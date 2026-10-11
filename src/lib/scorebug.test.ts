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
    expect(before.match!.big).toBe("2 UP");
    expect(before.match!.small).toBe("thru 5");
    expect(before.match!.sides.map((x) => [x.name, x.lead])).toEqual([
      ["Oisin", true],
      ["Neil", false],
    ]);
    // Neil gets 2 shots: on SI 1 and 2 only, so none on hole 6
    expect(before.match!.sides[1].dots).toBe(0);
    expect(scoreBug(s, { round: 1, hole: 2 })!.match!.sides[1].dots).toBe(1);
    const after = scoreBug(s, { round: 1, hole: 6, after: true, playerIds: ["oisin"] })!;
    expect(after.thru).toBe(6);
    expect(after.match!.big).toBe("3 UP");
    expect(after.flash).toBe("BIRDIE");
    // Neil's clip on the same hole: no birdie for him, and he lost the hole
    expect(scoreBug(s, { round: 1, hole: 6, after: true, playerIds: ["neil"] })!.flash).toBeUndefined();
  });

  it("match play: all square, dormie and decided", () => {
    const r = round(1, "match");
    const sq = [entry("r1", 1, 4, 5), entry("r1", 2, 5, 4)];
    expect(scoreBug({ tournament, players, rounds: [r], entries: sq }, { round: 1, hole: 3 })!.status).toBe("ALL SQUARE");
    // Oisin wins every hole: the match was over on the 10th, 10&8
    const won = Array.from({ length: 15 }, (_, i) => entry("r1", i + 1, 3, 6));
    const b = scoreBug({ tournament, players, rounds: [r], entries: won }, { round: 1, hole: 16 })!;
    expect(b.status).toBe("MATCH WON 10&8");
    expect(b.match!.big).toBe("10&8");
    // 3 up with 3 to play
    const dormie = [...Array.from({ length: 3 }, (_, i) => entry("r1", i + 1, 3, 6)), ...Array.from({ length: 12 }, (_, i) => entry("r1", i + 4, 4, 4))];
    expect(scoreBug({ tournament, players, rounds: [r], entries: dormie }, { round: 1, hole: 16 })!.status).toBe("DORMIE");
  });

  it("stroke play shows net to par, leader first; stableford shows points", () => {
    const r = round(1, "stroke", { neil: 18 });
    const e = [entry("r1", 1, 4, 5), entry("r1", 2, 5, 5), entry("r1", 3, 2, 4)];
    const b = scoreBug({ tournament, players, rounds: [r], entries: e }, { round: 1, hole: 4 })!;
    // Oisin: 0, +1, -1 = E. Neil gets a shot everywhere: 4,4,3 net = 0, 0, 0 = E
    expect(b.mode).toBe("field");
    expect(b.rows.map((x) => x.value)).toEqual(["E", "E"]);
    expect(b.rows.every((x) => x.lead && x.pos === "T1")).toBe(true);
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

  it("mini leaderboard: top five, the player on camera added when outside it, other groups as of the clip", () => {
    const six = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => ({ id, name: id.toUpperCase(), sort: i, handicap: 0, team_id: null })) as PlayerRow[];
    const games = [
      { id: "g1", sides: [{ id: "a", playerIds: ["a"] }, { id: "b", playerIds: ["b"] }, { id: "c", playerIds: ["c"] }, { id: "d", playerIds: ["d"] }] },
      { id: "g2", sides: [{ id: "e", playerIds: ["e"] }, { id: "f", playerIds: ["f"] }, { id: "g", playerIds: ["g"] }] },
    ];
    const r = { ...round(1, "stableford"), games } as unknown as RoundRow;
    const row = (g: string, hole: number, sc: Record<string, number>, at: string) =>
      ({ id: `${g}-${hole}`, round_id: "r1", game: g, hole, scores: Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, { gross: v }])), ctp_winner: null, ld_winner: null, updated_at: at }) as unknown as HoleEntryRow;
    // g1 plays holes 1-2: a birdies both, b-d par; g2 hole 1: e and f par, g bogeys, then g2's hole 2 is entered later
    const e = [
      row("g1", 1, { a: 3, b: 4, c: 4, d: 4 }, "2026-10-01T10:00:00Z"),
      row("g1", 2, { a: 3, b: 4, c: 4, d: 4 }, "2026-10-01T10:30:00Z"),
      row("g2", 1, { e: 4, f: 4, g: 6 }, "2026-10-01T10:05:00Z"),
      row("g2", 2, { e: 2, f: 4, g: 6 }, "2026-10-01T10:10:00Z"),
    ];
    const s = { tournament, players: six, rounds: [r], entries: e };
    const b = scoreBug(s, { round: 1, hole: 3, playerIds: ["g"], at: "2026-10-01T10:15:00Z" })!;
    expect(b.mode).toBe("field");
    // The other group's 2nd hole was entered after the clip was posted: not counted yet
    expect(b.rows.map((x) => `${x.pos} ${x.name} ${x.value}${x.gap ? " (gap)" : ""}${x.onCamera ? " *" : ""}`)).toEqual([
      "1 E 6 pts",
      "2 F 4 pts",
      "3 A 3 pts",
      "T4 B 2 pts",
      "T4 C 2 pts",
      "7 G 0 pts (gap) *",
    ]);
  });

  it("eagle and hole-in-one flashes", () => {
    const r = round(1, "stableford");
    const ace = { tournament, players, rounds: [r], entries: [entry("r1", 1, 4, 4), entry("r1", 2, 4, 4), entry("r1", 3, 1, 3)] };
    expect(scoreBug(ace, { round: 1, hole: 3, after: true, playerIds: ["oisin"] })!.flash).toBe("HOLE IN ONE");
    const eagle = { tournament, players, rounds: [r], entries: [...ace.entries.slice(0, 3), entry("r1", 4, 5, 3)] };
    expect(scoreBug(eagle, { round: 1, hole: 4, after: true })!.flash).toBe("EAGLE");
  });
});
