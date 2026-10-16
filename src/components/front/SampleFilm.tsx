"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scoreBug } from "@/lib/scorebug";
import { soundIcon } from "@/components/ReelFeed";
import type { TournamentState } from "@/lib/types";
import { DECLAN, SAMPLE_CLIP_HOLE } from "@/lib/sample";

/**
 * The sample round's highlight, as it looks in the film: Declan's putt with the film's own graphics (the score panel
 * built from the scores just entered, BIRDIE as the ball drops, then his name bar), two voices of commentary, music,
 * and the clip's own sound. The graphics are drawn here to the same design and positions as the film's
 * (see /api/director/card and broadcastLayout), so they can change with your scores.
 *
 * Sound starts off, as it does in the app: the button in the right column (or a tap on the picture) turns it on.
 */

// The clip: the putt is struck at about 0.9s and drops at 5.45s; the clip runs 8.3s
const CLIP_DROP = 5.45;
const CLIP_LEN = 8.3;
const BUG_AT = 0.25;

/**
 * The film's timeline, in seconds, from the commentary's lengths. The clip starts after a short lead-in, so the
 * first line can set the putt up; longer lines get a longer lead-in, so the read is done before the ball drops.
 * Lines: set-up, the read as it rolls, the call as it drops, the verdict after.
 */
function timeline(lines: Line[]) {
  const d = (i: number) => lines[i]?.sec ?? 0;
  const s0 = 0.35;
  const pre = Math.min(5, Math.max(2.4, d(0) + d(1) - 4.45));
  const drop = pre + CLIP_DROP;
  const s1 = Math.max(pre + 1.3, s0 + d(0) + 0.25); // after the putt is struck
  const s2 = drop - 0.1;
  const s3 = Math.max(drop + 2.3, s2 + d(2) + 0.35);
  const end = Math.max(pre + CLIP_LEN + 2.8, lines.length ? s3 + d(3) + 1.1 : 0);
  return { pre, drop, clipEnd: pre + CLIP_LEN, end, after: drop + 0.45, flashTo: drop + 1.9, strapAt: drop + 2.0, starts: [s0, s1, s2, s3] };
}
type Timeline = ReturnType<typeof timeline>;
const MUSIC = 0.3; // music under the clip; lower again while someone speaks
const MUSIC_UNDER = 0.13;

type Line = { src: string; sec: number };
type FilmAudio = { lines: Line[]; music: string | null };

/** The music's level through the film: in gently, down under the voices, out at the end. */
function musicCurve(lines: Line[], { starts, end }: Timeline): [number, number][] {
  const quiet: [number, number][] = [];
  lines.forEach((l, i) => {
    const a = starts[i] - 0.2;
    const b = starts[i] + l.sec + 0.3;
    const last = quiet[quiet.length - 1];
    if (last && a - last[1] < 0.6) last[1] = Math.max(last[1], b);
    else quiet.push([a, b]);
  });
  const pts: [number, number][] = [[0, 0], [0.8, MUSIC]];
  for (const [a, b] of quiet) pts.push([a, MUSIC], [a + 0.2, MUSIC_UNDER], [b - 0.3, MUSIC_UNDER], [b, MUSIC]);
  pts.push([end - 1.6, MUSIC], [end, 0]);
  return pts.sort((x, y) => x[0] - y[0]);
}
const valueAt = (pts: [number, number][], t: number) => {
  for (let i = 1; i < pts.length; i++) {
    const [t0, v0] = pts[i - 1];
    const [t1, v1] = pts[i];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1][1];
};

export function SampleFilm({ state, clipPath, onFeed }: { state: TournamentState; clipPath: string; onFeed: () => void }) {
  const round = state.rounds[0];
  const declan = state.players.find((p) => p.id === DECLAN)?.name ?? "Declan";
  // The score panel from the scores as entered: before the putt, and after it
  const before = useMemo(() => scoreBug(state, { round: round.number, hole: SAMPLE_CLIP_HOLE, playerIds: [DECLAN] }), [state, round.number]);
  const after = useMemo(() => scoreBug(state, { round: round.number, hole: SAMPLE_CLIP_HOLE, playerIds: [DECLAN], after: true }), [state, round.number]);

  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useRef({ t: 0, playing: true, last: 0 });
  const [phase, setPhase] = useState({ bug: false, after: false, flash: false, strap: false, ended: false });
  const [sound, setSound] = useState(false);
  const soundOn = useRef(false);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // The commentary and music (made once by the site owner; until then the film plays with the clip's own sound)
  const audio = useRef<{ info: FilmAudio | null; raw: (ArrayBuffer | null)[]; bufs: (AudioBuffer | null)[]; ctx: AudioContext | null; live: AudioScheduledSourceNode[]; t0: number }>({
    t0: 0,
    info: null,
    raw: [],
    bufs: [],
    ctx: null,
    live: [],
  });

  useEffect(() => {
    let stop = false;
    (async () => {
      const info = (await fetch("/api/sample-film")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as FilmAudio | null;
      if (stop || !info) return;
      audio.current.info = info;
      const srcs = [...info.lines.map((l) => l.src), info.music];
      audio.current.raw = await Promise.all(srcs.map((src) => (src ? fetch(src).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null) : Promise.resolve(null))));
      if (!stop && audio.current.ctx) decode();
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Stop whatever is sounding (the clock carries on) */
  const silence = useCallback(() => {
    for (const s of audio.current.live) {
      try {
        s.stop();
      } catch {}
    }
    audio.current.live = [];
  }, []);

  /** Line everything up from where the film is now */
  const schedule = useCallback(() => {
    silence();
    const a = audio.current;
    const ctx = a.ctx;
    const info = a.info;
    const c = clock.current;
    if (!ctx || !info || !c.playing || !soundOn.current) return;
    const T = c.t;
    const now = ctx.currentTime + 0.03;
    a.t0 = now - T;
    const tl = timeline(info.lines);
    const { starts, end } = tl;
    info.lines.forEach((l, i) => {
      const buf = a.bufs[i];
      if (!buf || T >= starts[i] + buf.duration) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(now + Math.max(0, starts[i] - T), Math.max(0, T - starts[i]));
      a.live.push(src);
    });
    const mbuf = a.bufs[info.lines.length];
    if (mbuf && T < end) {
      const src = ctx.createBufferSource();
      src.buffer = mbuf;
      const g = ctx.createGain();
      const pts = musicCurve(info.lines, tl);
      g.gain.setValueAtTime(valueAt(pts, T), now);
      for (const [t, v] of pts) if (t > T) g.gain.linearRampToValueAtTime(v, now + (t - T));
      src.connect(g).connect(ctx.destination);
      src.start(now, T % mbuf.duration);
      src.stop(now + (end - T) + 0.1);
      a.live.push(src);
    }
  }, [silence]);

  /** Turn the downloaded files into sound (needs the audio context, made on the first tap for sound) */
  function decode() {
    const a = audio.current;
    if (!a.ctx || !a.raw.length) return;
    Promise.all(a.raw.map((r) => (r ? a.ctx!.decodeAudioData(r.slice(0)).catch(() => null) : Promise.resolve(null)))).then((bufs) => {
      a.bufs = bufs;
      if (soundOn.current) schedule();
    });
  }

  /** Sound off, without a tap (the phone took it away) */
  const quiet = useCallback(() => {
    if (video.current) video.current.muted = true;
    soundOn.current = false;
    setSound(false);
    silence();
  }, [silence]);

  // The clock: runs the graphics, keeps the clip in step, ends the film
  useEffect(() => {
    let raf = 0;
    let key = "";
    const tick = (now: number) => {
      const c = clock.current;
      const v = video.current;
      const tl = timeline(audio.current.info?.lines ?? []);
      if (c.playing && !document.hidden) {
        // While the clip plays it keeps the time (so a slow phone never has it jump); otherwise the clock does
        const rolling = v && !v.paused && !v.seeking && v.currentTime > 0.05 && c.t >= tl.pre && c.t < tl.clipEnd - 0.05;
        c.t = Math.min(tl.end, rolling ? tl.pre + v.currentTime : c.t + Math.min(0.1, (now - (c.last || now)) / 1000));
      }
      c.last = now;
      const t = c.t;
      if (v && !document.hidden) {
        const vt = t - tl.pre;
        if (!c.playing || vt < 0) {
          if (!v.paused) v.pause();
          if (vt < 0 && v.currentTime > 0.05) v.currentTime = 0;
        } else if (t < tl.clipEnd && v.paused && !v.ended) {
          v.currentTime = vt;
          // A phone that won't play it with sound outside a tap still plays the picture
          v.play().catch(() => {
            v.muted = true;
            v.play().catch(() => {});
          });
        }
      }
      // The voices keep time with the picture: if they've drifted (the clip stalled), line them up again
      const a = audio.current;
      if (a.ctx?.state === "running" && soundOn.current && c.playing && !document.hidden && a.live.length && Math.abs(a.ctx.currentTime - a.t0 - t) > 0.35) schedule();
      if (bar.current) bar.current.style.transform = `scaleX(${(t / tl.end).toFixed(4)})`;
      const p = { bug: t >= BUG_AT, after: t >= tl.after, flash: t >= tl.drop && t < tl.flashTo, strap: t >= tl.strapAt, ended: t >= tl.end };
      const k = JSON.stringify(p);
      if (k !== key) {
        key = k;
        setPhase(p);
        if (p.ended) c.playing = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Away from the page (another tab, the phone locked): everything waits, picture and sound
    const vis = () => {
      const v = video.current;
      const a = audio.current;
      if (document.hidden) {
        silence();
        v?.pause();
        return;
      }
      clock.current.last = 0;
      if (!a.ctx || !soundOn.current) return;
      a.ctx
        .resume()
        .catch(() => {})
        .then(() => {
          // A phone that won't give the sound back without a tap: say so, rather than play on silently
          if (a.ctx?.state !== "running") return quiet();
          if (clock.current.playing) schedule();
        });
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [schedule, silence, quiet]);

  // Leaving: let the audio go
  useEffect(
    () => () => {
      silence();
      audio.current.ctx?.close().catch(() => {});
    },
    [silence],
  );

  function say(msg: string) {
    setHint(msg);
    setTimeout(() => setHint((h) => (h === msg ? null : h)), 900);
  }

  /** Watch again: it's a tap, so with sound */
  function again() {
    restart();
    if (!soundOn.current) setSoundTo(true);
  }

  /** Sound on or off. Turning it on has to happen in the tap itself, or phones keep it quiet. */
  function setSoundTo(on: boolean) {
    const v = video.current;
    if (v) {
      v.muted = !on;
      // iPhones only let a video play with sound once it has been started by a tap: start it here, in the tap,
      // and pause it again straight away if it isn't its turn yet
      if (on && v.paused && clock.current.t < timeline(audio.current.info?.lines ?? []).pre) {
        const p = v.play();
        v.pause();
        p?.catch(() => {});
      }
    }
    setSound(on);
    soundOn.current = on;
    if (!on) return silence();
    const a = audio.current;
    if (!a.ctx) {
      try {
        // Commentary plays even with the iPhone's ring switch on silent, like the clip's own sound
        const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (s) s.type = "playback";
      } catch {}
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        a.ctx = new AC();
        // A moment of silence in the tap unlocks the sound on older iPhones
        const b = a.ctx.createBuffer(1, 1, 22050);
        const s = a.ctx.createBufferSource();
        s.buffer = b;
        s.connect(a.ctx.destination);
        s.start(0);
        decode();
      }
    }
    a.ctx?.resume().catch(() => {});
    schedule();
  }

  function restart() {
    const c = clock.current;
    c.t = 0;
    c.playing = true;
    c.last = 0;
    setPaused(false);
    if (video.current) video.current.currentTime = 0;
    schedule();
  }

  function togglePause() {
    const c = clock.current;
    c.playing = !c.playing;
    setPaused(!c.playing);
    if (c.playing) schedule();
    else silence();
  }

  /** As in the app: the first tap turns the sound on; after that, a tap pauses and plays. */
  function tap() {
    if (phase.ended) return again();
    if (!sound) {
      setSoundTo(true);
      return say("Sound on");
    }
    togglePause();
  }

  const bug = phase.after ? after : before;

  return (
    <div className="reel-phone fm-film" aria-label={`Highlight: ${declan}'s birdie putt on hole ${SAMPLE_CLIP_HOLE}, as it looks in the film`}>
      <div className="fm-frame" onClick={tap}>
        <video ref={video} src={clipPath} poster="/home/clips/putt.jpg" muted playsInline preload="auto" className="fm-video" />

        {bug && bug.mode === "field" && (
          <div className={`fb-bug${phase.bug ? " is-in" : ""}`} aria-hidden>
            <div className="fb-head">
              <span className="fb-hole">Hole {bug.hole}</span>
              <span className="fb-par">
                Par {bug.par}
                {bug.yards ? ` · ${bug.yards} yds` : ""}
              </span>
              <span className="fb-kind">LEADERBOARD</span>
            </div>
            <div className="fb-rows" key={phase.after ? "after" : "before"}>
              {bug.rows.map((r) => (
                <div key={r.name} className={`fb-row${r.onCamera ? " is-cam" : ""}${r.lead && !r.onCamera ? " is-lead" : ""}`}>
                  <span className="fb-pos">{r.pos}</span>
                  <span className="fb-name">{r.name}</span>
                  <span className="fb-val">{r.value}</span>
                  <span className="fb-thru">{r.finished || r.thru >= 18 ? "F" : String(r.thru)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase.flash && (
          <div className="fb-flash" aria-hidden>
            <span>{after?.flash ?? "BIRDIE"}</span>
          </div>
        )}

        {phase.strap && (
          <div className="fb-strap" aria-hidden>
            <span className="fb-strap-card">
              <span className="fb-strap-rule" />
              <span className="fb-strap-body">
                <span className="fb-strap-hole">
                  <small>HOLE</small>
                  <b>{SAMPLE_CLIP_HOLE}</b>
                </span>
                <span className="fb-strap-text">
                  <b>{declan}</b>
                  <small>Birdie from 30 feet</small>
                </span>
              </span>
            </span>
          </div>
        )}

        <div className="reel-progress fm-progress" ref={bar} />
        {!sound && !phase.ended && <span className="reel-hint fm-hint is-fading">Tap for sound</span>}
        {hint && <span className="reel-flash fm-hint">{hint}</span>}
        {paused && !phase.ended && <span className="reel-paused" aria-label="Paused" />}
      </div>

      <span className="fm-label">How it looks in the film</span>

      <div className="reel-rail fm-rail">
        <button onClick={() => setSoundTo(!sound)} aria-label={sound ? "Sound off" : "Sound on"} aria-pressed={sound}>
          {soundIcon(sound)}
          <span>{sound ? "Sound" : "Muted"}</span>
        </button>
      </div>

      {phase.ended ? (
        <div className="fm-end">
          <button type="button" className="btn fm-again" onClick={again}>
            Watch again
          </button>
          <button type="button" className="btn secondary fm-feed" onClick={onFeed}>
            See the feed
          </button>
        </div>
      ) : (
        <button type="button" className="btn fm-next" onClick={onFeed}>
          See the feed
        </button>
      )}
    </div>
  );
}

