/**
 * Multi-format golf scoring engine.
 *
 * Vocabulary
 * - Player: a golfer with a handicap, optionally on a team.
 * - Side: one player, or a pair, competing as a unit.
 * - Ball: what gets a score on each hole. Own-ball formats (singles, fourball)
 *   have one ball per player; one-ball formats (foursomes, greensomes,
 *   scramble) have one ball per side. Ball ids are player ids or side ids.
 * - Game: a set of sides playing together. Two sides = head-to-head (match,
 *   or a 2-way stableford/stroke contest). More sides = a field/leaderboard.
 * - Round: one course on one day, with one play type + scoring type, and one
 *   or more games (e.g. four matches in a team session).
 *
 * Everything shown on the site is derived from raw hole entries here.
 */

import { shotsOnHole } from "./scoring";

/** A nine-hole round: a 9-hole course, or the front or back nine of an 18. */
export const isNine = (round: Pick<RoundCfg, "holes">) => round.holes.length <= 9;

/**
 * The stroke index used to give shots on a hole. On 18 holes it's the card's index. On nine holes the
 * holes are ranked by their card index (toughest first, 1 to 9), so shots go on the toughest of those nine.
 */
export function strokeIndex(round: Pick<RoundCfg, "holes">, hole: number): number {
  const h = cardHole(round.holes, hole);
  if (!h) return 99;
  if (!isNine(round)) return h.si;
  return [...round.holes].sort((a, b) => a.si - b.si || a.number - b.number).findIndex((x) => x.number === h.number) + 1;
}

/** Shots a ball receives on one hole of this round. */
export function holeShots(round: Pick<RoundCfg, "holes">, roundShots: number, hole: number): number {
  return shotsOnHole(roundShots, strokeIndex(round, hole), isNine(round) ? round.holes.length : 18);
}

/**
 * A hole of the card. Past the last hole (a knockout match level after 18 goes on to extra holes) the card
 * starts again: the 19th is played as the 1st, the 20th as the 2nd, with the same par and stroke index.
 */
export function cardHole(holes: Hole[], n: number): Hole | undefined {
  const h = holes.find((x) => x.number === n);
  if (h || !holes.length) return h;
  const sorted = [...holes].sort((a, b) => a.number - b.number);
  const last = sorted[sorted.length - 1].number;
  if (n <= last) return undefined;
  return sorted[(n - last - 1) % sorted.length];
}

/** The card a ball plays: a player on their own tees has their own pars and stroke indexes. */
export function holesFor(round: Pick<RoundCfg, "holes" | "playerTees">, ball: string): Hole[] {
  return round.playerTees?.[ball]?.holes ?? round.holes;
}

/** Par and shots for one ball on one hole, from the ball's own card. */
function ballHole(round: RoundCfg, ball: string, shots: number, n: number): { par: number; shots: number } | null {
  const holes = holesFor(round, ball);
  const h = cardHole(holes, n);
  if (!h) return null;
  return { par: h.par, shots: holeShots({ holes }, shots, h.number) };
}

export type PlayType = "singles" | "fourball" | "foursomes" | "greensomes" | "scramble";
export type ScoringType = "stableford" | "stroke" | "match" | "skins";
export type Segment = "front" | "back" | "full";

export const ONE_BALL: PlayType[] = ["foursomes", "greensomes", "scramble"];

export interface Hole {
  number: number;
  par: number;
  si: number;
}

export interface Player {
  id: string;
  name: string;
  handicap?: number | null;
  teamId?: string | null;
}

export interface Team {
  id: string;
  name: string;
  color?: string;
}

export interface Side {
  id: string;
  name?: string;
  playerIds: string[];
  teamId?: string | null;
}

export interface Game {
  id: string;
  name?: string;
  sides: Side[];
  scorerId?: string | null;
  /** Plays for nothing but the prizes (a knockout's knocked-out players): scored as Stableford, no points */
  free?: boolean;
  /** "10:20" */
  teeTime?: string | null;
}

export type HandicapRule =
  | { mode: "manual"; shots: Record<string, number> } // shots per ball id
  | {
      mode: "allowance";
      pct: number;
      relative: boolean;
      /** World Handicap System: player handicaps are indexes, turned into a course handicap for the tee played
       *  (index × slope ÷ 113 + rating − par) before the allowance. Without it, handicaps are used as they are. */
      course?: CourseRating | null;
    }; // from player handicaps

export interface PointsRule {
  front: number; // head-to-head: segment pots
  back: number;
  full: number;
  /** Field games: points for 1st, 2nd... on the full round (ties share). */
  positions?: number[];
  /** Skins: points per skin. */
  skin?: number;
  /** Field rounds played in several groups: positions are over the whole field, not within each group. */
  across?: boolean;
}

export interface RoundCfg {
  id: string;
  number: number;
  name: string;
  holes: Hole[];
  play: PlayType;
  scoring: ScoringType;
  games: Game[];
  points: PointsRule;
  handicap: HandicapRule;
  /** Organiser has closed the round (e.g. abandoned). Unplayed segments stay unawarded,
   *  but the tournament can still finish. */
  closed?: boolean;
  /** Players on different tees from the round's: their own card (pars, stroke indexes) and the tee's rating */
  playerTees?: Record<string, { tee: string; holes: Hole[]; course?: CourseRating | null }>;
}

export interface CourseRating {
  slope: number;
  rating: number;
  par: number;
}

export type SideGameKind = "ctp" | "ld" | "gir" | "birdies" | "eagles";

export interface SideGameCfg {
  kind: SideGameKind;
  /** Points to the overall winner (ties split). 0 = tally only. */
  points: number;
  enabled: boolean;
}

export interface TournamentCfg {
  players: Player[];
  teams: Team[];
  rounds: RoundCfg[];
  sideGames: SideGameCfg[];
  /** Who side games are awarded to. */
  sideGamesBy: "player" | "team";
  /** How the tournament is won: points from each round (default), or running Stableford or stroke-play totals.
   *  Tournaments made before the set-up redesign; newer ones say it in `win`. */
  standings?: StandingsMode;
  /** How the overall winner is decided (set-up redesign). Absent: worked out from `standings` and the teams. */
  win?: WinRule | null;
  /** Prizes alongside the winner (closest the pin and so on). They change the standings only as points-race bonus. */
  prizes?: Prize[] | null;
}

export type StandingsMode = "points" | "stableford" | "stroke";

/** Extra points in a points race, each time it happens. */
export type BonusKind = "birdies" | "eagles" | "gir" | "ctp" | "ld";
/** Closest the pin and long drive: the holes chosen in each round (round number → holes; [] = not that round). */
export type SideHoles = Partial<Record<"ctp" | "ld", Record<string, number[]>>>;

/** How the overall winner is decided. */
export type WinRule =
  /** Everyone's Stableford points over every round, added up */
  | { kind: "stableford" }
  /** Net strokes to par over every round, added up; lowest wins */
  | { kind: "stroke" }
  /** Points for each round's result (places, matches, skins), plus any bonus points per birdie and the like */
  | {
      kind: "points";
      bonus?: Partial<Record<BonusKind, number>>;
      /** Closest the pin and long drive: the holes chosen in each round (round number → holes; [] = not that round;
       *  a round missing = every par 3 or par 5). The same holes as the prize, when there's one. */
      bonusHoles?: SideHoles;
    }
  /** Two teams, Ryder Cup style: points for matches won, by team */
  | { kind: "matches" }
  /** Any number of teams: on every hole each team's best `count` Stableford scores count (0 = all of them) */
  | { kind: "teamscore"; count: number }
  /** Teams of up to four, one ball each (Texas scramble): net strokes to par, lowest wins */
  | { kind: "scramble" }
  /** Skins across the whole field: a hole won outright by the lowest net score; ties carry over if `carry` */
  | { kind: "skins"; carry: boolean }
  /** Match play knockout, one stage per round */
  | { kind: "knockout"; knockout: Knockout };

export interface Entrant {
  /** A player id (singles), or "pair:<a>+<b>" (pairs) */
  id: string;
  playerIds: string[];
}

export interface Knockout {
  /** Pairs play fourballs; otherwise singles */
  pairs: boolean;
  /** A match level after 18 holes: better back nine on the card, or extra holes */
  tie: "backnine" | "extra";
  draw: "random" | "seeded" | "pick";
  entrants: Entrant[];
  /** The first stage in bracket order: match k is slots[2k] v slots[2k+1]; null is a bye. Length a power of two. */
  slots: (string | null)[];
}

export type PrizeKind = "ctp" | "ld" | "nines" | "birdies" | "gir" | "skins" | "bestround";

export interface Prize {
  kind: PrizeKind;
  /** Over the whole trip, or one for each round (front and back nine are always per round) */
  per: "trip" | "round";
  /** Closest the pin and long drive: the holes that count (default: every par 3 / every par 5) */
  holes?: number[] | null;
  /** The same, chosen course by course: round number → holes (a round not listed: every par 3 / par 5) */
  holesByRound?: Record<string, number[]> | null;
  /** Points race only: the prize counts as this many points instead of standing apart */
  points?: number | null;
}

export interface BallHole {
  gross: number | null;
  pickedUp?: boolean;
  gir?: boolean;
  /** Who entered it (any phone in the group can) */
  by?: string;
}

export interface HoleEntry {
  game: string; // game id
  hole: number;
  scores: Record<string, BallHole>; // ball id -> score
  ctpWinner?: string | null; // ball id
  ldWinner?: string | null; // ball id
  /** Match play: the side that conceded the hole (the other side wins it; no scores needed) */
  conceded?: string | null;
}

// ---------------------------------------------------------------- balls + shots

export function ballsOfSide(side: Side, play: PlayType): string[] {
  return ONE_BALL.includes(play) ? [side.id] : side.playerIds;
}

export function ballsOfGame(game: Game, play: PlayType): string[] {
  return game.sides.flatMap((s) => ballsOfSide(s, play));
}

/** Which players a ball belongs to (for crediting tallies). */
export function playersOfBall(ball: string, game: Game): string[] {
  const side = game.sides.find((s) => s.id === ball);
  if (side) return side.playerIds;
  return [ball];
}

/** Handicap of a one-ball side from its players' handicaps, per the
 *  common recommended allowances. */
export function oneBallHandicap(play: PlayType, hcps: number[], pct: number): number {
  const s = [...hcps].sort((a, b) => a - b);
  if (play === "foursomes") return (s.reduce((a, b) => a + b, 0) * pct) / 100;
  if (play === "greensomes") return 0.6 * (s[0] ?? 0) + 0.4 * (s[1] ?? 0);
  if (play === "scramble") {
    const w = s.length >= 4 ? [0.25, 0.2, 0.15, 0.1] : s.length === 3 ? [0.3, 0.2, 0.1] : [0.35, 0.15];
    return s.reduce((a, h, i) => a + h * (w[i] ?? 0), 0);
  }
  return 0;
}

/** World Handicap System course handicap: index × slope ÷ 113 + (course rating − par). */
export function courseHandicap(index: number, c: { slope: number; rating: number; par: number }): number {
  return (index * c.slope) / 113 + (c.rating - c.par);
}

/** Shots received per ball in a game. */
export function gameShots(round: RoundCfg, game: Game, players: Player[]): Record<string, number> {
  const balls = ballsOfGame(game, round.play);
  const out: Record<string, number> = {};
  if (round.handicap.mode === "manual") {
    for (const b of balls) out[b] = Math.max(0, Math.round(round.handicap.shots[b] ?? 0));
    return out;
  }
  const { pct, relative, course } = round.handicap;
  const index = (pid: string) => players.find((p) => p.id === pid)?.handicap ?? 0;
  const hcp = (pid: string) => {
    const c = round.playerTees?.[pid]?.course ?? course;
    return c?.slope ? courseHandicap(index(pid), c) : index(pid);
  };
  for (const side of game.sides) {
    if (ONE_BALL.includes(round.play)) {
      out[side.id] = oneBallHandicap(round.play, side.playerIds.map(hcp), pct);
    } else {
      for (const pid of side.playerIds) out[pid] = (hcp(pid) * pct) / 100;
    }
  }
  // Nine holes: half the 18-hole allowance
  for (const b of balls) out[b] = Math.round((out[b] ?? 0) / (isNine(round) ? 2 : 1));
  if (relative) {
    const low = Math.min(...balls.map((b) => out[b]));
    for (const b of balls) out[b] -= low;
  }
  for (const b of balls) out[b] = Math.max(0, out[b]);
  return out;
}

// ---------------------------------------------------------------- per hole

function ballDone(b: BallHole | undefined, scoring: ScoringType, play: PlayType): boolean {
  if (!b) return false;
  if (b.gross != null) return true;
  // Pick-ups are fine except where every stroke counts on a single ball
  if (!b.pickedUp) return false;
  return !(scoring === "stroke" && play !== "fourball");
}

function ballNet(b: BallHole | undefined, shots: number): number | null {
  if (!b || b.gross == null || b.pickedUp) return null;
  return b.gross - shots;
}

function ballPts(b: BallHole | undefined, par: number, shots: number): number {
  const n = ballNet(b, shots);
  return n == null ? 0 : Math.max(0, 2 + par - n);
}

export interface SideHole {
  complete: boolean;
  net: number | null; // best net for the side (null = no score: picked up)
  pts: number; // stableford points for the side
}

export interface GameHole {
  hole: number;
  complete: boolean;
  sides: Record<string, SideHole>;
  /** Winner(s) of the hole by net (match/skins); "halved" if tied. */
  winner: string | "halved" | null;
}

export function gameHole(
  round: RoundCfg,
  game: Game,
  shots: Record<string, number>,
  entry: HoleEntry | undefined,
): GameHole {
  const h = entry ? cardHole(round.holes, entry.hole) : undefined;
  const res: GameHole = { hole: entry?.hole ?? -1, complete: false, sides: {}, winner: null };
  if (!h || !entry) return res;
  const net = (b: string) => {
    const bh = ballHole(round, b, shots[b] ?? 0, entry.hole);
    return bh ? ballNet(entry.scores[b], bh.shots) : null;
  };
  const pts = (b: string) => {
    const bh = ballHole(round, b, shots[b] ?? 0, entry.hole);
    return bh ? ballPts(entry.scores[b], bh.par, bh.shots) : 0;
  };
  // Conceded: the other side wins the hole, whatever (if anything) is on the card
  const gave = round.scoring === "match" && game.sides.length === 2 && entry.conceded ? game.sides.find((s) => s.id === entry.conceded) : undefined;
  if (gave) {
    for (const side of game.sides) {
      const nets = side.id === gave.id ? [] : ballsOfSide(side, round.play).map(net).filter((n): n is number => n != null);
      res.sides[side.id] = { complete: true, net: nets.length ? Math.min(...nets) : null, pts: 0 };
    }
    res.complete = true;
    res.winner = game.sides.find((s) => s.id !== gave.id)!.id;
    return res;
  }
  for (const side of game.sides) {
    const balls = ballsOfSide(side, round.play);
    const complete = balls.every((b) => ballDone(entry.scores[b], round.scoring, round.play));
    const nets = balls.map(net).filter((n): n is number => n != null);
    res.sides[side.id] = { complete, net: nets.length ? Math.min(...nets) : null, pts: Math.max(0, ...balls.map(pts)) };
  }
  res.complete = game.sides.every((s) => res.sides[s.id].complete);
  if (res.complete) {
    const scored = game.sides.filter((s) => res.sides[s.id].net != null);
    if (scored.length === 0) res.winner = "halved";
    else {
      const best = Math.min(...scored.map((s) => res.sides[s.id].net!));
      const at = scored.filter((s) => res.sides[s.id].net === best);
      res.winner = at.length === 1 ? at[0].id : "halved";
    }
  }
  return res;
}

// ---------------------------------------------------------------- segments

/** The holes of a segment. A nine-hole round has no front or back nine: just the one result. */
export function segmentHoles(round: Pick<RoundCfg, "holes">, segment: Segment): number[] {
  const all = round.holes.map((h) => h.number).sort((a, b) => a - b);
  if (segment === "full") return all;
  if (isNine(round)) return [];
  return segment === "front" ? all.slice(0, 9) : all.slice(9);
}

export interface SegmentResult {
  segment: Segment;
  holesPlayed: number;
  complete: boolean;
  /** stableford pts | net strokes | holes won | skins won */
  value: Record<string, number>; // by side id
  /** Ordered leaderboard (best first) with tied positions. */
  ranking: { sideId: string; pos: number; value: number }[];
  leaders: string[];
  points: Record<string, number>; // by side id; 0 until complete
  matchLabel?: string;
  /** Skins: skins currently carried over (void if still carried after the 18th). */
  carry?: number;
}

function rank(values: Record<string, number>, lowerBetter: boolean) {
  const ids = Object.keys(values).sort((a, b) => (lowerBetter ? values[a] - values[b] : values[b] - values[a]));
  const out: { sideId: string; pos: number; value: number }[] = [];
  ids.forEach((id, i) => {
    const prev = out[i - 1];
    out.push({ sideId: id, pos: prev && prev.value === values[id] ? prev.pos : i + 1, value: values[id] });
  });
  return out;
}

/** Share position points between tied sides: e.g. two tied 1st share 1st+2nd. */
export function positionPoints(ranking: SegmentResult["ranking"], table: number[]) {
  const out: Record<string, number> = {};
  let i = 0;
  while (i < ranking.length) {
    const tied = ranking.filter((r) => r.pos === ranking[i].pos);
    const pool = tied.reduce((a, _, k) => a + (table[i + k] ?? 0), 0);
    for (const t of tied) out[t.sideId] = pool / tied.length;
    i += tied.length;
  }
  return out;
}

export function sideName(side: Side, players: Player[]) {
  return side.name || side.playerIds.map((p) => players.find((x) => x.id === p)?.name ?? p).join(" & ");
}

export function segmentResult(
  round: RoundCfg,
  game: Game,
  shots: Record<string, number>,
  entries: HoleEntry[],
  segment: Segment,
  players: Player[] = [],
): SegmentResult {
  const holes = segmentHoles(round, segment);
  const value: Record<string, number> = Object.fromEntries(game.sides.map((s) => [s.id, 0]));
  let played = 0;
  let carry = 0;
  const skinPts = round.points.skin ?? 1;

  let decided: { leader: string; up: number; remaining: number } | null = null;
  for (const n of holes) {
    const gh = gameHole(round, game, shots, entries.find((e) => e.hole === n && e.game === game.id));
    if (!gh.complete) continue;
    played++;
    for (const s of game.sides) {
      const sh = gh.sides[s.id];
      if (round.scoring === "stableford") value[s.id] += sh.pts;
      else if (round.scoring === "stroke") {
        // A side with no ball holed out (fourball, both picked up) takes net double bogey
        const par = round.holes.find((x) => x.number === n)!.par;
        value[s.id] += sh.net ?? par + 2;
      }
      else if (round.scoring === "match" && gh.winner === s.id) value[s.id] += 1;
    }
    if (round.scoring === "skins") {
      if (gh.winner && gh.winner !== "halved") {
        value[gh.winner] += 1 + carry;
        carry = 0;
      } else carry += 1;
    }
    if (round.scoring === "match" && game.sides.length === 2 && !decided) {
      const [a, b] = game.sides;
      const diff = value[a.id] - value[b.id];
      const remaining = holes.length - played;
      if (remaining > 0 && Math.abs(diff) > remaining) decided = { leader: diff > 0 ? a.id : b.id, up: Math.abs(diff), remaining };
    }
  }

  // A match is over once it's decided (e.g. won 4&3): the last holes aren't needed
  const complete = played === holes.length || !!decided; // (an empty segment, on nine holes, is simply done)
  const lowerBetter = round.scoring === "stroke";
  const ranking = played > 0 ? rank(value, lowerBetter) : [];
  const leaders = ranking.filter((r) => r.pos === 1).map((r) => r.sideId);
  const points: Record<string, number> = Object.fromEntries(game.sides.map((s) => [s.id, 0]));

  if (round.scoring === "skins") {
    // Skins pay as they're won, no need to wait for completion
    if (segment === "full") for (const s of game.sides) points[s.id] = value[s.id] * skinPts;
  } else if (complete && leaders.length) {
    if (game.sides.length === 2 || !round.points.positions?.length) {
      const pot = segment === "full" ? round.points.full : round.points[segment];
      for (const id of leaders) points[id] = pot / leaders.length;
    } else if (segment === "full") {
      Object.assign(points, positionPoints(ranking, round.points.positions));
    } else {
      const pot = round.points[segment];
      for (const id of leaders) points[id] = pot / leaders.length;
    }
  }

  const res: SegmentResult = { segment, holesPlayed: played, complete, value, ranking, leaders, points };
  if (round.scoring === "match" && game.sides.length === 2) {
    const d = decided as { leader: string; up: number; remaining: number } | null;
    res.matchLabel = d
      ? `${sideName(game.sides.find((x) => x.id === d.leader)!, players)} won ${d.up}&${d.remaining}`
      : matchLabel(value, game.sides, players, played, holes.length);
  }
  if (round.scoring === "skins") res.carry = carry;
  return res;
}

export function matchLabel(
  wins: Record<string, number>,
  sides: Side[],
  players: Player[],
  played: number,
  total: number,
): string {
  const [a, b] = sides;
  const diff = wins[a.id] - wins[b.id];
  const remaining = total - played;
  if (played === 0) return "Not started";
  if (diff === 0) return remaining === 0 ? "Halved" : `All square thru ${played}`;
  const lead = diff > 0 ? a : b;
  const leader = sideName(lead, players);
  const plural = lead.playerIds.length > 1 && !lead.name;
  const up = Math.abs(diff);
  if (remaining === 0) return `${leader} ${plural ? "win" : "wins"} ${up} UP`;
  if (up > remaining) return `${leader} won ${up}&${remaining}`;
  if (up === remaining) return `${leader} ${up} UP (dormie) thru ${played}`;
  return `${leader} ${up} UP thru ${played}`;
}

// ---------------------------------------------------------------- game + round

export interface GameSummary {
  gameId: string;
  shots: Record<string, number>;
  front: SegmentResult;
  back: SegmentResult;
  full: SegmentResult;
  points: Record<string, number>; // by side
  holesPlayed: number;
  complete: boolean;
}

export interface Tallies {
  birdies: Record<string, number>;
  eagles: Record<string, number>;
  gir: Record<string, number>;
  ctp: Record<string, number>;
  ld: Record<string, number>;
}

export interface RoundSummary {
  roundId: string;
  games: GameSummary[];
  /** Points credited per player (every member of a side gets the side's points). */
  playerPoints: Record<string, number>;
  /** Points per team (each side's points counted once). */
  teamPoints: Record<string, number>;
  tallies: Tallies; // by player
  holesPlayed: number; // min across games
  complete: boolean;
}

function zero(ids: string[]) {
  return Object.fromEntries(ids.map((i) => [i, 0]));
}

export function gameSummary(round: RoundCfg, game: Game, players: Player[], entries: HoleEntry[]): GameSummary {
  // Playing for the prizes only: counted as Stableford, worth nothing
  if (game.free) round = { ...round, scoring: "stableford", play: "singles", points: { front: 0, back: 0, full: 0 } };
  const shots = gameShots(round, game, players);
  const mine = entries.filter((e) => e.game === game.id);
  const front = segmentResult(round, game, shots, mine, "front", players);
  const back = segmentResult(round, game, shots, mine, "back", players);
  const full = segmentResult(round, game, shots, mine, "full", players);
  const points = zero(game.sides.map((s) => s.id));
  for (const s of game.sides) {
    points[s.id] =
      round.scoring === "skins" ? full.points[s.id] : front.points[s.id] + back.points[s.id] + full.points[s.id];
  }
  return { gameId: game.id, shots, front, back, full, points, holesPlayed: full.holesPlayed, complete: full.complete };
}

/** A Stableford or stroke-play round in several groups whose places are over the whole field. */
export const acrossField = (r: Pick<RoundCfg, "points" | "scoring">) =>
  !!r.points.across && !!r.points.positions?.length && (r.scoring === "stableford" || r.scoring === "stroke");

/** Rank every side in the round together (once every group has finished) and pay the places. */
function applyAcross(round: RoundCfg, all: GameSummary[]) {
  const games = all.filter((_, i) => !round.games[i]?.free);
  const value: Record<string, number> = {};
  for (const g of games) Object.assign(value, g.full.value);
  const done = games.length > 0 && games.every((g) => g.full.complete);
  const paid = done ? positionPoints(rank(value, round.scoring === "stroke"), round.points.positions ?? []) : {};
  for (const g of games)
    for (const id of Object.keys(g.full.value)) {
      g.full.points[id] = paid[id] ?? 0;
      g.points[id] = g.front.points[id] + g.back.points[id] + g.full.points[id];
    }
}

export function roundSummary(round: RoundCfg, players: Player[], teams: Team[], entries: HoleEntry[]): RoundSummary {
  const pids = players.map((p) => p.id);
  const games = round.games.map((g) => gameSummary(round, g, players, entries));
  if (acrossField(round)) applyAcross(round, games);
  const playerPoints = zero(pids);
  const teamPoints = zero(teams.map((t) => t.id));
  const tallies: Tallies = { birdies: zero(pids), eagles: zero(pids), gir: zero(pids), ctp: zero(pids), ld: zero(pids) };

  round.games.forEach((g, gi) => {
    for (const s of g.sides) {
      const p = games[gi].points[s.id];
      for (const pid of s.playerIds) playerPoints[pid] = (playerPoints[pid] ?? 0) + p;
      const team = s.teamId ?? players.find((x) => x.id === s.playerIds[0])?.teamId;
      if (team) teamPoints[team] = (teamPoints[team] ?? 0) + p;
    }
    for (const e of entries.filter((x) => x.game === g.id)) {
      const h = round.holes.find((x) => x.number === e.hole); // extra holes don't count towards tallies
      if (!h) continue;
      const credit = (ball: string, key: keyof Tallies) => {
        for (const pid of playersOfBall(ball, g)) tallies[key][pid] = (tallies[key][pid] ?? 0) + 1;
      };
      for (const ball of ballsOfGame(g, round.play)) {
        const b = e.scores[ball];
        if (!b) continue;
        if (b.gir) credit(ball, "gir"); // a green hit still counts if the player later picks up
        if (b.gross == null || b.pickedUp) continue;
        const d = b.gross - (cardHole(holesFor(round, ball), e.hole) ?? h).par;
        if (d === -1) credit(ball, "birdies");
        if (d <= -2) credit(ball, "eagles");
      }
      const balls = ballsOfGame(g, round.play);
      if (h.par === 3 && e.ctpWinner && balls.includes(e.ctpWinner)) credit(e.ctpWinner, "ctp");
      if (h.par === 5 && e.ldWinner && balls.includes(e.ldWinner)) credit(e.ldWinner, "ld");
    }
  });

  return {
    roundId: round.id,
    games,
    playerPoints,
    teamPoints,
    tallies,
    holesPlayed: games.length ? Math.min(...games.map((g) => g.holesPlayed)) : 0,
    complete: games.length > 0 && games.every((g) => g.complete),
  };
}

// ---------------------------------------------------------------- tournament

export interface Award {
  kind: SideGameKind;
  counts: Record<string, number>; // by player or team
  leaders: string[];
  projected: Record<string, number>;
  points: Record<string, number>; // only once tournament complete
}

export interface TournamentSummary {
  rounds: RoundSummary[];
  awards: Award[];
  tallies: Tallies; // by player, whole trip
  /** Banked points from rounds, by player and by team */
  playerRoundPoints: Record<string, number>;
  teamRoundPoints: Record<string, number>;
  playerTotal: Record<string, number>; // + awarded side-game points (by player mode)
  teamTotal: Record<string, number>;
  playerProjected: Record<string, number>;
  teamProjected: Record<string, number>;
  pointsAvailable: number;
  pointsRemaining: number;
  complete: boolean;
  /** Set when the tournament is won on running Stableford or stroke-play totals rather than points */
  totals: Totals | null;
  /** How it's won */
  win: WinRule;
  /** Team score or Texas scramble: the teams' totals */
  teamRows: TeamRow[] | null;
  /** Most skins: the skins table */
  skins: SkinsTable | null;
  /** Match play knockout: the bracket */
  knockout: KnockoutState | null;
  /** Prizes alongside the winner */
  prizes: PrizeResult[];
  /** Points race: bonus points per player (birdies and the like), already in the totals */
  bonus: Record<string, number>;
  /** The same, by kind: player → birdies → points */
  bonusBy: Record<string, Partial<Record<BonusKind, number>>>;
  /** Points race: points won from prizes, per player (already in the totals) */
  prizePoints: Record<string, number>;
  /** What's still to play for, by where it comes from */
  left: { rounds: number; prizes: number; holes: number; ctp: number; ld: number };
}

/** Points on offer in a round (used for "points remaining"). */
export function roundPointsAvailable(round: RoundCfg): number {
  const r = { ...round, games: round.games.filter((g) => !g.free) };
  if (r.scoring === "skins") return r.holes.length * (r.points.skin ?? 1) * r.games.length;
  const nines = isNine(r) ? 0 : r.points.front + r.points.back;
  if (acrossField(r)) return r.games.length * nines + (r.points.positions ?? []).reduce((a, b) => a + b, 0);
  return r.games.reduce((t, g) => {
    if (g.sides.length === 2 || !r.points.positions?.length) return t + nines + r.points.full;
    return t + nines + r.points.positions.reduce((a, b) => a + b, 0);
  }, 0);
}

export interface TotalRow {
  playerId: string;
  /** Stableford points, or net strokes to par */
  value: number;
  /** Gross strokes and gross to par (stroke play) */
  gross: number;
  grossToPar: number;
  holes: number;
  /** The same, round by round (by round id) */
  rounds: Record<string, { value: number; gross: number; holes: number }>;
  /** Place, ties sharing it (0 = not started) */
  pos: number;
  tied: boolean;
}

/** Running Stableford or stroke-play totals across every round. */
export interface Totals {
  kind: "stableford" | "stroke";
  rows: TotalRow[];
}

/** Each player's own ball, hole by hole, added up over the whole tournament. Stroke play is net to par
 *  (a hole without a score counts as net double bogey), so players part-way round compare fairly. */
export function totalsFor(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>, complete = false): Totals | null {
  const kind = winRuleOf(cfg).kind;
  if (kind !== "stableford" && kind !== "stroke") return null;
  const rows: Record<string, TotalRow> = Object.fromEntries(
    cfg.players.map((p) => [p.id, { playerId: p.id, value: 0, gross: 0, grossToPar: 0, holes: 0, rounds: {}, pos: 0, tied: false }]),
  );
  for (const r of cfg.rounds) {
    const entries = entriesByRound[r.id] ?? [];
    for (const g of r.games) {
      const shots = gameShots(r, g, cfg.players);
      for (const e of entries) {
        if (e.game !== g.id) continue;
        const par = r.holes.find((h) => h.number === e.hole)?.par;
        if (par == null) continue;
        for (const side of g.sides)
          for (const pid of side.playerIds) {
            const row = rows[pid];
            const ball = ONE_BALL.includes(r.play) ? side.id : pid;
            const b = e.scores[ball];
            if (!row || !ballDone(b, kind, r.play)) continue;
            const bh = ballHole(r, ball, shots[ball] ?? 0, e.hole);
            if (!bh) continue;
            const s = bh.shots;
            const net = ballNet(b, s);
            const v = kind === "stableford" ? ballPts(b, bh.par, s) : (net ?? bh.par + 2) - bh.par;
            const gross = b?.gross != null && !b.pickedUp ? b.gross : bh.par + 2 + s;
            row.value += v;
            row.gross += gross;
            row.grossToPar += gross - bh.par;
            row.holes++;
            const rr = (row.rounds[r.id] ??= { value: 0, gross: 0, holes: 0 });
            rr.value += v;
            rr.gross += gross;
            rr.holes++;
          }
      }
    }
  }
  const lower = kind === "stroke";
  // Once it's all over, a tie is settled on count-back: the last round, then its last 9, 6, 3 and 1 holes
  const last = cfg.rounds[cfg.rounds.length - 1];
  const ph = complete && last ? playerHoles(cfg, entriesByRound) : null;
  const card = last ? last.holes.map((h) => h.number).sort((a, b) => a - b) : [];
  const list = placeRows(
    Object.values(rows).sort((a, b) => b.holes - a.holes),
    (r) => (lower ? -r.value : r.value),
    (r) => r.holes > 0,
    ph ? (r) => countback(ph[last.id]?.[r.playerId], card, lower) : undefined,
  );
  return { kind, rows: list };
}

// ---------------------------------------------------------------- ways to win (set-up redesign)

/** How a tournament is won, for old tournaments too. */
export function winRuleOf(cfg: Pick<TournamentCfg, "win" | "standings" | "teams">): WinRule {
  if (cfg.win) return cfg.win;
  if (cfg.standings === "stableford" || cfg.standings === "stroke") return { kind: cfg.standings };
  return { kind: "points" };
}

/** One player's own result on one hole. */
export interface PlayerHole {
  /** Stableford points */
  pts: number;
  /** Net strokes (null: picked up) */
  net: number | null;
  gross: number | null;
  par: number;
  /** Shots received on the hole */
  shots: number;
  /** Finished the hole (a score, or picked up where that's allowed) */
  done: boolean;
}

/**
 * Every player's own result, hole by hole, round by round: roundId → playerId → hole → result. A player in a
 * one-ball side is credited with the side's ball. Extra holes (a knockout tie) are left out.
 */
export function playerHoles(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>): Record<string, Record<string, Record<number, PlayerHole>>> {
  const out: Record<string, Record<string, Record<number, PlayerHole>>> = {};
  for (const r of cfg.rounds) {
    const per: Record<string, Record<number, PlayerHole>> = (out[r.id] = {});
    const entries = entriesByRound[r.id] ?? [];
    for (const g of r.games) {
      const round = g.free ? { ...r, scoring: "stableford" as const, play: "singles" as const } : r;
      const shots = gameShots(round, g, cfg.players);
      for (const e of entries) {
        if (e.game !== g.id || !r.holes.some((h) => h.number === e.hole)) continue;
        for (const side of g.sides)
          for (const pid of side.playerIds) {
            const ball = ONE_BALL.includes(round.play) ? side.id : pid;
            const bh = ballHole(round, ball, shots[ball] ?? 0, e.hole);
            if (!bh) continue;
            const b = e.scores[ball];
            (per[pid] ??= {})[e.hole] = {
              pts: ballPts(b, bh.par, bh.shots),
              net: ballNet(b, bh.shots),
              gross: b?.gross != null && !b.pickedUp ? b.gross : null,
              par: bh.par,
              shots: bh.shots,
              done: ballDone(b, round.scoring, round.play),
            };
          }
      }
    }
  }
  return out;
}

/** Stroke play value of a hole: net to par, a pick-up as net double bogey. */
const strokeValue = (h: PlayerHole) => (h.net ?? h.par + 2) - h.par;

/**
 * Count-back between tied totals: the last round, then its last 9, 6, 3 and 1 holes. Returns a list of values,
 * compared in order (each already "higher is better").
 */
function countback(holes: Record<number, PlayerHole> | undefined, card: number[], stroke: boolean): number[] {
  const v = (h: PlayerHole | undefined) => (!h ? 0 : stroke ? -strokeValue(h) : h.pts);
  const sum = (ns: number[]) => ns.reduce((a, n) => a + v(holes?.[n]), 0);
  const last = (k: number) => card.slice(-k);
  return [sum(card), ...(card.length > 9 ? [sum(last(9))] : []), sum(last(6)), sum(last(3)), sum(last(1))];
}

/** Places for a list of rows, ties sharing a place (ranked by `key`, then by `tiebreak` once it's all over). */
function placeRows<T extends { pos: number; tied: boolean }>(rows: T[], key: (r: T) => number, started: (r: T) => boolean, tiebreak?: (r: T) => number[]) {
  const cmp = (a: T, b: T) => {
    const d = key(b) - key(a);
    if (d || !tiebreak) return d;
    const ta = tiebreak(a), tb = tiebreak(b);
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) if ((tb[i] ?? 0) !== (ta[i] ?? 0)) return (tb[i] ?? 0) - (ta[i] ?? 0);
    return 0;
  };
  rows.sort((a, b) => (started(a) ? 0 : 1) - (started(b) ? 0 : 1) || cmp(a, b));
  rows.forEach((r, i) => {
    if (!started(r)) return;
    const first = rows.findIndex((o) => started(o) && cmp(o, r) === 0);
    r.pos = first + 1;
    r.tied = rows.filter((o) => started(o) && cmp(o, r) === 0).length > 1;
    void i;
  });
  return rows;
}

/** Team score: each team's best `count` Stableford scores on every hole (0 = all), round by round. */
export interface TeamRow {
  teamId: string;
  value: number;
  rounds: Record<string, number>;
  holes: number;
  pos: number;
  tied: boolean;
}

export function teamScore(cfg: TournamentCfg, ph: ReturnType<typeof playerHoles>, count: number): TeamRow[] {
  const rows: TeamRow[] = cfg.teams.map((t) => ({ teamId: t.id, value: 0, rounds: {}, holes: 0, pos: 0, tied: false }));
  for (const r of cfg.rounds) {
    for (const row of rows) {
      const members = cfg.players.filter((p) => p.teamId === row.teamId).map((p) => p.id);
      let total = 0;
      for (const h of r.holes) {
        const pts = members.map((m) => ph[r.id]?.[m]?.[h.number]).filter((x): x is PlayerHole => !!x?.done).map((x) => x.pts).sort((a, b) => b - a);
        if (!pts.length) continue;
        total += (count > 0 ? pts.slice(0, count) : pts).reduce((a, b) => a + b, 0);
        row.holes++;
      }
      row.rounds[r.id] = total;
      row.value += total;
    }
  }
  return placeRows(rows, (r) => r.value, (r) => r.holes > 0);
}

/** Texas scramble: each team's one ball, net strokes to par, round by round; lowest wins. */
export function scrambleScore(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>): TeamRow[] {
  const rows: TeamRow[] = cfg.teams.map((t) => ({ teamId: t.id, value: 0, rounds: {}, holes: 0, pos: 0, tied: false }));
  for (const r of cfg.rounds) {
    const entries = entriesByRound[r.id] ?? [];
    for (const g of r.games) {
      const shots = gameShots(r, g, cfg.players);
      for (const side of g.sides) {
        const team = side.teamId ?? cfg.players.find((p) => p.id === side.playerIds[0])?.teamId;
        const row = rows.find((x) => x.teamId === team);
        if (!row) continue;
        for (const e of entries) {
          if (e.game !== g.id || !r.holes.some((h) => h.number === e.hole)) continue;
          const ball = ONE_BALL.includes(r.play) ? side.id : side.playerIds[0];
          const bh = ballHole(r, ball, shots[ball] ?? 0, e.hole);
          const b = e.scores[ball];
          if (!bh || !b || b.gross == null || b.pickedUp) continue;
          const v = b.gross - bh.shots - bh.par;
          row.rounds[r.id] = (row.rounds[r.id] ?? 0) + v;
          row.value += v;
          row.holes++;
        }
      }
    }
  }
  return placeRows(rows, (r) => -r.value, (r) => r.holes > 0);
}

/** Skins across the whole field. */
export interface SkinsRow {
  playerId: string;
  skins: number;
  rounds: Record<string, number>;
  pos: number;
  tied: boolean;
}

export interface SkinsTable {
  rows: SkinsRow[];
  /** Hole by hole, round by round: who won it (null: carried or not decided yet) and the skins it was worth */
  holes: Record<string, { hole: number; winner: string | null; worth: number; decided: boolean }[]>;
  /** Skins carried over and still to be won, by round */
  carrying: Record<string, number>;
}

/**
 * Skins over the whole field, round by round. A hole is decided once everyone in the round has finished it: the
 * lowest net score wins it outright; a tie carries the skin to the next hole (if `carry`) or nobody wins it.
 * Skins still carried after a round's last hole aren't won.
 */
export function skinsTable(cfg: TournamentCfg, ph: ReturnType<typeof playerHoles>, carry: boolean, rounds: RoundCfg[] = cfg.rounds): SkinsTable {
  const rows: SkinsRow[] = cfg.players.map((p) => ({ playerId: p.id, skins: 0, rounds: {}, pos: 0, tied: false }));
  const holes: SkinsTable["holes"] = {};
  const carrying: Record<string, number> = {};
  for (const r of rounds) {
    const field = [...new Set(r.games.filter((g) => !g.free).flatMap((g) => g.sides.flatMap((s) => s.playerIds)))];
    let pot = 0;
    let carried: number | null = null;
    holes[r.id] = [];
    for (const h of [...r.holes].sort((a, b) => a.number - b.number)) {
      pot += 1;
      const res = field.map((pid) => ph[r.id]?.[pid]?.[h.number]);
      // In hole order: a hole still being played holds up the ones after it (a carried skin needs its result)
      const decided = carried == null && field.length > 0 && res.every((x) => x?.done);
      if (!decided) {
        if (carried == null) carried = pot - 1; // carried into the first hole still being played
        holes[r.id].push({ hole: h.number, winner: null, worth: pot, decided: false });
        continue;
      }
      const nets = field.map((pid, i) => ({ pid, net: res[i]!.net })).filter((x): x is { pid: string; net: number } => x.net != null);
      const best = nets.length ? Math.min(...nets.map((x) => x.net)) : null;
      const at = best == null ? [] : nets.filter((x) => x.net === best);
      if (at.length === 1) {
        const row = rows.find((x) => x.playerId === at[0].pid)!;
        row.skins += pot;
        row.rounds[r.id] = (row.rounds[r.id] ?? 0) + pot;
        holes[r.id].push({ hole: h.number, winner: at[0].pid, worth: pot, decided: true });
        pot = 0;
      } else {
        holes[r.id].push({ hole: h.number, winner: null, worth: pot, decided: true });
        if (!carry) pot = 0;
      }
    }
    carrying[r.id] = carried ?? 0;
  }
  placeRows(rows, (r) => r.skins, (r) => r.skins > 0 || Object.keys(r.rounds).length > 0);
  return { rows, holes, carrying };
}

// ---------------------------------------------------------------- knockout

export interface KoMatch {
  /** 0 = the first stage */
  stage: number;
  index: number;
  /** Entrant ids (null: not known yet, or a bye in the first stage) */
  a: string | null;
  b: string | null;
  winner: string | null;
  /** How it was settled */
  how: "holes" | "backnine" | "extra" | "bye" | null;
  /** The match's game id in its round */
  gameId: string;
  /** "Neil won 3&2", "All square thru 12", "Bye" */
  label: string;
}

export interface KnockoutState {
  stages: KoMatch[][];
  champion: string | null;
  /** Players knocked out, by stage they went out in */
  out: Record<string, number>;
}

export const koGameId = (stage: number, index: number) => `ko${stage + 1}-${index + 1}`;

/** Stage names counted back from the final. */
export function stageName(stage: number, stages: number): string {
  const left = stages - stage;
  return left === 1 ? "Final" : left === 2 ? "Semi-finals" : left === 3 ? "Quarter-finals" : `Round of ${2 ** left}`;
}

/** The bracket size for this many entrants (byes fill the rest). */
export const bracketSize = (n: number) => 2 ** Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

/** Standard seeding order for a bracket: 1 v 8, 4 v 5, 2 v 7, 3 v 6 (so the top seeds meet last). */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * The first stage. Seeded: entrants in seed order (lowest handicap first) placed so the top seeds meet last, the
 * byes going to the top seeds. Random: shuffled, byes spread out. Picked: the entrants as given, in pairs.
 */
export function drawBracket(entrants: Entrant[], draw: Knockout["draw"], players: Player[], rnd: () => number = Math.random): (string | null)[] {
  const size = bracketSize(entrants.length);
  if (draw === "pick") return Array.from({ length: size }, (_, i) => entrants[i]?.id ?? null);
  const hcp = (e: Entrant) => e.playerIds.reduce((a, p) => a + (players.find((x) => x.id === p)?.handicap ?? 54), 0);
  const order =
    draw === "seeded"
      ? [...entrants].sort((a, b) => hcp(a) - hcp(b))
      : (() => {
          const xs = [...entrants];
          for (let i = xs.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [xs[i], xs[j]] = [xs[j], xs[i]];
          }
          return xs;
        })();
  return seedOrder(size).map((seed) => order[seed - 1]?.id ?? null);
}

/** A tied match settled on the card: holes won on the back nine, then the last 6, 3 and 1 holes, then the last hole won. */
function backNine(round: RoundCfg, game: Game, shots: Record<string, number>, entries: HoleEntry[]): string | null {
  const card = round.holes.map((h) => h.number).sort((a, b) => a - b);
  const won = card.map((n) => gameHole(round, game, shots, entries.find((e) => e.hole === n && e.game === game.id)).winner);
  const [a, b] = game.sides;
  const spans = [...(card.length > 9 ? [9] : []), 6, 3, 1];
  for (const k of spans) {
    const part = won.slice(-k);
    const d = part.filter((w) => w === a.id).length - part.filter((w) => w === b.id).length;
    if (d) return d > 0 ? a.id : b.id;
  }
  for (let i = won.length - 1; i >= 0; i--) if (won[i] === a.id || won[i] === b.id) return won[i];
  return null;
}

/** A tied match settled on extra holes: the first one won outright. */
function extraHoles(round: RoundCfg, game: Game, shots: Record<string, number>, entries: HoleEntry[]): string | null {
  const last = Math.max(...round.holes.map((h) => h.number));
  const extra = entries.filter((e) => e.game === game.id && e.hole > last).sort((x, y) => x.hole - y.hole);
  for (const e of extra) {
    const w = gameHole(round, game, shots, e).winner;
    if (w && w !== "halved") return w;
  }
  return null;
}

/** The knockout as it stands: every stage's matches and who has gone through. Stage s is played in round s. */
export function knockoutState(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>, ko: Knockout): KnockoutState {
  const rounds = [...cfg.rounds].sort((a, b) => a.number - b.number);
  const size = ko.slots.length;
  const nStages = Math.max(1, Math.log2(size));
  const stages: KoMatch[][] = [];
  const out: Record<string, number> = {};
  const name = (id: string | null) => {
    const e = ko.entrants.find((x) => x.id === id);
    return e ? e.playerIds.map((p) => cfg.players.find((x) => x.id === p)?.name ?? p).join(" & ") : "";
  };
  let field: (string | null)[] = ko.slots;
  for (let s = 0; s < nStages; s++) {
    const matches: KoMatch[] = [];
    for (let k = 0; k < field.length / 2; k++) {
      const a = field[2 * k] ?? null;
      const b = field[2 * k + 1] ?? null;
      const m: KoMatch = { stage: s, index: k, a, b, winner: null, how: null, gameId: koGameId(s, k), label: "" };
      const r = rounds[s];
      if (s === 0 && (!a || !b) && (a || b)) {
        m.winner = a ?? b;
        m.how = "bye";
        m.label = "Bye";
      } else if (a && b && r) {
        const game = r.games.find((g) => g.id === m.gameId);
        if (game) {
          const entries = entriesByRound[r.id] ?? [];
          const gs = gameSummary(r, game, cfg.players, entries);
          m.label = gs.full.matchLabel ?? "";
          const sideEntrant = (sideId: string) => {
            const side = game.sides.find((x) => x.id === sideId);
            return [a, b].find((id) => ko.entrants.find((e) => e.id === id)?.playerIds.every((p) => side?.playerIds.includes(p))) ?? null;
          };
          if (gs.full.complete && gs.full.leaders.length === 1) {
            m.winner = sideEntrant(gs.full.leaders[0]);
            m.how = "holes";
          } else if (gs.full.complete) {
            const w = ko.tie === "extra" ? extraHoles(r, game, gs.shots, entries) : backNine(r, game, gs.shots, entries);
            if (w) {
              m.winner = sideEntrant(w);
              m.how = ko.tie === "extra" ? "extra" : "backnine";
              m.label = `${name(m.winner)} won ${ko.tie === "extra" ? "on extra holes" : "on the back nine"}`;
            } else m.label = ko.tie === "extra" ? "All square: extra holes" : "All square";
          }
        } else m.label = `${name(a)} v ${name(b)}`;
      }
      if (m.winner) {
        const loser = m.winner === a ? b : a;
        if (loser) for (const p of ko.entrants.find((e) => e.id === loser)?.playerIds ?? []) out[p] = s;
      }
      matches.push(m);
    }
    stages.push(matches);
    field = matches.map((m) => m.winner);
  }
  const final = stages.at(-1)?.[0];
  return { stages, champion: final?.winner ?? null, out };
}

/**
 * The games for each knockout round, from the results so far: a match for every pairing that's known, and the
 * players already out in groups of up to four, playing for the prizes. roundId → games.
 */
export function knockoutGames(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>, ko: Knockout): Record<string, Game[]> {
  const rounds = [...cfg.rounds].sort((a, b) => a.number - b.number);
  const out: Record<string, Game[]> = {};
  // Built a stage at a time: each stage's games decide who meets in the next
  let work: TournamentCfg = { ...cfg, rounds };
  const state0 = knockoutState(work, entriesByRound, ko);
  for (let s = 0; s < state0.stages.length && s < rounds.length; s++) {
    const st = knockoutState(work, entriesByRound, ko);
    const playing = new Set<string>();
    const games: Game[] = [];
    for (const m of st.stages[s]) {
      if (!m.a || !m.b) continue;
      const ea = ko.entrants.find((e) => e.id === m.a)!;
      const eb = ko.entrants.find((e) => e.id === m.b)!;
      const side = (e: Entrant) => ({ id: ko.pairs ? `${m.gameId}-${e.id === m.a ? "a" : "b"}` : e.playerIds[0], playerIds: e.playerIds });
      games.push({ id: m.gameId, name: stageName(s, st.stages.length), sides: [side(ea), side(eb)], scorerId: ea.playerIds[0] });
      for (const p of [...ea.playerIds, ...eb.playerIds]) playing.add(p);
    }
    const rest = cfg.players.filter((p) => !playing.has(p.id) && st.out[p.id] != null && st.out[p.id] < s).map((p) => p.id);
    for (let g = 0; g * 4 < rest.length; g++) {
      const ids = rest.slice(g * 4, g * 4 + 4);
      games.push({ id: `ko${s + 1}-free${g + 1}`, name: "Playing for the prizes", sides: ids.map((id) => ({ id, playerIds: [id] })), scorerId: ids[0], free: true });
    }
    out[rounds[s].id] = games;
    work = { ...work, rounds: work.rounds.map((r, i) => (i === s ? { ...r, games } : r)) };
  }
  return out;
}

// ---------------------------------------------------------------- prizes

/**
 * The holes in a round where closest the pin or long drive is recorded on the card: the prize's chosen holes (every
 * par 3 / par 5 unless chosen), or every one when a points race gives bonus points for them. Older tournaments
 * (no way to win set) record them on every par 3 and par 5.
 */
export function sideGameHoles(cfg: Pick<TournamentCfg, "win" | "prizes">, round: Pick<RoundCfg, "number" | "holes">, kind: "ctp" | "ld"): number[] {
  const par = kind === "ctp" ? 3 : 5;
  const every = round.holes.filter((h) => h.par === par).map((h) => h.number);
  if (!cfg.win) return every;
  const bonus = cfg.win.kind === "points" && (cfg.win.bonus?.[kind] ?? 0) > 0;
  const p = (cfg.prizes ?? []).find((x) => x.kind === kind);
  if (!bonus && !p) return [];
  // One choice of holes for the points and the prize: a round listed = those holes ([] = not that round)
  const byRound = (cfg.win.kind === "points" ? cfg.win.bonusHoles?.[kind] : undefined) ?? p?.holesByRound ?? null;
  const chosen = byRound && String(round.number) in byRound ? byRound[String(round.number)] : (p?.holes?.length ? p.holes : null);
  return chosen ? every.filter((n) => chosen.includes(n)) : every;
}

/** Closest the pin / long drive won by each player, counted from the cards on the side game's holes only */
export function holeWinCounts(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>, kind: "ctp" | "ld", rs: RoundCfg[] = cfg.rounds): Record<string, number> {
  const value = Object.fromEntries(cfg.players.map((p) => [p.id, 0]));
  for (const r of rs) {
    const holes = sideGameHoles(cfg, r, kind);
    for (const g of r.games)
      for (const e of entriesByRound[r.id] ?? []) {
        if (e.game !== g.id || !holes.includes(e.hole)) continue;
        const w = kind === "ctp" ? e.ctpWinner : e.ldWinner;
        if (w) for (const pid of playersOfBall(w, g)) value[pid] = (value[pid] ?? 0) + 1;
      }
  }
  return value;
}

export interface PrizeResult {
  kind: PrizeKind;
  /** The round it's for (null: the whole trip) */
  roundId: string | null;
  /** Front 9 and back 9 */
  nine?: "front" | "back";
  /** Count or score per player (lower is better for stroke-play nines and rounds) */
  value: Record<string, number>;
  lowerBetter: boolean;
  leaders: string[];
  /** Final: its round, or the whole trip, is over */
  decided: boolean;
  /** Points race: points to the winner(s), shared */
  points: Record<string, number>;
}

function leadersOf(value: Record<string, number>, lowerBetter: boolean, eligible: string[]): string[] {
  const ids = eligible.filter((id) => id in value);
  if (!ids.length) return [];
  const best = lowerBetter ? Math.min(...ids.map((i) => value[i])) : Math.max(...ids.map((i) => value[i]));
  if (!lowerBetter && best <= 0) return [];
  return ids.filter((i) => value[i] === best);
}

export function prizeResults(
  cfg: TournamentCfg,
  entriesByRound: Record<string, HoleEntry[]>,
  ph: ReturnType<typeof playerHoles>,
  rounds: RoundSummary[],
  complete: boolean,
): PrizeResult[] {
  const out: PrizeResult[] = [];
  const pids = cfg.players.map((p) => p.id);
  const stroke = winRuleOf(cfg).kind === "stroke";
  const roundDone = (i: number) => rounds[i]?.complete || !!cfg.rounds[i]?.closed;
  const award = (p: Prize, r: Omit<PrizeResult, "points">): PrizeResult => {
    const points = Object.fromEntries(pids.map((id) => [id, 0]));
    if (p.points && r.decided && r.leaders.length) for (const id of r.leaders) points[id] = p.points / r.leaders.length;
    return { ...r, points };
  };
  const holeWins = (kind: "ctp" | "ld", rs: RoundCfg[]) => holeWinCounts(cfg, entriesByRound, kind, rs);
  for (const p of cfg.prizes ?? []) {
    const scopes: { rs: RoundCfg[]; idx: number[]; roundId: string | null }[] =
      p.per === "round" || p.kind === "nines" ? cfg.rounds.map((r, i) => ({ rs: [r], idx: [i], roundId: r.id })) : [{ rs: cfg.rounds, idx: cfg.rounds.map((_, i) => i), roundId: null }];
    for (const sc of scopes) {
      const decided = sc.roundId ? sc.idx.every(roundDone) : complete;
      if (p.kind === "ctp" || p.kind === "ld") {
        // Not played in this round (no holes chosen, or none of that par): no prize for it
        if (sc.roundId && !sideGameHoles(cfg, sc.rs[0], p.kind).length) continue;
        const value = holeWins(p.kind, sc.rs);
        out.push(award(p, { kind: p.kind, roundId: sc.roundId, value, lowerBetter: false, leaders: leadersOf(value, false, pids), decided }));
      } else if (p.kind === "birdies" || p.kind === "gir") {
        const k: "birdies" | "gir" = p.kind;
        const value = Object.fromEntries(pids.map((id) => [id, sc.idx.reduce((a, i) => a + (rounds[i]?.tallies[k][id] ?? 0), 0)]));
        out.push(award(p, { kind: p.kind, roundId: sc.roundId, value, lowerBetter: false, leaders: leadersOf(value, false, pids), decided }));
      } else if (p.kind === "skins") {
        const t = skinsTable(cfg, ph, true, sc.rs);
        const value = Object.fromEntries(t.rows.map((r) => [r.playerId, r.skins]));
        out.push(award(p, { kind: "skins", roundId: sc.roundId, value, lowerBetter: false, leaders: leadersOf(value, false, pids), decided }));
      } else if (p.kind === "nines") {
        const r = sc.rs[0];
        if (r.holes.length < 18) continue;
        for (const nine of ["front", "back"] as const) {
          const ns = segmentHoles(r, nine);
          const value: Record<string, number> = {};
          for (const pid of pids) {
            const hs = ns.map((n) => ph[r.id]?.[pid]?.[n]);
            if (!hs.every((h) => h?.done)) continue; // only a finished nine counts
            value[pid] = hs.reduce((a, h) => a + (stroke ? strokeValue(h!) : h!.pts), 0);
          }
          const done = Object.keys(value).length;
          out.push(award(p, { kind: "nines", roundId: r.id, nine, value, lowerBetter: stroke, leaders: done ? leadersOf(value, stroke, pids) : [], decided }));
        }
      } else if (p.kind === "bestround") {
        const value: Record<string, number> = {};
        for (const r of sc.rs)
          for (const pid of pids) {
            const hs = r.holes.map((h) => ph[r.id]?.[pid]?.[h.number]);
            if (!hs.every((h) => h?.done)) continue; // only a finished round counts
            const v = hs.reduce((a, h) => a + (stroke ? strokeValue(h!) : h!.pts), 0);
            if (!(pid in value) || (stroke ? v < value[pid] : v > value[pid])) value[pid] = v;
          }
        out.push(award(p, { kind: "bestround", roundId: sc.roundId, value, lowerBetter: stroke, leaders: Object.keys(value).length ? leadersOf(value, stroke, pids) : [], decided }));
      }
    }
  }
  return out;
}

/** Bonus points with no ceiling (each birdie, eagle, green in regulation): nobody knows in advance how many there'll be */
const OPEN_BONUS: BonusKind[] = ["birdies", "eagles", "gir"];
export function openBonus(cfg: Pick<TournamentCfg, "win" | "standings" | "teams">): BonusKind[] {
  const w = winRuleOf(cfg);
  return w.kind === "points" ? OPEN_BONUS.filter((k) => (w.bonus?.[k] ?? 0) > 0) : [];
}
export const bonusOn = (cfg: Pick<TournamentCfg, "win" | "standings" | "teams">) => openBonus(cfg).length > 0;
/** "birdies and eagles": the open-ended bonuses, in words */
export function openBonusWords(cfg: Pick<TournamentCfg, "win" | "standings" | "teams">): string {
  const w = openBonus(cfg).map((k) => ({ birdies: "birdies", eagles: "eagles", gir: "greens in regulation" })[k as "birdies" | "eagles" | "gir"]);
  return w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

/**
 * Closest the pin and long drive bonuses are a known number of points: one winner on each of those holes, in each
 * group. All of them, and those still to be decided.
 */
function holeBonus(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>): { all: number; left: number; leftBy: { ctp: number; ld: number } } {
  const w = winRuleOf(cfg);
  let all = 0;
  let left = 0;
  const leftBy = { ctp: 0, ld: 0 };
  if (w.kind !== "points") return { all, left, leftBy };
  for (const kind of ["ctp", "ld"] as const) {
    const v = w.bonus?.[kind] ?? 0;
    if (!(v > 0)) continue;
    for (const r of cfg.rounds) {
      const holes = sideGameHoles(cfg, r, kind);
      for (const g of r.games) {
        if (g.free) continue;
        for (const n of holes) {
          all += v;
          if (r.closed) continue;
          const e = (entriesByRound[r.id] ?? []).find((x) => x.game === g.id && x.hole === n);
          const decided = !!e && ((kind === "ctp" ? e.ctpWinner : e.ldWinner) || ballsOfGame(g, r.play).every((b) => e.scores[b]?.gross != null || e.scores[b]?.pickedUp));
          if (!decided) {
            left += v;
            leftBy[kind] += v;
          }
        }
      }
    }
  }
  return { all, left, leftBy };
}

export function tournamentSummary(cfg: TournamentCfg, entriesByRound: Record<string, HoleEntry[]>): TournamentSummary {
  const pids = cfg.players.map((p) => p.id);
  const tids = cfg.teams.map((t) => t.id);
  const rounds = cfg.rounds.map((r) => roundSummary(r, cfg.players, cfg.teams, entriesByRound[r.id] ?? []));
  const complete = rounds.length > 0 && rounds.every((r, i) => r.complete || cfg.rounds[i].closed);

  const tallies: Tallies = { birdies: zero(pids), eagles: zero(pids), gir: zero(pids), ctp: zero(pids), ld: zero(pids) };
  const playerRoundPoints = zero(pids);
  const teamRoundPoints = zero(tids);
  for (const rs of rounds) {
    for (const p of pids) {
      playerRoundPoints[p] += rs.playerPoints[p] ?? 0;
      for (const k of Object.keys(tallies) as (keyof Tallies)[]) tallies[k][p] += rs.tallies[k][p] ?? 0;
    }
    for (const t of tids) teamRoundPoints[t] += rs.teamPoints[t] ?? 0;
  }

  const byTeam = cfg.sideGamesBy === "team" && tids.length > 0;
  const keys = byTeam ? tids : pids;
  const awards: Award[] = cfg.sideGames
    .filter((g) => g.enabled)
    .map((g) => {
      const counts = zero(keys);
      for (const p of pids) {
        const k = byTeam ? cfg.players.find((x) => x.id === p)?.teamId : p;
        if (k && k in counts) counts[k] += tallies[g.kind][p];
      }
      const best = Math.max(0, ...keys.map((k) => counts[k]));
      const leaders = best > 0 ? keys.filter((k) => counts[k] === best) : [];
      const projected = zero(keys);
      if (g.points > 0) {
        if (leaders.length) for (const k of leaders) projected[k] = g.points / leaders.length;
        else if (complete) for (const k of keys) projected[k] = g.points / keys.length;
      }
      return { kind: g.kind, counts, leaders, projected, points: complete ? projected : zero(keys) };
    });

  const add = (base: Record<string, number>, which: "points" | "projected", forTeam: boolean) => {
    const out = { ...base };
    if (forTeam !== byTeam) return out;
    for (const a of awards) for (const k of Object.keys(out)) out[k] += a[which][k] ?? 0;
    return out;
  };

  // Points race bonus: so many points for every birdie, eagle, green in regulation, closest the pin and long drive
  const win = winRuleOf(cfg);
  const bonus = zero(pids);
  const bonusBy: Record<string, Partial<Record<BonusKind, number>>> = Object.fromEntries(pids.map((p) => [p, {}]));
  // Closest the pin and long drive count only on the holes chosen for them
  const holeCounts: Partial<Record<"ctp" | "ld", Record<string, number>>> = {};
  if (win.kind === "points") for (const k of ["ctp", "ld"] as const) if ((win.bonus?.[k] ?? 0) > 0) holeCounts[k] = holeWinCounts(cfg, entriesByRound, k);
  if (win.kind === "points" && win.bonus)
    for (const p of pids)
      for (const [k, v] of Object.entries(win.bonus) as [BonusKind, number][]) {
        const n = k === "ctp" || k === "ld" ? (holeCounts[k]?.[p] ?? 0) : (tallies[k]?.[p] ?? 0);
        const got = n * (v || 0);
        bonus[p] += got;
        if (got) bonusBy[p][k] = got;
      }
  const ph = win.kind === "teamscore" || win.kind === "skins" || (cfg.prizes ?? []).length ? playerHoles(cfg, entriesByRound) : null;
  const prizes = ph ? prizeResults(cfg, entriesByRound, ph, rounds, complete) : [];
  const prizePts = zero(pids);
  for (const pr of prizes) for (const p of pids) prizePts[p] += pr.points[p] ?? 0;
  const withBonus = (base: Record<string, number>) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + (bonus[k] ?? 0) + (prizePts[k] ?? 0)]));

  const sideGamePts = cfg.sideGames.filter((g) => g.enabled).reduce((a, g) => a + g.points, 0);
  // Prizes that count as points: each one's points, once per time it's awarded (each round, each nine, or the trip)
  const prizePtsOn = prizes.reduce((a, pr) => a + (cfg.prizes ?? []).filter((p) => p.kind === pr.kind && (p.points ?? 0) > 0).reduce((x, p) => x + (p.points ?? 0), 0), 0);
  const prizePtsLeft = prizes.filter((pr) => !pr.decided).reduce((a, pr) => a + (cfg.prizes ?? []).filter((p) => p.kind === pr.kind && (p.points ?? 0) > 0).reduce((x, p) => x + (p.points ?? 0), 0), 0);
  const holeBonusPts = holeBonus(cfg, entriesByRound);
  const pointsAvailable = cfg.rounds.reduce((t, r) => t + roundPointsAvailable(r), 0) + sideGamePts + prizePtsOn + holeBonusPts.all;

  let pointsRemaining = 0;
  cfg.rounds.forEach((r, i) => {
    const rs = rounds[i];
    if (r.closed) return;
    r.games.forEach((g, gi) => {
      const gs = rs.games[gi];
      if (g.free) return;
      if (r.scoring === "skins") {
        if (gs.holesPlayed < r.holes.length) pointsRemaining += (r.holes.length - gs.holesPlayed + (gs.full.carry ?? 0)) * (r.points.skin ?? 1);
        return;
      }
      if (!gs.front.complete) pointsRemaining += r.points.front;
      if (!gs.back.complete) pointsRemaining += r.points.back;
      if (acrossField(r)) return; // the places are added once for the round, below
      if (!gs.full.complete)
        pointsRemaining +=
          g.sides.length > 2 && r.points.positions?.length
            ? r.points.positions.reduce((a, b) => a + b, 0)
            : r.points.full;
    });
    if (acrossField(r) && !rs.games.every((g, gi) => g.full.complete || r.games[gi]?.free)) pointsRemaining += (r.points.positions ?? []).reduce((a, b) => a + b, 0);
  });
  if (!complete) pointsRemaining += sideGamePts;
  const roundsLeft = pointsRemaining - (complete ? 0 : sideGamePts);
  pointsRemaining += prizePtsLeft + holeBonusPts.left;

  return {
    rounds,
    awards,
    tallies,
    playerRoundPoints,
    teamRoundPoints,
    playerTotal: withBonus(add(playerRoundPoints, "points", false)),
    teamTotal: add(teamRoundPoints, "points", true),
    playerProjected: withBonus(add(playerRoundPoints, "projected", false)),
    teamProjected: add(teamRoundPoints, "projected", true),
    pointsAvailable,
    pointsRemaining,
    complete,
    totals: totalsFor(cfg, entriesByRound, complete),
    win,
    teamRows: win.kind === "teamscore" && ph ? teamScore(cfg, ph, win.count) : win.kind === "scramble" ? scrambleScore(cfg, entriesByRound) : null,
    skins: win.kind === "skins" && ph ? skinsTable(cfg, ph, win.carry) : null,
    knockout: win.kind === "knockout" ? knockoutState(cfg, entriesByRound, win.knockout) : null,
    prizes,
    bonus,
    bonusBy,
    prizePoints: prizePts,
    left: { rounds: roundsLeft, prizes: prizePtsLeft, holes: holeBonusPts.left, ctp: holeBonusPts.leftBy.ctp, ld: holeBonusPts.leftBy.ld },
  };
}
