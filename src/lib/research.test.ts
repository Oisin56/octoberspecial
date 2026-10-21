import { describe, expect, it } from "vitest";
import { holeMatches } from "./research-check";

// A par 4 of 330 (red), 380 (yellow) and 400 (white) yards
const hole = { number: 1, par: 4, yards: [400, 380, 330] };

describe("a hole note's length", () => {
  it("keeps lengths close to any tee", () => {
    expect(holeMatches(hole, 4, 410, "yards")).toBe(true);
    expect(holeMatches(hole, 4, 300, "yards")).toBe(true);
    expect(holeMatches(hole, 4, 355, "metres")).toBe(true);
  });
  it("keeps a length given in the wrong unit", () => {
    expect(holeMatches(hole, 4, 420, "metres")).toBe(true);
  });
  it("keeps a note with no length", () => {
    expect(holeMatches(hole, 4, null, null)).toBe(true);
  });
  it("leaves out only a big difference", () => {
    expect(holeMatches(hole, 4, 180, "yards")).toBe(false);
    expect(holeMatches(hole, 4, 560, "yards")).toBe(false);
  });
  it("leaves out a different par", () => {
    expect(holeMatches(hole, 3, 380, "yards")).toBe(false);
  });
});
