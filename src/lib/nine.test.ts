import { describe, it, expect } from "vitest";
import { gameShots, gameSummary, holeShots, isNine, roundPointsAvailable, segmentHoles, strokeIndex, tournamentSummary, type HoleEntry, type RoundCfg } from "./engine";
import { normalizeRound, playedHoles, toRoundCfg, type RoundRow } from "./types";
import { validStrokeIndexes } from "./holes";
import { scoreTiles, scoreWord } from "./scoreEntry";

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SIS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const card18 = PARS.map((par, i) => ({ number: i + 1, par, si: SIS[i] }));

const players = [
  { id: "a", name: "Oisin", handicap: 10 },
  { id: "b", name: "Neil", handicap: 4 },
];
const game = { id: "main", sides: [{ id: "a", playerIds: ["a"] }, { id: "b", playerIds: ["b"] }] };

function round(holes: typeof card18, over: Partial<RoundCfg> = {}): RoundCfg {
  return {
    id: "r1",
    number: 1,
    name: "Test",
    holes,
    play: "singles",
    scoring: "match",
    games: [game],
    points: { front: 10, back: 10, full: 20 },
    handicap: { mode: "allowance", pct: 100, relative: true },
    ...over,
  };
}

const allPars = (r: RoundCfg, a: (h: number) => number, b: (h: number) => number): HoleEntry[] =>
  r.holes.map((h) => ({ game: "main", hole: h.number, scores: { a: { gross: a(h.number) }, b: { gross: b(h.number) } } }));

describe("nine-hole rounds", () => {
  it("knows a nine from an eighteen", () => {
    expect(isNine(round(card18))).toBe(false);
    expect(isNine(round(card18.slice(0, 9)))).toBe(true);
  });

  it("has no front or back nine of its own, just the one result", () => {
    const r = round(card18.slice(9));
    expect(segmentHoles(r, "front")).toEqual([]);
    expect(segmentHoles(r, "back")).toEqual([]);
    expect(segmentHoles(r, "full")).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(segmentHoles(round(card18), "back")).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("only offers the round's own points (no front or back nine pots)", () => {
    expect(roundPointsAvailable(round(card18))).toBe(40);
    expect(roundPointsAvailable(round(card18.slice(0, 9)))).toBe(20);
    expect(roundPointsAvailable(round(card18.slice(0, 9), { scoring: "skins", points: { front: 0, back: 0, full: 0, skin: 1 } }))).toBe(9);
  });

  it("halves the handicap allowance", () => {
    // 10 v 4, off the lowest: 6 shots over 18, 3 over nine
    expect(gameShots(round(card18), game, players)).toEqual({ a: 6, b: 0 });
    expect(gameShots(round(card18.slice(0, 9)), game, players)).toEqual({ a: 3, b: 0 });
  });

  it("gives shots on the toughest of the nine by stroke index", () => {
    const back = round(card18.slice(9)); // SIs 2,4,6,...,18 on holes 10..18
    expect(strokeIndex(back, 10)).toBe(1);
    expect(strokeIndex(back, 11)).toBe(2);
    expect(strokeIndex(back, 18)).toBe(9);
    // 3 shots: holes 10, 11, 12
    expect([10, 11, 12, 13].map((h) => holeShots(back, 3, h))).toEqual([1, 1, 1, 0]);
    // 11 shots on nine holes: one everywhere, two on the two toughest
    expect([10, 11, 12, 18].map((h) => holeShots(back, 11, h))).toEqual([2, 2, 1, 1]);
    // 18 holes: unchanged
    expect(holeShots(round(card18), 3, 10)).toBe(1);
    expect(holeShots(round(card18), 3, 1)).toBe(1);
    expect(holeShots(round(card18), 3, 3)).toBe(0);
    expect(holeShots(round(card18), 3, 11)).toBe(0);
  });

  it("finishes a nine-hole match after nine holes with the full points", () => {
    const r = round(card18.slice(0, 9), { handicap: { mode: "manual", shots: {} } });
    // a wins holes 1 and 9, the rest halved
    const entries = allPars(r, (h) => (h === 1 || h === 9 ? 3 : 4), () => 4);
    const gs = gameSummary(r, game, players, entries);
    expect(gs.complete).toBe(true);
    expect(gs.full.matchLabel).toBe("Oisin wins 2 UP");
    expect(gs.points).toEqual({ a: 20, b: 0 });
  });

  it("ends a nine-hole match early when it's decided (3&2 on nine)", () => {
    const r = round(card18.slice(0, 9), { handicap: { mode: "manual", shots: {} } });
    const entries = allPars(r, (h) => (h <= 3 ? 3 : 4), () => 4).filter((e) => e.hole <= 7);
    const gs = gameSummary(r, game, players, entries);
    expect(gs.complete).toBe(true);
    expect(gs.full.matchLabel).toBe("Oisin won 3&2");
  });

  it("counts the tournament complete when the nine is done", () => {
    const r = round(card18.slice(9), { scoring: "stableford", handicap: { mode: "manual", shots: {} } });
    const entries = allPars(r, () => 4, () => 5);
    const t = tournamentSummary({ players, teams: [], rounds: [r], sideGames: [], sideGamesBy: "player" }, { r1: entries });
    expect(t.complete).toBe(true);
    expect(t.pointsRemaining).toBe(0);
    expect(t.playerTotal.a).toBe(20);
  });
});

describe("rounds that play part of the card", () => {
  const row = { id: "r1", number: 1, course_name: "Birr", holes: card18.map((h) => ({ ...h, yards: 300 })), format: "match", play: "singles", games: [game], points_rule: null, handicap_rule: null, nine_points: 10, full_points: 20, shots: {}, status: "live" } as unknown as RoundRow;

  it("plays the whole card, the front nine or the back nine", () => {
    expect(playedHoles(card18, "all")).toHaveLength(18);
    expect(playedHoles(card18, "front").map((h) => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(playedHoles(card18, "back").map((h) => h.number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(playedHoles(card18, null)).toHaveLength(18);
  });

  it("loads a round with only its holes, keeping the whole card", () => {
    const n = normalizeRound({ ...row, hole_set: "back" });
    expect(n.holes.map((h) => h.number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(n.all_holes).toHaveLength(18);
    // loading twice changes nothing
    expect(normalizeRound(n).holes).toHaveLength(9);
    expect(toRoundCfg(n, []).holes).toHaveLength(9);
    expect(toRoundCfg({ ...row, hole_set: "front" }, []).holes).toHaveLength(9);
  });

  it("accepts a 9-hole card's stroke indexes", () => {
    expect(validStrokeIndexes(SIS)).toBe(true);
    expect(validStrokeIndexes([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(true);
    expect(validStrokeIndexes([1, 3, 5, 7, 9, 11, 13, 15, 17])).toBe(true);
    expect(validStrokeIndexes([1, 1, 3, 4, 5, 6, 7, 8, 9])).toBe(false);
    expect(validStrokeIndexes([1, 2, 3])).toBe(false);
    expect(validStrokeIndexes(SIS.map((x) => (x === 18 ? 17 : x)))).toBe(false);
  });
});

describe("score entry", () => {
  it("offers one under par to three over", () => {
    expect(scoreTiles(3)).toEqual([2, 3, 4, 5, 6]);
    expect(scoreTiles(4)).toEqual([3, 4, 5, 6, 7]);
    expect(scoreTiles(5)).toEqual([4, 5, 6, 7, 8]);
  });
  it("names the score", () => {
    expect(scoreWord(1, 3)).toBe("Ace");
    expect(scoreWord(3, 5)).toBe("Eagle");
    expect(scoreWord(3, 4)).toBe("Birdie");
    expect(scoreWord(4, 4)).toBe("Par");
    expect(scoreWord(6, 4)).toBe("Double");
    expect(scoreWord(9, 4)).toBe("+5");
  });
});
