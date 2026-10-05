/**
 * October Special scoring engine.
 *
 * Pure functions only: no database, no UI. Everything shown on the site
 * (leaderboards, match status, points, tallies) is derived from raw hole
 * entries by this module, so it is the single source of truth.
 *
 * Rules (agreed Oct 2026):
 * - Each round has a format: stableford | stroke | match.
 * - Front 9 = 10 pts, Back 9 = 10 pts, Full 18 = round.fullPoints (20/30/40).
 * - A halved segment splits its points equally.
 * - Handicaps are set per round: shots received per player (0 = flat/gross).
 *   Shots are given by stroke index (SI 1 hardest). >18 shots wrap around.
 * - Stableford: more points wins. Stroke: lower net total wins.
 *   Match: more holes won (net) on that segment wins. All matches played out.
 * - CTP (par 3s, ball on green) and Long Drive (par 5s, on fairway): one winner
 *   or nobody per hole; most wins across the tournament takes 10 pts each.
 * - GIR: most greens in regulation across the tournament takes 20 pts.
 * - Cumulative ties split points.
 * - Birdies/eagles are GROSS and are a tally only (no points).
 */

export type Format = "stableford" | "stroke" | "match";
export type PlayerId = string;

export interface Hole {
  number: number; // 1-18
  par: number;
  si: number; // stroke index 1-18
}

export interface PlayerHole {
  gross: number | null; // null = not yet entered
  pickedUp?: boolean; // stableford/match only: no score, 0 pts / loses hole
  gir?: boolean;
}

export interface HoleEntry {
  hole: number;
  scores: Record<PlayerId, PlayerHole>;
  ctpWinner?: PlayerId | null; // par 3s only; null = nobody on green
  ldWinner?: PlayerId | null; // par 5s only; null = nobody on fairway
}

export interface RoundConfig {
  id: string;
  number: number;
  name: string; // course name
  format: Format;
  ninePoints: number; // 10
  fullPoints: number; // 20 / 30 / 40
  shots: Record<PlayerId, number>; // shots received for this round; 0 = flat
  holes: Hole[]; // 18 holes
}

export interface TournamentConfig {
  players: PlayerId[];
  rounds: RoundConfig[];
  ctpPoints: number; // 10
  ldPoints: number; // 10
  girPoints: number; // 20
}

export type Segment = "front" | "back" | "full";

export const SEGMENT_HOLES: Record<Segment, number[]> = {
  front: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  back: [10, 11, 12, 13, 14, 15, 16, 17, 18],
  full: Array.from({ length: 18 }, (_, i) => i + 1),
};

// ---------------------------------------------------------------- basics

/** Shots a player receives on a hole given their shots for the round. */
export function shotsOnHole(roundShots: number, si: number): number {
  if (roundShots <= 0) return 0;
  const base = Math.floor(roundShots / 18);
  const extra = si <= roundShots % 18 ? 1 : 0;
  return base + extra;
}

export function isComplete(ph: PlayerHole | undefined, format: Format): boolean {
  if (!ph) return false;
  if (ph.gross != null) return true;
  return !!ph.pickedUp && format !== "stroke";
}

export function netScore(ph: PlayerHole, shots: number): number | null {
  if (ph.gross == null) return null;
  return ph.gross - shots;
}

export function stablefordPoints(ph: PlayerHole, par: number, shots: number): number {
  if (ph.pickedUp || ph.gross == null) return 0;
  return Math.max(0, 2 + par - (ph.gross - shots));
}

/** Gross result vs par: -1 birdie, -2 eagle, etc. null if no score. */
export function grossToPar(ph: PlayerHole | undefined, par: number): number | null {
  if (!ph || ph.gross == null || ph.pickedUp) return null;
  return ph.gross - par;
}

// ---------------------------------------------------------------- per hole

export interface HoleResult {
  hole: number;
  complete: boolean; // all players have entered
  net: Record<PlayerId, number | null>;
  stableford: Record<PlayerId, number>;
  shots: Record<PlayerId, number>;
  matchWinner?: PlayerId | "halved" | null; // match play only (2 players)
}

export function holeResult(
  round: RoundConfig,
  players: PlayerId[],
  entry: HoleEntry | undefined,
): HoleResult {
  const hole = round.holes.find((h) => h.number === (entry?.hole ?? -1));
  const holeNo = entry?.hole ?? -1;
  const res: HoleResult = {
    hole: holeNo,
    complete: false,
    net: {},
    stableford: {},
    shots: {},
  };
  if (!hole || !entry) return res;

  res.complete = players.every((p) => isComplete(entry.scores[p], round.format));
  for (const p of players) {
    const s = shotsOnHole(round.shots[p] ?? 0, hole.si);
    res.shots[p] = s;
    const ph = entry.scores[p];
    res.net[p] = ph ? netScore(ph, s) : null;
    res.stableford[p] = ph ? stablefordPoints(ph, hole.par, s) : 0;
  }

  if (round.format === "match" && players.length === 2 && res.complete) {
    const [a, b] = players;
    const aPU = !!entry.scores[a]?.pickedUp;
    const bPU = !!entry.scores[b]?.pickedUp;
    if (aPU && bPU) res.matchWinner = "halved";
    else if (aPU) res.matchWinner = b;
    else if (bPU) res.matchWinner = a;
    else {
      const na = res.net[a]!;
      const nb = res.net[b]!;
      res.matchWinner = na < nb ? a : nb < na ? b : "halved";
    }
  }
  return res;
}

// ---------------------------------------------------------------- segments

export interface SegmentResult {
  segment: Segment;
  holesPlayed: number; // holes complete for all players
  complete: boolean;
  /** Format-specific running value per player:
   *  stableford = points, stroke = net strokes, match = holes won */
  value: Record<PlayerId, number>;
  /** Leader(s) on current value (ties included). Empty if nothing played. */
  leaders: PlayerId[];
  /** Points awarded once complete (split on ties). Zero until complete. */
  points: Record<PlayerId, number>;
  /** Match play: holes up for the leader and label, e.g. "2 UP thru 11" */
  matchLabel?: string;
}

function emptyRecord(players: PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(players.map((p) => [p, 0]));
}

export function segmentResult(
  round: RoundConfig,
  players: PlayerId[],
  entries: HoleEntry[],
  segment: Segment,
  names?: Record<PlayerId, string>,
): SegmentResult {
  const holes = SEGMENT_HOLES[segment];
  const value = emptyRecord(players);
  let holesPlayed = 0;

  for (const n of holes) {
    const entry = entries.find((e) => e.hole === n);
    const hr = holeResult(round, players, entry);
    if (!hr.complete) continue;
    holesPlayed++;
    for (const p of players) {
      if (round.format === "stableford") value[p] += hr.stableford[p];
      else if (round.format === "stroke") value[p] += hr.net[p] ?? 0;
      else if (hr.matchWinner === p) value[p] += 1;
    }
  }

  const complete = holesPlayed === holes.length;
  const lowerIsBetter = round.format === "stroke";
  let leaders: PlayerId[] = [];
  if (holesPlayed > 0) {
    const vals = players.map((p) => value[p]);
    const best = lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
    leaders = players.filter((p) => value[p] === best);
  }

  const pot =
    segment === "full" ? round.fullPoints : round.ninePoints;
  const points = emptyRecord(players);
  if (complete && leaders.length > 0) {
    for (const p of leaders) points[p] = pot / leaders.length;
  }

  const result: SegmentResult = {
    segment,
    holesPlayed,
    complete,
    value,
    leaders,
    points,
  };

  if (round.format === "match" && players.length === 2) {
    result.matchLabel = matchLabel(value, players, holesPlayed, holes.length, names);
  }
  return result;
}

export function matchLabel(
  wins: Record<PlayerId, number>,
  players: PlayerId[],
  played: number,
  total: number,
  names?: Record<PlayerId, string>,
): string {
  const [a, b] = players;
  const diff = wins[a] - wins[b];
  const remaining = total - played;
  if (played === 0) return "Not started";
  const nm = (p: PlayerId) => names?.[p] ?? p;
  if (diff === 0) {
    return remaining === 0 ? "Halved" : `All square thru ${played}`;
  }
  const leader = diff > 0 ? a : b;
  const up = Math.abs(diff);
  if (remaining === 0) return `${nm(leader)} wins ${up} UP`;
  if (up > remaining) return `${nm(leader)} won ${up}&${remaining}`;
  if (up === remaining) return `${nm(leader)} ${up} UP (dormie) thru ${played}`;
  return `${nm(leader)} ${up} UP thru ${played}`;
}

// ---------------------------------------------------------------- round

export interface RoundSummary {
  roundId: string;
  front: SegmentResult;
  back: SegmentResult;
  full: SegmentResult;
  points: Record<PlayerId, number>; // front + back + full
  holesPlayed: number;
  complete: boolean;
  birdies: Record<PlayerId, number>;
  eagles: Record<PlayerId, number>; // eagle or better
  gir: Record<PlayerId, number>;
  ctp: Record<PlayerId, number>;
  ld: Record<PlayerId, number>;
  stablefordTotal: Record<PlayerId, number>;
  grossTotal: Record<PlayerId, number>;
}

export function roundSummary(
  round: RoundConfig,
  players: PlayerId[],
  entries: HoleEntry[],
  names?: Record<PlayerId, string>,
): RoundSummary {
  const front = segmentResult(round, players, entries, "front", names);
  const back = segmentResult(round, players, entries, "back", names);
  const full = segmentResult(round, players, entries, "full", names);

  const points = emptyRecord(players);
  for (const p of players) points[p] = front.points[p] + back.points[p] + full.points[p];

  const birdies = emptyRecord(players);
  const eagles = emptyRecord(players);
  const gir = emptyRecord(players);
  const ctp = emptyRecord(players);
  const ld = emptyRecord(players);
  const stablefordTotal = emptyRecord(players);
  const grossTotal = emptyRecord(players);

  for (const entry of entries) {
    const hole = round.holes.find((h) => h.number === entry.hole);
    if (!hole) continue;
    const hr = holeResult(round, players, entry);
    for (const p of players) {
      const ph = entry.scores[p];
      const tp = grossToPar(ph, hole.par);
      if (tp === -1) birdies[p]++;
      if (tp != null && tp <= -2) eagles[p]++;
      if (ph?.gir) gir[p]++;
      if (ph?.gross != null && !ph.pickedUp) grossTotal[p] += ph.gross;
      stablefordTotal[p] += hr.stableford[p] ?? 0;
    }
    if (hole.par === 3 && entry.ctpWinner && players.includes(entry.ctpWinner)) {
      ctp[entry.ctpWinner]++;
    }
    if (hole.par === 5 && entry.ldWinner && players.includes(entry.ldWinner)) {
      ld[entry.ldWinner]++;
    }
  }

  return {
    roundId: round.id,
    front,
    back,
    full,
    points,
    holesPlayed: full.holesPlayed,
    complete: full.complete,
    birdies,
    eagles,
    gir,
    ctp,
    ld,
    stablefordTotal,
    grossTotal,
  };
}

// ---------------------------------------------------------------- tournament

export interface CumulativeAward {
  counts: Record<PlayerId, number>;
  leaders: PlayerId[];
  /** Provisional split if the tournament ended now. */
  projectedPoints: Record<PlayerId, number>;
  /** Awarded points: only non-zero once every round is complete. */
  points: Record<PlayerId, number>;
}

export interface TournamentSummary {
  rounds: RoundSummary[];
  ctp: CumulativeAward;
  ld: CumulativeAward;
  gir: CumulativeAward;
  birdies: Record<PlayerId, number>;
  eagles: Record<PlayerId, number>;
  /** Points from completed segments only (nines/18s) */
  matchPoints: Record<PlayerId, number>;
  /** matchPoints + awarded side points */
  totalPoints: Record<PlayerId, number>;
  /** matchPoints + projected side points (for "if it ended now" view) */
  projectedTotal: Record<PlayerId, number>;
  pointsRemaining: number;
  complete: boolean;
}

function award(
  counts: Record<PlayerId, number>,
  players: PlayerId[],
  pot: number,
  finished: boolean,
): CumulativeAward {
  const vals = players.map((p) => counts[p]);
  const best = Math.max(...vals);
  const leaders = best > 0 ? players.filter((p) => counts[p] === best) : [];
  const projectedPoints = emptyRecord(players);
  if (leaders.length > 0) {
    for (const p of leaders) projectedPoints[p] = pot / leaders.length;
  } else if (finished) {
    // Nobody won a single one across the whole trip: split it.
    for (const p of players) projectedPoints[p] = pot / players.length;
  }
  return {
    counts,
    leaders,
    projectedPoints,
    points: finished ? projectedPoints : emptyRecord(players),
  };
}

export function tournamentSummary(
  cfg: TournamentConfig,
  entriesByRound: Record<string, HoleEntry[]>,
  names?: Record<PlayerId, string>,
): TournamentSummary {
  const { players } = cfg;
  const rounds = cfg.rounds.map((r) =>
    roundSummary(r, players, entriesByRound[r.id] ?? [], names),
  );
  const sum = (key: keyof RoundSummary) => {
    const out = emptyRecord(players);
    for (const rs of rounds) {
      const rec = rs[key] as Record<PlayerId, number>;
      for (const p of players) out[p] += rec[p] ?? 0;
    }
    return out;
  };

  const complete = rounds.length > 0 && rounds.every((r) => r.complete);
  const ctp = award(sum("ctp"), players, cfg.ctpPoints, complete);
  const ld = award(sum("ld"), players, cfg.ldPoints, complete);
  const gir = award(sum("gir"), players, cfg.girPoints, complete);
  const matchPoints = sum("points");

  const totalPoints = emptyRecord(players);
  const projectedTotal = emptyRecord(players);
  for (const p of players) {
    totalPoints[p] = matchPoints[p] + ctp.points[p] + ld.points[p] + gir.points[p];
    projectedTotal[p] =
      matchPoints[p] + ctp.projectedPoints[p] + ld.projectedPoints[p] + gir.projectedPoints[p];
  }

  // Points still to be decided
  let pointsRemaining = 0;
  cfg.rounds.forEach((r, i) => {
    const rs = rounds[i];
    if (!rs.front.complete) pointsRemaining += r.ninePoints;
    if (!rs.back.complete) pointsRemaining += r.ninePoints;
    if (!rs.full.complete) pointsRemaining += r.fullPoints;
  });
  if (!complete) pointsRemaining += cfg.ctpPoints + cfg.ldPoints + cfg.girPoints;

  return {
    rounds,
    ctp,
    ld,
    gir,
    birdies: sum("birdies"),
    eagles: sum("eagles"),
    matchPoints,
    totalPoints,
    projectedTotal,
    pointsRemaining,
    complete,
  };
}

export function totalPointsAvailable(cfg: TournamentConfig): number {
  return (
    cfg.rounds.reduce((t, r) => t + r.ninePoints * 2 + r.fullPoints, 0) +
    cfg.ctpPoints +
    cfg.ldPoints +
    cfg.girPoints
  );
}
