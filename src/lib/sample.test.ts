import { describe, expect, it } from "vitest";
import { DECLAN, MARCUS, SAMPLE_CLIP_HOLE, SAMPLE_LOCKED, YOU, sampleReactions, sampleState, yourRoundDone } from "./sample";
import { scoreBug } from "./scorebug";
import { roundBoard } from "./live";
import { tournamentSummary } from "./engine";
import { toEntries, toTournamentCfg, type PostRow, type TournamentState } from "./types";
import { outcomesFor, type ShotKind } from "./shots";

/** The sample with your scores entered (null: left blank) */
function played(yours: (number | null)[], note?: string): TournamentState {
  const s = sampleState();
  const entries = s.entries.map((e, i) => (yours[i] == null ? e : { ...e, scores: { ...e.scores, [YOU]: { gross: yours[i], gir: false, pickedUp: false } } }));
  const posts: PostRow[] = note
    ? [{ ...s.posts[0], id: "n1", kind: "note", body: note, author_name: "You", author_player_id: YOU, media_path: null, player_ids: [YOU], created_at: new Date(Date.now() - 60e3).toISOString() }, ...s.posts]
    : s.posts;
  return { ...s, entries, posts };
}
const field = (s: TournamentState) => roundBoard(s, tournamentSummary(toTournamentCfg(s), toEntries(s.entries)), s.rounds[0]).field;

describe("the sample round", () => {
  it("arrives with Declan's and Marcus's scores in, and nothing of yours", () => {
    const s = sampleState();
    expect(s.rounds[0].course_name).toBe("The Atlantic Links");
    expect(s.rounds[0].holes.map((h) => h.number)).toEqual([1, 2, 3]);
    for (const e of s.entries) {
      expect(Object.keys(e.scores).sort()).toEqual([...SAMPLE_LOCKED].sort());
      expect(e.scores[YOU]).toBeUndefined();
    }
    expect(s.entries.find((e) => e.hole === 3)!.scores[DECLAN].gross).toBe(2);
    expect(yourRoundDone(s)).toBe(false);
  });

  it("logs what happened for each of their strokes, in the app's own words", () => {
    const s = sampleState();
    for (const e of s.entries)
      for (const pid of SAMPLE_LOCKED) {
        const shots = (s.shots ?? []).filter((x) => x.hole === e.hole && x.player_id === pid);
        expect(shots.length).toBe(e.scores[pid].gross);
        const h = s.rounds[0].holes.find((x) => x.number === e.hole)!;
        for (const x of shots) expect(outcomesFor(x.kind as ShotKind, { par: h.par, yards: h.yards })).toContain(x.outcome);
        expect(shots[shots.length - 1].outcome).toMatch(/^Holed/);
      }
    const putt = (s.shots ?? []).find((x) => x.hole === 3 && x.player_id === DECLAN && x.kind === "putt")!;
    expect(putt.outcome).toBe("Holed from 30 ft+");
  });

  it("has Marcus's clip of Declan's putt", () => {
    const clip = sampleState().posts.find((p) => p.kind === "video")!;
    expect(clip.author_player_id).toBe(MARCUS);
    expect(clip.player_ids).toEqual([DECLAN]);
    expect(clip.hole).toBe(SAMPLE_CLIP_HOLE);
  });

  it("builds the film's score panel from your scores: everyone thru 2 before the putt, then BIRDIE", () => {
    const s = played([4, 5, 3]);
    expect(yourRoundDone(s)).toBe(true);
    const before = scoreBug(s, { round: 1, hole: 3, playerIds: [DECLAN] })!;
    const after = scoreBug(s, { round: 1, hole: 3, playerIds: [DECLAN], after: true })!;
    expect(before.mode).toBe("field");
    expect(before.rows.map((r) => r.thru)).toEqual([2, 2, 2]);
    expect(before.rows.find((r) => r.onCamera)!.name).toBe("Declan");
    expect(after.rows.every((r) => r.finished)).toBe(true);
    expect(after.flash).toBe("BIRDIE");
    expect(after.rows.map((r) => r.name).sort()).toEqual(["Declan", "Marcus", "You"]);
  });

  it("writes the bulletin from your round, and quotes your note", () => {
    const s = played([5, 4, 3], "Declan: Lovely morning for it. The greens are quick, mind.");
    const { piece, comments } = sampleReactions(s, field(s));
    expect(piece.title).toBe("After three");
    expect(piece.body).toMatch(/^You('re| share the lead| lead)/);
    expect(piece.body).toContain("at The Atlantic Links");
    expect(piece.body).toContain("Your card: bogey, par, par.");
    expect(piece.body).toContain("Declan holed from thirty feet for birdie at the 3rd");
    expect(piece.body).toContain("In your words: “Lovely morning for it. The greens are quick, mind.”");
    expect(comments.filter((c) => c.post_id === "sample-clip")).toHaveLength(2);
  });

  it("says where you stand, whatever you score", () => {
    const lead = played([3, 3, 2]);
    expect(sampleReactions(lead, field(lead)).piece.body).toMatch(/^You lead on \d+ points after three holes at The Atlantic Links, \d+ points? clear of/);
    expect(sampleReactions(lead, field(lead)).comments[0].body).toMatch(/^(An eagle|Birdie) at the/);
    const behind = played([7, 7, 5]);
    const b = sampleReactions(behind, field(behind));
    expect(b.piece.body).toMatch(/^You're (tied )?(second|third) on \d+ points? after three holes at The Atlantic Links, \d+ points? behind Declan/);
    expect(b.piece.body).toContain("Your card: triple bogey, triple bogey, double bogey.");
    expect(b.piece.body).toMatch(/to (go top|go clear at the top)/);
    expect(b.comments[0].body).toMatch(/^Rough one at the/);
    expect(b.piece.body).not.toContain("In your words");
  });
});

describe("the sample round's handicaps", () => {
  it("give shots as an 18-hole round would: one on SI 1 and SI 5, none on SI 15", () => {
    const s = played([5, 4, 3]);
    const b = field(s);
    // bogey, par, par with a shot on each of the first two: 2 + 3 + 2
    expect(b.find((x) => x.playerIds.includes(YOU))!.value).toBe(7);
    // Declan: 5 (net par) 2, 4 (net birdie) 3, 2 (birdie) 3
    expect(b.find((x) => x.playerIds.includes(DECLAN))!.value).toBe(8);
  });

  it("says when Declan's birdie changes the lead, and not when it doesn't", () => {
    const tied = played([5, 4, 3]); // all on 5 after two: his birdie takes him clear
    expect(sampleReactions(tied, field(tied)).piece.body).toContain("to go clear at the top");
    const ahead = played([3, 3, 3]); // you lead by miles: no lead to change
    const a = sampleReactions(ahead, field(ahead)).piece.body;
    expect(a).not.toMatch(/to (go top|go clear|stay top|draw level)/);
    const pick = played([5, null, 3]);
    pick.entries[1] = { ...pick.entries[1], scores: { ...pick.entries[1].scores, [YOU]: { gross: null, pickedUp: true, gir: false } } };
    expect(sampleReactions(pick, field(pick)).piece.body).toContain("Your card: bogey, pick-up, par.");
  });
});
