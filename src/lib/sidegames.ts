/**
 * Side games in words: the one line for each (set-up, the organiser page, the rules page, the writers), and the
 * line saying what's on offer on top of the rounds. Works the same from the set-up answers or a saved tournament.
 */
import type { BonusKind, Prize, PrizeKind, SideHoles, TournamentCfg } from "./engine";

export type SideKind = "ctp" | "ld" | "birdies" | "eagles" | "gir" | "nines" | "skins" | "bestround";

export const SIDE_KINDS: SideKind[] = ["ctp", "ld", "birdies", "eagles", "gir", "nines", "skins", "bestround"];

export const SIDE_NAME: Record<SideKind, string> = {
  ctp: "Closest the pin",
  ld: "Long drive",
  birdies: "Birdies",
  eagles: "Eagles",
  gir: "Greens in regulation",
  nines: "Front 9 and back 9",
  skins: "Skins",
  bestround: "Best round",
};

/** Can be points for each one (a points race only) */
export const CAN_POINTS: SideKind[] = ["ctp", "ld", "birdies", "eagles", "gir"];
/** Can be a prize (eagles are too rare to have a most) */
export const CAN_PRIZE: SideKind[] = ["ctp", "ld", "birdies", "gir", "nines", "skins", "bestround"];

export interface SideRound {
  number: number;
  course: string;
  /** The holes played in this round, with their par */
  holes: { number: number; par: number; yards?: number }[];
  /** 18 holes played as a nine */
  nine?: "front" | "back" | null;
  /** Groups or matches (each one has its own closest the pin and long drive) */
  games: number;
}

export interface SideSetup {
  race: boolean;
  bonus: Partial<Record<BonusKind, number>>;
  prizes: Prize[];
  holes: SideHoles;
  rounds: SideRound[];
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : `${Math.floor(v) || ""}½`);

export function ordinal(k: number): string {
  const t = k % 100;
  if (t >= 11 && t <= 13) return `${k}th`;
  return `${k}${["th", "st", "nd", "rd"][k % 10] ?? "th"}`;
}

export const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const parOf = (k: "ctp" | "ld") => (k === "ctp" ? 3 : 5);

/** The par 3s (par 5s) of a round */
export const parHoles = (r: Pick<SideRound, "holes">, k: "ctp" | "ld") => r.holes.filter((h) => h.par === parOf(k)).map((h) => h.number);

/** The holes it's on in a round: as chosen ([] = not in this round), else every par 3 / par 5 */
export function holesIn(s: Pick<SideSetup, "holes">, r: SideRound, k: "ctp" | "ld"): number[] {
  const every = parHoles(r, k);
  const chosen = s.holes[k]?.[String(r.number)];
  return chosen ? every.filter((h) => chosen.includes(h)) : every;
}

export const isOn = (s: Pick<SideSetup, "race" | "bonus" | "prizes">, k: SideKind) => (s.race && (s.bonus[k as BonusKind] ?? 0) > 0) || s.prizes.some((p) => p.kind === k);

/** "Every par 3." / "The 3rd and 12th." / "Round 1: the 3rd and 12th; not in round 2." */
export function holesText(s: SideSetup, k: "ctp" | "ld"): string {
  const every = k === "ctp" ? "every par 3" : "every par 5";
  const rs = s.rounds.filter((r) => parHoles(r, k).length);
  const desc = (r: SideRound) => {
    const on = holesIn(s, r, k);
    if (on.length === parHoles(r, k).length) return every;
    return on.length ? `the ${and(on.map(ordinal))}` : null;
  };
  const all = rs.map(desc);
  if (all.every((x) => x === every)) return `${up(every)}.`;
  if (rs.length === 1) return all[0] ? `${up(all[0])}.` : "No holes chosen.";
  // Only the rounds that differ, then the rest
  const bits = rs.map((r, i) => (all[i] === every ? null : all[i] ? `round ${r.number}: ${all[i]}` : `not in round ${r.number}`)).filter((x): x is string => !!x);
  const rest = all.filter((x) => x === every).length;
  if (rest) bits.push(`${every} in the other round${rest === 1 ? "" : "s"}`);
  return `${up(bits.join("; "))}.`;
}

const up = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

const MOST: PrizeKind[] = ["ctp", "ld", "birdies", "gir", "skins"];

/** "Closest the pin: 3 points each, and a prize for the most (worth 5). Every par 3." */
export function sideLine(s: SideSetup, k: SideKind): string | null {
  if (!isOn(s, k)) return null;
  const parts: string[] = [];
  const v = s.race ? (s.bonus[k as BonusKind] ?? 0) : 0;
  if (v > 0) parts.push(`${n(v)} point${v === 1 ? "" : "s"} each`);
  const p = s.prizes.find((x) => x.kind === k);
  if (p) {
    let t = MOST.includes(p.kind) ? "a prize for the most" : p.kind === "nines" ? "a prize for each nine" : "a prize";
    if (s.rounds.length > 1 && p.kind !== "nines") t += p.per === "round" ? " in each round" : " over the whole trip";
    if (p.kind === "nines" && s.rounds.length > 1) t += " in each round";
    if (s.race && (p.points ?? 0) > 0) t += ` (worth ${n(p.points!)})`;
    parts.push(t);
  }
  let line = `${SIDE_NAME[k]}: ${parts.join(", and ")}.`;
  if (k === "ctp" || k === "ld") line += ` ${holesText(s, k)}`;
  return line;
}

/** Every side game that's on, a line each */
export const sideLines = (s: SideSetup) => SIDE_KINDS.map((k) => sideLine(s, k)).filter((x): x is string => !!x);

/** How many times a prize is given (each round, each nine, or once) */
function timesGiven(s: SideSetup, p: Prize): number {
  if (p.kind === "nines") return s.rounds.filter((r) => r.holes.length === 18).length * 2;
  return p.per === "round" ? s.rounds.length : 1;
}

/**
 * Points race: "On top of the rounds: up to 36 points for closest the pin and long drive, 2 for each birdie and
 * 5 for each eagle, and up to 4 from prizes." Null when nothing's on.
 */
export function onTopLine(s: SideSetup): string | null {
  if (!s.race) return null;
  const bits: string[] = [];
  const holeKinds = (["ctp", "ld"] as const).filter((k) => (s.bonus[k] ?? 0) > 0);
  const holePts = holeKinds.reduce((a, k) => a + s.rounds.reduce((x, r) => x + holesIn(s, r, k).length * Math.max(1, r.games) * (s.bonus[k] ?? 0), 0), 0);
  if (holePts > 0) bits.push(`up to ${n(holePts)} points for ${and(holeKinds.map((k) => SIDE_NAME[k].toLowerCase()))}`);
  const each: Record<string, string> = { birdies: "birdie", eagles: "eagle", gir: "green in regulation" };
  const open = (["birdies", "eagles", "gir"] as const).filter((k) => (s.bonus[k] ?? 0) > 0).map((k) => `${n(s.bonus[k]!)} for each ${each[k]}`);
  bits.push(...open);
  const prizePts = s.prizes.reduce((a, p) => a + (p.points ?? 0) * timesGiven(s, p), 0);
  if (prizePts > 0) bits.push(`up to ${n(prizePts)} from prizes`);
  if (!bits.length) return null;
  return `On top of the rounds: ${and(bits)}.`;
}

// ---------------------------------------------------------------- from a saved tournament

/** The holes as set: the bonus's, else the prize's (an old flat list of holes counts in every round) */
export function sideHolesOf(win: TournamentCfg["win"] | null | undefined, prizes: Prize[] | null | undefined, rounds: { number: number; holes: { number: number; par: number }[] }[]): SideHoles {
  const out: SideHoles = {};
  for (const k of ["ctp", "ld"] as const) {
    const fromBonus = win?.kind === "points" ? win.bonusHoles?.[k] : undefined;
    const p = (prizes ?? []).find((x) => x.kind === k);
    const flat = p?.holes?.length ? p.holes : null;
    const h = fromBonus ?? p?.holesByRound ?? (flat ? Object.fromEntries(rounds.map((r) => [String(r.number), r.holes.filter((x) => x.par === parOf(k) && flat.includes(x.number)).map((x) => x.number)])) : null);
    if (h && Object.keys(h).length) out[k] = { ...h };
  }
  return out;
}

/** A saved tournament's side games, ready for the lines above */
export function sideSetupOf(cfg: Pick<TournamentCfg, "win" | "prizes" | "rounds">): SideSetup {
  const w = cfg.win;
  return {
    race: w?.kind === "points",
    bonus: w?.kind === "points" ? (w.bonus ?? {}) : {},
    prizes: cfg.prizes ?? [],
    holes: sideHolesOf(w, cfg.prizes, cfg.rounds),
    rounds: cfg.rounds.map((r) => ({ number: r.number, course: r.name, holes: r.holes, games: r.games.filter((g) => !g.free).length })),
  };
}
