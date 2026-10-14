import { describe, expect, it } from "vitest";
import { cameraChoices, filmUnlock, lengthsFor, musicPieces, shapeMix, filmShape, uprightCrop, canLeaveOut, estimateCents } from "./film";
import { clipParts, lineRecorded, lineVoice, seatOf, segmentSeconds, voiceKey, type CardSegment, type ClipSegment } from "./director-types";
import type { PostRow, RoundRow, TournamentState } from "./types";

const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, si: i + 1 }));
const round = (n: number, status: RoundRow["status"], games: RoundRow["games"] = [{ id: `g${n}`, name: `Match ${n}`, sides: [{ id: "a", playerIds: ["a"] }, { id: "b", playerIds: ["b"] }] }]): RoundRow =>
  ({ id: `r${n}`, tournament_id: "t", number: n, course_slug: "x", course_name: `Course ${n}`, course_location: null, course_blurb: null, lat: null, lon: null, play_date: null, tee_time: null, tee: null, format: "stableford", play: "singles", nine_points: 0, full_points: 1, shots: {}, holes, scorer_id: "a", status, games, points_rule: null, handicap_rule: null }) as RoundRow;
const clip = (id: string, extra: Partial<PostRow> = {}): PostRow =>
  ({ id, tournament_id: "t", round_id: "r1", hole: 3, author_name: "Neil", author_player_id: "b", kind: "video", body: "", tags: [], media_path: `video/t/${id}.mp4`, visibility: "public", hidden: false, created_at: "2026-10-01T10:00:00Z", ...extra }) as PostRow;
const state = (rounds: RoundRow[], posts: PostRow[] = [clip("c1")], cards: TournamentState["cards"] = []) =>
  ({
    tournament: { id: "t", require_attestation: false, teams: [], side_games: [], standings: "points" },
    players: [
      { id: "a", name: "Oisin", sort: 0 },
      { id: "b", name: "Neil", sort: 1 },
    ],
    rounds,
    entries: [],
    posts,
    cards,
    signatures: [],
  }) as unknown as TournamentState;

describe("when the film can be made", () => {
  it("only once every round is complete", () => {
    const u = filmUnlock(state([round(1, "complete"), round(2, "upcoming")]));
    expect(u.ok).toBe(false);
    expect(u.missing).toEqual(["Round 2 hasn't been played yet."]);
    expect(filmUnlock(state([round(1, "complete"), round(2, "complete")])).ok).toBe(true);
  });

  it("says whose card isn't final", () => {
    const s = state([round(1, "complete"), round(2, "live")]);
    s.entries = [{ id: "e", round_id: "r2", game: "g2", hole: 1, scores: { a: { gross: 4 }, b: { gross: 5 } }, ctp_winner: null, ld_winner: null } as never];
    expect(filmUnlock(s).missing).toEqual(["Round 2: Match 2's card isn't final yet."]);
    s.cards = [{ round_id: "r2", game: "g2", status: "final" } as never];
    expect(filmUnlock(s).ok).toBe(true);
  });

  it("needs clips, and doesn't count films or hidden clips", () => {
    expect(filmUnlock(state([round(1, "complete")], [])).missing).toEqual(["There are no clips to make a film from yet."]);
    const u = filmUnlock(state([round(1, "complete")], [clip("c1", { hidden: true }), clip("f", { author_name: "AI director" }), clip("c2")]));
    expect(u.clips).toBe(1);
  });
});

describe("the questions", () => {
  it("offers the lengths the clips can fill, and marks the best", () => {
    expect(lengthsFor(6)).toEqual({ options: [180], best: 180 });
    expect(lengthsFor(18)).toEqual({ options: [180, 300], best: 300 });
    expect(lengthsFor(40)).toEqual({ options: [180, 300, 480], best: 480 });
  });

  it("picks the shape from the tournament, else from how the clips were filmed", () => {
    const mix = shapeMix([clip("a", { details: { shape: "portrait" } }), clip("b", { details: { shape: "portrait" } }), clip("c", { details: { shape: "landscape" } })]);
    expect(mix).toEqual({ portrait: 2, landscape: 1, unknown: 0 });
    expect(filmShape(null, mix)).toBe("portrait");
    expect(filmShape("landscape", mix)).toBe("landscape");
    expect(canLeaveOut(mix, "portrait")).toBe(false);
    expect(canLeaveOut({ portrait: 9, landscape: 2, unknown: 0 }, "portrait")).toBe(true);
  });
});

describe("the camera's question", () => {
  it("isn't asked during play", () => {
    expect(cameraChoices({ rounds: [round(1, "live")] })).toBeNull();
  });
  it("puts predictions first before the event, interviews after a round", () => {
    expect(cameraChoices({ rounds: [round(1, "upcoming")] })).toEqual({ order: ["prediction", "scene", "interview", "other"], when: "pre", roundId: null });
    expect(cameraChoices({ rounds: [round(1, "complete"), round(2, "upcoming")] })).toEqual({ order: ["interview", "prediction", "scene", "other"], when: "post", roundId: "r1" });
    expect(cameraChoices({ rounds: [round(1, "complete"), round(2, "complete")] })?.order[0]).toBe("interview");
  });
});

describe("the commentary team", () => {
  const c: ClipSegment = { id: "s1", kind: "clip", postId: "p", src: "x", caption: "", in: 0, out: 8, voice: "Twelve feet for the half", payoff: "In it goes!", replay: true, replayVoice: "Watch the pace" };
  const res: CardSegment = { id: "s2", kind: "card", card: "result", heading: "Round points", seconds: 4, voice: "He'll be kicking himself" };
  const plan = { voiceId: "commentator1", voice2Id: "pundit01", booth: 2 as const };
  it("the commentator sets up, the pundit reacts and sums up", () => {
    expect([seatOf(c, "voice"), seatOf(c, "payoff"), seatOf(c, "replay"), seatOf(res, "voice")]).toEqual([1, 2, 2, 2]);
    expect(lineVoice(plan, c, "payoff")).toBe("pundit01");
    expect(lineVoice({ ...plan, booth: 1 }, c, "payoff")).toBe("commentator1");
    expect(lineVoice(plan, { ...c, seats: { payoff: 1 } }, "payoff")).toBe("commentator1");
  });
  it("a line recorded in the other voice is recorded again; your own recording stays", () => {
    const rec = { ...c, payoffSrc: "u", payoffFor: voiceKey("In it goes!", "commentator1"), payoffSec: 1 };
    expect(lineRecorded({ ...plan, booth: 1 }, rec, "payoff")).toBe(true);
    expect(lineRecorded(plan, rec, "payoff")).toBe(false);
    const mine = { ...c, own: { payoff: true }, payoffSrc: "mine.wav", payoffFor: "own|", payoffSec: 1.4 };
    expect(lineRecorded(plan, mine, "payoff")).toBe(true);
    expect(lineVoice(plan, mine, "payoff")).toBe("own");
  });
  it("a line said before the clip makes room for itself", () => {
    const lead: ClipSegment = { ...c, payoff: undefined, replay: undefined, leadIn: true, voiceSrc: "v", voiceFor: voiceKey("Twelve feet for the half", "commentator1"), voiceSec: 2.2 };
    expect(clipParts(lead).lead).toBeCloseTo(3.5, 1);
    expect(segmentSeconds(lead)).toBeCloseTo(3.5 + 8, 1);
  });
});

describe("the music under the film", () => {
  const spans = [
    { start: 0, end: 10, level: 1 },
    { start: 10, end: 60, level: 0.5 },
    { start: 60, end: 70, level: 1, chapter: true },
    { start: 70, end: 200, level: 0.25 },
  ];
  it("dips under the clips and fades at the ends", () => {
    const m = musicPieces(spans, [{ src: "a.mp3", sec: 300 }], 0.5);
    expect(m.map((x) => [x.start, x.length, x.volume])).toEqual([
      [0, 10, 0.5],
      [10, 50, 0.25],
      [60, 10, 0.5],
      [70, 130, 0.13],
    ]);
    expect(m[0].effect).toBe("fadeIn");
    expect(m[3].effect).toBe("fadeOut");
    expect(m.every((x) => x.trim === x.start)).toBe(true);
  });
  it("moves on to the next track at a round change when the first runs out", () => {
    const m = musicPieces(spans, [{ src: "a.mp3", sec: 90 }, { src: "b.mp3", sec: 300 }], 1);
    const b = m.filter((x) => x.src === "b.mp3");
    expect(b[0].start).toBe(60);
    expect(b[0].trim).toBe(0);
    expect(b[0].effect).toBe("fadeIn");
    expect(m.filter((x) => x.src === "a.mp3").at(-1)?.effect).toBe("fadeOut");
  });
});

describe("a wide clip in an upright film", () => {
  it("keeps the slice around the golfer", () => {
    expect(uprightCrop(0.5)).toEqual({ left: 0.342, right: 0.342 });
    expect(uprightCrop(0.1)).toEqual({ left: 0, right: 0.684 });
    expect(uprightCrop(undefined)).toEqual({ left: 0.342, right: 0.342 });
  });
});

describe("cost", () => {
  it("adds up rendering, voices and the plan", () => {
    expect(estimateCents(300, 2000)).toBe(100 + 60 + 15);
  });
});
