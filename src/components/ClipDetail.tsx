"use client";

import { takeClipFix } from "@/lib/clipFix";
import { flushGps, saveReading } from "@/lib/gpsQueue";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./Providers";
import { groupPlayers } from "@/lib/courseCards";
import { KIND_LABEL, tagsFor, type HoleInfo, type ShotKind } from "@/lib/shots";
import { shotWords } from "@/lib/detail";
import { flushClips, queueClip } from "@/lib/trimmer";
import { StrokeTeller, nth, useHoleTelling } from "./AddDetail";
import { readScorePos } from "@/lib/scorePos";
import { HoldToTalk } from "./HoldToTalk";
import { CLIP_TYPES } from "@/lib/film";
import type { ClipType } from "@/lib/types";

type Step = "trim" | "type" | "people" | "confirm" | "change" | "detail" | "done" | "another";
type Aside = Exclude<ClipType, "shot">;
/** Recordings longer than this can have more than one shot cut from them */
const MULTI_SECONDS = 25;
/** A shot: trim it, confirm the guess, post (Change and Add detail open from the confirm screen) */
const ORDER: Step[] = ["trim", "confirm"];
const LAST_PLAYER = (slug: string) => `mgs_shot_player_${slug}`;
/** An interview, a prediction, scene-setting: just who's in it */
const ASIDE_ORDER: Step[] = ["trim", "type", "people", "done"];
const t1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * A clip just filmed: trim it with two big handles (nothing is cut on the phone, the film just plays the chosen
 * part), then confirm the guess ("Neil's shot 3 on the 7th?") and post. Change opens the same player tabs and shot
 * list as Add detail; Add detail opens the same shot card. Saved on the phone and sent in the background.
 */
export function ClipDetail({
  blob,
  roundId,
  hole,
  prefill,
  onDone,
  onCancel,
  backLabel = "Scorecard",
  clipType,
  clipWhen,
  typeChoices,
}: {
  blob: Blob;
  /** Chosen on the camera before filming (no round being played) */
  clipType?: Aside;
  clipWhen?: "pre" | "post";
  /** Picked from the camera roll with no round being played: ask what it is */
  typeChoices?: { order: Aside[]; when: "pre" | "post"; roundId: string | null } | null;
  /** Where the first Back goes */
  backLabel?: string;
  roundId: string | null;
  hole: number | null;
  holeInfo?: HoleInfo;
  /** Filmed from a shot card: the player, and the stroke */
  prefill?: { playerId: string; seq?: number | null } | null;
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
  const T = useHoleTelling(roundId ?? "", hole ?? 0);
  const [who, setWho] = useState<string[]>(prefill?.playerId ? [prefill.playerId] : []);
  /** The stroke it shows (null = the next one, worked out when asked) */
  const [seq, setSeq] = useState<number | null>(prefill?.seq ?? null);
  /** The player tab open on Change */
  const [tab, setTab] = useState<string | null>(null);
  /** Shots already cut from this recording (shaded on the trim bar) */
  const [used, setUsed] = useState<[number, number][]>([]);
  const shared = useRef<string | null>(null);
  const [caption, setCaption] = useState("");
  /** For the highlights film only: kept out of the feed */
  const [filmOnly, setFilmOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Not a shot (an interview, a prediction…): set on the camera, from the list, or by "Not a shot?" during play */
  const [aside, setAside] = useState<Aside | null>(clipType ?? null);
  const asking = !!typeChoices && !clipType;
  const order = aside || asking ? ASIDE_ORDER.filter((x) => x !== "type" || asking) : ORDER;

  const players = useMemo(() => {
    if (!state || !roundId) return state?.players ?? [];
    const pos = readScorePos(slug, roundId);
    const g = groupPlayers(state, roundId, pos?.game, session?.playerId);
    return g.length ? g : state.players;
  }, [state, roundId, slug, session?.playerId]);

  /** Who's playing it: the player last picked on this phone, else whoever's phone it is, else the first in the group */
  const guessWho = (): string | null => {
    try {
      const last = localStorage.getItem(LAST_PLAYER(slug));
      if (last && players.some((p) => p.id === last)) return last;
    } catch {}
    if (session?.playerId && players.some((p) => p.id === session.playerId)) return session.playerId;
    return players[0]?.id ?? null;
  };
  /** The next stroke for this player: the one after the last told (or filmed), never past the score */
  const nextSeq = (pid: string) => {
    const rows = T.rowsFor(pid);
    const lastTold = Math.max(0, ...rows.filter((r) => r.shot || r.clip).map((r) => r.seq));
    return Math.max(1, Math.min(lastTold + 1, rows.length || 1));
  };
  const one = who.length === 1 ? who[0] : null;
  const strokeNo = one ? (seq ?? nextSeq(one)) : null;
  const nameOf = (id: string) => state?.players.find((p) => p.id === id)?.name ?? id;
  const told = one && strokeNo ? (T.rowsFor(one).find((r) => r.seq === strokeNo)?.shot ?? null) : null;

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
    if (aside && !asking && step === "people" && !clipType) {
      // "Not a shot?" during play: back to the confirm screen
      setAside(null);
      return setStep("confirm");
    }
    if (step === "change" || step === "detail") return setStep("confirm");
    const i = order.indexOf(step);
    if (i <= 0) return used.length ? setStep("another") : onCancel();
    setStep(order[i - 1]);
  };
  /** After the trim: the guess, ready to confirm */
  function toConfirm() {
    if (!who.length) {
      const g = guessWho();
      if (g) setWho([g]);
    }
    go("confirm");
  }

  async function post() {
    setBusy(true);
    const names = who.map((id) => state?.players.find((p) => p.id === id)?.name ?? id);
    // What's told of the stroke (nothing is filled in: only what someone tapped)
    const shot = !aside && told ? (told.kind as ShotKind) : null;
    const result = !aside && told?.outcome ? told.outcome : null;
    const club = !aside && told?.club && told.kind !== "putt" ? told.club : null;
    const summary = aside
      ? [names.join(" & "), CLIP_TYPES[aside].name.toLowerCase()].filter(Boolean).join(" · ")
      : [names.join(" & "), told ? shotWords(told).toLowerCase() : strokeNo ? `shot ${strokeNo}` : null].filter(Boolean).join(" · ");
    const when = aside ? clipWhen ?? typeChoices?.when ?? "post" : undefined;
    const postRound = aside && asking ? (when === "post" ? typeChoices!.roundId : null) : roundId;
    const shotId = !aside && told ? told.client_id : undefined;
    // Where it was filmed: the distance for the shot, if nobody measured it
    const at = takeClipFix();
    if (at && !aside && roundId && hole && who.length === 1) {
      saveReading(slug, {
        id: "",
        round_id: roundId,
        hole,
        player_id: who[0],
        client_id: crypto.randomUUID(),
        accuracy: at.accuracy,
        to_front: null,
        to_middle: null,
        to_back: null,
        from_tee: null,
        source: "clip",
        seq: strokeNo,
        ignored: false,
        author_name: session?.name ?? "",
        taken_at: new Date(at.at).toISOString(),
        lat: at.lat,
        lon: at.lon,
      });
      flushGps(slug);
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
        roundId: postRound,
        hole: aside ? null : hole,
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
          ...(!aside && strokeNo ? { seq: strokeNo } : {}),
          ...(aside ? { clipType: aside, when } : {}),
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
    setSeq(null);
    setCaption("");
    setFilmOnly(false);
    if (!clipType) setAside(null);
    setStep("trim");
  }

  const guessLine = one && strokeNo && hole ? `${nameOf(one)}'s shot ${strokeNo} on the ${nth(hole)}?` : who.length > 1 && hole ? `The whole group on the ${nth(hole)}?` : "Ready to post";
  const title: Record<Step, string> = {
    trim: "Trim the clip",
    type: "What's this?",
    people: "Who's in it?",
    confirm: guessLine,
    change: "Which shot is it?",
    detail: one && strokeNo ? `${nameOf(one)}'s shot ${strokeNo}` : "Add detail",
    done: "Ready to post",
    another: "Saved. Another shot in this clip?",
  };
  const n = step === "change" || step === "detail" ? 1 : order.indexOf(step);

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
          {order.map((s, i) => (
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

      {step === "type" && typeChoices && (
        <div className="cd-body">
          <div className="cd-grid two">
            {typeChoices.order.map((k) => (
              <button key={k} className="cd-tile" onClick={() => (setAside(k), go("people"))}>
                {CLIP_TYPES[k].name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "people" && (
        <div className="cd-body">
          <div className="cd-grid two">
            {(state?.players ?? []).map((p) => (
              <button key={p.id} className="cd-tile" aria-pressed={who.includes(p.id)} onClick={() => setWho((w) => (w.includes(p.id) ? w.filter((x) => x !== p.id) : [...w, p.id]))}>
                {p.name}
              </button>
            ))}
          </div>
          <p className="cd-note">Tap everyone in it, then Next.</p>
        </div>
      )}

      {step === "confirm" && (
        <div className="cd-body cd-done">
          <div className="cd-confirm">
            <button className="btn block cd-primary" disabled={busy} onClick={post}>
              {busy ? "Saving…" : filmOnly ? "Yes, save it for the film" : "Yes, post it"}
            </button>
            <button className="btn secondary block cd-primary" onClick={() => (setTab(one ?? players[0]?.id ?? null), go("change"))}>
              Change
            </button>
          </div>
          {one && strokeNo && roundId && hole && (
            <button className="cd-add-detail" onClick={() => go("detail")}>
              {told ? `Add detail: ${shotWords(told).toLowerCase()}` : "Add detail"}
            </button>
          )}
          <CaptionAndFilm caption={caption} setCaption={setCaption} filmOnly={filmOnly} setFilmOnly={setFilmOnly} />
        </div>
      )}

      {step === "change" && (
        <div className="cd-body">
          <div className="dtl-tabs" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, players.length))}, 1fr)` }} role="tablist">
            {players.map((p) => (
              <button key={p.id} role="tab" className="dtl-tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}>
                <span className="nm">{p.name}</span>
              </button>
            ))}
          </div>
          {tab && (
            <ol className="dtl-shots">
              {T.rowsFor(tab).map((r) => (
                <li key={r.seq} className={`dtl-shot${r.shot ? " told" : ""}${tab === one && r.seq === strokeNo ? " open" : ""}`}>
                  <button
                    className="dtl-card-main"
                    onClick={() => {
                      setWho([tab]);
                      setSeq(r.seq);
                      try {
                        localStorage.setItem(LAST_PLAYER(slug), tab);
                      } catch {}
                      go("confirm");
                    }}
                  >
                    <span className="dtl-seq">{r.seq}</span>
                    <span className="dtl-what">
                      {r.shot ? shotWords(r.shot) : r.auto?.outcome ? "Holed" : r.seq === 1 ? "Tee shot" : `Shot ${r.seq}`}
                      {r.from != null && <small className="dtl-sub">from {T.dist(r.from)}</small>}
                    </span>
                    {r.clip && <span className="dtl-cam" aria-label="Filmed">🎥</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {players.length > 1 && (
            <button className="cd-tile soft cd-group" onClick={() => (setWho(players.map((p) => p.id)), setSeq(null), go("confirm"))}>
              The whole group
            </button>
          )}
          <button type="button" className="linklike cd-notshot" onClick={() => (setAside("interview"), setSeq(null), go("people"))}>
            Not a shot? An interview or a chat
          </button>
        </div>
      )}

      {step === "detail" && one && strokeNo && roundId && hole && (
        <div className="cd-body">
          <StrokeTeller roundId={roundId} hole={hole} playerId={one} seq={strokeNo} onDone={() => go("confirm")} />
        </div>
      )}

      {step === "done" && (
        <div className="cd-body cd-done">
          <p className="cd-summary">{[who.map((id) => state?.players.find((p) => p.id === id)?.name).join(" & "), aside ? CLIP_TYPES[aside].name : null].filter(Boolean).join(" · ")}</p>
          <CaptionAndFilm caption={caption} setCaption={setCaption} filmOnly={filmOnly} setFilmOnly={setFilmOnly} />
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

      <div className="cd-foot" hidden={step === "another" || step === "confirm" || step === "change" || step === "detail"}>
        {step === "trim" && (
          <button className="btn block cd-primary" disabled={!dur} onClick={() => (asking && !aside ? go("type") : aside ? go("people") : toConfirm())}>
            Next
          </button>
        )}
        {step === "people" && (
          <button className="btn block cd-primary" onClick={() => go("done")}>
            Next
          </button>
        )}
        {step === "done" && (
          <button className="btn block cd-primary" disabled={busy} onClick={post}>
            {busy ? "Saving…" : filmOnly ? "Save for the film" : "Post the clip"}
          </button>
        )}

      </div>
    </div>
  );
}

/** A caption, said or typed, and Highlights film only */
function CaptionAndFilm({ caption, setCaption, filmOnly, setFilmOnly }: { caption: string; setCaption: (f: (c: string) => string) => void; filmOnly: boolean; setFilmOnly: (f: (v: boolean) => boolean) => void }) {
  return (
    <>
      <div className="cd-caption-voice">
        <HoldToTalk onText={(t) => setCaption((c) => (c ? `${c} ${t}` : t))} label="Hold to say a caption" />
      </div>
      <label className="cd-cap">
        <span>Caption (optional): say it, or type it</span>
        <textarea value={caption} maxLength={200} onChange={(e) => setCaption(() => e.target.value)} placeholder="Say what happened, if you like" />
      </label>
      <button type="button" className="cd-film-only" role="switch" aria-checked={filmOnly} onClick={() => setFilmOnly((v) => !v)}>
        <span className="box" aria-hidden="true">{filmOnly ? "✓" : ""}</span>
        <span>
          <strong>Highlights film only</strong>
          <small>{filmOnly ? "Kept out of the feed. The film can still use it." : "Leave unticked to post it to the feed too"}</small>
        </span>
      </button>
    </>
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
