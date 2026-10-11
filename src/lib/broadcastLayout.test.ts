import { describe, expect, it } from "vitest";
import { NEVER_TOGETHER, overlaps, zones, type ZoneName } from "./broadcastLayout";

const SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [1024, 576],
  [1080, 1920],
  [720, 1280],
  [576, 1024],
];

describe("on-screen graphics never cover each other", () => {
  for (const [W, H] of SIZES) {
    it(`${W}x${H}`, () => {
      const z = zones(W, H);
      const names: ZoneName[] = ["score", "strap", "caption", "replay", "flash"];
      for (const n of names) {
        const r = z[n];
        // inside the frame, with a margin
        expect(r.x, `${n} left`).toBeGreaterThanOrEqual(24 * z.u);
        expect(r.y, `${n} top`).toBeGreaterThanOrEqual(24 * z.u);
        expect(r.x + r.w, `${n} right`).toBeLessThanOrEqual(W - 24 * z.u);
        expect(r.y + r.h, `${n} bottom`).toBeLessThanOrEqual(H - 24 * z.u);
        // upright: the bottom 18% is left for the apps' own buttons
        if (H > W) expect(r.y + r.h, `${n} clear of the app buttons`).toBeLessThanOrEqual(z.clearBottom);
      }
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const pair = [names[i], names[j]];
          if (NEVER_TOGETHER.some(([a, b]) => (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]))) continue;
          expect(overlaps(z[names[i]], z[names[j]], 16 * z.u), `${pair.join(" and ")} overlap`).toBe(false);
        }
    });
  }
});
