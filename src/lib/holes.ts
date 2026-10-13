/** Checks on a course card, shared by the setup screens and the server. */

/** 18 holes: each of 1 to 18 once. A 9-hole card: nine different indexes between 1 and 18. */
export function validStrokeIndexes(si: number[]): boolean {
  if (si.length === 18) return [...si].sort((a, b) => a - b).every((v, i) => v === i + 1);
  if (si.length === 9) return new Set(si).size === 9 && si.every((v) => Number.isInteger(v) && v >= 1 && v <= 18);
  return false;
}
