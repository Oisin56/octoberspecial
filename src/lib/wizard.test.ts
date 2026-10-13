import { describe, it, expect } from "vitest";
import { drawProblems, drawRound, groupsOf, handicapFor, needsDraw, pointsRule, standingsFor, type WizRound } from "./wizard";

const r = (format: WizRound["format"]): WizRound => ({ courseName: "X", holeSet: "all", format });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const noTeams = (xs: string[]) => Object.fromEntries(xs.map((x) => [x, null]));
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("the wizard's choices", () => {
  it("wins on running totals only when everyone plays the same Stableford or stroke play", () => {
    expect(standingsFor({ who: "individuals", rounds: [r("stableford"), r("stableford")] })).toBe("stableford");
    expect(standingsFor({ who: "solo", rounds: [r("stroke")] })).toBe("stroke");
    expect(standingsFor({ who: "individuals", rounds: [r("stableford"), r("stroke")] })).toBe("points");
    expect(standingsFor({ who: "individuals", rounds: [r("match"), r("match")] })).toBe("points");
    expect(standingsFor({ who: "teams", rounds: [r("singles")] })).toBe("points");
  });

  it("uses the World Handicap System allowances", () => {
    expect(handicapFor("stableford", null)).toMatchObject({ pct: 95, relative: false });
    expect(handicapFor("fourball", null)).toMatchObject({ pct: 85, relative: true });
    expect(handicapFor("foursomes", null)).toMatchObject({ pct: 50, relative: true });
    expect(handicapFor("singles", null)).toMatchObject({ pct: 100, relative: true });
    const c = { slope: 128, rating: 71.2, par: 72 };
    expect(handicapFor("stroke", c)).toMatchObject({ course: c });
  });

  it("gives sensible points, or none for running totals", () => {
    expect(pointsRule("match", undefined, "points", 8)).toEqual({ front: 0, back: 0, full: 1 });
    expect(pointsRule("stableford", undefined, "points", 8)).toEqual({ front: 0, back: 0, full: 0, positions: [3, 2, 1], across: true });
    expect(pointsRule("stableford", undefined, "points", 3).positions).toEqual([2, 1]);
    expect(pointsRule("skins", { skin: 2 }, "points", 4)).toEqual({ front: 0, back: 0, full: 0, skin: 2 });
    expect(pointsRule("fourball", { win: 1.5 }, "points", 8).full).toBe(1.5);
    expect(pointsRule("stableford", undefined, "stableford", 8)).toEqual({ front: 0, back: 0, full: 0 });
  });
});

describe("groups and matches", () => {
  it("splits into groups of at most four, as even as possible", () => {
    expect(groupsOf(ids(4)).map((g) => g.length)).toEqual([4]);
    expect(groupsOf(ids(6)).map((g) => g.length)).toEqual([3, 3]);
    expect(groupsOf(ids(9)).map((g) => g.length)).toEqual([3, 3, 3]);
    expect(groupsOf(ids(10)).map((g) => g.length)).toEqual([4, 3, 3]);
    expect(groupsOf(ids(13)).map((g) => g.length)).toEqual([4, 3, 3, 3]);
  });

  it("only asks about the draw when there's a choice to make", () => {
    const p = (n: number) => ids(n).map((name) => ({ name, index: null }));
    expect(needsDraw({ who: "individuals", rounds: [r("stableford")], players: p(4) })).toBe(false);
    expect(needsDraw({ who: "individuals", rounds: [r("stableford")], players: p(5) })).toBe(true);
    expect(needsDraw({ who: "individuals", rounds: [r("match")], players: p(2) })).toBe(false);
    expect(needsDraw({ who: "individuals", rounds: [r("match")], players: p(4) })).toBe(true);
    expect(needsDraw({ who: "solo", rounds: [r("stroke")], players: p(1) })).toBe(false);
    expect(needsDraw({ who: "teams", rounds: [r("singles")], players: p(2) })).toBe(true);
  });

  it("leaves it to the organiser when they'll set them", () => {
    expect(drawRound({ who: "individuals", draw: "myself" }, r("stableford"), 1, ids(8), noTeams(ids(8)))).toBeNull();
    expect(drawRound({ who: "teams", draw: "myself" }, r("fourball"), 1, ids(4), { p1: "a", p2: "a", p3: "b", p4: "b" })).toBeNull();
    // Nothing to choose: one group of four
    const g = drawRound({ who: "individuals", draw: "myself" }, r("stableford"), 1, ids(4), noTeams(ids(4)))!;
    expect(g).toHaveLength(1);
    expect(g[0].sides.map((s) => s.id)).toEqual(ids(4));
    expect(g[0].scorerId).toBe("p1");
  });

  it("draws random groups, every player once, the first in each group keeping score", () => {
    const g = drawRound({ who: "individuals", draw: "random" }, r("stroke"), 2, ids(10), noTeams(ids(10)), rnd)!;
    expect(g.map((x) => x.sides.length)).toEqual([4, 3, 3]);
    expect(g.flatMap((x) => x.sides.map((s) => s.id)).sort()).toEqual(ids(10).sort());
    expect(g.map((x) => x.id)).toEqual(["r2g1", "r2g2", "r2g3"]);
    for (const x of g) expect(x.scorerId).toBe(x.sides[0].id);
  });

  it("pairs individuals for match play", () => {
    const g = drawRound({ who: "individuals", draw: "random" }, r("match"), 1, ids(6), noTeams(ids(6)), rnd)!;
    expect(g).toHaveLength(3);
    expect(g.every((x) => x.sides.length === 2)).toBe(true);
  });

  it("makes Ryder Cup matches: pairs from each team for fourballs, one against one for singles", () => {
    const team = { p1: "a", p2: "a", p3: "a", p4: "a", p5: "b", p6: "b", p7: "b", p8: "b" } as Record<string, string>;
    const fb = drawRound({ who: "teams", draw: "random" }, r("fourball"), 1, ids(8), team, rnd)!;
    expect(fb).toHaveLength(2);
    for (const m of fb) {
      expect(m.sides[0].playerIds.every((p) => team[p] === "a")).toBe(true);
      expect(m.sides[1].playerIds.every((p) => team[p] === "b")).toBe(true);
      expect(m.sides[0].teamId).toBe("a");
      expect(m.sides[0].playerIds).toHaveLength(2);
    }
    const sg = drawRound({ who: "teams", draw: "random" }, r("singles"), 3, ids(8), team, rnd)!;
    expect(sg).toHaveLength(4);
    expect(sg.every((m) => m.sides[0].playerIds.length === 1 && team[m.sides[0].id] === "a")).toBe(true);
  });

  it("says plainly what would stop the draw working", () => {
    const pl = (teams: (0 | 1 | null)[]) => teams.map((team, i) => ({ name: `p${i}`, index: null, team }));
    expect(drawProblems({ who: "teams", rounds: [r("singles")], players: pl([0, 0, 1]) })[0]).toMatch(/same number/);
    expect(drawProblems({ who: "teams", rounds: [r("fourball")], players: pl([0, 0, 0, 1, 1, 1]) })[0]).toMatch(/even number/);
    expect(drawProblems({ who: "teams", rounds: [r("singles")], players: pl([0, null]) })[0]).toMatch(/every player/);
    expect(drawProblems({ who: "teams", rounds: [r("singles")], players: pl([0, 1]) })).toEqual([]);
    expect(drawProblems({ who: "individuals", rounds: [r("stableford"), r("match")], players: pl([null, null, null]) })[0]).toMatch(/round 2.*even/);
  });
});
