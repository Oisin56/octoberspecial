import { describe, it, expect } from "vitest";
import { courseHandicap, gameShots, roundPointsAvailable, roundSummary, tournamentSummary, type Game, type HoleEntry, type RoundCfg, type TournamentCfg } from "./engine";

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SIS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const card = PARS.map((par, i) => ({ number: i + 1, par, si: SIS[i] }));

const players = [
  { id: "a", name: "Oisin", handicap: 10 },
  { id: "b", name: "Neil", handicap: 4 },
  { id: "c", name: "Ger", handicap: 18 },
  { id: "d", name: "Dave", handicap: 0 },
];
const solo = (id: string) => ({ id, playerIds: [id] });
// Two groups of two, one leaderboard
const g1: Game = { id: "g1", sides: [solo("a"), solo("b")] };
const g2: Game = { id: "g2", sides: [solo("c"), solo("d")] };

function round(over: Partial<RoundCfg> = {}): RoundCfg {
  return {
    id: "r1",
    number: 1,
    name: "Test",
    holes: card,
    play: "singles",
    scoring: "stableford",
    games: [g1, g2],
    points: { front: 0, back: 0, full: 0, positions: [3, 2, 1], across: true },
    handicap: { mode: "allowance", pct: 100, relative: false },
    ...over,
  };
}

/** Everyone scores the same gross on every hole, given per player. */
const allHoles = (r: RoundCfg, gross: Record<string, number | ((h: number) => number)>, upTo = 18): HoleEntry[] =>
  r.games.flatMap((g) =>
    r.holes
      .filter((h) => h.number <= upTo)
      .map((h) => ({
        game: g.id,
        hole: h.number,
        scores: Object.fromEntries(
          g.sides.map((s) => {
            const v = gross[s.id];
            return [s.id, { gross: typeof v === "function" ? v(h.number) : (v ?? h.par) }];
          }),
        ),
      })),
  );
const parPlus = (n: number) => (hole: number) => PARS[hole - 1] + n;

describe("World Handicap System", () => {
  it("turns an index into a course handicap for the tee", () => {
    // 10.0 off a 130-slope, 72.5-rated par 72: 10 × 130 ÷ 113 + 0.5 = 12.0
    expect(courseHandicap(10, { slope: 130, rating: 72.5, par: 72 })).toBeCloseTo(12.0, 1);
    expect(courseHandicap(0, { slope: 113, rating: 70, par: 72 })).toBe(-2);
  });

  it("gives shots from the course handicap and the allowance", () => {
    const course = { slope: 130, rating: 72.5, par: 72 };
    const r = round({ handicap: { mode: "allowance", pct: 95, relative: false, course } });
    // Oisin 12.0 × 95% = 11.4 → 11; Ger 18 × 130/113 + 0.5 = 21.2 × 95% = 20.1 → 20
    expect(gameShots(r, g1, players).a).toBe(11);
    expect(gameShots(r, g2, players).c).toBe(20);
    // A scratch player on an easy course gives shots back but never goes below 0 shots here
    expect(gameShots(round({ handicap: { mode: "allowance", pct: 100, relative: false, course: { slope: 113, rating: 70, par: 72 } } }), g2, players).d).toBe(0);
  });

  it("leaves old rounds (no slope) exactly as they were", () => {
    expect(gameShots(round(), g1, players)).toEqual({ a: 10, b: 4 });
  });
});

describe("places over the whole field", () => {
  it("ranks every group together once all have finished", () => {
    const r = round();
    // Gross par everywhere: points = 36 + shots received → Ger 54, Oisin 46, Neil 40, Dave 36
    const rs = roundSummary(r, players, [], allHoles(r, {}));
    expect(rs.playerPoints).toEqual({ c: 3, a: 2, b: 1, d: 0 });
  });

  it("pays nothing until every group is in", () => {
    const r = round();
    const entries = [...allHoles({ ...r, games: [g1] }, {}), ...allHoles({ ...r, games: [g2] }, {}, 12)];
    const rs = roundSummary(r, players, [], entries);
    expect(Object.values(rs.playerPoints).every((p) => p === 0)).toBe(true);
  });

  it("offers the places once per round, not per group", () => {
    expect(roundPointsAvailable(round())).toBe(6);
    const t = tournamentSummary({ players, teams: [], rounds: [round()], sideGames: [], sideGamesBy: "player" }, { r1: [] });
    expect(t.pointsRemaining).toBe(6);
  });

  it("shares tied places", () => {
    const r = round();
    // Neil (4) and Dave (0): Dave one under on four holes → both 40
    const rs = roundSummary(r, players, [], allHoles(r, { d: (h) => (h <= 4 ? PARS[h - 1] - 1 : PARS[h - 1]) }));
    expect(rs.playerPoints.c).toBe(3);
    expect(rs.playerPoints.a).toBe(2);
    expect(rs.playerPoints.b).toBe(0.5);
    expect(rs.playerPoints.d).toBe(0.5);
  });
});

describe("running totals", () => {
  const two = (over: Partial<RoundCfg> = {}): RoundCfg[] => [round({ ...over }), round({ id: "r2", number: 2, ...over })];
  const cfg = (standings: TournamentCfg["standings"], rounds: RoundCfg[]): TournamentCfg => ({
    players,
    teams: [],
    rounds,
    sideGames: [],
    sideGamesBy: "player",
    standings,
  });

  it("adds Stableford points across rounds", () => {
    const rounds = two();
    const t = tournamentSummary(cfg("stableford", rounds), { r1: allHoles(rounds[0], {}), r2: allHoles(rounds[1], {}, 9) });
    const by = Object.fromEntries(t.totals!.rows.map((r) => [r.playerId, r]));
    // Oisin: 46 in round 1; front nine of round 2 with shots on SI 1–10 (odd SIs on the front: 1,3,5,7,9) = 18 + 5
    expect(by.a.value).toBe(46 + 23);
    expect(by.a.holes).toBe(27);
    expect(t.totals!.rows[0].playerId).toBe("c");
    expect(t.totals!.rows[0].pos).toBe(1);
  });

  it("adds stroke play net to par, gross alongside, partial rounds comparing fairly", () => {
    const rounds = two({ scoring: "stroke" });
    const t = tournamentSummary(cfg("stroke", rounds), {
      r1: allHoles(rounds[0], { a: parPlus(1), b: parPlus(0) }),
      r2: allHoles(rounds[1], { a: parPlus(0), b: parPlus(0) }, 9),
    });
    const by = Object.fromEntries(t.totals!.rows.map((r) => [r.playerId, r]));
    // Oisin: 90 gross (18 over) less 10 shots = +8; then 9 holes of par less 5 shots = −5 → +3
    expect(by.a.value).toBe(8 - 5);
    expect(by.a.gross).toBe(90 + 36);
    expect(by.a.grossToPar).toBe(18);
    // Neil: −4, then −2 = −6, leading
    expect(by.b.value).toBe(-6);
    expect(t.totals!.kind).toBe("stroke");
    expect(t.totals!.rows[0].playerId).toBe("c"); // Ger: −18 then −9
  });

  it("isn't there for points tournaments", () => {
    expect(tournamentSummary(cfg("points", two()), {}).totals).toBeNull();
    expect(tournamentSummary(cfg(undefined, two()), {}).totals).toBeNull();
  });

  it("shows tied places and leaves the unstarted unplaced", () => {
    const rounds = two();
    const t = tournamentSummary(cfg("stableford", rounds), { r1: allHoles({ ...rounds[0], games: [g1] }, { a: parPlus(0), b: (h) => PARS[h - 1] + (h <= 6 ? -1 : 0) }) });
    const by = Object.fromEntries(t.totals!.rows.map((r) => [r.playerId, r]));
    expect(by.a.pos).toBe(1);
    expect(by.b.pos).toBe(1);
    expect(by.a.tied).toBe(true);
    expect(by.c.pos).toBe(0);
  });
});
