import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { guideFrom, holeMatches, mergePage, newGuideWork } from "./guide";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const card = PARS.map((par, i) => ({ number: i + 1, par, si: i + 1, yards: par === 3 ? 170 : par === 4 ? 390 : 520 }));

describe("checking a page against our card", () => {
  it("needs the same par, and a length within 15% where both are known", () => {
    expect(holeMatches(card[0], 4, 400, "yards")).toBe(true);
    expect(holeMatches(card[0], 3, 400, "yards")).toBe(false);
    expect(holeMatches(card[0], 4, 480, "yards")).toBe(false);
    expect(holeMatches(card[0], 4, 360, "metres")).toBe(true); // 394 yards
    expect(holeMatches(card[0], 4, null, null)).toBe(true);
  });

  it("keeps the holes that agree and drops the one that doesn't", () => {
    const holes: Record<string, unknown> = {};
    for (let h = 1; h <= 6; h++) holes[h] = { par: PARS[h - 1], length: null, note: `Hole ${h}` };
    holes[6] = { par: 5, length: null, note: "wrong par" };
    const m = mergePage(card, newGuideWork(), { sameCourse: true, overview: "Parkland.", signature: "The 3rd.", holes }, "https://club.ie");
    expect(Object.keys(m.work.holes).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(m.work.overview).toBe("Parkland.");
    expect(m.work.from).toEqual(["https://club.ie"]);
  });

  it("throws out a page that's plainly about a different layout", () => {
    const holes: Record<string, unknown> = {};
    for (let h = 1; h <= 18; h++) holes[h] = { par: 4, note: `Hole ${h}` };
    const m = mergePage(card, newGuideWork(), { sameCourse: true, overview: "A links.", holes }, "https://other.com");
    expect(m.kept).toBe(0);
    expect(m.work.overview).toBeUndefined();
    expect(m.why).toMatch(/didn't match/);
    expect(mergePage(card, newGuideWork(), { sameCourse: false, overview: "x", holes: {} }, "u").why).toMatch(/different course/);
  });

  it("never overwrites what an earlier (better) page said", () => {
    const first = mergePage(card, newGuideWork(), { holes: { 1: { par: 4, note: "From the club" } } }, "a").work;
    const second = mergePage(card, first, { holes: { 1: { par: 4, note: "From a review" }, 2: { par: 4, note: "Review 2" } } }, "b");
    expect(second.work.holes["1"]).toBe("From the club");
    expect(second.work.holes["2"]).toBe("Review 2");
    expect(second.kept).toBe(1);
  });

  it("says nothing was found rather than inventing it", () => {
    expect(guideFrom(newGuideWork())).toBeNull();
    expect(guideFrom({ ...newGuideWork(), holes: { 3: "Short hole" } })).toEqual({ overview: "", signature: "", holes: { 3: "Short hole" } });
  });
});
