import { describe, expect, it } from "vitest";
import { testRound, TEST_ROUND_ID } from "./testRound";
import { buildGrid, gridText, strokeText, toldLevel, scoreWord, inPlayOf } from "./grid";
import { figuresText, matchFigures, playerFigures } from "./figures";
import { findMoments, pickMoments, shapeOf } from "./moments";
import { writerBrief, gridLength, BANNED_PHRASES } from "./writerBrief";

const every = testRound("every");
const rows = buildGrid(every, TEST_ROUND_ID);
const row = (pid: string, hole: number) => rows.find((r) => r.playerId === pid && r.hole === hole)!;

describe("the grid", () => {
  it("has a row for each player on each hole", () => {
    expect(rows).toHaveLength(72);
    expect(new Set(rows.map((r) => r.playerId))).toEqual(new Set(["neil", "paddy", "sean", "ciaran"]));
  });
  it("knows the match before and after each hole, from each side", () => {
    const n = row("neil", 17);
    expect(n.score).toMatchObject({ gross: 3, word: "birdie" });
    expect(n.game).toMatchObject({ before: "1 down", after: "all square", hole: "won" });
    expect(row("paddy", 17).game).toMatchObject({ before: "1 up", after: "all square", hole: "lost" });
    expect(row("neil", 18).game.after).toBe("won 1 up");
    expect(row("sean", 14).game.after).toBe("won 5&4");
    expect(row("sean", 15).game.over).toBe(true);
  });
  it("keeps the strokes as told, with the clip on the stroke it shows", () => {
    const n = row("neil", 17);
    expect(n.told).toBe("every");
    expect(n.strokes.map((s) => s.kind)).toEqual(["tee", "approach", "putt"]);
    expect(n.strokes[1]).toMatchObject({ club: "8 iron", from: 140, outcome: "On the green", outcomeFrom: "told" });
    expect(n.strokes[2].clipId).toBe("clip-neil-17");
    expect(n.said.posted).toEqual(["Neil for birdie on 17"]);
    const p = row("paddy", 18);
    expect(p.score.pickedUp).toBe(true);
    expect(p.strokes.map((s) => s.outcome)).toEqual(["Out of bounds", "Penalty", "Right rough"]);
  });
  it("marks what's known from the score, and never dresses it up", () => {
    const some = buildGrid(testRound("some"), TEST_ROUND_ID).find((r) => r.playerId === "neil" && r.hole === 17)!;
    expect(some.told).toBe("some");
    const last = some.strokes[2];
    expect(last.outcomeFrom).toBe("score");
    expect(strokeText(last)).toBe("3 holed (known from the score) [filmed]");
    expect(gridText([some])).toContain("2 not told");
  });
  it("keeps voice notes apart from what was posted", () => {
    expect(row("neil", 18).said.voice[0]).toMatch(/hands/);
    expect(gridText(rows)).toContain("said to the commentators (use it in your own words, never quote it)");
  });
  it("has the group's wind on the hole", () => {
    expect(row("neil", 12)).toMatchObject({ wind: "Hurting, strong", windBy: "group" });
    expect(row("sean", 12).wind).toBeNull();
  });
  it("says how much was told", () => {
    expect(toldLevel(rows)).toBe("most");
    expect(toldLevel(buildGrid(testRound("some"), TEST_ROUND_ID))).toBe("some");
    expect(toldLevel(buildGrid(testRound("scores"), TEST_ROUND_ID))).toBe("scores");
  });
  it("words and hazards", () => {
    expect(scoreWord(1, 3)).toBe("hole in one");
    expect(scoreWord(3, 5)).toBe("eagle");
    expect(scoreWord(7, 4)).toBe("triple bogey");
    expect(inPlayOf("A lake guards the left; out of bounds right, two bunkers")).toEqual(["water", "bunkers", "out of bounds"]);
  });
});

describe("the figures", () => {
  it("works out the match: lead changes, the turn, the comeback", () => {
    const m = matchFigures(rows.filter((r) => r.gameId === "g1"))!;
    expect(m).toMatchObject({ winner: "Neil", margin: "1 up", endHole: 18, turnedOn: 18, swaps: 2 });
    expect(m.deepest).toEqual({ name: "Neil", down: 2, hole: 15 });
    expect(m.loserBest).toMatchObject({ name: "Paddy", up: 2, hole: 15, left: 3 });
    const m2 = matchFigures(rows.filter((r) => r.gameId === "g2"))!;
    expect(m2).toMatchObject({ winner: "Seán", margin: "5&4", endHole: 14 });
  });
  it("counts out of what was told, never as a percentage", () => {
    const f = playerFigures(rows.filter((r) => r.playerId === "neil"));
    expect(f.gross).toBe(78);
    expect(f.birdies).toEqual([2, 17]);
    expect(f.fairways.told).toBe(14);
    const text = figuresText(rows);
    expect(text).toMatch(/fairways: \d+ of the 14 told/);
    expect(text).not.toMatch(/%/);
  });
  it("fairways are only counted where the tee shot was told", () => {
    const f = playerFigures(buildGrid(testRound("scores"), TEST_ROUND_ID).filter((r) => r.playerId === "neil"));
    expect(f.fairways).toEqual({ hit: 0, told: 0 });
    expect(figuresText(buildGrid(testRound("scores"), TEST_ROUND_ID))).not.toContain("fairways");
  });
});

describe("the story finder", () => {
  const all = findMoments(rows, { players: every.players, end: true });
  const top = pickMoments(all, 8, rows);
  it("puts what decided a match first", () => {
    expect(top[0].kind).toBe("decided");
    expect(top[0].text).toMatch(/^Neil beat Paddy 1 up on the last/);
    expect(top.some((m) => m.kind === "comeback" && /2 down after the 15th with 3 to play/.test(m.text))).toBe(true);
    expect(shapeOf(top, rows)).toBe("last");
  });
  it("finds the eagle, the shot of the day and the call-back", () => {
    expect(all.some((m) => m.kind === "bigHole" && /eagle 3 on the 15th/.test(m.text))).toBe(true);
    expect(all.find((m) => m.kind === "shotOfDay")?.clips).toContain("clip-neil-17");
    expect(all.find((m) => m.kind === "callBack")?.text).toMatch(/I'll win my match by five.*Neil won 1 up/);
    expect(all.some((m) => m.kind === "againstType" && /driver/.test(m.text))).toBe(true);
  });
  it("mentions everyone and lets nobody take it over", () => {
    for (const pid of ["neil", "paddy", "sean", "ciaran"]) expect(top.some((m) => m.who.includes(pid))).toBe(true);
    expect(top.length).toBeLessThanOrEqual(8);
  });
  it("a pick-up is only a moment when it settled a match", () => {
    const scores = buildGrid(testRound("scores"), TEST_ROUND_ID);
    const pick = findMoments(scores).filter((m) => m.kind === "disaster" && /picked up/.test(m.text));
    expect(pick).toHaveLength(1);
    expect(pick[0].text).toMatch(/Paddy picked up on the 18th, the hole that settled the match/);
  });
  it("finds the same moments every time", () => {
    expect(findMoments(rows, { players: every.players, end: true }).map((m) => m.id)).toEqual(all.map((m) => m.id));
  });
});

describe("the writer's brief", () => {
  it("hands over the grid, figures and moments, and the facts for the check", () => {
    const b = writerBrief(every, "report", TEST_ROUND_ID);
    expect(b.shape).toBe("last");
    expect(b.told).toBe("most");
    expect(b.blocks.map((x) => x.head.split(" (")[0])).toEqual(expect.arrayContaining(["THE GRID, ROUND 1", "THE FIGURES", "THE MOMENTS WORTH TELLING"]));
    expect(b.facts).toContain("EVERY SCORE");
    expect(b.facts).toContain("Neil Brennan R1: 1:5 2:4");
  });
  it("a bulletin is about the hole just played", () => {
    const b = writerBrief(every, "bulletin", TEST_ROUND_ID, { gameId: "g1", hole: 17 });
    expect(b.rows.every((r) => r.gameId === "g1" && r.index <= 16)).toBe(true);
    expect(b.moments[0].refs.some((r) => r.hole === 17)).toBe(true);
  });
  it("length follows how much was told", () => {
    expect(gridLength("report", "scores")).toBe("about 200 words, crisp");
    expect(gridLength("report", "most")).toBe("500–650 words");
    expect(BANNED_PHRASES).toContain("a round to remember");
  });
});

describe("sentences for the fact check", () => {
  it("splits and joins a piece without changing it", async () => {
    const { splitSentences, joinSentences } = await import("./sentences");
    const body = "Neil won the 17th. Paddy didn't!\n\nThe last hole\n\nIt finished 1 up, on the 18th. “Never in doubt,” said nobody.";
    const s = splitSentences(body);
    expect(s.map((x) => x.text)).toEqual(["Neil won the 17th.", "Paddy didn't!", "The last hole", "It finished 1 up, on the 18th.", "“Never in doubt,” said nobody."]);
    expect(joinSentences(s)).toBe(body);
    expect(joinSentences(s.map((x) => (x.n === 2 ? { ...x, text: "" } : x)))).toBe("Neil won the 17th.\n\nThe last hole\n\nIt finished 1 up, on the 18th. “Never in doubt,” said nobody.");
  });
});
