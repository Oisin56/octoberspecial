"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./Providers";
import { cutClip, flushClips, getTrimmer, queueClip, sendClip, trimmerCached } from "@/lib/trimmer";
import { toRoundCfg } from "@/lib/types";

const TAGS = ["birdie", "eagle", "chip-in", "long putt", "great drive", "near miss", "water", "bunker", "lip-out", "shank", "banter"];

interface Cut {
  id: string;
  start: number;
  end: number;
  hole: number | null;
  playerIds: string[];
  tags: string[];
  note: string;
  status: "ready" | "cutting" | "uploading" | "posted" | "queued" | "failed";
  progress?: number;
  error?: string;
}

const t1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function ClipTrimmer({
  file,
  roundId,
  defaultHole,
  onDone,
  onCancel,
}: {
  file: File;
  roundId: string | null;
  defaultHole: number | null;
  onDone: (posted: number, queued: number) => void;
  onCancel: () => void;
}) {
  const { state, slug, session, refresh } = useT();
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [hole, setHole] = useState<number | null>(defaultHole);
  const [players, setPlayers] = useState<string[]>(session?.playerId ? [session.playerId] : []);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [thumbs, setThumbs] = useState<{ t: number; src: string }[]>([]);
  const [tools, setTools] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // Who might be playing: everyone in this round's matches
  const roundPlayers = useMemo(() => {
    if (!state) return [];
    const r = state.rounds.find((x) => x.id === roundId);
    if (!r) return state.players;
    const ids = new Set(toRoundCfg(r, state.players).games.flatMap((g) => g.sides.flatMap((s) => s.playerIds)));
    return state.players.filter((p) => ids.has(p.id));
  }, [state, roundId]);

  // Start loading the video tools straight away (cached after the first time)
  useEffect(() => {
    setTools("loading");
    getTrimmer()
      .then(() => setTools("ready"))
      .catch(() => setTools("failed"));
  }, []);

  // A strip of thumbnails to find the shots in a long recording
  useEffect(() => {
    if (!duration) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    const n = Math.min(16, Math.max(6, Math.round(duration / 20)));
    const canvas = document.createElement("canvas");
    const out: { t: number; src: string }[] = [];
    const grab = (i: number) => {
      if (cancelled || i >= n) return;
      const t = ((i + 0.5) / n) * duration;
      v.currentTime = t;
      v.onseeked = () => {
        if (cancelled) return;
        const w = 160;
        const h = Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * w) || 90;
        canvas.width = w;
        canvas.height = h;
        try {
          canvas.getContext("2d")!.drawImage(v, 0, 0, w, h);
          out.push({ t, src: canvas.toDataURL("image/jpeg", 0.6) });
          setThumbs([...out]);
        } catch {
          /* some formats can't be drawn: skip thumbnails */
          return;
        }
        grab(i + 1);
      };
    };
    v.onloadeddata = () => grab(0);
    return () => {
      cancelled = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [url, duration]);

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, t));
    setNow(v.currentTime);
  }

  function playSelection() {
    const v = video.current;
    if (!v) return;
    v.currentTime = start;
    stopAt.current = end;
    v.play();
  }

  function addCut() {
    if (end - start < 0.5) return setMsg("Mark a start and an end first (at least half a second).");
    setCuts([...cuts, { id: crypto.randomUUID(), start, end, hole, playerIds: players, tags, note: note.trim(), status: "ready" }]);
    setTags([]);
    setNote("");
    setMsg(`Cut ${cuts.length + 1} added. Mark the next shot, or post.`);
    // Move on past this cut so the next one is easy to mark
    const next = Math.min(duration, end + 1);
    setStart(next);
    setEnd(next);
    seek(next);
  }

  function update(id: string, patch: Partial<Cut>) {
    setCuts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function postAll() {
    if (!cuts.length) return;
    setPosting(true);
    setMsg(null);
    let posted = 0;
    let queued = 0;
    for (const c of cuts) {
      if (c.status === "posted" || c.status === "queued") continue;
      try {
        update(c.id, { status: "cutting", error: undefined });
        const blob = await cutClip(file, c.start, c.end);
        if (blob.size > 50 * 1024 * 1024) throw new Error("This cut is over 50 MB. Make it shorter.");
        const meta = {
          roundId,
          hole: c.hole,
          body: c.note,
          tags: c.tags,
          playerIds: c.playerIds,
          clipStart: Math.round(c.start * 10) / 10,
          clipEnd: Math.round(c.end * 10) / 10,
        };
        update(c.id, { status: "uploading", progress: 0 });
        try {
          await sendClip({ slug, blob, filename: "clip.mp4", meta }, (p) => update(c.id, { progress: p }));
          update(c.id, { status: "posted" });
          posted++;
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status && status < 500 && status !== 408) throw e;
          // No signal (or server busy): keep it on the phone and send later
          await queueClip({ id: c.id, slug, blob, filename: "clip.mp4", meta, at: Date.now() });
          update(c.id, { status: "queued" });
          queued++;
        }
      } catch (e) {
        update(c.id, { status: "failed", error: e instanceof Error ? e.message : "Failed" });
      }
    }
    setPosting(false);
    refresh();
    flushClips(slug).catch(() => undefined);
    if (posted || queued) onDone(posted, queued);
  }

  const holes = state?.rounds.find((r) => r.id === roundId)?.holes ?? Array.from({ length: 18 }, (_, i) => ({ number: i + 1 }));
  const selLen = Math.max(0, end - start);

  return (
    <div className="stack">
      <video
        ref={video}
        src={url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLVideoElement).duration;
          setDuration(d);
          setEnd(Math.min(d, 8));
        }}
        onTimeUpdate={(e) => {
          const v = e.target as HTMLVideoElement;
          setNow(v.currentTime);
          if (stopAt.current != null && v.currentTime >= stopAt.current) {
            v.pause();
            stopAt.current = null;
          }
        }}
        style={{ width: "100%", maxHeight: "45vh", background: "#000", borderRadius: 8 }}
      />

      {thumbs.length > 0 && (
        <div className="thumbs" aria-label="Jump to a point in the video">
          {thumbs.map((th) => (
            <button key={th.t} onClick={() => seek(th.t)} aria-label={`Jump to ${t1(th.t)}`} className={now >= th.t - duration / thumbs.length / 2 && now < th.t + duration / thumbs.length / 2 ? "on" : ""}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={th.src} alt="" />
              <span>{t1(th.t)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="trim-bar" aria-hidden>
        <div className="sel" style={{ left: `${(start / (duration || 1)) * 100}%`, width: `${(selLen / (duration || 1)) * 100}%` }} />
        {cuts.map((c) => (
          <div key={c.id} className="cut" style={{ left: `${(c.start / (duration || 1)) * 100}%`, width: `${((c.end - c.start) / (duration || 1)) * 100}%` }} />
        ))}
        <div className="head" style={{ left: `${(now / (duration || 1)) * 100}%` }} />
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="display">Now {t1(now)} of {t1(duration)}</span>
        <span className="display">
          Selected {t1(start)} – {t1(end)} ({selLen.toFixed(1)}s)
        </span>
      </div>
      <div className="trim-buttons">
        <button className="btn secondary" onClick={() => (setStart(now), now >= end && setEnd(Math.min(duration, now + 6)))}>
          Start here
        </button>
        <button className="btn secondary" onClick={() => (setEnd(now), now <= start && setStart(Math.max(0, now - 6)))}>
          End here
        </button>
        <button className="btn secondary" onClick={() => seek(now - 2)}>
          −2s
        </button>
        <button className="btn secondary" onClick={() => seek(now + 2)}>
          +2s
        </button>
        <button className="btn secondary" onClick={playSelection} disabled={selLen < 0.5}>
          Play selection
        </button>
      </div>
      <details>
        <summary className="small display">Fine-tune with sliders</summary>
        <label className="field">
          <span className="lbl">Start {t1(start)}</span>
          <input type="range" min={0} max={duration || 0} step={0.1} value={start} onChange={(e) => (setStart(Number(e.target.value)), seek(Number(e.target.value)))} />
        </label>
        <label className="field">
          <span className="lbl">End {t1(end)}</span>
          <input type="range" min={0} max={duration || 0} step={0.1} value={end} onChange={(e) => (setEnd(Number(e.target.value)), seek(Number(e.target.value)))} />
        </label>
      </details>

      <div className="post stack">
        <div className="row">
          <label className="field" style={{ flex: "0 0 110px" }}>
            <span className="lbl">Hole</span>
            <select value={hole ?? ""} onChange={(e) => setHole(e.target.value ? Number(e.target.value) : null)}>
              <option value="">–</option>
              {holes.map((h) => (
                <option key={h.number} value={h.number}>
                  {h.number}
                </option>
              ))}
            </select>
          </label>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <span className="lbl">Who&apos;s playing the shot</span>
            <div className="row" style={{ gap: 4 }}>
              {roundPlayers.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={players.includes(p.id)} onClick={() => setPlayers(players.includes(p.id) ? players.filter((x) => x !== p.id) : [...players, p.id])}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {TAGS.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t].slice(0, 5))}>
              {t}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="lbl">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Tee shot, right at the flag" maxLength={200} />
        </label>
        <button className="btn" onClick={addCut} disabled={selLen < 0.5}>
          Add this cut
        </button>
      </div>

      {cuts.length > 0 && (
        <div className="stack">
          <h3>
            {cuts.length} cut{cuts.length > 1 ? "s" : ""} to post
          </h3>
          {cuts.map((c, i) => (
            <div key={c.id} className="post row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong className="display">
                  {i + 1}. Hole {c.hole ?? "–"} · {t1(c.start)}–{t1(c.end)}
                </strong>{" "}
                <span className="small muted">
                  {c.playerIds.map((p) => state?.players.find((x) => x.id === p)?.name).join(" & ")}
                  {c.tags.length ? ` · ${c.tags.join(", ")}` : ""}
                  {c.note ? ` · ${c.note}` : ""}
                </span>
                {c.status === "failed" && <span className="error small"> · {c.error}</span>}
              </span>
              <span className="display small">
                {c.status === "ready" && (
                  <button className="chip" onClick={() => setCuts(cuts.filter((x) => x.id !== c.id))} disabled={posting}>
                    Remove
                  </button>
                )}
                {c.status === "cutting" && "Cutting…"}
                {c.status === "uploading" && `Uploading ${Math.round((c.progress ?? 0) * 100)}%`}
                {c.status === "posted" && "Posted ✓"}
                {c.status === "queued" && "Saved, sends when there's signal"}
                {c.status === "failed" && (
                  <button className="chip" onClick={() => update(c.id, { status: "ready" })}>
                    Try again
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="display" aria-live="polite">{msg}</p>}
      {tools === "loading" && !trimmerCached() && <p className="small muted">Getting the video tools ready (about 30 MB, first time only)…</p>}
      {tools === "failed" && <p className="error small">The video tools didn&apos;t load. Check your signal, or use &quot;Post the whole video&quot; instead.</p>}

      <div className="sticky-save row" style={{ justifyContent: "space-between" }}>
        <button className="btn secondary" onClick={onCancel} disabled={posting}>
          Back
        </button>
        <button className="btn" style={{ fontSize: 20 }} onClick={postAll} disabled={posting || !cuts.some((c) => c.status === "ready") || tools !== "ready"}>
          {posting ? "Posting…" : `Post ${cuts.filter((c) => c.status === "ready").length || ""} clip${cuts.filter((c) => c.status === "ready").length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
