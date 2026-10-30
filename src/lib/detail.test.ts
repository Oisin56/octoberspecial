import { describe, expect, it } from "vitest";
import { clubOrder, kindOrder, outcomeOrder, shotWords, windWord, bearing, extrasWords, WIND } from "./detail";
import { mayScore, mayTellShots, oneScorer, scoringGames } from "./scoring-access";
import type { Game } from "./engine";

describe("what comes first", () => {
  it("the kind of shot, from where it was played", () => {
    expect(kindOrder(8, 4, null)).toEqual(["putt", "chip", "bunker"]);
    expect(kindOrder(40, 4, null)).toEqual(["chip", "bunker", "putt"]);
    expect(kindOrder(150, 4, "tee")).toEqual(["approach", "recovery", "chip"]);
    expect(kindOrder(250, 5, "tee")).toEqual(["second", "recovery", "approach"]);
    // Not measured: whatever usually follows
    expect(kindOrder(null, 4, "tee")[0]).toBe("approach");
    expect(kindOrder(null, 4, "approach")[0]).toBe("chip");
    expect(kindOrder(null, 4, "chip")[0]).toBe("putt");
  });

  it("clubs: the driver off a par 4 or 5 tee, by distance otherwise", () => {
    expect(clubOrder("tee", 4, 400)).toEqual(["Driver", "3 wood", "Hybrid"]);
    expect(clubOrder("tee", 3, 165)).toEqual(["7 iron", "6 iron", "8 iron"]);
    expect(clubOrder("approach", 4, 172)).toEqual(["6 iron", "5 iron", "Hybrid"]);
    expect(clubOrder("approach", 4, 110)).toEqual(["Pitching wedge", "9 iron", "Gap wedge"]);
    expect(clubOrder("chip", 4, 30)).toEqual(["Sand wedge", "Lob wedge", "Pitching wedge"]);
    expect(clubOrder("bunker", 4, 20)[0]).toBe("Sand wedge");
    expect(clubOrder("putt", 4, 5)).toEqual(["Putter"]);
  });

  it("a player's own club from about that far moves to the front, once picked twice", () => {
    const h = [
      { club: "6 iron", from: 163 },
      { club: "6 iron", from: 160 },
    ];
    expect(clubOrder("approach", 4, 158, h)).toEqual(["6 iron", "7 iron", "8 iron"]);
    expect(clubOrder("approach", 4, 158, h.slice(0, 1))).toEqual(["7 iron", "6 iron", "8 iron"]);
  });

  it("outcomes: six for each kind, water last when it's in play", () => {
    expect(outcomeOrder("tee", { par: 4 })).toEqual(["Fairway", "Left rough", "Right rough", "Bunker", "Trees", "Out of bounds"]);
    expect(outcomeOrder("tee", { par: 3 })).toEqual(["On the green", "Short", "Left", "Right", "Long", "Bunker"]);
    expect(outcomeOrder("tee", { par: 4, water: true }).at(-1)).toBe("Water");
    expect(outcomeOrder("putt", { par: 4 })).toHaveLength(6);
    expect(outcomeOrder("penalty", { par: 4 })).toEqual([]);
    for (const k of ["tee", "second", "approach", "chip", "bunker", "recovery", "putt"] as const) expect(outcomeOrder(k, { par: 4 })).toHaveLength(6);
  });
});

describe("the wind on a hole", () => {
  it("in golfers' words, from the weather and the hole's direction", () => {
    // A hole playing due north (0°)
    expect(windWord(5, 0, 0)).toBe("No wind");
    expect(windWord(15, 0, 0)).toBe("Hurting, light");
    expect(windWord(30, 10, 0)).toBe("Hurting, strong");
    expect(windWord(15, 180, 0)).toBe("Helping, light");
    expect(windWord(30, 170, 0)).toBe("Helping, strong");
    // From the east (the right of a hole playing north): it blows right to left
    expect(windWord(15, 90, 0)).toBe("Right to left, light");
    expect(windWord(30, 270, 0)).toBe("Left to right, strong");
    // Everything it can say can be saved
    expect(WIND).toContain(windWord(30, 270, 0));
    expect(WIND).toContain("No wind");
    expect(WIND).toHaveLength(9);
    // No direction known: only calm can be said
    expect(windWord(15, 90, null)).toBeNull();
    expect(windWord(null, 90, 0)).toBeNull();
  });

  it("works out a hole's direction", () => {
    expect(Math.round(bearing([53, -8], [53.01, -8]))).toBe(0);
    expect(Math.round(bearing([53, -8], [53, -7.99]))).toBe(90);
  });
});

describe("a shot in words", () => {
  it("names the club, or a putt's length", () => {
    expect(shotWords({ kind: "tee", outcome: "On the green", club: "7 iron" })).toBe("Tee shot, 7 iron: on the green");
    expect(shotWords({ kind: "putt", outcome: "Holed", club: "Putter", distance: "10 to 30 ft" })).toBe("Putt, 10 to 30 ft: holed");
    expect(shotWords({ kind: "approach", outcome: "", club: "8 iron" })).toBe("Approach, 8 iron");
    expect(extrasWords({ contact: "Flushed", shape: "Draw", flight: "Normal" })).toBe("flushed, draw");
  });
});

describe("who can enter a group's scores", () => {
  const g1: Game = { id: "g1", sides: [{ id: "neil", playerIds: ["neil"] }, { id: "paddy", playerIds: ["paddy"] }], scorerId: "neil" };
  const g2: Game = { id: "g2", sides: [{ id: "sean", playerIds: ["sean"] }, { id: "ois", playerIds: ["ois"] }], scorerId: "sean" };
  const open = { one_scorer: false };
  it("anyone in the group, not the other groups", () => {
    expect(mayScore(open, {}, g1, { playerId: "paddy", role: "player" })).toBe(true);
    expect(mayScore(open, {}, g1, { playerId: "sean", role: "player" })).toBe(false);
    expect(scoringGames(open, {}, [g1, g2], { playerId: "paddy", role: "player" }).map((g) => g.id)).toEqual(["g1"]);
  });
  it("the organiser: their own group, and any set to organiser only; the rest as a logged correction", () => {
    expect(scoringGames(open, {}, [g1, g2], { playerId: "sean", role: "organiser" }).map((g) => g.id)).toEqual(["g2"]);
    expect(scoringGames(open, {}, [g1, g2], { role: "organiser" })).toEqual([]);
    expect(scoringGames(open, {}, [g1, { ...g2, scorerId: null }], { role: "organiser" }).map((g) => g.id)).toEqual(["g2"]);
  });
  it("one scorer per group, or a round being played when it went live: only the scorer", () => {
    expect(oneScorer({ one_scorer: true }, {})).toBe(true);
    expect(oneScorer(open, { keep_scorer: true })).toBe(true);
    expect(mayScore({ one_scorer: true }, {}, g1, { playerId: "paddy", role: "player" })).toBe(false);
    expect(mayScore(open, { keep_scorer: true }, g1, { playerId: "neil", role: "player" })).toBe(true);
  });
  it("anyone in the group can tell each other's shots", () => {
    expect(mayTellShots([g1, g2], { playerId: "paddy", role: "player" }, "neil")).toBe(true);
    expect(mayTellShots([g1, g2], { playerId: "sean", role: "player" }, "neil")).toBe(false);
  });
});
