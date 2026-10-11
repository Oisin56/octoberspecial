import { describe, expect, it } from "vitest";
import { matchMoment, nextKind, outcomesFor, scorePrompt, kindsFor } from "./shots";

describe("shot choices", () => {
  it("par 3 tee shots are about the green", () => {
    expect(outcomesFor("tee", { par: 3 })).toEqual(["On the green", "Missed left", "Missed right", "Short", "Long", "Bunker"]);
    expect(outcomesFor("tee", { par: 3, note: "Water short right" })).toContain("Water");
  });
  it("par 4 tee shots are about the fairway; water from the guide replaces the least likely trouble", () => {
    expect(outcomesFor("tee", { par: 4 })).toEqual(["Fairway", "Left", "Right", "Bunker", "Trees", "Out of bounds"]);
    expect(outcomesFor("tee", { par: 4, note: "A lake guards the left" })).toEqual(["Fairway", "Left", "Right", "Water", "Trees", "Out of bounds"]);
  });
  it("never more than six", () => {
    for (const k of kindsFor({ par: 5 })) expect(outcomesFor(k, { par: 5, note: "water, bunkers and trees" }).length).toBeLessThanOrEqual(6);
  });
  it("par 5s get a second shot", () => {
    expect(kindsFor({ par: 5 })).toContain("second");
    expect(kindsFor({ par: 4 })).not.toContain("second");
  });
});

describe("next likely shot", () => {
  const p4 = { par: 4 };
  it("follows the hole", () => {
    expect(nextKind([], p4)).toBe("tee");
    expect(nextKind([{ kind: "tee", outcome: "Right" }], p4)).toBe("approach");
    expect(nextKind([{ kind: "tee", outcome: "Trees" }], p4)).toBe("recovery");
    expect(nextKind([{ kind: "tee", outcome: "Out of bounds" }], p4)).toBe("tee");
    expect(nextKind([{ kind: "approach", outcome: "Stiff" }], p4)).toBe("putt");
    expect(nextKind([{ kind: "approach", outcome: "Bunker" }], p4)).toBe("bunker");
    expect(nextKind([{ kind: "putt", outcome: "Holed from 10 ft" }], p4)).toBeNull();
    expect(nextKind([{ kind: "tee", outcome: "On the green" }], { par: 3 })).toBe("putt");
    expect(nextKind([{ kind: "tee", outcome: "Fairway" }], { par: 5 })).toBe("second");
  });
});

describe("questions from the scores", () => {
  it("birdie and worse-than-double ask; par and bogey don't", () => {
    expect(scorePrompt("Neil", "neil", 3, { par: 4 })?.question).toBe("How did Neil make birdie?");
    expect(scorePrompt("Neil", "neil", 6, { par: 4 })?.question).toBe("What went wrong for Neil?");
    expect(scorePrompt("Neil", "neil", 4, { par: 4 })).toBeNull();
    expect(scorePrompt("Neil", "neil", 5, { par: 4 })).toBeNull();
    expect(scorePrompt("Neil", "neil", 1, { par: 3 })?.badge).toBe("Ace");
  });
  it("matchplay: only the big moments", () => {
    expect(matchMoment([1], 1, 18, "A", "A", "B")).toBeNull(); // a hole won early: nothing
    expect(matchMoment([...Array(15).fill(1), 2], 16, 18, "A", "A", "B")).toBe("A goes dormie"); // 2 up with 2 to play
    expect(matchMoment([1, 2, 1, 2], 4, 18, "A", "A", "B")).toBeNull();
    expect(matchMoment([0, -1, -2, -1, 0], 5, 18, "A", "A", "B")).toBe("Back to all square: A fights back");
    expect(matchMoment([...Array(13).fill(-1), 0, 1], 15, 18, "A", "A", "B")).toBe("A takes the lead");
    expect(matchMoment([...Array(14).fill(3), 4], 15, 18, "A", "A", "B")).toBe("A wins the match");
  });
});
