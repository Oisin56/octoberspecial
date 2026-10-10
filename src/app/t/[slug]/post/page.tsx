"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { ClipTrimmer } from "@/components/ClipTrimmer";
import { TrimmerReady } from "@/components/TrimmerReady";
import { uploadPoster } from "@/lib/trimmer";

const TAGS = [
  "birdie", "eagle", "chip-in", "long putt", "3-putt", "water", "bunker", "OB",
  "lip-out", "shank", "great drive", "near miss", "banter", "weather", "rules",
];
const MAX_BYTES = 50 * 1024 * 1024;

function uploadWithProgress(signedUrl: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("No signal. The upload didn't go through."));
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    xhr.send(fd);
  });
}

function PostInner() {
  const { state, session, refresh, api, href, slug } = useT();
  const sp = useSearchParams();
  const router = useRouter();

  const defaultRound = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    return (
      (n && state.rounds.find((r) => r.number === Number(n))) ||
      state.rounds.find((r) => r.status === "live") ||
      null
    );
  }, [state, sp]);

  // Default hole: what the query says, else the hole currently being played
  const defaultHole = useMemo(() => {
    const q = sp.get("hole");
    if (q) return Number(q);
    if (!state || !defaultRound) return null;
    const done = state.entries.filter((e) => e.round_id === defaultRound.id).map((e) => e.hole);
    return done.length ? Math.min(18, Math.max(...done)) : 1;
  }, [sp, state, defaultRound]);

  const [roundId, setRoundId] = useState<string>("");
  const [hole, setHole] = useState<string>("");
  const [body, setBody] = useState(() => {
    try {
      return localStorage.getItem(`os_post_draft_${slug}`) ?? "";
    } catch {
      return "";
    }
  });
  const [tags, setTags] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [reportOnly, setReportOnly] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [trim, setTrim] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (defaultRound && !roundId) setRoundId(defaultRound.id);
    if (defaultHole && !hole) setHole(String(defaultHole));
  }, [defaultRound, defaultHole, roundId, hole]);

  useEffect(() => {
    try {
      localStorage.setItem(`os_post_draft_${slug}`, body);
    } catch {}
  }, [body]);

  if (!state) return <Loading />;
  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/post"))}`)}>Log in</Link> to post from the course.
      </p>
    );

  async function pick(f: File | null) {
    setWarn(null);
    setFile(f);
    setDone(null);
    if (!f) return;
    if (f.type.startsWith("video") || /\.(mov|mp4|m4v)$/i.test(f.name)) {
      setTrim(true); // videos go through the trimmer first
      return;
    }
    if (f.size > MAX_BYTES) setWarn(`That file is ${(f.size / 1048576).toFixed(0)} MB. The limit is 50 MB, so trim the clip or film at 1080p.`);
    if (f.type.startsWith("video")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (v.duration > 45) setWarn(`That clip is ${Math.round(v.duration)} seconds. Keep highlights under 30 seconds so they upload on the course.`);
        URL.revokeObjectURL(v.src);
      };
      v.src = URL.createObjectURL(f);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (file && file.size > MAX_BYTES) return setErr("File too big. The limit is 50 MB.");
    try {
      let mediaPath: string | null = null;
      if (file) {
        setProgress(0);
        const up = await api("/api/upload-url", { filename: file.name, contentType: file.type || "video/quicktime" });
        if (!up.ok) throw new Error(String(up.j.error ?? "Couldn't start the upload"));
        await uploadWithProgress(String(up.j.signedUrl), file, setProgress);
        mediaPath = String(up.j.path);
        if (file.type.startsWith("video")) await uploadPoster(slug, mediaPath, file);
      }
      const r = await api("/api/posts", {
        roundId: roundId || null,
        hole: hole ? Number(hole) : null,
        body,
        tags,
        kind: file ? (file.type.startsWith("video") ? "video" : "photo") : "note",
        mediaPath,
        visibility: reportOnly ? "report" : "public",
      });
      if (!r.ok) throw new Error(String(r.j.error ?? "Post didn't send"));
      setBody("");
      try {
        localStorage.removeItem(`os_post_draft_${slug}`);
      } catch {}
      await refresh();
      const rn = state?.rounds.find((x) => x.id === roundId)?.number;
      router.push(rn ? href(`/rounds/${rn}`) : href("/feed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Your text is saved; try again.");
    } finally {
      setProgress(null);
    }
  }

  if (trim && file) {
    return (
      <div className="scorer stack">
        <h1>Trim your video</h1>
        <p className="small muted" style={{ margin: 0 }}>
          Find each shot, mark its start and end, and add it as a cut. Only the cuts are uploaded; the full recording stays on your phone.
        </p>
        <ClipTrimmer
          file={file}
          roundId={roundId || null}
          defaultHole={hole ? Number(hole) : null}
          onCancel={() => (setTrim(false), setFile(null))}
          onDone={(posted, queued) => {
            setTrim(false);
            setFile(null);
            setDone(
              `${posted ? `${posted} clip${posted > 1 ? "s" : ""} posted. ` : ""}${queued ? `${queued} saved on this phone; they'll send when there's signal.` : ""}`,
            );
          }}
        />
        {file.size <= MAX_BYTES && (
          <button className="chip" onClick={() => setTrim(false)}>
            Post the whole video instead
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="scorer stack" onSubmit={submit}>
      <h1>Post from the course</h1>
      {done && <p className="notice">{done}</p>}
      {state.tournament.video_enabled && <TrimmerReady />}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="rd">Round</label>
          <select id="rd" value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            <option value="">General</option>
            {state.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.number} {r.course_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="hl">Hole</label>
          <select id="hl" value={hole} onChange={(e) => setHole(e.target.value)}>
            <option value="">–</option>
            {Array.from({ length: 18 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="bd">What happened?</label>
        <textarea
          id="bd"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tap the microphone on your keyboard to talk instead of typing"
          maxLength={2000}
        />
      </div>

      <div className="row" role="group" aria-label="Tags">
        {TAGS.map((t) => (
          <button
            type="button"
            key={t}
            className="chip"
            aria-pressed={tags.includes(t)}
            onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t].slice(0, 5)))}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="md">{state.tournament.video_enabled ? "Photo or video (optional)" : "Photo (optional)"}</label>
        <input id="md" type="file" accept={state.tournament.video_enabled ? "image/*,video/*" : "image/*"} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        {warn && <p className="notice">{warn}</p>}
      </div>

      <label className="row display" style={{ fontSize: 17 }}>
        <input type="checkbox" checked={reportOnly} onChange={(e) => setReportOnly(e.target.checked)} style={{ width: 22, height: 22 }} />
        Keep off the public feed (use in the report only)
      </label>

      {err && <p className="error">{err}</p>}
      {progress != null && (
        <div>
          <div style={{ height: 10, background: "var(--rule)", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "var(--board)" }} />
          </div>
          <p className="queue">Uploading {Math.round(progress * 100)}%</p>
        </div>
      )}
      <button className="btn block" style={{ fontSize: 22, padding: 14 }} disabled={progress != null || (!body.trim() && !file)}>
        Post
      </button>
    </form>
  );
}

export default function PostPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PostInner />
    </Suspense>
  );
}
