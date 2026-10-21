import { describe, expect, it } from "vitest";
import {
  defaultFormat,
  defaultPoints,
  defaultWin,
  drawRound,
  groupsOf,
  handicapFor,
  knockoutPairs,
  knockoutStages,
  pointsRule,
  problems,
  roundFormats,
  teeTimeAt,
  winRule,
  winsFor,
  type Wizard,
  type WizPlayer,
} from "./wizard";

const players = (n: number, team?: (i: number) => number): WizPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `P${i}`, index: i * 3, team: team ? team(i) : null }));

describe("ways to win", () => {
  it("offers the group's five, and the teams' three with their limits", () => {
    expect(winsFor("individuals", 0).map((w) => w.id)).toEqual(["stableford", "stroke", "points", "knockout", "skins"]);
    expect(winsFor("teams", 3, [4, 4, 4]).find((w) => w.id === "matches")!.off).toBe("Needs exactly two teams");
    expect(winsFor("teams", 2, [6, 6]).find((w) => w.id === "scramble")!.off).toBe("Teams of four or fewer");
    expect(winsFor("teams", 2, [4, 4]).every((w) => !w.off)).toBe(true);
  });

  it("starts on the usual choice", () => {
    expect(defaultWin("individuals", 0)).toBe("stableford");
    expect(defaultWin("teams", 2)).toBe("matches");
    expect(defaultWin("teams", 4)).toBe("teamscore");
  });

  it("asks a round's format only when there's a choice", () => {
    expect(roundFormats("individuals", "stableford")).toEqual(["stableford"]);
    expect(roundFormats("individuals", "points")).toEqual(["stableford", "stroke", "match", "skins"]);
    expect(roundFormats("teams", "matches")).toEqual(["fourball", "foursomes", "singles"]);
    expect(roundFormats("individuals", "knockout", true)).toEqual(["fourball"]);
  });

  it("opens a Ryder Cup weekend with fourballs and foursomes, singles last", () => {
    expect([0, 1, 2].map((i) => defaultFormat("teams", "matches", i, 3))).toEqual(["fourball", "foursomes", "singles"]);
    expect(defaultFormat("teams", "matches", 0, 1)).toBe("singles");
  });

  it("turns the answers into the engine's rule", () => {
    expect(winRule({ win: "teamscore" })).toEqual({ kind: "teamscore", count: 2 });
    expect(winRule({ win: "skins", skinsCarry: false })).toEqual({ kind: "skins", carry: false });
    expect(winRule({ win: "points", bonus: { birdies: 1, gir: 0 } })).toEqual({ kind: "points", bonus: { birdies: 1 } });
  });
});

describe("points and handicaps", () => {
  it("pays the winner only with two players, 3-2-1 up to nine, 5-4-3-2-1 for ten or more", () => {
    expect(defaultPoints("stableford", 2)).toEqual({ positions: [1] });
    expect(defaultPoints("stroke", 9)).toEqual({ positions: [3, 2, 1] });
    expect(defaultPoints("stableford", 10)).toEqual({ positions: [5, 4, 3, 2, 1] });
    expect(defaultPoints("match", 8)).toEqual({ win: 1 });
  });

  it("adds front and back nine points when switched on, and none outside a points race", () => {
    expect(pointsRule("match", { nines: { front: 1, back: 1 } }, "points", 2)).toEqual({ front: 1, back: 1, full: 1 });
    expect(pointsRule("stableford", undefined, "stableford", 8)).toEqual({ front: 0, back: 0, full: 0 });
  });

  it("uses the official allowances", () => {
    const pct = (f: Parameters<typeof handicapFor>[0], win: Parameters<typeof handicapFor>[1] = "points") => handicapFor(f, win, null).pct;
    expect([pct("stableford"), pct("stableford", "teamscore"), pct("match"), pct("fourball"), pct("foursomes"), pct("skins")]).toEqual([95, 85, 100, 90, 50, 100]);
    expect(handicapFor("fourball", "matches", null).relative).toBe(true);
    expect(handicapFor("stableford", "stableford", null, 100).pct).toBe(100);
  });
});

describe("checks", () => {
  const base = { who: "individuals" as const, teams: [], rounds: [] };
  it("needs an even number for match play and pairs", () => {
    expect(problems({ ...base, win: "points", players: players(5), rounds: [{ format: "match" } as Wizard["rounds"][number]] })).toContain("Match play (round 1) needs an even number of players.");
    expect(problems({ ...base, win: "knockout", ko: { pairs: true, draw: "random", tie: "backnine" }, players: players(5) })).toContain("A pairs knockout needs an even number of players.");
  });
  it("checks the teams", () => {
    const teams = [
      { name: "A", color: "#000000" },
      { name: "B", color: "#ffffff" },
    ];
    expect(problems({ who: "teams", win: "matches", teams, rounds: [], players: players(5, (i) => i % 2) })).toContain("The teams need the same number of players for matches (3 and 2 now).");
    expect(problems({ who: "teams", win: "scramble", teams, rounds: [], players: players(10, (i) => (i < 5 ? 0 : 1)) })).toContain("A scramble team is four players at most.");
    expect(problems({ who: "teams", win: "teamscore", teams, rounds: [], players: players(6, (i) => i % 2) })).toEqual([]);
  });
});

describe("the draw", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const hcp = Object.fromEntries(ids.map((id, i) => [id, i * 4]));
  const info = (teamOf: Record<string, string | null> = {}) => ({ hcp, teamOf, idOf: Object.fromEntries(ids.map((x) => [`k-${x}`, x])) });
  const rnd = () => 0.42;

  it("splits a field into even groups", () => {
    expect(groupsOf([1, 2, 3, 4, 5, 6]).map((g) => g.length)).toEqual([3, 3]);
    expect(groupsOf([...Array(10).keys()]).map((g) => g.length)).toEqual([4, 3, 3]);
  });

  it("balances groups by handicap, one from each band in every group", () => {
    const g = drawRound({ who: "individuals", win: "stableford", draw: "balanced" }, { format: "stableford" }, 1, ids, info(), Math.random);
    expect(g.map((x) => x.sides.length)).toEqual([4, 4]);
    // Bands of two: {a,b} {c,d} {e,f} {g,h}: each group has one of each
    for (const band of [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]) for (const x of g) expect(x.sides.filter((s) => band.includes(s.id))).toHaveLength(1);
  });

  it("pairs similar handicaps for balanced match play", () => {
    const g = drawRound({ who: "individuals", win: "points", draw: "balanced" }, { format: "match" }, 1, ids, info(), rnd);
    expect(g.map((x) => x.sides.map((s) => s.id))).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("lines up team matches, and gives four players to each tee time", () => {
    const teamOf = Object.fromEntries(ids.map((id, i) => [id, i < 4 ? "t1" : "t2"]));
    const g = drawRound({ who: "teams", win: "matches", draw: "balanced" }, { format: "singles", time: "09:00" }, 1, ids, info(teamOf), rnd);
    expect(g.map((x) => x.sides.map((s) => s.id))).toEqual([
      ["a", "e"],
      ["b", "f"],
      ["c", "g"],
      ["d", "h"],
    ]);
    expect(g.map((x) => x.teeTime)).toEqual(["09:00", "09:00", "09:10", "09:10"]);
  });

  it("puts a scramble team on one ball", () => {
    const teamOf = Object.fromEntries(ids.map((id, i) => [id, i < 4 ? "t1" : "t2"]));
    const g = drawRound({ who: "teams", win: "scramble", draw: "random" }, { format: "scramble" }, 1, ids, info(teamOf), rnd);
    expect(g.map((x) => x.sides.map((s) => s.playerIds.length))).toEqual([[4], [4]]);
  });

  it("uses the organiser's picks, and groups anyone left out", () => {
    const picks = [[["k-a"], ["k-h"]], [["k-b"], ["k-c"], ["k-d"]]];
    const g = drawRound({ who: "individuals", win: "stableford", draw: "pick" }, { format: "stableford", picks }, 1, ids, info(), rnd);
    expect(g.map((x) => x.sides.map((s) => s.id))).toEqual([["a", "h"], ["b", "c", "d"], ["e", "f", "g"]]);
  });

  it("counts tee times on from the first", () => {
    expect(teeTimeAt("09:55", 2, 10)).toBe("10:15");
    expect(teeTimeAt(null, 2)).toBeNull();
  });
});

describe("knockout", () => {
  it("needs one round for each stage", () => {
    expect([2, 3, 4, 5, 8, 9, 16].map(knockoutStages)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it("makes balanced pairs: the lowest handicap with the highest", () => {
    const keys = ["a", "b", "c", "d"];
    expect(knockoutPairs(keys, { a: 2, b: 20, c: 10, d: 14 }, "seeded", null)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
