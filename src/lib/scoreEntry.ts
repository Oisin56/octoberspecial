/** Entering a score on the course: big number tiles around par, and the word for a score. */

/** The five tiles shown for a hole: one under par to three over (anything else is under "More"). */
export function scoreTiles(par: number): number[] {
  return [par - 1, par, par + 1, par + 2, par + 3].filter((n) => n >= 1);
}

export function scoreWord(gross: number, par: number): string {
  if (gross === 1) return "Ace";
  const d = gross - par;
  if (d <= -3) return "Albatross";
  if (d === -2) return "Eagle";
  if (d === -1) return "Birdie";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double";
  if (d === 3) return "Triple";
  return `+${d}`;
}
