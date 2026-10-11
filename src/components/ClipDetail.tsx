"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./Providers";
import { groupPlayers } from "@/lib/courseCards";
import { CLUB_GROUPS, KIND_LABEL, kindsFor, outcomesFor, tagsFor, type HoleInfo, type ShotKind } from "@/lib/shots";
import { flushShots, saveShot } from "@/lib/shotQueue";
import { flushClips, queueClip } from "@/lib/trimmer";
import { readScorePos } from "@/lib/scorePos";
import { HoldToTalk } from "./HoldToTalk";

type Step = "trim" | "who" | "shot" | "result" | "club" | "done" | "another";
/** Recordings longer than this can have more than one shot cut from them */
const MULTI_SECONDS = 25;
const ORDER: Step[] = ["trim", "who", "shot", "result", "club", "done"];
const t1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * A clip just filmed: trim it with two big handles (nothing is cut on the phone, the film just plays the
 * chosen part), then say who, what shot, how it finished and the club, one tap each. Saved on the phone
 * and sent in the background, so it's straight back to the scorecard.
 */
export function ClipDetail({
  blob,
  roundId,
  hole,
  holeInfo,
  prefill,
  onDone,
  onCancel,
  backLabel = "Scorecard",
}: {
  blob: Blob;
  /** Where the first Back goes */
  backLabel?: string;
  roundId: string | null;
  hole: number | null;
  holeInfo?: HoleInfo;
  /** From the shot just logged for this player: who, what and how it finished are already known */
  prefill?: { playerId: string; kind?: string; outcome?: string; club?: string | null; shotClientId?: string } | null;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const { state, session, slug } = useT();
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const video = useRef<HTMLVideoElement>(null);
  const [dur, setDur] = useState(0);
  const [shape, setShape] = useState<"portrait" | "landscape" | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [step, setStep] = useState<Step>("trim");
  const info: HoleInfo = holeInfo ?? { par: 4 };
  const [who, setWho] = useState<string[]>(prefill?.playerId ? [prefill.playerId] : []);
  const [shot, setShot] = useState<ShotKind | null>((prefill?.kind as ShotKind) ?? null);
  const [result, setResult] = useState<string | null>(prefill?.outcome ?? null);
  const [club, setClub] = useState<string | null>(prefill?.club ?? null);
  /** Shots already cut from this recording (shaded on the trim bar) */
  const [used, setUsed] = useState<[number, number][]>([]);
  const shared = useRef<string | null>(null);
  const complete = used.length === 0 && !!(prefill?.playerId && prefill.kind && prefill.outcome);
  const [caption, setCaption] = useState("");
  /** For the highlights film only: kept out of the feed */
  const [filmOnly, setFilmOnly] = useState(false);
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
    if (i === 0) return used.length ? setStep("another") : onCancel();
    let prev = ORDER[i - 1];
    if (prev === "club" && shot === "putt") prev = "result";
    setStep(prev);
  };

  async function post() {
    setBusy(true);
    const names = who.map((id) => state?.players.find((p) => p.id === id)?.name ?? id);
    const summary = [names.join(" & "), shot ? KIND_LABEL[shot].toLowerCase() : null, result?.toLowerCase()].filter(Boolean).join(" · ");
    // The clip is a shot: link it to the one logged, or log it now (one player, a shot and how it finished)
    const unchanged = complete && who[0] === prefill!.playerId && shot === prefill!.kind && result === prefill!.outcome;
    let shotId = unchanged ? prefill!.shotClientId : undefined;
    if (!shotId && roundId && hole && who.length === 1 && shot && result) {
      shotId = crypto.randomUUID();
      saveShot(slug, shotId, { roundId, hole, playerId: who[0], kind: shot, outcome: result, club, distance: null, loggedAt: new Date().toISOString(), author: session?.name ?? "" });
      flushShots(slug);
    }
    const ext = /mp4/.test(blob.type) ? "mp4" : /quicktime/.test(blob.type) ? "mov" : "webm";
    const whole = range[0] <= 0.05 && (!dur || range[1] >= dur - 0.05);
    // A long recording may give several shots: it's uploaded once and each shot points at its own part
    const multi = dur > MULTI_SECONDS;
    const first = !shared.current;
    if (multi && first) shared.current = crypto.randomUUID();
    await queueClip({
      id: crypto.randomUUID(),
      slug,
      blob: multi && !first ? new Blob([], { type: blob.type }) : blob,
      ...(multi ? { shared: shared.current! } : {}),
      filename: `clip-${Date.now()}.${ext}`,
      at: Date.now(),
      meta: {
        roundId,
        hole,
        body: caption.trim() || summary,
        tags: shot && result ? tagsFor(shot, result) : [],
        playerIds: who,
        trimIn: whole ? null : Math.round(range[0] * 10) / 10,
        trimOut: whole ? null : Math.round(range[1] * 10) / 10,
        details: {
          ...(shot ? { shot: KIND_LABEL[shot] } : {}),
          ...(result ? { result } : {}),
          ...(club ? { club } : {}),
          ...(shotId ? { shotId } : {}),
          ...(shape ? { shape } : {}),
          ...(dur ? { dur: Math.round(dur * 10) / 10 } : {}),
        },
        ...(filmOnly ? { visibility: "report" } : {}),
      },
    });
    flushClips(slug); // carries on in the background
    const n = used.length + 1;
    setUsed((u) => [...u, range]);
    setBusy(false);
    if (multi) return setStep("another");
    finish(n);
  }

  function finish(n: number) {
    const what = n > 1 ? `${n} shots saved` : filmOnly ? "Saved for the film" : "Clip saved";
    onDone(navigator.onLine ? `${what}. ${n > 1 ? "They're" : "It's"} uploading now.` : `${what} on this phone. ${n > 1 ? "They'll" : "It'll"} send when there's signal.`);
  }

  /** Another shot from the same recording: the trim starts after the last one, everything else is asked again. */
  function another() {
    const lastEnd = Math.max(...used.map((u) => u[1]));
    const start = lastEnd < dur - 1 ? lastEnd : 0;
    setRange([start, dur]);
    if (video.current) video.current.currentTime = start;
    setWho([]);
    setShot(null);
    setResult(null);
    setClub(null);
    setCaption("");
    setFilmOnly(false);
    setStep("trim");
  }

  const title: Record<Step, string> = {
    trim: "Trim the clip",
    who: "Who's playing the shot?",
    shot: "What shot?",
    result: "How did it finish?",
    club: "Which club?",
    done: "Ready to post",
    another: "Saved. Another shot in this clip?",
  };
  const n = ORDER.indexOf(step);

  return (
    <div className="cd" role="dialog" aria-label={title[step]}>
      <div className="cd-head">
        {step !== "another" ? (
          <button className="cd-back" onClick={back}>
            ‹ {n === 0 ? (used.length ? "Back" : backLabel) : "Back"}
          </button>
        ) : (
          <span />
        )}
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
              // Back for another shot: the length is known and the range is set; just start where it starts
              if (dur > 0) {
                (e.target as HTMLVideoElement).currentTime = range[0];
                return;
              }
              const d = (e.target as HTMLVideoElement).duration;
              const vw = (e.target as HTMLVideoElement).videoWidth;
              const vh = (e.target as HTMLVideoElement).videoHeight;
              if (vw && vh) setShape(vh > vw ? "portrait" : "landscape");
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
          {dur > 0 && <TrimBar dur={dur} range={range} used={used} onChange={(r, which) => { setRange(r); if (video.current) video.current.currentTime = which === 0 ? r[0] : Math.max(r[0], r[1] - 1); }} />}
          <p className="cd-note">
            {dur > 0 ? `Keeping ${t1(range[1] - range[0])} of ${t1(dur)}. Drag the ends to trim.${used.length ? " Shaded parts are shots you've already cut." : ""}` : "Loading the clip…"}
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
            {kindsFor(info).map((k) => (
              <button key={k} className="cd-tile" onClick={() => (setShot(k), setResult(null), go("result"))}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "result" && shot && (
        <div className="cd-body">
          <div className="cd-grid two">
            {outcomesFor(shot, info).map((r) => (
              <button
                key={r}
                className="cd-tile"
                onClick={() => {
                  setResult(r);
                  if (shot === "putt") {
                    setClub("Putter");
                    go("done");
                  } else go("club");
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "club" && (
        <div className="cd-body">
          <div className="cd-grid three">
            {CLUB_GROUPS.map((c) => (
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
            {[who.map((id) => state?.players.find((p) => p.id === id)?.name).join(" & "), shot ? KIND_LABEL[shot] : null, result, club].filter(Boolean).join(" · ")}
            {hole ? ` · hole ${hole}` : ""}
          </p>
          <HoldToTalk onText={(t) => setCaption((c) => (c ? `${c} ${t}` : t))} />
          <label className="cd-cap">
            <span>Caption (optional): say it, or type it</span>
            <textarea value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder="Say what happened, if you like" />
          </label>
          <button type="button" className="cd-film-only" role="switch" aria-checked={filmOnly} onClick={() => setFilmOnly((v) => !v)}>
            <span className="box" aria-hidden="true">{filmOnly ? "✓" : ""}</span>
            <span>
              <strong>Highlights film only</strong>
              <small>{filmOnly ? "Kept out of the feed. The film can still use it." : "Leave unticked to post it to the feed too"}</small>
            </span>
          </button>
        </div>
      )}

      {step === "another" && (
        <div className="cd-body cd-another">
          <p className="cd-note">
            {used.length} shot{used.length > 1 ? "s" : ""} saved from this recording. Two players&apos; putts, a drive and an approach: each can be its own clip, with one upload.
          </p>
          <button className="btn block cd-primary" onClick={another}>
            Cut another shot from this clip
          </button>
          <button className="btn secondary block cd-primary" onClick={() => finish(used.length)}>
            Back to the {backLabel.toLowerCase()}
          </button>
        </div>
      )}

      <div className="cd-foot" hidden={step === "another"}>
        {step === "trim" && (
          <button className="btn block cd-primary" disabled={!dur} onClick={() => go(complete ? "done" : "who")}>
            Next
          </button>
        )}
        {step === "done" && (
          <button className="btn block cd-primary" disabled={busy} onClick={post}>
            {busy ? "Saving…" : filmOnly ? "Save for the film" : "Post the clip"}
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
function TrimBar({ dur, range, used = [], onChange }: { dur: number; range: [number, number]; used?: [number, number][]; onChange: (r: [number, number], which: 0 | 1) => void }) {
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
      {used.map((u, i) => (
        <div key={i} className="used" style={{ left: pct(u[0]), right: `${100 - (u[1] / dur) * 100}%` }} aria-hidden="true" />
      ))}
      <div className="keep" style={{ left: pct(range[0]), right: `${100 - (range[1] / dur) * 100}%` }} />
      <div className="handle" style={{ left: pct(range[0]) }} aria-label="Start" />
      <div className="handle end" style={{ left: pct(range[1]) }} aria-label="End" />
    </div>
  );
}
