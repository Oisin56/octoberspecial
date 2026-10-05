import { describe, expect, it } from "vitest";
import { scoreBug } from "./scorebug";
import type { HoleEntryRow, PlayerRow, RoundRow, TournamentRow } from "./types";

const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const holes = PAR.map((par, i) => ({ number: i + 1, par, si: i + 1, yards: 300 + i }));
const players = [
  { id: "oisin", name: "Oisin", sort: 0, handicap: 10, team_id: null },
  { id: "neil", name: "Neil", sort: 1, handicap: 12, team_id: null },
] as PlayerRow[];
const tournament = { name: "Test", teams: [], side_games: [], side_games_by: "player" } as unknown as TournamentRow;

const round = (n: number, format: RoundRow["format"], shots: Record<string, number> = {}): RoundRow =>
  ({
    id: `r${n}`,
    number: n,
    course_name: `Course ${n}`,
    holes,
    format,
    play: "singles",
    nine_points: 10,
    full_points: 20,
    shots,
    status: "live",
    games: null,
    points_rule: null,
    handicap_rule: null,
  }) as unknown as RoundRow;

const entry = (r: string, hole: number, o: number, n: number): HoleEntryRow =>
  ({ id: `${r}-${hole}`, round_id: r, game: "main", hole, scores: { oisin: { gross: o }, neil: { gross: n } }, ctp_winner: null, ld_winner: null }) as unknown as HoleEntryRow;

describe("score bug", () => {
  it("match play: state before the hole, then after with the flash", () => {
    const r = round(1, "match", { neil: 2 });
    // Oisin wins 1 and 2 (even after Neil's shots), holes 3-5 halved; hole 6 Oisin birdies (3 on a par 4)
    const e = [entry("r1", 1, 4, 6), entry("r1", 2, 4, 6), entry("r1", 3, 3, 3), entry("r1", 4, 5, 5), entry("r1", 5, 4, 4), entry("r1", 6, 3, 5)];
    const s = { tournament, players, rounds: [r], entries: e };
    const before = scoreBug(s, { round: 1, hole: 6, playerIds: ["oisin"] })!;
    expect(before.mode).toBe("match");
    expect(before.thru).toBe(5);
    expect(before.par).toBe(4);
    expect(before.yards).toBe(305);
    expect(before.rows.map((x) => [x.name, x.value, x.lead])).toEqual([
      ["Oisin", "2 UP", true],
      ["Neil", "", false],
    ]);
    // Neil gets 2 shots: on SI 1 and 2 only, so none on hole 6
    expect(before.rows[1].dots).toBe(0);
    expect(scoreBug(s, { round: 1, hole: 2 })!.rows[1].dots).toBe(1);
    const after = scoreBug(s, { round: 1, hole: 6, after: true, playerIds: ["oisin"] })!;
    expect(after.thru).toBe(6);
    expect(after.rows[0].value).toBe("3 UP");
    expect(after.flash).toBe("BIRDIE");
    // Neil's clip on the same hole: no birdie for him, and he lost the hole
    expect(scoreBug(s, { round: 1, hole: 6, after: true, playerIds: ["neil"] })!.flash).toBeUndefined();
  });

  it("match play: all square, dormie and decided", () => {
    const r = round(1, "match");
    const sq = [entry("r1", 1, 4, 5), entry("r1", 2, 5, 4)];
    expect(scoreBug({ tournament, players, rounds: [r], entries: sq }, { round: 1, hole: 3 })!.status).toBe("ALL SQUARE");
    // Oisin wins 1-15: won 15&3 before hole 16 (he can't be caught)
    const won = Array.from({ length: 15 }, (_, i) => entry("r1", i + 1, 3, 6));
    const b = scoreBug({ tournament, players, rounds: [r], entries: won }, { round: 1, hole: 16 })!;
    expect(b.status).toBe("MATCH WON 15&3");
    expect(b.rows[0].value).toBe("15&3");
    // 3 up with 3 to play
    const dormie = [...Array.from({ length: 3 }, (_, i) => entry("r1", i + 1, 3, 6)), ...Array.from({ length: 12 }, (_, i) => entry("r1", i + 4, 4, 4))];
    expect(scoreBug({ tournament, players, rounds: [r], entries: dormie }, { round: 1, hole: 16 })!.status).toBe("DORMIE");
  });

  it("stroke play shows net to par, leader first; stableford shows points", () => {
    const r = round(1, "stroke", { neil: 18 });
    const e = [entry("r1", 1, 4, 5), entry("r1", 2, 5, 5), entry("r1", 3, 2, 4)];
    const b = scoreBug({ tournament, players, rounds: [r], entries: e }, { round: 1, hole: 4 })!;
    // Oisin: 0, +1, -1 = E. Neil gets a shot everywhere: 4,4,3 net = 0, 0, 0 = E
    expect(b.rows.map((x) => x.value)).toEqual(["E", "E"]);
    expect(b.rows.every((x) => x.lead)).toBe(true);
    expect(b.rows.find((x) => x.name === "Neil")!.dots).toBe(1);
    const sf = round(1, "stableford");
    const b2 = scoreBug({ tournament, players, rounds: [sf], entries: e }, { round: 1, hole: 4 })!;
    // Oisin 2+1+3 = 6; Neil 1+1+1 = 3
    expect(b2.rows.map((x) => [x.name, x.value])).toEqual([
      ["Oisin", "6 pts"],
      ["Neil", "3 pts"],
    ]);
  });

  it("shows hole details only when an earlier hole is missing", () => {
    const r = round(1, "match");
    const b = scoreBug({ tournament, players, rounds: [r], entries: [entry("r1", 1, 4, 4), entry("r1", 3, 4, 4)] }, { round: 1, hole: 4 })!;
    expect(b.mode).toBe("none");
    expect(b.rows).toEqual([]);
    expect(b.par).toBe(5);
    // after-mode needs this hole entered
    expect(scoreBug({ tournament, players, rounds: [r], entries: [entry("r1", 1, 4, 4)] }, { round: 1, hole: 2, after: true })!.mode).toBe("none");
  });

  it("overall footer counts banked points as of the clip", () => {
    const r1 = round(1, "stableford");
    const r2 = round(2, "match");
    const full1 = Array.from({ length: 18 }, (_, i) => entry("r1", i + 1, PAR[i] - 1, PAR[i] + 1)); // Oisin wins all 3 segments: 40-0
    const front2 = Array.from({ length: 9 }, (_, i) => entry("r2", i + 1, PAR[i] + 1, PAR[i])); // Neil wins front 9 of R2
    const s = { tournament, players, rounds: [r1, r2], entries: [...full1, ...front2] };
    expect(scoreBug(s, { round: 2, hole: 9 })!.footer).toBe("Oisin 40 · Neil 0");
    expect(scoreBug(s, { round: 2, hole: 9, after: true })!.footer).toBe("Oisin 40 · Neil 10");
    // Clip from round 1 doesn't see round 2
    expect(scoreBug(s, { round: 1, hole: 18 })!.footer).toBe("Oisin 10 · Neil 0") // front nine already banked;
    expect(scoreBug(s, { round: 1, hole: 18, after: true })!.footer).toBe("Oisin 40 · Neil 0");
  });

  it("eagle and hole-in-one flashes", () => {
    const r = round(1, "stableford");
    const ace = { tournament, players, rounds: [r], entries: [entry("r1", 1, 4, 4), entry("r1", 2, 4, 4), entry("r1", 3, 1, 3)] };
    expect(scoreBug(ace, { round: 1, hole: 3, after: true, playerIds: ["oisin"] })!.flash).toBe("HOLE IN ONE");
    const eagle = { tournament, players, rounds: [r], entries: [...ace.entries.slice(0, 3), entry("r1", 4, 5, 3)] };
    expect(scoreBug(eagle, { round: 1, hole: 4, after: true })!.flash).toBe("EAGLE");
  });
});
