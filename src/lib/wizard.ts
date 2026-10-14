/**
 * The setup wizard: what the organiser chose, and how it becomes a tournament (formats, handicap
 * allowances, points, groups and matches). Pure, so the wizard can check its answers as it goes and the
 * server builds exactly the same thing.
 */
import type { Game, HandicapRule, PlayType, PointsRule, ScoringType, StandingsMode } from "./engine";
import type { HoleSet, ThemeId } from "./types";

export type Who = "solo" | "individuals" | "teams";
export type DayFormat = "stableford" | "stroke" | "match" | "skins" | "fourball" | "foursomes" | "singles";

export const MAX_ROUNDS = 10;
export const MAX_PLAYERS = 40;

export const FORMATS: Record<Who, { id: DayFormat; name: string; note: string }[]> = {
  solo: [
    { id: "stableford", name: "Stableford", note: "Points on every hole after your shots" },
    { id: "stroke", name: "Stroke play", note: "Every shot counts, less your handicap" },
  ],
  individuals: [
    { id: "stableford", name: "Stableford", note: "Points on every hole after your shots" },
    { id: "stroke", name: "Stroke play", note: "Every shot counts, less your handicap" },
    { id: "match", name: "Match play", note: "One against one, hole by hole" },
    { id: "skins", name: "Skins", note: "Win a hole outright to take its skin" },
  ],
  teams: [
    { id: "fourball", name: "Fourballs", note: "Pairs, the better ball counts, match play" },
    { id: "foursomes", name: "Foursomes", note: "Pairs, one ball, alternate shots, match play" },
    { id: "singles", name: "Singles", note: "One against one, match play" },
  ],
};

export const formatName = (f: DayFormat) => Object.values(FORMATS).flat().find((x) => x.id === f)?.name ?? f;

export function playOf(f: DayFormat): { play: PlayType; scoring: ScoringType } {
  if (f === "fourball") return { play: "fourball", scoring: "match" };
  if (f === "foursomes") return { play: "foursomes", scoring: "match" };
  if (f === "singles" || f === "match") return { play: "singles", scoring: "match" };
  return { play: "singles", scoring: f };
}

/** Head-to-head formats need players drawn into matches. */
export const isMatch = (f: DayFormat) => playOf(f).scoring === "match";
/** Pairs on each side. */
export const isPairs = (f: DayFormat) => f === "fourball" || f === "foursomes";

export interface CourseRating {
  slope: number;
  rating: number;
  par: number;
}

/** The World Handicap System allowances, with course handicaps from the tee's slope and rating where known. */
export function handicapFor(f: DayFormat, course: CourseRating | null): HandicapRule {
  const pct = f === "stableford" || f === "stroke" ? 95 : f === "fourball" ? 85 : f === "foursomes" ? 50 : 100;
  return { mode: "allowance", pct, relative: f !== "stableford" && f !== "stroke", course };
}

export interface RoundPoints {
  /** Match formats: points for winning a match (a half shares it) */
  win?: number;
  /** Stableford and stroke-play days: points for 1st, 2nd, 3rd… over the whole field */
  positions?: number[];
  /** Skins: points per skin */
  skin?: number;
}

export function defaultPoints(f: DayFormat, players: number): RoundPoints {
  if (isMatch(f)) return { win: 1 };
  if (f === "skins") return { skin: 1 };
  return { positions: players >= 4 ? [3, 2, 1] : players === 3 ? [2, 1] : [1] };
}

export function pointsRule(f: DayFormat, p: RoundPoints | undefined, standings: StandingsMode, players: number): PointsRule {
  if (standings !== "points") return { front: 0, back: 0, full: 0 };
  const d = { ...defaultPoints(f, players), ...p };
  if (isMatch(f)) return { front: 0, back: 0, full: Math.max(0, Number(d.win) || 0) };
  if (f === "skins") return { front: 0, back: 0, full: 0, skin: Math.max(0, Number(d.skin) || 0) };
  return { front: 0, back: 0, full: 0, positions: (d.positions ?? []).map((n) => Math.max(0, Number(n) || 0)), across: true };
}

export interface WizRound {
  /** A course from the search ("golfapi:…", "gca:…", "local:…"), or none when the card is typed in */
  courseRef?: string | null;
  courseName: string;
  location?: string | null;
  lat?: number | null;
  lon?: number | null;
  tee?: string | null;
  holeSet: HoleSet;
  /** Typed in by hand: par and stroke index per hole */
  manualCard?: { par: number; si: number }[] | null;
  format: DayFormat;
  date?: string | null;
  time?: string | null;
  points?: RoundPoints;
}

export interface WizPlayer {
  name: string;
  /** Handicap index (plus handicaps are negative) */
  index: number | null;
  /** Team 0 or 1 (team events) */
  team?: 0 | 1 | null;
}

export interface Wizard {
  who: Who;
  name: string;
  subtitle?: string;
  rounds: WizRound[];
  players: WizPlayer[];
  /** The organiser is the first player */
  organiserPlays: boolean;
  teams?: { name: string; color: string }[];
  draw: "myself" | "random";
  extras: { feed: boolean; ai: boolean; video: boolean };
  theme: ThemeId;
  /** GPS distances in yards (default) or metres */
  units?: "yards" | "metres";
}

/** Running totals when everyone plays the same Stableford or stroke-play format; points otherwise. */
export function standingsFor(w: Pick<Wizard, "who" | "rounds">): StandingsMode {
  if (w.who === "teams" || !w.rounds.length) return "points";
  const f = w.rounds[0].format;
  if ((f === "stableford" || f === "stroke") && w.rounds.every((r) => r.format === f)) return f;
  return "points";
}

/** More than one group or match to arrange: the draw question is asked. */
export function needsDraw(w: Pick<Wizard, "who" | "rounds" | "players">): boolean {
  if (w.who === "solo") return false;
  const n = w.players.length;
  return w.rounds.some((r) => (w.who === "teams" ? true : isMatch(r.format) ? n > 2 : n > 4));
}

/** What would stop the draw working, in plain words. */
export function drawProblems(w: Pick<Wizard, "who" | "rounds" | "players">): string[] {
  const out: string[] = [];
  const n = w.players.length;
  if (w.who === "teams") {
    const a = w.players.filter((p) => p.team === 0).length;
    const b = w.players.filter((p) => p.team === 1).length;
    if (a + b < n) out.push("Put every player on a team.");
    else if (a !== b) out.push(`The teams need the same number of players (${a} and ${b} now).`);
    else if (a && w.rounds.some((r) => isPairs(r.format)) && a % 2) out.push("Fourballs and foursomes need an even number on each team, to make pairs.");
    if (a === 0 || b === 0) out.push("Each team needs players.");
  } else if (w.who === "individuals") {
    const m = w.rounds.findIndex((r) => r.format === "match");
    if (m >= 0 && n % 2) out.push(`Match play (round ${m + 1}) needs an even number of players.`);
    if (n < 2) out.push("Add at least two players.");
  }
  return [...new Set(out)];
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Split into groups of at most four, as even as possible (6 → 3 + 3, 9 → 3 + 3 + 3, 10 → 4 + 3 + 3). */
export function groupsOf(ids: string[], max = 4): string[][] {
  if (!ids.length) return [];
  const count = Math.ceil(ids.length / max);
  const out: string[][] = Array.from({ length: count }, () => []);
  const base = Math.floor(ids.length / count);
  let extra = ids.length % count;
  let k = 0;
  for (const g of out) {
    const size = base + (extra-- > 0 ? 1 : 0);
    g.push(...ids.slice(k, k + size));
    k += size;
  }
  return out;
}

/**
 * Who plays with whom in a round. `ids` are player ids in the wizard's order; `teamOf` their team ids.
 * Returns null when the organiser will set them in Admin (the draw is "myself" and there's a choice to make).
 */
export function drawRound(
  w: Pick<Wizard, "who" | "draw">,
  round: Pick<WizRound, "format">,
  roundNo: number,
  ids: string[],
  teamOf: Record<string, string | null>,
  rnd: () => number = Math.random,
): Game[] | null {
  const gid = (i: number) => `r${roundNo}g${i + 1}`;
  const solo = (pid: string) => ({ id: pid, playerIds: [pid], teamId: teamOf[pid] ?? null });
  if (w.who === "solo") return [{ id: gid(0), sides: [solo(ids[0])], scorerId: ids[0] }];
  const order = (xs: string[]) => (w.draw === "random" ? shuffle(xs, rnd) : xs);

  if (w.who === "teams") {
    if (w.draw === "myself") return null;
    const teamIds = [...new Set(ids.map((p) => teamOf[p]).filter(Boolean))] as string[];
    const [a, b] = teamIds.map((t) => order(ids.filter((p) => teamOf[p] === t)));
    if (!a || !b) return null;
    const per = isPairs(round.format) ? 2 : 1;
    const games: Game[] = [];
    for (let i = 0; i * per < Math.min(a.length, b.length); i++) {
      const pa = a.slice(i * per, i * per + per);
      const pb = b.slice(i * per, i * per + per);
      if (pa.length < per || pb.length < per) break;
      const g = gid(i);
      const side = (ps: string[], k: "a" | "b") => (per === 1 ? solo(ps[0]) : { id: `${g}-${k}`, playerIds: ps, teamId: teamOf[ps[0]] ?? null });
      games.push({ id: g, name: `Match ${i + 1}`, sides: [side(pa, "a"), side(pb, "b")], scorerId: pa[0] });
    }
    return games;
  }

  // Individuals
  if (isMatch(round.format)) {
    if (ids.length > 2 && w.draw === "myself") return null;
    const xs = ids.length > 2 ? order(ids) : ids;
    const games: Game[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2)
      games.push({ id: gid(i / 2), name: `Match ${i / 2 + 1}`, sides: [solo(xs[i]), solo(xs[i + 1])], scorerId: xs[i] });
    return games;
  }
  if (ids.length > 4 && w.draw === "myself") return null;
  return groupsOf(ids.length > 4 ? order(ids) : ids).map((g, i) => ({ id: gid(i), name: `Group ${i + 1}`, sides: g.map(solo), scorerId: g[0] }));
}
