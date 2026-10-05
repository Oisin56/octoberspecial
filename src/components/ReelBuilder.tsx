"use client";

import { useMemo, useRef, useState } from "react";
import { useT } from "./Providers";
import { mediaUrl } from "@/lib/supabase";

/* The browser build of ffmpeg is served from /ffmpeg (copied at build time).
   Everything runs on this computer: no video service, no upload until you choose. */
type FFmpegLike = {
  load: (o: { coreURL: string; wasmURL: string }) => Promise<boolean>;
  writeFile: (name: string, data: Uint8Array) => Promise<boolean>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  exec: (args: string[]) => Promise<number>;
  deleteFile: (name: string) => Promise<boolean>;
  on: (ev: "progress" | "log", cb: (e: { progress?: number; message?: string }) => void) => void;
};

export function ReelBuilder() {
  const { state, api, refresh } = useT();
  const [roundNo, setRoundNo] = useState<string>("all");
  const [quality, setQuality] = useState<"540" | "720">("540");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ url: string; blob: Blob } | null>(null);
  const [pct, setPct] = useState(0);
  const ff = useRef<FFmpegLike | null>(null);
  const logSink = useRef<((m: string) => void) | null>(null);
  const logTail = useRef<string[]>([]);
  const [details, setDetails] = useState<string | null>(null);

  const clips = useMemo(() => {
    if (!state) return [];
    const num = (id: string | null) => state.rounds.find((r) => r.id === id)?.number ?? 99;
    return state.posts
      .filter((p) => p.kind === "video" && p.media_path)
      .filter((p) => roundNo === "all" || String(num(p.round_id)) === roundNo)
      .sort((a, b) => num(a.round_id) - num(b.round_id) || (a.hole ?? 0) - (b.hole ?? 0) || a.created_at.localeCompare(b.created_at));
  }, [state, roundNo]);

  async function getFF() {
    if (ff.current) return ff.current;
    setStatus("Loading the video tools (about 30 MB, first time only)…");
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/ffmpeg/index.js" as string);
    const inst = new mod.FFmpeg() as FFmpegLike;
    await inst.load({ coreURL: "/ffmpeg/core/ffmpeg-core.js", wasmURL: "/ffmpeg/core/ffmpeg-core.wasm" });
    inst.on("log", (e) => {
      const m = e.message ?? "";
      logSink.current?.(m);
      logTail.current = [...logTail.current.slice(-11), m];
    });
    inst.on("progress", (e) => setPct(Math.round((e.progress ?? 0) * 100)));
    ff.current = inst;
    return inst;
  }

  async function build() {
    if (!clips.length) return;
    setBusy(true);
    setOut(null);
    setDetails(null);
    try {
      const f = await getFF();
      const h = quality === "720" ? 720 : 540;
      const parts: string[] = [];
      const skipped: string[] = [];
      for (const [i, c] of clips.entries()) {
        setStatus(`Preparing clip ${i + 1} of ${clips.length}…`);
        setPct(0);
        const res = await fetch(mediaUrl(c.media_path)!);
        if (!res.ok) {
          skipped.push(`hole ${c.hole ?? "–"} by ${c.author_name} (download failed)`);
          continue;
        }
        const inName = `in${i}`;
        await f.writeFile(inName, new Uint8Array(await res.arrayBuffer()));
        const partName = `p${i}.mp4`;
        // Does this clip have sound? (ffmpeg prints stream info when probing)
        let hasAudio = false;
        logSink.current = (m) => {
          if (/Stream #.*Audio/.test(m)) hasAudio = true;
        };
        await f.exec(["-hide_banner", "-i", inName]);
        logSink.current = null;
        // Same size, frame rate and one stereo track for every part so they join cleanly
        const code = await f.exec([
          "-i", inName,
          "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a",
          "-vf", `scale=-2:${h}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:${h}:(ow-iw)/2:0,fps=30,format=yuv420p`,
          "-t", "45",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", quality === "720" ? "28" : "30",
          "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest",
          partName,
        ]);
        await f.deleteFile(inName);
        if (code !== 0) {
          skipped.push(`hole ${c.hole ?? "–"} by ${c.author_name}`);
          continue;
        }
        parts.push(partName);
      }
      if (!parts.length) throw new Error("None of the clips could be read");
      setStatus("Joining the clips…");
      const list = parts.map((p) => `file '${p}'`).join("\n");
      await f.writeFile("list.txt", new TextEncoder().encode(list));
      const code = await f.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "reel.mp4"]);
      if (code !== 0) throw new Error("Joining failed");
      const data = await f.readFile("reel.mp4");
      for (const p of parts) await f.deleteFile(p);
      const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
      setOut({ url: URL.createObjectURL(blob), blob });
      setStatus(
        `Reel ready: ${parts.length} clip${parts.length === 1 ? "" : "s"}, ${(blob.size / 1048576).toFixed(1)} MB.` +
          (skipped.length ? ` Skipped ${skipped.length} that couldn't be read: ${skipped.join("; ")}.` : ""),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Something went wrong building the reel");
      setDetails(logTail.current.join("\n"));
    } finally {
      setBusy(false);
      setPct(0);
    }
  }

  async function publish() {
    if (!out) return;
    if (out.blob.size > 50 * 1048576) return setStatus("The reel is over 50 MB. Build it at 540p or for one round at a time.");
    setBusy(true);
    setStatus("Uploading the reel…");
    const r = await api("/api/upload-url", { filename: "reel.mp4", contentType: "video/mp4" });
    if (!r.ok) {
      setBusy(false);
      return setStatus(String(r.j.error ?? "Upload failed"));
    }
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", out.blob, "reel.mp4");
    const up = await fetch(String(r.j.signedUrl), { method: "PUT", body: fd, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" } });
    if (!up.ok) {
      setBusy(false);
      return setStatus("Upload failed");
    }
    const round = roundNo === "all" ? null : state?.rounds.find((x) => String(x.number) === roundNo);
    const p = await api("/api/posts", {
      kind: "video",
      mediaPath: r.j.path,
      roundId: round?.id ?? null,
      body: round ? `Highlights reel: Round ${round.number}, ${round.course_name}` : "Highlights reel: the whole tournament",
    });
    setBusy(false);
    setStatus(p.ok ? "Reel published to the feed." : String(p.j.error ?? "Couldn't publish"));
    if (p.ok) refresh();
  }

  if (!state) return null;
  return (
    <section className="panel stack">
      <h2>Quick reel (free, on this computer)</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Joins the video clips in round and hole order into one video, right here on this computer. Use a laptop: it takes a minute or two per few clips.
      </p>
      <div className="row">
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label>Which clips</label>
          <select value={roundNo} onChange={(e) => setRoundNo(e.target.value)}>
            <option value="all">Whole tournament</option>
            {state.rounds.map((r) => (
              <option key={r.id} value={String(r.number)}>
                R{r.number} {r.course_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 160px" }}>
          <label>Quality</label>
          <select value={quality} onChange={(e) => setQuality(e.target.value as "540" | "720")}>
            <option value="540">540p (smaller, faster)</option>
            <option value="720">720p</option>
          </select>
        </div>
      </div>
      <p className="display" style={{ margin: 0 }}>
        {clips.length} clip{clips.length === 1 ? "" : "s"} selected
      </p>
      <div className="row">
        <button className="btn" disabled={busy || !clips.length} onClick={build}>
          {busy && !out ? "Building…" : "Build reel"}
        </button>
        {out && (
          <>
            <a className="btn secondary" href={out.url} download="highlights.mp4">
              Download
            </a>
            <button className="btn" disabled={busy} onClick={publish}>
              Publish to the feed
            </button>
          </>
        )}
      </div>
      {status && (
        <p className="display" aria-live="polite" style={{ margin: 0 }}>
          {status}
          {busy && pct > 0 ? ` ${pct}%` : ""}
        </p>
      )}
      {details && (
        <details>
          <summary className="small">Technical details</summary>
          <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{details}</pre>
        </details>
      )}
      {out && <video src={out.url} controls playsInline style={{ width: "100%", maxHeight: "60vh", background: "#000", borderRadius: 6 }} />}
    </section>
  );
}
