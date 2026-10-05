import { describe, it, expect } from "vitest";
import * as old from "./scoring";
import {
  tournamentSummary,
  roundSummary,
  gameShots,
  oneBallHandicap,
  gameSummary,
  type RoundCfg,
  type TournamentCfg,
  type HoleEntry,
  type Player,
  type Game,
  type PlayType,
  type ScoringType,
} from "./engine";

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
const SIS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const holes = PARS.map((par, i) => ({ number: i + 1, par, si: SIS[i] }));

// Deterministic RNG
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// ------------------------------------------------------------ regression vs the October Special engine

describe("regression: new engine == October Special engine", () => {
  const FORMATS: old.Format[] = ["stableford", "stableford", "stroke", "stableford", "match", "match", "stroke"];
  const FULL = [20, 20, 20, 20, 30, 30, 40];

  for (let seed = 1; seed <= 500; seed++) {
    it(`random tournament #${seed}`, () => {
      const r = rng(seed);
      const P = ["oisin", "neil"];
      const oldCfg: old.TournamentConfig = {
        players: P,
        ctpPoints: 10,
        ldPoints: 10,
        girPoints: 20,
        rounds: FORMATS.map((f, i) => ({
          id: `r${i + 1}`,
          number: i + 1,
          name: `R${i + 1}`,
          format: f,
          ninePoints: 10,
          fullPoints: FULL[i],
          shots: { oisin: Math.floor(r() * 6), neil: Math.floor(r() * 24) },
          holes,
        })),
      };
      const oldEntries: Record<string, old.HoleEntry[]> = {};
      const newEntries: Record<string, HoleEntry[]> = {};
      for (const rc of oldCfg.rounds) {
        // Some rounds unplayed, some partial, most complete
        const played = r() < 0.15 ? 0 : r() < 0.25 ? Math.floor(r() * 18) : 18;
        const es: old.HoleEntry[] = [];
        for (let h = 1; h <= played; h++) {
          const par = PARS[h - 1];
          const sc = (): old.PlayerHole => {
            const pu = rc.format !== "stroke" && r() < 0.06;
            return pu
              ? { gross: null, pickedUp: true, gir: false }
              : { gross: Math.max(1, par + Math.floor(r() * 5) - 1 - (r() < 0.05 ? 1 : 0)), gir: r() < 0.4 };
          };
          const pick = () => (r() < 0.4 ? "oisin" : r() < 0.7 ? "neil" : null);
          es.push({
            hole: h,
            scores: { oisin: sc(), neil: sc() },
            ctpWinner: par === 3 ? pick() : null,
            ldWinner: par === 5 ? pick() : null,
          });
        }
        oldEntries[rc.id] = es;
        newEntries[rc.id] = es.map((e) => ({ ...e, game: "main" }));
      }

      const newCfg: TournamentCfg = {
        players: P.map((id) => ({ id, name: id })),
        teams: [],
        sideGamesBy: "player",
        sideGames: [
          { kind: "ctp", points: 10, enabled: true },
          { kind: "ld", points: 10, enabled: true },
          { kind: "gir", points: 20, enabled: true },
          { kind: "birdies", points: 0, enabled: true },
          { kind: "eagles", points: 0, enabled: true },
        ],
        rounds: oldCfg.rounds.map((rc) => ({
          id: rc.id,
          number: rc.number,
          name: rc.name,
          holes,
          play: "singles",
          scoring: rc.format,
          games: [{ id: "main", sides: P.map((p) => ({ id: p, playerIds: [p] })) }],
          points: { front: 10, back: 10, full: rc.fullPoints },
          handicap: { mode: "manual", shots: rc.shots },
        })),
      };

      const a = old.tournamentSummary(oldCfg, oldEntries);
      const b = tournamentSummary(newCfg, newEntries);

      a.rounds.forEach((ra, i) => {
        const rb = b.rounds[i];
        const g = rb.games[0];
        for (const seg of ["front", "back", "full"] as const) {
          expect(g[seg].value, `R${i + 1} ${seg} value`).toEqual(ra[seg].value);
          expect(g[seg].points, `R${i + 1} ${seg} points`).toEqual(ra[seg].points);
          expect(g[seg].complete).toBe(ra[seg].complete);
          expect([...g[seg].leaders].sort()).toEqual([...ra[seg].leaders].sort());
          if (ra[seg].matchLabel) expect(g[seg].matchLabel).toBe(ra[seg].matchLabel);
        }
        expect(rb.playerPoints).toEqual(ra.points);
        expect(rb.tallies.birdies).toEqual(ra.birdies);
        expect(rb.tallies.eagles).toEqual(ra.eagles);
        expect(rb.tallies.gir).toEqual(ra.gir);
        expect(rb.tallies.ctp).toEqual(ra.ctp);
        expect(rb.tallies.ld).toEqual(ra.ld);
        expect(rb.complete).toBe(ra.complete);
      });
      expect(b.playerRoundPoints).toEqual(a.matchPoints);
      expect(b.playerTotal).toEqual(a.totalPoints);
      expect(b.playerProjected).toEqual(a.projectedTotal);
      expect(b.pointsRemaining).toBe(a.pointsRemaining);
      expect(b.pointsAvailable).toBe(360);
      expect(b.complete).toBe(a.complete);
      const award = (k: string) => b.awards.find((x) => x.kind === k)!;
      expect(award("ctp").points).toEqual(a.ctp.points);
      expect(award("gir").projected).toEqual(a.gir.projectedPoints);
    });
  }
});

// ------------------------------------------------------------ helpers for format tests

const players: Player[] = [
  { id: "a", name: "Aoife", handicap: 4, teamId: "red" },
  { id: "b", name: "Brian", handicap: 18, teamId: "red" },
  { id: "c", name: "Ciara", handicap: 10, teamId: "blue" },
  { id: "d", name: "Dara", handicap: 24, teamId: "blue" },
];

function round(play: PlayType, scoring: ScoringType, games: Game[], extra: Partial<RoundCfg> = {}): RoundCfg {
  return {
    id: "r",
    number: 1,
    name: "Test",
    holes,
    play,
    scoring,
    games,
    points: { front: 0, back: 0, full: 1 },
    handicap: { mode: "manual", shots: {} },
    ...extra,
  };
}

/** entries where each ball's score = par + delta[ball][hole-1] */
function entries(game: string, deltas: Record<string, number[]>): HoleEntry[] {
  return holes.map((h, i) => ({
    game,
    hole: h.number,
    scores: Object.fromEntries(Object.entries(deltas).map(([b, d]) => [b, { gross: h.par + d[i] }])),
  }));
}
const flat = (v: number) => Array(18).fill(v);

const pairs: Game = {
  id: "g1",
  sides: [
    { id: "AB", playerIds: ["a", "b"], teamId: "red" },
    { id: "CD", playerIds: ["c", "d"], teamId: "blue" },
  ],
};

// ------------------------------------------------------------ format tests

describe("handicap allowances", () => {
  it("own ball, 90% off the low (fourball match play)", () => {
    const r = round("fourball", "match", [pairs], { handicap: { mode: "allowance", pct: 90, relative: true } });
    // 90%: 3.6->4, 16.2->16, 9->9, 21.6->22; minus low 4
    expect(gameShots(r, pairs, players)).toEqual({ a: 0, b: 12, c: 5, d: 18 });
  });
  it("foursomes 50% of combined, off the low side", () => {
    const r = round("foursomes", "match", [pairs], { handicap: { mode: "allowance", pct: 50, relative: true } });
    // AB: 11, CD: 17 -> AB 0, CD 6
    expect(gameShots(r, pairs, players)).toEqual({ AB: 0, CD: 6 });
  });
  it("greensomes 60/40 and scramble 35/15", () => {
    expect(oneBallHandicap("greensomes", [4, 18], 100)).toBeCloseTo(0.6 * 4 + 0.4 * 18);
    expect(oneBallHandicap("scramble", [18, 4], 100)).toBeCloseTo(0.35 * 4 + 0.15 * 18);
    expect(oneBallHandicap("scramble", [4, 10, 18, 24], 100)).toBeCloseTo(1 + 2 + 2.7 + 2.4);
  });
  it("full handicap, not relative (stableford)", () => {
    const g: Game = { id: "f", sides: players.map((p) => ({ id: p.id, playerIds: [p.id] })) };
    const r = round("singles", "stableford", [g], { handicap: { mode: "allowance", pct: 95, relative: false } });
    expect(gameShots(r, g, players)).toEqual({ a: 4, b: 17, c: 10, d: 23 });
  });
});

describe("fourball (better ball)", () => {
  it("best ball counts; side wins match", () => {
    // Flat shots. A pars everything, B bogeys; C bogeys, D birdies hole 1 only, rest double.
    const d = flat(2);
    d[0] = -1;
    const e = entries("g1", { a: flat(0), b: flat(1), c: flat(1), d });
    const r = round("fourball", "match", [pairs]);
    const gs = gameSummary(r, pairs, players, e);
    // Hole 1: CD best -1 beats AB 0. Others AB par beats CD bogey. AB wins 17 holes.
    expect(gs.full.value).toEqual({ AB: 17, CD: 1 });
    expect(gs.points).toEqual({ AB: 1, CD: 0 });
    expect(gs.full.matchLabel).toBe("Aoife & Brian wins 16 UP");
  });
  it("stableford better ball takes the best points per hole", () => {
    const r = round("fourball", "stableford", [pairs], { points: { front: 0, back: 0, full: 2 } });
    const e = entries("g1", { a: flat(0), b: flat(-1), c: flat(1), d: flat(1) });
    const gs = gameSummary(r, pairs, players, e);
    expect(gs.full.value).toEqual({ AB: 54, CD: 18 });
  });
  it("partner can pick up; side still complete", () => {
    const r = round("fourball", "stroke", [pairs]);
    const e = entries("g1", { a: flat(0), b: flat(0), c: flat(0), d: flat(0) });
    e[0].scores.b = { gross: null, pickedUp: true };
    const gs = gameSummary(r, pairs, players, e);
    expect(gs.full.complete).toBe(true);
    expect(gs.full.value.AB).toBe(72);
  });
});

describe("one-ball formats", () => {
  it("foursomes: one score per side, side handicap applied", () => {
    const r = round("foursomes", "stroke", [pairs], {
      handicap: { mode: "allowance", pct: 50, relative: false },
      points: { front: 1, back: 1, full: 2 },
    });
    // AB: 50% of (4+18) = 11. CD: 50% of (10+24) = 17. Both shoot 80 gross (+8 on holes 1-8).
    // Front (odd SIs): AB 6 shots, CD 9 -> AB 38, CD 35. Back: AB 5, CD 8 -> AB 31, CD 28.
    const d = flat(0);
    for (let i = 0; i < 8; i++) d[i] = 1;
    const e = entries("g1", { AB: d, CD: d });
    const gs = gameSummary(r, pairs, players, e);
    expect(gs.shots).toEqual({ AB: 11, CD: 17 });
    expect(gs.front.value).toEqual({ AB: 38, CD: 35 });
    expect(gs.back.value).toEqual({ AB: 31, CD: 28 });
    expect(gs.full.value).toEqual({ AB: 69, CD: 63 });
    expect(gs.points).toEqual({ AB: 0, CD: 4 });
  });
  it("stroke play singles: pick-up does not complete the hole", () => {
    const g: Game = { id: "s", sides: [{ id: "a", playerIds: ["a"] }, { id: "c", playerIds: ["c"] }] };
    const r = round("singles", "stroke", [g]);
    const e = entries("s", { a: flat(0), c: flat(0) });
    e[3].scores.a = { gross: null, pickedUp: true };
    expect(gameSummary(r, g, players, e).full.complete).toBe(false);
  });
});

describe("skins", () => {
  it("carry-overs go to the next outright winner", () => {
    const g: Game = { id: "s", sides: ["a", "b", "c"].map((p) => ({ id: p, playerIds: [p] })) };
    const r = round("singles", "skins", [g], { points: { front: 0, back: 0, full: 0, skin: 2 } });
    const a = flat(0), b = flat(0), c = flat(0);
    // H1, H2 tied (carry 2), H3 b wins (3 skins). H4 a wins (1). Rest tied -> unclaimed.
    b[2] = -1;
    a[3] = -1;
    const gs = gameSummary(r, g, players, entries("s", { a, b, c }));
    expect(gs.full.value).toEqual({ a: 1, b: 3, c: 0 });
    expect(gs.points).toEqual({ a: 2, b: 6, c: 0 });
  });
});

describe("field / society day", () => {
  it("positions table, ties share the pooled points", () => {
    const g: Game = { id: "f", sides: players.map((p) => ({ id: p.id, playerIds: [p.id] })) };
    const r = round("singles", "stableford", [g], { points: { front: 0, back: 0, full: 0, positions: [10, 6, 3, 1] } });
    // a 36, b 36, c 18, d 0
    const gs = gameSummary(r, g, players, entries("f", { a: flat(0), b: flat(0), c: flat(1), d: flat(3) }));
    expect(gs.full.ranking.map((x) => [x.sideId, x.pos])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
      ["d", 4],
    ]);
    expect(gs.points).toEqual({ a: 8, b: 8, c: 3, d: 1 });
  });
});

describe("team event (Ryder Cup style)", () => {
  const singlesGames: Game[] = [
    { id: "m1", sides: [{ id: "a", playerIds: ["a"], teamId: "red" }, { id: "c", playerIds: ["c"], teamId: "blue" }] },
    { id: "m2", sides: [{ id: "b", playerIds: ["b"], teamId: "red" }, { id: "d", playerIds: ["d"], teamId: "blue" }] },
  ];
  const cfg: TournamentCfg = {
    players,
    teams: [
      { id: "red", name: "Red" },
      { id: "blue", name: "Blue" },
    ],
    sideGamesBy: "team",
    sideGames: [{ kind: "ctp", points: 1, enabled: true }],
    rounds: [
      { ...round("fourball", "match", [pairs]), id: "fb" },
      { ...round("singles", "match", singlesGames), id: "sg" },
    ],
  };
  it("1 point per match, ½ for a half, team totals", () => {
    const fb = entries("g1", { a: flat(0), b: flat(1), c: flat(1), d: flat(1) }); // AB wins
    const m1 = entries("m1", { a: flat(0), c: flat(0) }); // halved
    const m2 = entries("m2", { b: flat(1), d: flat(0) }); // d wins
    m2.forEach((e) => {
      if (e.hole === 3) e.ctpWinner = "d";
    });
    const s = tournamentSummary(cfg, { fb, sg: [...m1, ...m2] });
    expect(s.teamRoundPoints).toEqual({ red: 1.5, blue: 1.5 });
    expect(s.complete).toBe(true);
    expect(s.awards[0].counts).toEqual({ red: 0, blue: 1 });
    expect(s.teamTotal).toEqual({ red: 1.5, blue: 2.5 });
    expect(s.pointsAvailable).toBe(1 + 2 + 1);
    // Individual records: each player in the winning pair gets the point
    expect(s.playerRoundPoints).toEqual({ a: 1.5, b: 1, c: 0.5, d: 1 });
  });
  it("round summary while live", () => {
    const m1 = entries("m1", { a: flat(0), c: flat(1) }).slice(0, 5);
    const rs = roundSummary(cfg.rounds[1], players, cfg.teams, m1);
    expect(rs.games[0].full.matchLabel).toBe("Aoife 5 UP thru 5");
    expect(rs.games[0].points).toEqual({ a: 0, c: 0 }); // not decided until complete
    expect(rs.complete).toBe(false);
  });
});
