import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./ai", () => ({ writeEndPiece: vi.fn() }));
vi.mock("./server-data", () => ({ loadServerState: vi.fn() }));
vi.mock("./admin", () => ({
  adminClient: () => {
    throw new Error("no database in unit tests");
  },
}));

import { tournamentSummary } from "./engine";
import { toEntries, toTournamentCfg, feedOpen, type HoleEntryRow, type PlayerRow, type PostRow, type RoundRow, type TournamentRow, type TournamentState } from "./types";
import { soloRounds, soloTotal } from "./solo";
import { bestMoments, filmPost, finalStandings } from "./trip";
import { autoFinishDay } from "./finish";
import { cleanBio, hasBio } from "./bios";
import { dayMonth, filmExpiry } from "./films";

const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const holes = PAR.map((par, i) => ({ number: i + 1, par, si: i + 1 }));
const P = (id: string, name: string, sort: number) => ({ id, name, sort, handicap: 0, team_id: null }) as unknown as PlayerRow;
const round = (n: number, format: RoundRow["format"], games: unknown = null, date: string | null = null): RoundRow =>
  ({ id: `r${n}`, number: n, course_name: `Course ${n}`, holes, format, play: "singles", nine_points: 10, full_points: 20, shots: {}, status: "live", games, points_rule: null, handicap_rule: null, play_date: date }) as unknown as RoundRow;
const entry = (r: string, hole: number, scores: Record<string, number>, game = "main"): HoleEntryRow =>
  ({ id: `${r}-${game}-${hole}`, round_id: r, game, hole, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { gross: v }])), ctp_winner: null, ld_winner: null }) as unknown as HoleEntryRow;
const state = (t: Partial<TournamentRow>, rounds: RoundRow[], entries: HoleEntryRow[], players: PlayerRow[], extra: Partial<TournamentState> = {}): TournamentState =>
  ({ tournament: { name: "Test", teams: [], side_games: [], side_games_by: "player", ...t }, players, rounds, entries, attestations: [], posts: [], comments: [], pieces: [], votes: [], cards: [], signatures: [], ...extra }) as unknown as TournamentState;

describe("finishing by itself", () => {
  it("a group trip finishes 3 days after its last round; on your own, the day after", () => {
    expect(autoFinishDay({ solo: false }, "2026-06-14")).toBe("2026-06-17");
    expect(autoFinishDay({ solo: true }, "2026-06-14")).toBe("2026-06-15");
    expect(autoFinishDay({ solo: false }, null)).toBeNull();
  });
  it("scoring opened again: 3 days from then, if that's later", () => {
    expect(autoFinishDay({ solo: false, reopened_at: "2026-06-20T10:00:00Z" }, "2026-06-14")).toBe("2026-06-23");
    expect(autoFinishDay({ solo: false, reopened_at: "2026-06-14T10:00:00Z" }, "2026-06-14")).toBe("2026-06-17");
  });
  it("the feed stays open until feed_until, and always before finishing", () => {
    const now = Date.parse("2026-07-01T12:00:00Z");
    expect(feedOpen({ finished_at: null, feed_until: null }, now)).toBe(true);
    expect(feedOpen({ finished_at: "2026-06-17T00:00:00Z", feed_until: "2026-07-17T00:00:00Z" }, now)).toBe(true);
    expect(feedOpen({ finished_at: "2026-06-17T00:00:00Z", feed_until: "2026-06-30T00:00:00Z" }, now)).toBe(false);
  });
});

describe("a round on your own", () => {
  const me = [P("neil", "Neil Byrne", 0)];
  const solo = (format: RoundRow["format"], n = 18) => {
    const games = [{ id: "g1", sides: [{ id: "neil", playerIds: ["neil"] }], scorerId: "neil" }];
    return state({ solo: true, win: { kind: format === "stroke" ? "stroke" : "stableford" } as TournamentRow["win"] }, [round(1, format, games)], Array.from({ length: n }, (_, i) => entry("r1", i + 1, { neil: PAR[i] + (i % 3 === 0 ? 1 : 0) }, "g1")), me);
  };
  it("stroke play: strokes and to par", () => {
    const [r] = soloRounds(solo("stroke"));
    expect(r.big).toBe("78");
    expect(r.small).toBe("+6");
    expect(r.score).toBe("78, +6");
    expect(r.played).toBe(18);
  });
  it("Stableford: points", () => {
    const [r] = soloRounds(solo("stableford"));
    expect(r.small).toBe("points");
    expect(r.score).toBe(`${r.big} points`);
    expect(Number(r.big)).toBe(30);
  });
  it("nothing in yet: no score", () => {
    const [r] = soloRounds(solo("stroke", 0));
    expect(r.score).toBe("");
  });
  it("a trip of several rounds adds them up", () => {
    expect(soloTotal([{ played: 18, big: "78", kind: "stroke" }, { played: 18, big: "80", kind: "stroke" }] as never)).toBe("158 strokes");
    expect(soloTotal([{ played: 18, big: "36", kind: "stableford" }] as never)).toBe("");
  });
});

describe("the trip page", () => {
  const four = [P("a", "Ann", 0), P("b", "Bob", 1), P("c", "Cal", 2), P("d", "Dee", 3)];
  const games = [{ id: "g1", sides: [{ id: "a", playerIds: ["a"] }, { id: "b", playerIds: ["b"] }, { id: "c", playerIds: ["c"] }, { id: "d", playerIds: ["d"] }] }];
  it("final standings and one winner, in stroke play totals", () => {
    const e = Array.from({ length: 18 }, (_, i) => entry("r1", i + 1, { a: PAR[i] - (i < 2 ? 1 : 0), b: PAR[i], c: PAR[i] + 1, d: PAR[i] }, "g1"));
    const s = state({ win: { kind: "stroke" } as TournamentRow["win"] }, [round(1, "stroke", games)], e, four);
    const f = finalStandings(s, tournamentSummary(toTournamentCfg(s), toEntries(s.entries)), toTournamentCfg(s));
    expect(f.winner?.name).toBe("Ann");
    expect(f.rows.map((r) => `${r.pos} ${r.name}`)).toEqual(["1 Ann", "T2 Bob", "T2 Dee", "4 Cal"]);
  });
  it("no single winner when tied at the top", () => {
    const e = Array.from({ length: 18 }, (_, i) => entry("r1", i + 1, { a: PAR[i], b: PAR[i], c: PAR[i] + 1, d: PAR[i] + 1 }, "g1"));
    const s = state({ win: { kind: "stroke" } as TournamentRow["win"] }, [round(1, "stroke", games)], e, four);
    expect(finalStandings(s, tournamentSummary(toTournamentCfg(s), toEntries(s.entries)), toTournamentCfg(s)).winner).toBeNull();
  });
  it("the film is the newest the director made; best moments are the most liked photos and clips", () => {
    const post = (id: string, kind: PostRow["kind"], author = "Ann", at = "2026-06-14T10:00:00Z") => ({ id, kind, author_name: author, media_path: `photo/t/${id}.jpg`, hidden: false, visibility: "public", created_at: at }) as PostRow;
    const posts = [post("f1", "video", "AI director", "2026-06-15T10:00:00Z"), post("f2", "video", "AI director", "2026-06-16T10:00:00Z"), post("p1", "photo"), post("p2", "photo"), post("n1", "note")];
    const s = state({}, [], [], four, { posts, likes: [{ post_id: "p2", tournament_id: "t", liker: "x", created_at: "" }] });
    expect(filmPost(s)?.id).toBe("f2");
    expect(bestMoments(s).map((p) => p.id)).toEqual(["p2", "p1"]);
  });
});

describe("bios and films", () => {
  it("a bio is short plain text, and a photo only from this tournament's folder", () => {
    const b = cleanBio({ home_club: "  Birr <b>GC</b> ", best_club: "Driver", photo_path: "photo/other-trip/x.jpg", nickname: "" }, "kinsale");
    expect(b.home_club).toBe("Birr bGC/b");
    expect(b.best_club).toBe("Driver");
    expect("photo_path" in b).toBe(false);
    expect(b.nickname).toBeNull();
    expect(cleanBio({ photo_path: "photo/kinsale/abc-1.jpg" }, "kinsale").photo_path).toBe("photo/kinsale/abc-1.jpg");
    expect(hasBio({ home_club: null, nickname: "" })).toBe(false);
  });
  it("a film is kept 12 months", () => {
    expect(filmExpiry("2026-06-14T10:00:00Z")).toBe("2027-06-14T10:00:00.000Z");
    expect(dayMonth("2027-06-14T10:00:00Z")).toBe("14 June");
  });
});
