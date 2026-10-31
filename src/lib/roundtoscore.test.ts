import { describe, expect, it } from "vitest";
import { roundToScore } from "./scorecards";
import type { TournamentState } from "./types";

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, si: i + 1 }));
const game = { id: "g1", sides: [{ id: "o", playerIds: ["o"] }, { id: "n", playerIds: ["n"] }] };
const round = (n: number, status: string) => ({ id: `r${n}`, number: n, status, holes, hole_set: "all", play: "singles", format: "stroke", games: [game], points_rule: { front: 0, back: 0, full: 0 }, course_name: `Course ${n}` });
const base = (cards: { round_id: string; game: string; status: string }[], r1 = "live") =>
  ({
    tournament: { require_attestation: false },
    players: [{ id: "o", name: "Oisin", handicap: 10 }, { id: "n", name: "Neil", handicap: 12 }],
    rounds: [round(1, r1), round(2, "upcoming")],
    entries: [],
    cards,
    signatures: [],
  }) as unknown as TournamentState;

describe("which round Score opens", () => {
  it("round 1 while its card is still being played", () => {
    expect(roundToScore(base([]), { playerId: "o" })?.number).toBe(1);
  });
  it("my card handed in: round 2, even before round 1 is marked finished", () => {
    expect(roundToScore(base([{ round_id: "r1", game: "g1", status: "submitted" }]), { playerId: "o" })?.number).toBe(2);
    expect(roundToScore(base([{ round_id: "r1", game: "g1", status: "final" }]), { playerId: "o" })?.number).toBe(2);
  });
  it("round 1 finished: round 2", () => {
    expect(roundToScore(base([], "complete"), { playerId: "o" })?.number).toBe(2);
  });
});
