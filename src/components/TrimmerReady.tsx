"use client";

import { useState } from "react";
import { prefetchTrimmer, trimmerCached } from "@/lib/trimmer";

/** One-off download of the video trimmer, best done on Wi-Fi before the round. */
export function TrimmerReady() {
  const [cached, setCached] = useState(() => (typeof window === "undefined" ? true : trimmerCached()));
  const [p, setP] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (cached) return null;
  return (
    <div className="notice row" style={{ justifyContent: "space-between" }}>
      <span>Video trimming needs a one-off 30 MB download. Best done on Wi-Fi before the round.</span>
      <button
        type="button"
        className="btn secondary"
        disabled={p != null}
        onClick={async () => {
          setErr(null);
          setP(0);
          try {
            await prefetchTrimmer((d, t) => setP(d / t));
            setCached(true);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Download failed");
            setP(null);
          }
        }}
      >
        {p != null ? `Downloading ${Math.round(p * 100)}%` : "Get the trimmer ready"}
      </button>
      {err && <span className="error small">{err}</span>}
    </div>
  );
}
