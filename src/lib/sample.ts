/**
 * The front page's sample round: the app's real on-course screens, fed sample data, with nothing leaving the phone.
 * Every queue that would send something (scores, shots, GPS, notes, clips) checks isSample() and keeps it here
 * instead. No camera, microphone or location permission is ever asked for: the clip is a sample clip, the voice note
 * a sample note, and the GPS reads from a sample spot on the hole.
 */
import data from "./sampleRound.json";
import type { CourseGeo } from "./gps";
import { roundBoard } from "./live";
import { tournamentSummary } from "./engine";
import { toEntries, toTournamentCfg } from "./types";
import type { AiPieceRow, CommentRow, HoleEntryRow, PlayerRow, PostRow, RoundRow, ShotRow, TournamentRow, TournamentState } from "./types";

import { SAMPLE_SLUG } from "./sampleFlag";
export { SAMPLE_SLUG, isSample, SAMPLE_POST_EVENT } from "./sampleFlag";

/** What the voice note "hears" in the sample */
export const SAMPLE_NOTE = "Lovely morning for it. The greens are quick, mind.";

/** The sample course (the holes are a real course's; the name is made up) */
export const SAMPLE_COURSE = "The Atlantic Links";

const HOLES = 3;
const raw = data as unknown as { tournament: TournamentRow; players: PlayerRow[]; rounds: RoundRow[]; geo: CourseGeo };
export const YOU = raw.players[0].id;
export const DECLAN = raw.players[1].id;
export const MARCUS = raw.players[2].id;
/** Their scores are already in when you arrive: you only enter your own */
export const SAMPLE_LOCKED = [DECLAN, MARCUS];
/** The clip in the sample: Declan's putt on the 3rd, filmed by Marcus */
export const SAMPLE_CLIP_HOLE = 3;
const round0 = raw.rounds[0];
const GAME = round0.games?.[0]?.id ?? "main";

/** Declan's and Marcus's holes: the score, and what happened, shot by shot (kind, outcome, club) */
const THEIRS: Record<number, Record<string, { gross: number; gir: boolean; shots: [string, string, string | null][] }>> = {
  1: {
    [DECLAN]: { gross: 5, gir: false, shots: [["tee", "Right", "Driver"], ["recovery", "Back in play", "Mid iron"], ["approach", "On the green", "Wedge"], ["putt", "Missed", null], ["putt", "Holed, tap-in", null]] },
    [MARCUS]: { gross: 4, gir: true, shots: [["tee", "Fairway", "Driver"], ["approach", "On the green", "Mid iron"], ["putt", "Missed", null], ["putt", "Holed, tap-in", null]] },
  },
  2: {
    [DECLAN]: { gross: 4, gir: false, shots: [["tee", "Fairway", "Driver"], ["approach", "Missed left", "Long iron"], ["chip", "Close", "Wedge"], ["putt", "Holed, tap-in", null]] },
    [MARCUS]: { gross: 5, gir: false, shots: [["tee", "Left", "Driver"], ["approach", "Short", "Mid iron"], ["chip", "On the green", "Wedge"], ["putt", "Missed", null], ["putt", "Holed, tap-in", null]] },
  },
  3: {
    [DECLAN]: { gross: 2, gir: true, shots: [["tee", "On the green", "Mid iron"], ["putt", "Holed from 30 ft+", null]] },
    [MARCUS]: { gross: 3, gir: false, shots: [["tee", "Short", "Mid iron"], ["chip", "Close", "Wedge"], ["putt", "Holed, tap-in", null]] },
  },
};

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

/**
 * A fresh sample round: three holes, you and two playing partners. Declan's and Marcus's scores are already in
 * (and what happened on each hole), and Marcus has posted his clip of Declan's birdie putt on the 3rd.
 */
export function sampleState(clipPath = "/home/clips/putt.mp4"): TournamentState {
  const tid = raw.tournament.id;
  const holes = (round0.all_holes ?? round0.holes).filter((h) => h.number <= HOLES);
  // Shots as an 18-hole round gives them on these holes (the toughest two, SI 1 and SI 5): three holes would
  // otherwise count as a nine, with the handicap halved and spread over just three holes
  const shots18 = Object.fromEntries(raw.players.map((p) => [p.id, 2]));
  const round: RoundRow = {
    ...round0,
    course_name: SAMPLE_COURSE,
    holes,
    all_holes: holes,
    hole_set: "all",
    status: "live",
    course_guide: null,
    photo_path: null,
    handicap_rule: { mode: "manual", shots: shots18 },
    shots: shots18,
  };
  const name = (id: string) => raw.players.find((p) => p.id === id)?.name ?? "";
  const entries: HoleEntryRow[] = holes.map((h) => ({
    id: `sample-e${h.number}`,
    round_id: round.id,
    game: GAME,
    hole: h.number,
    scores: Object.fromEntries(SAMPLE_LOCKED.map((pid) => [pid, { gross: THEIRS[h.number][pid].gross, gir: THEIRS[h.number][pid].gir, pickedUp: false }])),
    ctp_winner: null,
    ld_winner: null,
    conceded: null,
    updated_by: "Marcus",
    updated_at: iso(1),
  }));
  const shots: ShotRow[] = holes.flatMap((h) =>
    SAMPLE_LOCKED.flatMap((pid) =>
      THEIRS[h.number][pid].shots.map(([kind, outcome, club], i) => ({
        id: `sample-s${h.number}-${pid}-${i + 1}`,
        seq: i + 1,
        author_player_id: pid,
        tournament_id: tid,
        round_id: round.id,
        hole: h.number,
        player_id: pid,
        kind,
        outcome,
        club,
        distance: null,
        author_name: name(pid),
        client_id: `sample-s${h.number}-${pid}-${i + 1}`,
        logged_at: iso(2),
      })),
    ),
  );
  const clip: PostRow = {
    id: "sample-clip",
    tournament_id: tid,
    round_id: round.id,
    hole: SAMPLE_CLIP_HOLE,
    author_name: name(MARCUS),
    author_player_id: MARCUS,
    kind: "video",
    body: "Thirty feet for birdie",
    tags: [],
    media_path: clipPath,
    visibility: "public",
    hidden: false,
    created_at: iso(2),
    player_ids: [DECLAN],
    details: { shot: "Putt", result: "Holed from 30 ft+", club: "Putter", shape: "portrait" },
  };
  return {
    tournament: { ...raw.tournament, slug: SAMPLE_SLUG, name: "Sample round", subtitle: "Three holes. Nothing is saved.", feed_on: true },
    players: raw.players,
    rounds: [round],
    entries,
    attestations: [],
    posts: [clip],
    comments: [],
    pieces: [],
    votes: [],
    shots,
    gps: [],
    likes: [],
    cards: [],
    signatures: [],
  };
}

/** Your score on every hole is in (the round can finish) */
export function yourRoundDone(state: TournamentState): boolean {
  return state.rounds[0].holes.every((h) => {
    const b = state.entries.find((e) => e.hole === h.number && e.round_id === state.rounds[0].id)?.scores[YOU];
    return !!b && (b.gross != null || !!b.pickedUp);
  });
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

/** What a score is called, with its article: "a birdie", "a par", "a 7" */
function scoreName(gross: number, par: number) {
  if (gross === 1) return "a hole in one";
  const d = gross - par;
  return d <= -2 ? "an eagle" : d === -1 ? "a birdie" : d === 0 ? "a par" : d === 1 ? "a bogey" : d === 2 ? "a double bogey" : d === 3 ? "a triple bogey" : gross === 8 || gross === 11 ? `an ${gross}` : `a ${gross}`;
}

/**
 * What the people at home see once the round's done, all written from the scores as entered: the bulletin leads with
 * your round and quotes your voice note, and the comments react to how you played.
 */
export function sampleReactions(state: TournamentState, field: { name: string; playerIds: string[]; value: number }[]): { comments: CommentRow[]; piece: AiPieceRow } {
  const round = state.rounds[0];
  const clip = state.posts.find((p) => p.kind === "video");
  // The real leaderboard's points (handicaps included), best first
  const table = [...field].sort((a, b) => b.value - a.value).map((f) => ({ name: f.name, id: f.playerIds[0], pts: f.value }));
  const mine = table.find((x) => x.id === YOU) ?? { name: "You", id: YOU, pts: 0 };
  const above = table.filter((x) => x.pts > mine.pts);
  const level = table.filter((x) => x.pts === mine.pts && x.id !== YOU);
  const place = above.length + 1;
  const pts = (n: number) => `${n} point${n === 1 ? "" : "s"}`;
  const names = (xs: { name: string }[]) => (xs.length === 1 ? xs[0].name : `${xs.slice(0, -1).map((x) => x.name).join(", ")} and ${xs[xs.length - 1].name}`);

  let lead: string;
  if (place === 1 && !level.length) {
    const next = table.find((x) => x.id !== YOU);
    lead = `You lead on ${pts(mine.pts)} after three holes at ${round.course_name}${next ? `, ${pts(mine.pts - next.pts)} clear of ${next.name}` : ""}.`;
  } else if (place === 1) lead = `You share the lead with ${names(level)} on ${pts(mine.pts)} after three holes at ${round.course_name}.`;
  else
    lead = `You're ${level.length ? "tied " : ""}${place === 2 ? "second" : "third"} on ${pts(mine.pts)} after three holes at ${round.course_name}, ${pts(table[0].pts - mine.pts)} behind ${names(above.filter((x) => x.pts === table[0].pts))}.`;

  // Your card, hole by hole: "bogey, par, par"
  const word = (gross: number, par: number) => scoreName(gross, par).replace(/^an? /, "");
  const yours = round.holes
    .map((h) => ({ h, b: state.entries.find((e) => e.hole === h.number)?.scores[YOU] }))
    .map(({ h, b }) => (b?.pickedUp ? "pick-up" : b?.gross != null ? word(b.gross, h.par) : null))
    .filter((x): x is string => !!x);
  const card = yours.length ? `Your card: ${yours.join(", ")}.` : "";

  // Declan's birdie, and what it did for him: compared with the board after the 2nd
  const after2 = { ...state, entries: state.entries.filter((e) => e.hole <= 2) };
  const was = roundBoard(after2, tournamentSummary(toTournamentCfg(after2), toEntries(after2.entries)), round).field;
  const topOf = (f: { playerIds: string[]; value: number }[]) => {
    const best = Math.max(...f.map((x) => x.value));
    const at = f.filter((x) => x.value === best);
    return { top: at.some((x) => x.playerIds.includes(DECLAN)), shared: at.length > 1 };
  };
  const before = topOf(was);
  const now = topOf(field);
  const move = !now.top
    ? ""
    : !before.top
      ? now.shared
        ? " to draw level at the top"
        : " to go top"
      : before.shared && !now.shared
        ? " to go clear at the top"
        : !now.shared
          ? " to stay top"
          : "";
  const birdie = `Declan holed from thirty feet for birdie at the 3rd${move}, and Marcus filmed it.`;

  // Your voice note, in your words
  const note = state.posts.filter((p) => p.kind === "note" && p.author_player_id === YOU && p.body).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  // (a note about a player starts with his name: "Declan: …")
  const said = note?.body?.replace(new RegExp(`^(${state.players.map((p) => p.name).join("|")}): `), "").trim();
  const quote = said ? `In your words: \u201c${said.replace(/[.!?]?$/, (m) => m || ".")}\u201d` : "";

  const piece: AiPieceRow = {
    id: "sample-bulletin",
    tournament_id: state.tournament.id,
    round_id: round.id,
    kind: "bulletin",
    title: "After three",
    body: [lead, card, birdie, quote].filter(Boolean).join(" "),
    trigger: "h3",
    status: "published",
    created_at: iso(0.1),
    published_at: iso(0.1),
  } as AiPieceRow;

  // Someone at home, on how you played
  const yourHoles = round.holes.map((h) => ({ n: h.number, d: (state.entries.find((e) => e.hole === h.number)?.scores[YOU]?.gross ?? h.par) - h.par }));
  const best = [...yourHoles].sort((a, b) => a.d - b.d)[0];
  const worst = [...yourHoles].sort((a, b) => b.d - a.d)[0];
  const cheer =
    best && best.d <= -1
      ? `${best.d <= -2 ? "An eagle" : "Birdie"} at the ${ordinal(best.n)}! Following every shot from home`
      : place === 1 && !level.length
        ? "Top of the leaderboard! Keep it going"
        : place === 1
          ? "Level at the top. Tense stuff"
          : worst && worst.d >= 2
            ? `Rough one at the ${ordinal(worst.n)}. Shake it off, plenty of golf left`
            : "Following every hole from home. Come on!";
  const comments: CommentRow[] = [
    { id: "sample-c0", tournament_id: state.tournament.id, round_id: round.id, author_name: "Niamh", body: cheer, created_at: iso(0.3), post_id: null },
    { id: "sample-c1", tournament_id: state.tournament.id, round_id: round.id, author_name: "Aoife", body: "Get in, Declan! Watching from the kitchen", created_at: iso(1.2), post_id: clip?.id ?? null },
    { id: "sample-c2", tournament_id: state.tournament.id, round_id: round.id, author_name: "Declan", body: "Thirty feet. Remember that, lads", created_at: iso(0.8), post_id: clip?.id ?? null, author_player_id: DECLAN },
  ];
  return { comments, piece };
}

function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

export type { HoleEntryRow };
