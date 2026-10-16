/**
 * The front page's sample round: the app's real on-course screens, fed sample data, with nothing leaving the phone.
 * Every queue that would send something (scores, shots, GPS, notes, clips) checks isSample() and keeps it here
 * instead. No camera, microphone or location permission is ever asked for: the clip is a sample clip, the voice note
 * a sample note, and the GPS reads from a sample spot on the hole.
 */
import data from "./sampleRound.json";
import type { CourseGeo } from "./gps";
import type { AiPieceRow, CommentRow, HoleEntryRow, PlayerRow, PostRow, RoundRow, TournamentRow, TournamentState } from "./types";

import { SAMPLE_SLUG } from "./sampleFlag";
export { SAMPLE_SLUG, isSample, SAMPLE_POST_EVENT } from "./sampleFlag";

/** What the voice note "hears" in the sample */
export const SAMPLE_NOTE = "Thirty feet, never left the hole. Buying the first round.";

const HOLES = 3;
const raw = data as unknown as { tournament: TournamentRow; players: PlayerRow[]; rounds: RoundRow[]; geo: CourseGeo };
export const YOU = raw.players[0].id;
const round0 = raw.rounds[0];

/** The greens of the three sample holes */
export const SAMPLE_GEO: CourseGeo = Object.fromEntries(Object.entries(raw.geo).filter(([h]) => Number(h) <= HOLES));

/** Where "you" are standing on each hole when you tap GPS: out on the fairway, about 150 yards from the middle */
export function sampleSpot(hole: number): [number, number] | null {
  const g = SAMPLE_GEO[String(hole)];
  if (!g) return null;
  const tee = g.tee ?? g.green.middle;
  const f = hole === 3 ? 0.1 : 0.58; // the par 3: on the tee
  return [tee[0] + (g.green.middle[0] - tee[0]) * f, tee[1] + (g.green.middle[1] - tee[1]) * f];
}

/** The sample clip: MP4 where the browser plays it (iPhones, Chrome), WebM otherwise */
export function sampleClipPath(): string {
  try {
    const v = document.createElement("video");
    if (v.canPlayType('video/mp4; codecs="avc1.64001F"')) return "/home/clips/putt.mp4";
  } catch {}
  return "/home/clips/putt.webm";
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60e3).toISOString();

/** A fresh sample round: three holes, you and two playing partners, nothing played yet. */
export function sampleState(): TournamentState {
  const tid = raw.tournament.id;
  const holes = (round0.all_holes ?? round0.holes).filter((h) => h.number <= HOLES);
  const round: RoundRow = { ...round0, holes, all_holes: holes, hole_set: "all", status: "live", course_guide: null, photo_path: null };
  return {
    tournament: { ...raw.tournament, slug: SAMPLE_SLUG, name: "Sample round", subtitle: "Three holes. Nothing is saved.", feed_on: true },
    players: raw.players,
    rounds: [round],
    entries: [],
    attestations: [],
    posts: [],
    comments: [],
    pieces: [],
    votes: [],
    shots: [],
    gps: [],
    likes: [],
    cards: [],
    signatures: [],
  };
}

/** A post the sample "posted" (a note from the voice button, or the clip) */
export function samplePost(state: TournamentState, body: { roundId?: string | null; hole?: number | null; kind: "note" | "video"; body?: string; playerIds?: string[]; mediaPath?: string }): PostRow {
  return {
    id: `sample-${Math.random().toString(36).slice(2)}`,
    tournament_id: state.tournament.id,
    round_id: body.roundId ?? state.rounds[0].id,
    hole: body.hole ?? null,
    author_name: "You",
    author_player_id: YOU,
    kind: body.kind,
    body: body.body ?? null,
    tags: [],
    media_path: body.mediaPath ?? null,
    visibility: "public",
    hidden: false,
    created_at: new Date().toISOString(),
    player_ids: body.playerIds ?? [YOU],
    details: body.kind === "video" ? { shot: "Putt", result: "Holed", club: "Putter" } : null,
  } as PostRow;
}

/** What the people at home "say" about your round, once it's done */
export function sampleReactions(state: TournamentState, field: { name: string; playerIds: string[]; value: number }[]): { comments: CommentRow[]; piece: AiPieceRow } {
  const round = state.rounds[0];
  const clip = state.posts.find((p) => p.kind === "video");
  // The real leaderboard's points (handicaps included), best first
  const table = [...field].sort((a, b) => b.value - a.value).map((f) => ({ name: f.name, id: f.playerIds[0], pts: f.value }));
  const mine = table.find((x) => x.id === YOU) ?? { name: "You", id: YOU, pts: 0 };
  const place = table.filter((x) => x.pts > mine.pts).length + 1;
  const tied = table.filter((x) => x.pts === mine.pts).length > 1;
  const best = state.entries
    .flatMap((e) => Object.entries(e.scores).map(([pid, s]) => ({ pid, hole: e.hole, d: (s.gross ?? 99) - (round.holes.find((h) => h.number === e.hole)?.par ?? 4) })))
    .sort((a, b) => a.d - b.d)[0];
  const bestName = best ? (best.pid === YOU ? "You" : (state.players.find((p) => p.id === best.pid)?.name ?? "")) : "";
  const word = best ? (best.d <= -2 ? "an eagle" : best.d === -1 ? "a birdie" : best.d === 0 ? "a solid par" : "a fighting bogey") : "";
  const lead =
    place === 1
      ? tied
        ? `You share the lead on ${mine.pts} points`
        : `You lead on ${mine.pts} points`
      : `You're ${tied ? "tied " : ""}${place === 2 ? "second" : "third"} on ${mine.pts} points, ${table[0].pts - mine.pts} behind ${table[0].name}`;
  const body = `${lead} after three holes at ${round.course_name}.${best ? ` The moment so far: ${word} at the ${ordinal(best.hole)} from ${bestName === "You" ? "you" : bestName}.` : ""}${clip ? " The putt is already in the highlights." : ""} Plenty of golf left.`;
  const piece: AiPieceRow = {
    id: "sample-bulletin",
    tournament_id: state.tournament.id,
    round_id: round.id,
    kind: "bulletin",
    title: "After three",
    body,
    trigger: "h3",
    status: "published",
    created_at: iso(0.2),
    published_at: iso(0.2),
  } as AiPieceRow;
  const comments: CommentRow[] = [
    { id: "sample-c1", tournament_id: state.tournament.id, round_id: round.id, author_name: "Aoife", body: clip ? "Get in! Watching from the kitchen" : "Following every hole from the kitchen", created_at: iso(0.6), post_id: clip?.id ?? null },
    { id: "sample-c2", tournament_id: state.tournament.id, round_id: round.id, author_name: "Declan", body: "Enjoy it while it lasts", created_at: iso(0.4), post_id: clip?.id ?? null, author_player_id: state.players[1]?.id ?? null },
  ];
  return { comments, piece };
}

function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

export type { HoleEntryRow };
