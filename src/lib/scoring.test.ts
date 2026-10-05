import { describe, it, expect } from "vitest";
import {
  shotsOnHole,
  stablefordPoints,
  holeResult,
  segmentResult,
  roundSummary,
  tournamentSummary,
  totalPointsAvailable,
  matchLabel,
  type RoundConfig,
  type HoleEntry,
  type TournamentConfig,
  type Format,
} from "./scoring";

const O = "oisin";
const N = "neil";
const P = [O, N];

// Simple par-72 card: pars 4,4,3,4,5,4,3,4,5 each nine; SI odd on front, even on back
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SIS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const holes = PARS.map((par, i) => ({ number: i + 1, par, si: SIS[i] }));

function round(format: Format, fullPoints = 20, shots = { [O]: 0, [N]: 0 }): RoundConfig {
  return { id: `r-${format}`, number: 1, name: "Test", format, ninePoints: 10, fullPoints, shots, holes };
}

/** Build entries from per-hole gross arrays (relative to par if rel=true). */
function entries(o: number[], n: number[], rel = true): HoleEntry[] {
  return o.map((_, i) => ({
    hole: i + 1,
    scores: {
      [O]: { gross: rel ? PARS[i] + o[i] : o[i] },
      [N]: { gross: rel ? PARS[i] + n[i] : n[i] },
    },
  }));
}
const zeros = (k = 18) => Array(k).fill(0);

describe("handicap shots", () => {
  it("allocates by stroke index", () => {
    expect(shotsOnHole(0, 1)).toBe(0);
    expect(shotsOnHole(5, 5)).toBe(1);
    expect(shotsOnHole(5, 6)).toBe(0);
    expect(shotsOnHole(18, 18)).toBe(1);
    expect(shotsOnHole(20, 2)).toBe(2);
    expect(shotsOnHole(20, 3)).toBe(1);
  });
  it("stableford points", () => {
    expect(stablefordPoints({ gross: 4 }, 4, 0)).toBe(2);
    expect(stablefordPoints({ gross: 3 }, 4, 0)).toBe(3);
    expect(stablefordPoints({ gross: 5 }, 4, 1)).toBe(2);
    expect(stablefordPoints({ gross: 8 }, 4, 0)).toBe(0);
    expect(stablefordPoints({ gross: null, pickedUp: true }, 4, 1)).toBe(0);
  });
});

describe("stableford round", () => {
  it("awards nines and 18 to the clear winner", () => {
    // Oisin all pars (36 pts). Neil bogeys everything (18 pts).
    const r = round("stableford");
    const rs = roundSummary(r, P, entries(zeros(), Array(18).fill(1)));
    expect(rs.front.points).toEqual({ [O]: 10, [N]: 0 });
    expect(rs.back.points).toEqual({ [O]: 10, [N]: 0 });
    expect(rs.full.points).toEqual({ [O]: 20, [N]: 0 });
    expect(rs.points).toEqual({ [O]: 40, [N]: 0 });
    expect(rs.stablefordTotal).toEqual({ [O]: 36, [N]: 18 });
  });

  it("splits a halved nine", () => {
    // Front identical; Neil better on back by one birdie.
    const o = zeros();
    const n = zeros();
    n[12] = -1; // birdie on 13
    const rs = roundSummary(round("stableford"), P, entries(o, n));
    expect(rs.front.points).toEqual({ [O]: 5, [N]: 5 });
    expect(rs.back.points).toEqual({ [O]: 0, [N]: 10 });
    expect(rs.full.points).toEqual({ [O]: 0, [N]: 20 });
    expect(rs.birdies).toEqual({ [O]: 0, [N]: 1 });
  });

  it("applies handicap shots", () => {
    // Neil gets 9 shots (SI 1-9: front 1..5 & back 2,4,6,8). Bogeys everywhere
    // for Neil, pars for Oisin.
    const r = round("stableford", 20, { [O]: 0, [N]: 9 });
    const rs = roundSummary(r, P, entries(zeros(), Array(18).fill(1)));
    // Neil: 9 holes net par (2 pts) + 9 bogeys (1 pt) = 27; Oisin 36
    expect(rs.stablefordTotal[N]).toBe(27);
    expect(rs.full.points).toEqual({ [O]: 20, [N]: 0 });
  });

  it("awards nothing until a segment is complete", () => {
    const e = entries(zeros(), Array(18).fill(1)).slice(0, 12);
    const rs = roundSummary(round("stableford"), P, e);
    expect(rs.front.complete).toBe(true);
    expect(rs.back.complete).toBe(false);
    expect(rs.points).toEqual({ [O]: 10, [N]: 0 });
    expect(rs.back.leaders).toEqual([O]);
  });
});

describe("stroke play", () => {
  it("lower net wins, handicap applied", () => {
    // Oisin +18 gross (bogey each). Neil +20 gross but 4 shots -> net +16.
    const o = Array(18).fill(1);
    const n = Array(18).fill(1);
    n[0] = 2;
    n[1] = 2; // +20 total
    const r = round("stroke", 20, { [O]: 0, [N]: 4 });
    const rs = roundSummary(r, P, entries(o, n));
    // Neil shots on SI 1,2,3,4 -> holes 1,10,2,11
    // Front: Oisin 9 over; Neil 11 over gross - 2 shots (holes 1,2) = 9 -> halved
    expect(rs.front.points).toEqual({ [O]: 5, [N]: 5 });
    // Back: Oisin 9 over; Neil 9 over - 2 shots = 7 -> Neil
    expect(rs.back.points).toEqual({ [O]: 0, [N]: 10 });
    expect(rs.full.points).toEqual({ [O]: 0, [N]: 20 });
  });

  it("stroke play needs a real score, pick-up doesn't complete the hole", () => {
    const e = entries(zeros(), zeros());
    e[0].scores[N] = { gross: null, pickedUp: true };
    const sr = segmentResult(round("stroke"), P, e, "front");
    expect(sr.holesPlayed).toBe(8);
    expect(sr.complete).toBe(false);
  });
});

describe("match play", () => {
  it("counts holes won per segment and labels status", () => {
    // Oisin wins holes 1,2,3; Neil wins 10; rest halved.
    const o = zeros();
    const n = zeros();
    o[0] = o[1] = o[2] = -1;
    n[9] = -1;
    const r = round("match", 30);
    const names = { [O]: "Oisin", [N]: "Neil" };
    const rs = roundSummary(r, P, entries(o, n), names);
    expect(rs.front.points).toEqual({ [O]: 10, [N]: 0 });
    expect(rs.back.points).toEqual({ [O]: 0, [N]: 10 });
    expect(rs.full.points).toEqual({ [O]: 30, [N]: 0 });
    expect(rs.full.matchLabel).toBe("Oisin wins 2 UP");
    expect(rs.points).toEqual({ [O]: 40, [N]: 10 });
  });

  it("net decides the hole; pick-up loses it", () => {
    const r = round("match", 30, { [O]: 0, [N]: 1 }); // Neil shot on SI1 = hole 1
    const e: HoleEntry = { hole: 1, scores: { [O]: { gross: 4 }, [N]: { gross: 5 } } };
    expect(holeResult(r, P, e).matchWinner).toBe("halved");
    const e2: HoleEntry = { hole: 2, scores: { [O]: { gross: null, pickedUp: true }, [N]: { gross: 7 } } };
    expect(holeResult(r, P, e2).matchWinner).toBe(N);
  });

  it("labels", () => {
    expect(matchLabel({ a: 4, b: 1 }, ["a", "b"], 16, 18)).toBe("a won 3&2");
    expect(matchLabel({ a: 3, b: 1 }, ["a", "b"], 16, 18)).toBe("a 2 UP (dormie) thru 16");
    expect(matchLabel({ a: 2, b: 2 }, ["a", "b"], 10, 18)).toBe("All square thru 10");
    expect(matchLabel({ a: 2, b: 2 }, ["a", "b"], 18, 18)).toBe("Halved");
  });
});

describe("tournament", () => {
  const cfg: TournamentConfig = {
    players: P,
    ctpPoints: 10,
    ldPoints: 10,
    girPoints: 20,
    rounds: [
      { ...round("stableford", 20), id: "r1" },
      { ...round("stroke", 20), id: "r2" },
      { ...round("match", 30), id: "r3" },
    ],
  };

  it("total available", () => {
    expect(totalPointsAvailable(cfg)).toBe(40 + 40 + 50 + 40);
  });

  it("the real October Special totals 360", () => {
    const mk = (id: string, f: Format, full: number) => ({ ...round(f, full), id });
    const real: TournamentConfig = {
      ...cfg,
      rounds: [
        mk("1", "stableford", 20),
        mk("2", "stableford", 20),
        mk("3", "stroke", 20),
        mk("4", "stableford", 20),
        mk("5", "match", 30),
        mk("6", "match", 30),
        mk("7", "stroke", 40),
      ],
    };
    expect(totalPointsAvailable(real)).toBe(360);
  });

  it("side games are provisional until the end, then awarded", () => {
    const withSides = (e: HoleEntry[]) =>
      e.map((h) => ({
        ...h,
        ctpWinner: PARS[h.hole - 1] === 3 ? (h.hole === 3 ? N : O) : undefined,
        ldWinner: PARS[h.hole - 1] === 5 ? (h.hole === 5 ? null : N) : undefined,
        scores: {
          [O]: { ...h.scores[O], gir: true },
          [N]: { ...h.scores[N], gir: h.hole % 2 === 0 },
        },
      }));
    const e = withSides(entries(zeros(), zeros()));

    // Only round 1 played
    const partial = tournamentSummary(cfg, { r1: e });
    expect(partial.complete).toBe(false);
    // par 3s: holes 3 (N), 7 (O), 12 (O), 16 (O)
    expect(partial.ctp.counts).toEqual({ [O]: 3, [N]: 1 });
    expect(partial.ctp.points).toEqual({ [O]: 0, [N]: 0 });
    expect(partial.ctp.projectedPoints).toEqual({ [O]: 10, [N]: 0 });
    // par 5s: 5 (nobody), 9, 14, 18 (N)
    expect(partial.ld.counts).toEqual({ [O]: 0, [N]: 3 });
    expect(partial.gir.counts).toEqual({ [O]: 18, [N]: 9 });

    // All rounds played, identical cards -> every nine/18 halved
    const full = tournamentSummary(cfg, { r1: e, r2: e, r3: e });
    expect(full.complete).toBe(true);
    expect(full.ctp.points).toEqual({ [O]: 10, [N]: 0 });
    expect(full.ld.points).toEqual({ [O]: 0, [N]: 10 });
    expect(full.gir.points).toEqual({ [O]: 20, [N]: 0 });
    // match points: each round halved everywhere -> half of 40+40+50
    expect(full.matchPoints).toEqual({ [O]: 65, [N]: 65 });
    expect(full.totalPoints).toEqual({ [O]: 95, [N]: 75 });
    expect(full.pointsRemaining).toBe(0);
    expect(full.totalPoints[O] + full.totalPoints[N]).toBe(totalPointsAvailable(cfg));
  });

  it("tied cumulative counts split", () => {
    const e = entries(zeros(), zeros()).map((h) => ({
      ...h,
      ctpWinner: h.hole === 3 ? O : h.hole === 7 ? N : undefined,
    }));
    const s = tournamentSummary(cfg, { r1: e, r2: entries(zeros(), zeros()), r3: entries(zeros(), zeros()) });
    expect(s.ctp.points).toEqual({ [O]: 5, [N]: 5 });
  });

  it("counts eagles separately from birdies (gross)", () => {
    const o = zeros();
    o[4] = -2; // eagle on par 5
    o[5] = -1;
    const rs = roundSummary(round("stableford", 20, { [O]: 10, [N]: 0 }), P, entries(o, zeros()));
    expect(rs.eagles[O]).toBe(1);
    expect(rs.birdies[O]).toBe(1);
  });
});
