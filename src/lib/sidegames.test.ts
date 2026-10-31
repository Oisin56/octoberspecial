import { describe, expect, it } from "vitest";
import { holesText, onTopLine, ordinal, sideLine, sideLines, type SideSetup } from "./sidegames";

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const card = PARS.map((par, i) => ({ number: i + 1, par }));
const r1 = { number: 1, course: "Galway Bay", holes: card, games: 1 };
const r2 = { number: 2, course: "Glenlo", holes: card.slice(0, 9), nine: "front" as const, games: 1 };

const base: SideSetup = { race: true, bonus: {}, prizes: [], holes: {}, rounds: [r1, r2] };

describe("side games in words", () => {
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
  it("closest the pin: points and a prize, every par 3", () => {
    const s = { ...base, bonus: { ctp: 3 }, prizes: [{ kind: "ctp" as const, per: "trip" as const, points: 5 }] };
    expect(sideLine(s, "ctp")).toBe("Closest the pin: 3 points each, and a prize for the most over the whole trip (worth 5). Every par 3.");
  });
  it("chosen holes round by round, and a round left out", () => {
    const s = { ...base, bonus: { ctp: 1 }, holes: { ctp: { "1": [3, 12], "2": [] } } };
    expect(holesText(s, "ctp")).toBe("Round 1: the 3rd and 12th; not in round 2.");
    expect(holesText({ ...s, holes: { ctp: { "2": [] } } }, "ctp")).toBe("Not in round 2; every par 3 in the other round.");
    expect(sideLine(s, "ctp")).toBe("Closest the pin: 1 point each. Round 1: the 3rd and 12th; not in round 2.");
  });
  it("off: no line", () => {
    expect(sideLine(base, "birdies")).toBeNull();
    expect(sideLines(base)).toEqual([]);
    expect(onTopLine(base)).toBeNull();
  });
  it("what's on top of the rounds", () => {
    // Par 3s: 4 in round 1, 2 on the front nine at Glenlo. Par 5s the same.
    const s = { ...base, bonus: { ctp: 3, ld: 3, birdies: 2, eagles: 5 }, prizes: [{ kind: "gir" as const, per: "round" as const, points: 2 }] };
    expect(onTopLine(s)).toBe("On top of the rounds: up to 36 points for closest the pin and long drive, 2 for each birdie, 5 for each eagle and up to 4 from prizes.");
  });
  it("a prize only, outside a points race", () => {
    const s = { ...base, race: false, bonus: { birdies: 2 }, prizes: [{ kind: "skins" as const, per: "round" as const }] };
    expect(sideLines(s)).toEqual(["Skins: a prize for the most in each round."]);
  });
});
