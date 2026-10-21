/** The checks on what a web page says about a course (kept apart so they can be tested on their own). */

export interface CardHole {
  number: number;
  par: number;
  /** The hole's length from each tee, in yards (0 when unknown) */
  yards: number[];
}

/**
 * A hole note agrees with our card: the same par, and a length that isn't far out. Lengths are only a check that
 * it's the same hole: anything within a quarter of the course's tees (shortest to longest) is fine, read as yards
 * or as metres (pages mix them up). Only a big difference leaves the note out.
 */
export function holeMatches(card: CardHole, par: unknown, length: unknown, unit: unknown): boolean {
  if (Number(par) !== card.par) return false;
  const len = Number(length);
  const known = card.yards.filter((y) => y > 0);
  if (!known.length || !Number.isFinite(len) || len <= 0) return true;
  const lo = Math.min(...known) * 0.75;
  const hi = Math.max(...known) * 1.25;
  const fits = (yards: number) => yards >= lo && yards <= hi;
  void unit;
  return fits(len) || fits(len * 1.0936) || fits(len / 1.0936);
}

