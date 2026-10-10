"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./Providers";
import { CLUBS, RESULTS, SHOTS, groupPlayers, resultTags } from "@/lib/courseCards";
import { flushClips, queueClip } from "@/lib/trimmer";
import { readScorePos } from "@/lib/scorePos";

type Step = "trim" | "who" | "shot" | "result" | "club" | "done";
const ORDER: Step[] = ["trim", "who", "shot", "result", "club", "done"];
const t1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * A clip just filmed: trim it with two big handles (nothing is cut on the phone, the film just plays the
 * chosen part), then say who, what shot, how it finished and the club, one tap each. Saved on the phone
 * and sent in the background, so it's straight back to the scorecard.
 */
export function ClipDetail({ blob, roundId, hole, onDone, onCancel }: { blob: Blob; roundId: string | null; hole: number | null; onDone: (msg: string) => void; onCancel: () => void }) {
  const { state, session, slug } = useT();
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const video = useRef<HTMLVideoElement>(null);
  const [dur, setDur] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [step, setStep] = useState<Step>("trim");
  const [who, setWho] = useState<string[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [club, setClub] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  const players = useMemo(() => {
    if (!state || !roundId) return state?.players ?? [];
    const pos = readScorePos(slug, roundId);
    const g = groupPlayers(state, roundId, pos?.game, session?.playerId);
    return g.length ? g : state.players;
  }, [state, roundId, slug, session?.playerId]);

  // Play the chosen part on a loop
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => {
      if (range[1] > range[0] && (v.currentTime > range[1] || v.currentTime < range[0] - 0.05)) v.currentTime = range[0];
    };
    v.addEventListener("timeupdate", tick);
    return () => v.removeEventListener("timeupdate", tick);
  }, [range]);

  const go = (s: Step) => setStep(s);
  const back = () => {
    const i = ORDER.indexOf(step);
    if (i === 0) return onCancel();
    let prev = ORDER[i - 1];
    if (prev === "club" && shot === "Putt") prev = "result";
    setStep(prev);
  };

  // A likely result from the scorecard: a putt on a hole the player made par or better on probably dropped
  const suggestion = useMemo(() => {
    if (!state || !roundId || !hole || shot !== "Putt" || who.length !== 1) return null;
    const round = state.rounds.find((r) => r.id === roundId);
    const par = round?.holes.find((h) => h.number === hole)?.par;
    const e = state.entries.filter((x) => x.round_id === roundId && x.hole === hole).map((x) => x.scores[who[0]]).find(Boolean);
    return par && e?.gross != null && e.gross <= par ? "Holed" : null;
  }, [state, roundId, hole, shot, who]);

  async function post() {
    setBusy(true);
    const names = who.map((id) => state?.players.find((p) => p.id === id)?.name ?? id);
    const summary = [names.join(" & "), shot?.toLowerCase(), result?.toLowerCase()].filter(Boolean).join(" · ");
    const ext = /mp4/.test(blob.type) ? "mp4" : /quicktime/.test(blob.type) ? "mov" : "webm";
    const whole = range[0] <= 0.05 && (!dur || range[1] >= dur - 0.05);
    await queueClip({
      id: crypto.randomUUID(),
      slug,
      blob,
      filename: `clip-${Date.now()}.${ext}`,
      at: Date.now(),
      meta: {
        roundId,
        hole,
        body: caption.trim() || summary,
        tags: resultTags(shot ?? undefined, result ?? undefined),
        playerIds: who,
        trimIn: whole ? null : Math.round(range[0] * 10) / 10,
        trimOut: whole ? null : Math.round(range[1] * 10) / 10,
        details: { ...(shot ? { shot } : {}), ...(result ? { result } : {}), ...(club ? { club } : {}) },
      },
    });
    flushClips(slug); // carries on in the background
    onDone(navigator.onLine ? "Clip saved. It's uploading now." : "Clip saved on this phone. It'll send when there's signal.");
  }

  const title: Record<Step, string> = {
    trim: "Trim the clip",
    who: "Who's playing the shot?",
    shot: "What shot?",
    result: "How did it finish?",
    club: "Which club?",
    done: "Ready to post",
  };
  const n = ORDER.indexOf(step);

  return (
    <div className="cd" role="dialog" aria-label={title[step]}>
      <div className="cd-head">
        <button className="cd-back" onClick={back}>
          ‹ {n === 0 ? "Scorecard" : "Back"}
        </button>
        <div className="cd-dots" aria-hidden="true">
          {ORDER.map((s, i) => (
            <span key={s} className={i <= n ? "on" : ""} />
          ))}
        </div>
      </div>
      <h2 className="cd-title">{title[step]}</h2>

      {step === "trim" && (
        <div className="cd-body cd-trim">
          <video
            ref={video}
            src={url}
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={(e) => {
              const d = (e.target as HTMLVideoElement).duration;
              // Safari reports Infinity for fresh recordings until it has read the whole file
              if (Number.isFinite(d)) {
                setDur(d);
                setRange([0, d]);
              } else {
                const v = e.target as HTMLVideoElement;
                v.currentTime = 1e6;
                v.addEventListener(
                  "timeupdate",
                  () => {
                    const real = v.duration;
                    v.currentTime = 0;
                    if (Number.isFinite(real)) {
                      setDur(real);
                      setRange([0, real]);
                    }
                  },
                  { once: true },
                );
              }
            }}
          />
          {dur > 0 && <TrimBar dur={dur} range={range} onChange={(r, which) => { setRange(r); if (video.current) video.current.currentTime = which === 0 ? r[0] : Math.max(r[0], r[1] - 1); }} />}
          <p className="cd-note">
            {dur > 0 ? `Keeping ${t1(range[1] - range[0])} of ${t1(dur)}. Drag the ends to trim.` : "Loading the clip…"}
          </p>
        </div>
      )}

      {step === "who" && (
        <div className="cd-body">
          <div className="cd-grid two">
            {players.map((p) => (
              <button key={p.id} className="cd-tile" onClick={() => (setWho([p.id]), go("shot"))}>
                {p.name}
              </button>
            ))}
            {players.length > 1 && (
              <button className="cd-tile soft" onClick={() => (setWho(players.map((p) => p.id)), go("shot"))}>
                The whole group
              </button>
            )}
          </div>
        </div>
      )}

      {step === "shot" && (
        <div className="cd-body">
          <div className="cd-grid two">
            {SHOTS.map((s) => (
              <button key={s} className="cd-tile" onClick={() => (setShot(s), setResult(null), go("result"))}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "result" && shot && (
        <div className="cd-body">
          <div className="cd-grid two">
            {RESULTS[shot].map((r) => (
              <button
                key={r}
                className={`cd-tile${r === suggestion ? " likely" : ""}`}
                onClick={() => {
                  setResult(r);
                  if (shot === "Putt") {
                    setClub("Putter");
                    go("done");
                  } else go("club");
                }}
              >
                {r}
                {r === suggestion && <small>From the scorecard</small>}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "club" && (
        <div className="cd-body">
          <div className="cd-grid three">
            {CLUBS.filter((c) => c !== "Putter").map((c) => (
              <button key={c} className="cd-tile small" onClick={() => (setClub(c), go("done"))}>
                {c}
              </button>
            ))}
            <button className="cd-tile small soft" onClick={() => (setClub(null), go("done"))}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="cd-body cd-done">
          <p className="cd-summary">
            {[who.map((id) => state?.players.find((p) => p.id === id)?.name).join(" & "), shot, result, club].filter(Boolean).join(" · ")}
            {hole ? ` · hole ${hole}` : ""}
          </p>
          <label className="cd-cap">
            <span>Caption (optional)</span>
            <textarea value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="Say what happened, if you like" />
          </label>
        </div>
      )}

      <div className="cd-foot">
        {step === "trim" && (
          <button className="btn block cd-primary" disabled={!dur} onClick={() => go("who")}>
            Next
          </button>
        )}
        {step === "done" && (
          <button className="btn block cd-primary" disabled={busy} onClick={post}>
            {busy ? "Saving…" : "Post the clip"}
          </button>
        )}
        {step !== "trim" && step !== "done" && (
          <button className="btn secondary block cd-primary" onClick={() => go("done")}>
            Skip the rest and post
          </button>
        )}
      </div>
    </div>
  );
}

/** Two big handles on the clip's timeline: drag the start and the end. */
function TrimBar({ dur, range, onChange }: { dur: number; range: [number, number]; onChange: (r: [number, number], which: 0 | 1) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const at = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur));
  };
  const move = (x: number) => {
    if (drag.current == null) return;
    const v = at(x);
    const min = Math.min(1, dur / 2);
    const next: [number, number] = drag.current === 0 ? [Math.min(v, range[1] - min), range[1]] : [range[0], Math.max(v, range[0] + min)];
    onChange(next, drag.current);
  };
  const pct = (v: number) => `${(v / dur) * 100}%`;
  return (
    <div
      className="trimbar"
      ref={bar}
      onPointerDown={(e) => {
        const v = at(e.clientX);
        drag.current = Math.abs(v - range[0]) <= Math.abs(v - range[1]) ? 0 : 1;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => move(e.clientX)}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      role="group"
      aria-label="Trim the clip"
    >
      <div className="keep" style={{ left: pct(range[0]), right: `${100 - (range[1] / dur) * 100}%` }} />
      <div className="handle" style={{ left: pct(range[0]) }} aria-label="Start" />
      <div className="handle end" style={{ left: pct(range[1]) }} aria-label="End" />
    </div>
  );
}
