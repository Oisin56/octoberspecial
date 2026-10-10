"use client";

/** Where the scorer was (match and hole), so coming back from the camera or another page lands in the same place. */
export interface ScorePos {
  game: string;
  hole: number;
  at: number;
}

const key = (slug: string, roundId: string) => `mgs_score_pos_${slug}_${roundId}`;

export function readScorePos(slug: string, roundId: string): ScorePos | null {
  try {
    const p = JSON.parse(localStorage.getItem(key(slug, roundId)) ?? "null") as ScorePos | null;
    // a day later it's a different outing
    return p && Date.now() - p.at < 20 * 3600 * 1000 ? p : null;
  } catch {
    return null;
  }
}

export function writeScorePos(slug: string, roundId: string, p: Omit<ScorePos, "at">) {
  try {
    localStorage.setItem(key(slug, roundId), JSON.stringify({ ...p, at: Date.now() }));
    window.dispatchEvent(new Event("mgs-score-pos"));
  } catch {
    /* private browsing: fine */
  }
}

/** The hole the scorer is on in a round, if known (for Record and Note). */
export function currentHole(slug: string, roundId: string): number | null {
  return readScorePos(slug, roundId)?.hole ?? null;
}
