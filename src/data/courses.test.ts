import { describe, it, expect } from "vitest";
import { COURSES } from "./courses";

describe("course data sanity", () => {
  for (const c of COURSES) {
    it(`${c.name}: 18 holes, SI is a permutation of 1-18, tees are complete`, () => {
      expect(c.par).toHaveLength(18);
      expect(c.si).toHaveLength(18);
      expect([...c.si].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
      for (const [tee, yards] of Object.entries(c.tees)) {
        expect(yards, tee).toHaveLength(18);
        yards.forEach((y, i) => {
          const par = c.par[i];
          // Loose plausibility: par 3 < 260, par 5 > 400
          if (par === 3) expect(y, `${tee} hole ${i + 1}`).toBeLessThan(260);
          if (par === 5) expect(y, `${tee} hole ${i + 1}`).toBeGreaterThan(400);
        });
      }
    });
  }
  it("pars", () => {
    const pars = Object.fromEntries(COURSES.map((c) => [c.slug, c.par.reduce((a, b) => a + b, 0)]));
    expect(pars).toEqual({
      "druids-heath": 71,
      wicklow: 71,
      macreddin: 72,
      rathsallagh: 72,
      "concra-wood": 72,
      "slieve-russell": 72,
      "farnham-estate": 72,
    });
  });
});
