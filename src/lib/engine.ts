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
}

export type HandicapRule =
  | { mode: "manual"; shots: Record<string, number> } // shots per ball id
  | { mode: "allowance"; pct: number; relative: boolean }; // from player handicaps

export interface PointsRule {
  front: number; // head-to-head: segment pots
  back: number;
  full: number;
  /** Field games: points for 1st, 2nd... on the full 18 (ties share). */
  positions?: number[];
  /** Skins: points per skin. */
  skin?: number;
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
}

export interface BallHole {
  gross: number | null;
  pickedUp?: boolean;
  gir?: boolean;
}

export interface HoleEntry {
  game: string; // game id
  hole: number;
  scores: Record<string, BallHole>; // ball id -> score
  ctpWinner?: string | null; // ball id
  ldWinner?: string | null; // ball id
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

/** Shots received per ball in a game. */
export function gameShots(round: RoundCfg, game: Game, players: Player[]): Record<string, number> {
  const balls = ballsOfGame(game, round.play);
  const out: Record<string, number> = {};
  if (round.handicap.mode === "manual") {
    for (const b of balls) out[b] = Math.max(0, Math.round(round.handicap.shots[b] ?? 0));
    return out;
  }
  const { pct, relative } = round.handicap;
  const hcp = (pid: string) => players.find((p) => p.id === pid)?.handicap ?? 0;
  for (const side of game.sides) {
    if (ONE_BALL.includes(round.play)) {
      out[side.id] = oneBallHandicap(round.play, side.playerIds.map(hcp), pct);
    } else {
      for (const pid of side.playerIds) out[pid] = (hcp(pid) * pct) / 100;
    }
  }
  for (const b of balls) out[b] = Math.round(out[b] ?? 0);
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
  const h = round.holes.find((x) => x.number === entry?.hole);
  const res: GameHole = { hole: entry?.hole ?? -1, complete: false, sides: {}, winner: null };
  if (!h || !entry) return res;
  for (const side of game.sides) {
    const balls = ballsOfSide(side, round.play);
    const complete = balls.every((b) => ballDone(entry.scores[b], round.scoring, round.play));
    const nets = balls
      .map((b) => ballNet(entry.scores[b], shotsOnHole(shots[b] ?? 0, h.si)))
      .filter((n): n is number => n != null);
    const pts = Math.max(0, ...balls.map((b) => ballPts(entry.scores[b], h.par, shotsOnHole(shots[b] ?? 0, h.si))));
    res.sides[side.id] = { complete, net: nets.length ? Math.min(...nets) : null, pts };
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

export const SEGMENT_HOLES: Record<Segment, number[]> = {
  front: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  back: [10, 11, 12, 13, 14, 15, 16, 17, 18],
  full: Array.from({ length: 18 }, (_, i) => i + 1),
};

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
function positionPoints(ranking: SegmentResult["ranking"], table: number[]) {
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
  const holes = SEGMENT_HOLES[segment];
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

  const complete = played === holes.length;
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

export function roundSummary(round: RoundCfg, players: Player[], teams: Team[], entries: HoleEntry[]): RoundSummary {
  const pids = players.map((p) => p.id);
  const games = round.games.map((g) => gameSummary(round, g, players, entries));
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
      const h = round.holes.find((x) => x.number === e.hole);
      if (!h) continue;
      const credit = (ball: string, key: keyof Tallies) => {
        for (const pid of playersOfBall(ball, g)) tallies[key][pid] = (tallies[key][pid] ?? 0) + 1;
      };
      for (const ball of ballsOfGame(g, round.play)) {
        const b = e.scores[ball];
        if (!b) continue;
        if (b.gir) credit(ball, "gir"); // a green hit still counts if the player later picks up
        if (b.gross == null || b.pickedUp) continue;
        const d = b.gross - h.par;
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
}

/** Points on offer in a round (used for "points remaining"). */
export function roundPointsAvailable(r: RoundCfg): number {
  if (r.scoring === "skins") return 18 * (r.points.skin ?? 1) * r.games.length;
  return r.games.reduce((t, g) => {
    if (g.sides.length === 2 || !r.points.positions?.length) return t + r.points.front + r.points.back + r.points.full;
    return t + r.points.front + r.points.back + r.points.positions.reduce((a, b) => a + b, 0);
  }, 0);
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

  const sideGamePts = cfg.sideGames.filter((g) => g.enabled).reduce((a, g) => a + g.points, 0);
  const pointsAvailable = cfg.rounds.reduce((t, r) => t + roundPointsAvailable(r), 0) + sideGamePts;

  let pointsRemaining = 0;
  cfg.rounds.forEach((r, i) => {
    const rs = rounds[i];
    if (r.closed) return;
    r.games.forEach((g, gi) => {
      const gs = rs.games[gi];
      if (r.scoring === "skins") {
        if (gs.holesPlayed < 18) pointsRemaining += (18 - gs.holesPlayed + (gs.full.carry ?? 0)) * (r.points.skin ?? 1);
        return;
      }
      if (!gs.front.complete) pointsRemaining += r.points.front;
      if (!gs.back.complete) pointsRemaining += r.points.back;
      if (!gs.full.complete)
        pointsRemaining +=
          g.sides.length > 2 && r.points.positions?.length
            ? r.points.positions.reduce((a, b) => a + b, 0)
            : r.points.full;
    });
  });
  if (!complete) pointsRemaining += sideGamePts;

  return {
    rounds,
    awards,
    tallies,
    playerRoundPoints,
    teamRoundPoints,
    playerTotal: add(playerRoundPoints, "points", false),
    teamTotal: add(teamRoundPoints, "points", true),
    playerProjected: add(playerRoundPoints, "projected", false),
    teamProjected: add(teamRoundPoints, "projected", true),
    pointsAvailable,
    pointsRemaining,
    complete,
  };
}
