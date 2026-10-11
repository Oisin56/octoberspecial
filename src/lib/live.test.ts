import { describe, expect, it } from "vitest";
import { tournamentSummary } from "./engine";
import { fieldPosition, liveLine, roundBoard, standings } from "./live";
import { toEntries, toTournamentCfg, type CardRow, type HoleEntryRow, type PlayerRow, type RoundRow, type TournamentRow, type TournamentState } from "./types";

const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const holes = PAR.map((par, i) => ({ number: i + 1, par, si: i + 1 }));
const P = (id: string, name: string, sort: number) => ({ id, name, sort, handicap: 0, team_id: null }) as unknown as PlayerRow;
const tournament = { name: "Test", teams: [], side_games: [], side_games_by: "player" } as unknown as TournamentRow;

const round = (n: number, format: RoundRow["format"], status: RoundRow["status"] = "live", games: unknown = null): RoundRow =>
  ({ id: `r${n}`, number: n, course_name: `Course ${n}`, holes, format, play: "singles", nine_points: 10, full_points: 20, shots: {}, status, games, points_rule: null, handicap_rule: null }) as unknown as RoundRow;
const entry = (r: string, hole: number, scores: Record<string, number>, game = "main"): HoleEntryRow =>
  ({ id: `${r}-${game}-${hole}`, round_id: r, game, hole, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { gross: v }])), ctp_winner: null, ld_winner: null }) as unknown as HoleEntryRow;

function state(rounds: RoundRow[], entries: HoleEntryRow[], players = [P("oisin", "Oisin", 0), P("neil", "Neil", 1)], cards: CardRow[] = []): TournamentState {
  return { tournament, players, rounds, entries, attestations: [], posts: [], comments: [], pieces: [], votes: [], cards, signatures: [] } as unknown as TournamentState;
}
const sum = (s: TournamentState) => tournamentSummary(toTournamentCfg(s), toEntries(s.entries));

describe("live match state", () => {
  it("2 UP thru 11, and the line for the strip", () => {
    const e = Array.from({ length: 11 }, (_, i) => entry("r1", i + 1, { oisin: PAR[i] - (i < 2 ? 1 : 0), neil: PAR[i] }));
    const s = state([round(1, "match")], e);
    const b = roundBoard(s, sum(s), s.rounds[0]);
    expect(b.kind).toBe("match");
    expect(b.matches[0].big).toBe("2 UP");
    expect(b.matches[0].small).toBe("thru 11");
    expect(liveLine(b)).toBe("Oisin 2 UP thru 11");
  });

  it("dormie, then won 4&3", () => {
    const four = Array.from({ length: 14 }, (_, i) => entry("r1", i + 1, { oisin: PAR[i] - (i < 4 ? 1 : 0), neil: PAR[i] }));
    let s = state([round(1, "match")], four);
    expect(roundBoard(s, sum(s), s.rounds[0]).matches[0].small).toBe("Dormie, thru 14");
    s = state([round(1, "match")], [...four, entry("r1", 15, { oisin: 4, neil: 4 })]);
    const m = roundBoard(s, sum(s), s.rounds[0]).matches[0];
    expect(m.big).toBe("4&3");
    expect(m.over).toBe(true);
  });
});

describe("field leaderboard", () => {
  const four = [P("a", "Ann", 0), P("b", "Bob", 1), P("c", "Cal", 2), P("d", "Dee", 3)];
  const games = [
    { id: "g1", sides: [{ id: "a", playerIds: ["a"] }, { id: "b", playerIds: ["b"] }] },
    { id: "g2", sides: [{ id: "c", playerIds: ["c"] }, { id: "d", playerIds: ["d"] }] },
  ];
  it("ranks every group together, to par in stroke play", () => {
    const e = [
      ...[1, 2, 3].map((h) => entry("r1", h, { a: PAR[h - 1] - 1, b: PAR[h - 1] }, "g1")),
      ...[1, 2].map((h) => entry("r1", h, { c: PAR[h - 1], d: PAR[h - 1] + 1 }, "g2")),
    ];
    const s = state([round(1, "stroke", "live", games)], e, four);
    const b = roundBoard(s, sum(s), s.rounds[0]);
    expect(b.kind).toBe("field");
    expect(b.field.map((r) => `${r.pos} ${r.name} ${r.score} ${r.thru}`)).toEqual(["1 Ann −3 3", "T2 Bob E 3", "T2 Cal E 2", "4 Dee +2 2"]);
    expect(fieldPosition(b, "d")).toBe("4th, 5 behind Ann");
    expect(fieldPosition(b, "a")).toBe("1st, −3 thru 3");
  });
});

describe("banked and projected", () => {
  it("live leaders count as projected, not banked; final cards bank", () => {
    // R1 finished, Oisin won everything (40), card final. R2 match live: Neil 1 up thru 5.
    const r1 = round(1, "stableford", "live");
    const r2 = round(2, "match");
    const e = [
      ...Array.from({ length: 18 }, (_, i) => entry("r1", i + 1, { oisin: PAR[i] - 1, neil: PAR[i] + 1 })),
      ...Array.from({ length: 5 }, (_, i) => entry("r2", i + 1, { oisin: PAR[i] + (i === 0 ? 1 : 0), neil: PAR[i] })),
    ];
    const final = { round_id: "r1", game: "main", status: "final" } as CardRow;
    let s = state([r1, r2], e, undefined, [final]);
    let st = standings(s, sum(s), false);
    expect(st.banked).toEqual({ oisin: 40, neil: 0 });
    expect(st.projected).toEqual({ oisin: 40, neil: 30 }); // Neil leads the front nine (10) and the match (20)
    expect(st.moving).toBe(true);

    // Same, but R1's card not submitted: its 40 is provisional
    s = state([r1, r2], e);
    st = standings(s, sum(s), false);
    expect(st.banked).toEqual({ oisin: 0, neil: 0 });
    expect(st.projected).toEqual({ oisin: 40, neil: 30 });
  });

  it("a tied segment splits its projected points", () => {
    const e = Array.from({ length: 3 }, (_, i) => entry("r1", i + 1, { oisin: PAR[i], neil: PAR[i] }));
    const s = state([round(1, "match")], e);
    expect(standings(s, sum(s), false).projected).toEqual({ oisin: 15, neil: 15 }); // front 10 and match 20 split; back nine not started
  });
});
