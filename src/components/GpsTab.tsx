"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { useSwipe } from "@/lib/useSwipe";
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
/** Worse than this (metres) and the numbers may be out */
const WEAK = 15;

interface Fix {
  hole: number;
  d: GreenYards;
  accuracy: number;
  at: number;
}

/**
 * GPS during a live round: a big labelled tab on the right edge. Tap it (or swipe the panel) for the front,
 * middle and back of the green. Each measurement is kept against your next shot on that hole.
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

  const show = () => {
    // The hole the scorecard is on (it moves on as the card does); the arrows are for when that's wrong
    const h = startHole() ?? hole;
    if (h == null) return;
    setHole(h);
    setOpen(true);
    measure(h);
    try {
      if (isIPhone() && !localStorage.getItem(TIP_KEY)) setTip(true);
    } catch {}
  };
  const swipe = useSwipe({ onRight: () => setOpen(false) });
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
        className={`gps-tab${open ? " hidden" : ""}`}
        onClick={show}
        aria-label="GPS distances to the green"
      >
        <span className="gps-tab-k">GPS</span>
        {tabNumber != null && (
          <span className="gps-tab-v num">{tabNumber}</span>
        )}
      </button>
      {open && (
        <div className="gps-back" onClick={() => setOpen(false)}>
          <aside
            className="gps-panel"
            role="dialog"
            aria-label={`Distances, hole ${hole}`}
            onClick={(e) => e.stopPropagation()}
            {...swipe}
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
            <button className="gps-close" onClick={() => setOpen(false)}>
              Close <small>or swipe right</small>
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
