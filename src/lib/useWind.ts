"use client";

import { useEffect, useState } from "react";
import { windAt, type WindDay } from "./windDay";

/**
 * The wind on each hole of a round, from the weather: fetched once per round on this phone. `at` is when the hole
 * was played (its scores' time), or now. Null when it can't be worked out.
 */
export function useWind(slug: string, roundId: string | null, enabled = true) {
  const [day, setDay] = useState<WindDay | null>(null);
  useEffect(() => {
    if (!roundId || !enabled) return;
    let stop = false;
    const key = `mgs-wind-${roundId}`;
    const t = setTimeout(async () => {
      try {
        const kept = sessionStorage.getItem(key);
        if (kept) {
          const k = JSON.parse(kept) as { at: number; day: WindDay };
          if (Date.now() - k.at < 30 * 60e3) return !stop && setDay(k.day);
        }
      } catch {}
      const r = await fetch(`/api/wind?t=${encodeURIComponent(slug)}&round=${roundId}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (stop || !r) return;
      setDay(r);
      try {
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), day: r }));
      } catch {}
    }, 0);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [slug, roundId, enabled]);

  return (hole: number, at?: string | null): string | null => windAt(day, hole, at);
}
