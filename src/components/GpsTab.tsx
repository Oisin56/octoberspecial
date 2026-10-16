"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import {
  greenYards,
  inUnits,
  metres,
  unitWord,
  type CourseGeo,
  type GreenYards,
} from "@/lib/gps";
import { flushGps, saveReading } from "@/lib/gpsQueue";
import { readScorePos } from "@/lib/scorePos";
import { isIPhone } from "@/lib/camera";

type Units = "yards" | "metres";
const UNITS_KEY = "mgs-units";
const TIP_KEY = "mgs-gps-tip";
/** Where the tab was last left on the right edge (its middle, as a share of the screen's height) */
const POS_KEY = "mgs-gps-y";
/** Movement (px) before a touch counts as a drag rather than a tap */
const SLOP = 8;
const panelWidth = () => Math.min(window.innerWidth * 0.92, 420);
/** Worse than this (metres) and the numbers may be out */
const WEAK = 15;

interface Fix {
  hole: number;
  d: GreenYards;
  accuracy: number;
  at: number;
}

/**
 * GPS during a live round: a big labelled tab on the right edge, over the scorecard. Tap it, or pull it left
 * and the panel follows the finger, for the front, middle and back of the green; push the panel right to put it
 * away. Drag the tab up or down to wherever it's out of the way: it stays there. Each measurement is kept against
 * your next shot on that hole.
 */
export function GpsTab() {
  const { state, session, slug, sample } = useT();
  const path = usePathname();
  const round = state?.rounds.find((r) => r.status === "live") ?? null;
  const crew = session?.role === "player" || session?.role === "organiser";
  const [geo, setGeo] = useState<CourseGeo | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [hole, setHole] = useState<number | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<"denied" | "unavailable" | "far" | null>(null);
  const [units, setUnits] = useState<Units>("yards");
  const [tip, setTip] = useState(false);
  // The tab's height on the edge (its middle, share of the screen), and how far the panel is pushed off (px; 0 = open)
  const [tabY, setTabY] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; t: number; y0: number; mode: "tap" | "move" | "pull" | "push"; w: number } | null>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last reading kept: measuring again on the same spot doesn't add another
  const [last, setLast] = useState<{ hole: number; at: [number, number]; t: number } | null>(null);

  // The course's greens: once per round
  useEffect(() => {
    if (!round || !crew || !round.course_slug.startsWith("golfapi:")) return;
    if (sample) {
      const t = setTimeout(() => setGeo(sample.geo), 0);
      return () => clearTimeout(t);
    }
    let stop = false;
    const key = `mgs-geo-${round.id}`;
    const t = setTimeout(async () => {
      try {
        const kept = sessionStorage.getItem(key);
        if (kept) return !stop && setGeo(JSON.parse(kept));
      } catch {}
      const r = await fetch(
        `/api/gps?t=${encodeURIComponent(slug)}&round=${round.id}`,
      )
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (stop) return;
      setGeo(r?.geo ?? null);
      try {
        if (r?.geo) sessionStorage.setItem(key, JSON.stringify(r.geo));
      } catch {}
    }, 0);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [round, crew, slug, sample]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const y = Number(localStorage.getItem(POS_KEY));
        if (y > 0 && y < 1) setTabY(y);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const u = localStorage.getItem(UNITS_KEY);
        setUnits(
          u === "metres" || u === "yards"
            ? u
            : state?.tournament.units === "metres"
              ? "metres"
              : "yards",
        );
      } catch {
        setUnits(state?.tournament.units === "metres" ? "metres" : "yards");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [state?.tournament.units]);

  const holes = useMemo(
    () => (round ? round.holes.map((h) => h.number).sort((a, b) => a - b) : []),
    [round],
  );
  const startHole = () => {
    if (!round) return null;
    const pos = readScorePos(slug, round.id)?.hole;
    if (pos && holes.includes(pos)) return pos;
    // The first hole this player hasn't a score on yet
    const mine =
      state?.entries
        .filter(
          (e) =>
            e.round_id === round.id &&
            session?.playerId &&
            e.scores[session.playerId]?.gross != null,
        )
        .map((e) => e.hole) ?? [];
    return holes.find((h) => !mine.includes(h)) ?? holes[0] ?? null;
  };

  /** Measure hole h. `keep`: file the reading against this player's next shot (not when just looking at another hole). */
  const measure = (h: number, keep = true) => {
    if (!geo?.[String(h)] || !round) return;
    setBusy(true);
    setErr(null);
    // The sample round: a spot on the fairway, no location permission asked for
    if (sample) {
      const at = sample.spot(h);
      setTimeout(() => {
        setBusy(false);
        if (at) setFix({ hole: h, d: greenYards(at, geo[String(h)]), accuracy: 4, at: Date.now() });
      }, 450);
      return;
    }
    if (!navigator.geolocation) {
      setBusy(false);
      return setErr("unavailable");
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        const g = geo[String(h)];
        const at: [number, number] = [p.coords.latitude, p.coords.longitude];
        const d = greenYards(at, g);
        if (d.middle > 1200) {
          setFix(null);
          return setErr("far");
        }
        setFix({
          hole: h,
          d,
          accuracy: Math.round(p.coords.accuracy),
          at: Date.now(),
        });
        // Kept against this player's next shot on the hole
        const same = last && last.hole === h && metres(last.at, at) < 8 && Date.now() - last.t < 5 * 60e3;
        if (keep && !same && session?.playerId) {
          setLast({ hole: h, at, t: Date.now() });
          saveReading(slug, {
            id: "",
            round_id: round.id,
            hole: h,
            player_id: session.playerId,
            client_id: crypto.randomUUID(),
            accuracy: Math.round(p.coords.accuracy),
            to_front: d.front,
            to_middle: d.middle,
            to_back: d.back,
            from_tee: d.fromTee,
            source: "gps",
            seq: null,
            ignored: false,
            author_name: session.name,
            taken_at: new Date().toISOString(),
            lat: at[0],
            lon: at[1],
          });
          flushGps(slug);
        }
      },
      (e) => {
        setBusy(false);
        setErr(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
        if (e.code === e.PERMISSION_DENIED) setTip(true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  /** Open the panel (from `from` px off the edge: 0 = all the way in) and measure the hole the card is on. */
  const show = (from = 0) => {
    // The hole the scorecard is on (it moves on as the card does); the arrows are for when that's wrong
    const h = startHole() ?? hole;
    if (h == null) return false;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHole(h);
    setSlide(from);
    setOpen(true);
    measure(h);
    try {
      if (isIPhone() && !localStorage.getItem(TIP_KEY)) setTip(true);
    } catch {}
    return true;
  };
  /** Slide the panel away, then take it off the screen. */
  const hide = () => {
    setDragging(false);
    setSlide(panelWidth());
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setSlide(0);
    }, 200);
  };
  /** Let go of a pull or a push: past a third of the way (or flicked), it goes; otherwise it springs back. */
  const settle = (dx: number, w: number, ms: number) => {
    setDragging(false);
    const quick = Math.abs(dx) > 40 && ms < 250;
    const shown = w - slideFor(dx, w);
    if (gesture.current?.mode === "pull") return shown > w / 3 || (quick && dx < 0) ? setSlide(0) : hide();
    return w - shown > w / 3 || (quick && dx > 0) ? hide() : setSlide(0);
  };
  const slideFor = (dx: number, w: number) => (gesture.current?.mode === "pull" ? Math.max(0, Math.min(w, w + dx)) : Math.max(0, Math.min(w, dx)));

  // The tab: tap to open; pull left to slide the panel out with the finger; drag up or down to move it
  const tabHandlers = {
    onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
      const r = e.currentTarget.getBoundingClientRect();
      gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), y0: r.top + r.height / 2, mode: "tap", w: panelWidth() };
    },
    onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (g.mode === "tap") {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (dx < 0 && Math.abs(dx) > Math.abs(dy)) {
          g.mode = "pull";
          if (!show(g.w)) return (gesture.current = null);
        } else g.mode = "move";
        setDragging(true);
      }
      if (g.mode === "pull") setSlide(slideFor(dx, g.w));
      else {
        const half = (tabRef.current?.offsetHeight ?? 104) / 2;
        // Between the top of the screen and the bar along the bottom
        const top = 64 + half;
        const bar = document.querySelector(".oncourse")?.getBoundingClientRect().top ?? window.innerHeight;
        const bottom = Math.min(bar, window.innerHeight) - 12 - half;
        setTabY(Math.max(top, Math.min(bottom, g.y0 + dy)) / window.innerHeight);
      }
    },
    onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
      const g = gesture.current;
      if (!g) return;
      if (g.mode === "pull") settle(e.clientX - g.x, g.w, Date.now() - g.t);
      else if (g.mode === "move") {
        setDragging(false);
        try {
          if (tabY != null) localStorage.setItem(POS_KEY, String(tabY));
        } catch {}
      }
      // A tap is left to the click (so the keyboard opens it too)
      if (g.mode !== "tap") setTimeout(() => (gesture.current = null), 0);
    },
    onPointerCancel() {
      const g = gesture.current;
      gesture.current = null;
      setDragging(false);
      if (g?.mode === "pull") hide();
    },
    onClick() {
      const g = gesture.current;
      gesture.current = null;
      // Slides in from the edge, as it does when pulled
      if ((!g || g.mode === "tap") && show(panelWidth())) requestAnimationFrame(() => requestAnimationFrame(() => setSlide(0)));
    },
  };
  // The panel: push it right and it follows the finger; let go past a third and it's put away
  const panelHandlers = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), y0: 0, mode: "tap", w: e.currentTarget.offsetWidth };
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const g = gesture.current;
      if (!g || g.mode === "move" || g.mode === "pull") return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (g.mode === "tap") {
        if (Math.abs(dx) < SLOP * 2 && Math.abs(dy) < SLOP * 2) return;
        // Up and down is a scroll, not a push
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) return (gesture.current = null);
        g.mode = "push";
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }
      setSlide(slideFor(dx, g.w));
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const g = gesture.current;
      gesture.current = null;
      if (g?.mode === "push") settle(e.clientX - g.x, g.w, Date.now() - g.t);
    },
    onPointerCancel() {
      if (gesture.current?.mode === "push") setSlide(0);
      gesture.current = null;
      setDragging(false);
    },
    onClickCapture(e: React.MouseEvent) {
      // The end of a push isn't a tap on whatever button it started on
      if (dragging) e.stopPropagation();
    },
  };
  const setU = (u: Units) => {
    setUnits(u);
    try {
      localStorage.setItem(UNITS_KEY, u);
    } catch {}
  };
  const go = (dir: 1 | -1) => {
    if (hole == null) return;
    const i = holes.indexOf(hole);
    const n = holes[Math.max(0, Math.min(holes.length - 1, i + dir))];
    setHole(n);
    setFix(null);
    // Just a look: it's kept only once you tap Measure again on that hole
    measure(n, false);
  };

  if (
    !round ||
    !crew ||
    !geo ||
    path.endsWith("/record") ||
    path.endsWith("/highlights")
  )
    return null;
  const par = round.holes.find((x) => x.number === hole)?.par;
  const shown = fix && fix.hole === hole ? fix : null;
  const u = (y: number | null) => (y == null ? "–" : inUnits(y, units));
  const tabNumber = fix ? inUnits(fix.d.middle, units) : null;

  return (
    <>
      <button
        ref={tabRef}
        className={`gps-tab${open ? " hidden" : ""}${dragging && !open ? " dragging" : ""}`}
        style={tabY != null ? { top: `clamp(116px, ${(tabY * 100).toFixed(2)}%, calc(100% - var(--oc-h) - 64px))`, bottom: "auto", transform: "translateY(-50%)" } : undefined}
        {...tabHandlers}
        aria-label="GPS distances to the green. Drag up or down to move it."
      >
        <span className="gps-tab-k">GPS</span>
        {tabNumber != null && (
          <span className="gps-tab-v num">{tabNumber}</span>
        )}
      </button>
      {open && (
        <div className={`gps-back${dragging ? " dragging" : ""}`} style={{ opacity: Math.max(0, 1 - slide / panelWidth()) }} onClick={hide}>
          <aside
            className={`gps-panel${dragging ? " dragging" : ""}`}
            style={{ transform: `translateX(${slide}px)` }}
            role="dialog"
            aria-label={`Distances, hole ${hole}`}
            onClick={(e) => e.stopPropagation()}
            {...panelHandlers}
          >
            <div className="gps-head">
              <button
                className="gps-nav"
                aria-label="Previous hole"
                onClick={() => go(-1)}
                disabled={holes.indexOf(hole ?? 0) <= 0}
              >
                ‹
              </button>
              <div className="gps-hole">
                <strong>Hole {hole}</strong>
                {par && <span>Par {par}</span>}
              </div>
              <button
                className="gps-nav"
                aria-label="Next hole"
                onClick={() => go(1)}
                disabled={holes.indexOf(hole ?? 0) >= holes.length - 1}
              >
                ›
              </button>
            </div>

            {err === "denied" ? (
              <div className="gps-msg">
                <p>
                  <strong>
                    Your phone hasn&apos;t allowed location for this site.
                  </strong>
                </p>
                {isIPhone() ? (
                  <ol>
                    <li>
                      Open Settings, then Privacy &amp; Security, then Location
                      Services.
                    </li>
                    <li>
                      Make sure Location Services is on, then tap Safari
                      Websites and choose While Using the App.
                    </li>
                    <li>Come back and tap Measure again.</li>
                  </ol>
                ) : (
                  <p>
                    Tap the padlock or the settings beside the web address,
                    allow Location, then tap Measure again.
                  </p>
                )}
              </div>
            ) : err === "far" ? (
              <p className="gps-msg">
                You&apos;re not near hole {hole}. Pick the hole you&apos;re on
                with the arrows.
              </p>
            ) : err === "unavailable" ? (
              <p className="gps-msg">
                Couldn&apos;t get a fix just now. Step out from under trees and
                tap Measure again.
              </p>
            ) : (
              <div className={`gps-nums${busy && !shown ? " busy" : ""}`}>
                <div className="gps-n back">
                  <span>Back</span>
                  <b className="num">{shown ? u(shown.d.back) : "…"}</b>
                </div>
                <div className="gps-n mid">
                  <span>Middle</span>
                  <b className="num">{shown ? u(shown.d.middle) : "…"}</b>
                </div>
                <div className="gps-n front">
                  <span>Front</span>
                  <b className="num">{shown ? u(shown.d.front) : "…"}</b>
                </div>
                <p className="gps-unit">{unitWord(units)} to the green</p>
                {shown && shown.accuracy > WEAK && (
                  <p className="gps-weak">
                    Weak signal: these could be out by about{" "}
                    {inUnits(shown.accuracy * 1.0936, units)}{" "}
                    {unitWord(units, true)}.
                  </p>
                )}
              </div>
            )}

            <button
              className="btn block gps-again"
              onClick={() => hole != null && measure(hole)}
              disabled={busy}
            >
              {busy ? "Measuring…" : "Measure again"}
            </button>
            <div className="gps-units" role="group" aria-label="Units">
              <button
                className="pick-tile"
                aria-pressed={units === "yards"}
                onClick={() => setU("yards")}
              >
                Yards
              </button>
              <button
                className="pick-tile"
                aria-pressed={units === "metres"}
                onClick={() => setU("metres")}
              >
                Metres
              </button>
            </div>
            {tip && err !== "denied" && (
              <p className="gps-tip">
                iPhone tip: so it stops asking every time, open Settings, then
                Privacy &amp; Security, then Location Services, then Safari
                Websites, and choose While Using the App.{" "}
                <button
                  className="linklike"
                  onClick={() => {
                    setTip(false);
                    try {
                      localStorage.setItem(TIP_KEY, "1");
                    } catch {}
                  }}
                >
                  Got it
                </button>
              </p>
            )}
            <button className="gps-close" onClick={hide}>
              Close <small>or swipe right</small>
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
