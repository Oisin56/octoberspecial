/**
 * A made-up round for testing the writers: four made-up golfers, two singles matches at Druids Heath, every shot told
 * (or, if asked, only the tee shots, or only the scores). The story is fixed so the tests know what to expect:
 *
 * - Neil v Paddy: Paddy is 2 up with 3 to play, Neil wins the last three holes (a birdie on the 17th, filmed) and
 *   takes it 1 up. Paddy goes out of bounds on the last and picks up.
 * - Seán v Ciarán: Seán runs away with it, 5 and 4, then makes an eagle on the 15th after the match is over.
 *
 * Pure: the unit tests and the console's writing test both use it. Nothing here is ever saved.
 */
import { COURSES } from "../data/courses";
import { clubOrder } from "./detail";
import type { GpsRow, HoleEntryRow, HoleNoteRow, PlayerRow, PostRow, RoundRow, ShotRow, TournamentRow, TournamentState } from "./types";

export const TEST_TOURNAMENT_ID = "test-trip-0000";
export const TEST_ROUND_ID = "test-round-0001";
const T0 = "2026-10-03T09:30:00.000Z";

const COURSE = COURSES.find((c) => c.slug === "druids-heath")!;

const P = (id: string, name: string, handicap: number, sort: number, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  tournament_id: TEST_TOURNAMENT_ID,
  name,
  nickname: null,
  handicap,
  home_club: null,
  bio: null,
  best_club: null,
  worst_club: null,
  weakness: null,
  quote: null,
  photo_path: null,
  sort,
  team_id: null,
  ...extra,
});

export const TEST_PLAYERS: PlayerRow[] = [
  P("neil", "Neil Brennan", 12, 0, { home_club: "Birr", worst_club: "Driver", quote: "I'll win my match by five." }),
  P("paddy", "Paddy Walsh", 18, 1, { best_club: "Putter" }),
  P("sean", "Seán Doyle", 9, 2, { best_club: "Driver" }),
  P("ciaran", "Ciarán Kelly", 22, 3, { weakness: "Bunkers" }),
];

/** Gross scores, hole 1 to 18 (null = picked up) */
const SCORES: Record<string, (number | null)[]> = {
  neil: [5, 4, 3, 6, 4, 4, 4, 5, 6, 5, 4, 5, 4, 3, 5, 4, 3, 4],
  paddy: [6, 6, 3, 5, 3, 5, 6, 5, 5, 5, 3, 6, 5, 3, 5, 6, 5, null],
  sean: [4, 5, 2, 5, 3, 5, 4, 5, 4, 3, 3, 5, 4, 3, 3, 4, 4, 5],
  ciaran: [6, 6, 4, 7, 3, 5, 6, 6, 6, 5, 4, 6, 5, 3, 7, 6, 5, 6],
};

/** How far each one hits it off the tee, about */
const DRIVE: Record<string, number> = { neil: 235, paddy: 215, sean: 255, ciaran: 200 };

type Shot = { kind: string; outcome: string; club?: string | null; distance?: string | null; from?: number | null; contact?: string | null; shape?: string | null };

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = <T,>(list: T[], key: string) => list[hash(key) % list.length];

/** A hole played to a score, stroke by stroke, so every story the tests need is in it */
function playHole(pid: string, n: number, par: number, yards: number, gross: number | null): Shot[] {
  const key = `${pid}${n}`;
  // The scripted moments first
  if (pid === "paddy" && n === 18)
    return [
      { kind: "tee", outcome: "Out of bounds", club: "Driver", shape: "Slice" },
      { kind: "penalty", outcome: "Penalty" },
      { kind: "tee", outcome: "Right rough", club: "3 wood" },
    ];
  if (pid === "neil" && n === 17)
    return [
      { kind: "tee", outcome: "Fairway", club: "Driver", contact: "Flushed" },
      { kind: "approach", outcome: "On the green", club: "8 iron", from: 140 },
      { kind: "putt", outcome: "Holed", distance: "10 to 30 ft" },
    ];
  if (pid === "sean" && n === 15)
    return [
      { kind: "tee", outcome: "Fairway", club: "Driver", contact: "Flushed", shape: "Draw" },
      { kind: "second", outcome: "On the green", club: "3 wood", from: 225 },
      { kind: "putt", outcome: "Holed", distance: "3 to 10 ft" },
    ];
  if (gross == null) return [];
  const putts = gross < par ? 1 : gross >= par + 2 && hash(key) % 3 === 0 ? 3 : 2;
  const g = Math.max(1, gross - putts);
  const out: Shot[] = [];
  const left = (k: number) => Math.max(15, Math.round(yards - DRIVE[pid] * k));
  const club = (kind: "approach" | "second" | "chip" | "tee", from: number | null) => clubOrder(kind as never, par, from)[0];
  if (par === 3) {
    out.push({ kind: "tee", outcome: g === 1 ? "On the green" : pick(["Short", "Bunker", "Left"], key), club: club("tee", yards), from: yards });
    for (let i = 2; i <= g; i++) {
      const bunker = out[out.length - 1].outcome === "Bunker";
      out.push({ kind: bunker ? "bunker" : "chip", outcome: i === g ? "On the green" : "Short", club: bunker ? "Sand wedge" : "Pitching wedge", from: 20 });
    }
  } else {
    const trouble = g >= par;
    out.push({
      kind: "tee",
      outcome: trouble ? pick(["Trees", "Left rough", "Bunker"], key) : pick(pid === "neil" ? ["Fairway", "Fairway", "Fairway", "Right rough"] : ["Fairway", "Left rough", "Right rough", "Fairway"], key),
      club: "Driver",
      contact: hash(key) % 4 === 0 ? "Flushed" : null,
    });
    let at = 2;
    if (trouble) {
      out.push({ kind: "recovery", outcome: "Back in play", club: "7 iron", from: left(0.6) });
      at++;
    }
    if (par === 5 && g - at >= 1) {
      out.push({ kind: "second", outcome: g === at ? "On the green" : "Fairway", club: "3 wood", from: left(1) });
      at++;
    }
    for (; at <= g; at++) {
      const from = at === 2 && par === 4 ? left(1) : at === g ? 30 : 120;
      const last = at === g;
      const kind = from <= 40 ? "chip" : "approach";
      out.push({ kind, outcome: last ? (kind === "chip" ? "Close" : "On the green") : "Short", club: club(kind, from), from });
    }
  }
  for (let i = 1; i <= putts; i++)
    out.push(
      i === putts
        ? { kind: "putt", outcome: "Holed", distance: putts === 1 ? "10 to 30 ft" : "Tap-in" }
        : { kind: "putt", outcome: pick(["Short", "Long", "Close"], `${key}${i}`), distance: i === 1 ? "10 to 30 ft" : "3 to 10 ft" },
    );
  return out;
}

export type TestTold = "every" | "some" | "scores";

/** The made-up round. `told`: every shot, only the tee shots, or only the scores. */
export function testRound(told: TestTold = "every"): TournamentState {
  const holes = COURSE.par.map((par, i) => ({ number: i + 1, par, si: COURSE.si[i], yards: COURSE.tees.White[i] }));
  const tournament = {
    id: TEST_TOURNAMENT_ID,
    slug: "test-trip",
    name: "The Test Trip",
    subtitle: "A made-up round for the writing test",
    start_date: "2026-10-03",
    end_date: "2026-10-03",
    theme: "spring",
    custom_colors: null,
    logo_path: null,
    hero_path: null,
    tone: "broadsheet",
    side_games: [],
    side_games_by: "player",
    teams: [],
    auto_bulletins: true,
    video_enabled: true,
    organiser_player_id: "neil",
    published: true,
    ai_on: true,
    units: "yards",
  } as unknown as TournamentRow;
  const round: RoundRow = {
    id: TEST_ROUND_ID,
    tournament_id: TEST_TOURNAMENT_ID,
    number: 1,
    course_slug: COURSE.slug,
    course_name: COURSE.name,
    course_location: COURSE.location,
    course_blurb: COURSE.blurb,
    lat: COURSE.lat,
    lon: COURSE.lon,
    play_date: "2026-10-03",
    tee_time: "09:30",
    tee: "White",
    format: "match",
    play: "singles",
    nine_points: 1,
    full_points: 1,
    shots: {},
    holes,
    scorer_id: null,
    status: "complete",
    games: [
      { id: "g1", name: "Match 1", sides: [{ id: "neil", playerIds: ["neil"] }, { id: "paddy", playerIds: ["paddy"] }] },
      { id: "g2", name: "Match 2", sides: [{ id: "sean", playerIds: ["sean"] }, { id: "ciaran", playerIds: ["ciaran"] }] },
    ],
    points_rule: { front: 1, back: 1, full: 1 },
    handicap_rule: { mode: "allowance", pct: 100, relative: true },
  };
  const at = (n: number, extra = 0) => new Date(Date.parse(T0) + (n - 1) * 13 * 60e3 + extra * 1000).toISOString();
  const entries: HoleEntryRow[] = [];
  const shots: ShotRow[] = [];
  const gps: GpsRow[] = [];
  const games: [string, string[]][] = [
    ["g1", ["neil", "paddy"]],
    ["g2", ["sean", "ciaran"]],
  ];
  for (const [game, pids] of games)
    for (const h of holes) {
      const scores: HoleEntryRow["scores"] = {};
      for (const pid of pids) {
        const gross = SCORES[pid][h.number - 1];
        scores[pid] = gross == null ? { gross: null, pickedUp: true } : { gross };
        if (told === "scores") continue;
        const played = playHole(pid, h.number, h.par, h.yards, gross);
        played.forEach((sh, i) => {
          const seq = i + 1;
          if (told === "some" && sh.kind !== "tee") return;
          const id = `${pid}-${h.number}-${seq}`;
          // The last putt that went in is left for the score to tell, now and then (as on the course)
          if (told === "every" && sh.kind === "putt" && sh.outcome === "Holed" && seq === played.length && hash(id) % 2 === 0 && !(pid === "neil" && h.number === 17)) return;
          shots.push({
            id,
            seq,
            tournament_id: TEST_TOURNAMENT_ID,
            round_id: TEST_ROUND_ID,
            hole: h.number,
            player_id: pid,
            kind: sh.kind,
            outcome: sh.outcome,
            club: sh.kind === "putt" || sh.kind === "penalty" ? (sh.kind === "putt" ? "Putter" : null) : (sh.club ?? null),
            distance: sh.distance ?? null,
            contact: sh.contact ?? null,
            shape: sh.shape ?? null,
            flight: null,
            author_name: TEST_PLAYERS.find((p) => p.id === pid)!.name,
            author_player_id: pid,
            client_id: id,
            logged_at: at(h.number, seq * 20),
          });
          if (told === "every" && sh.from && seq > 1)
            gps.push({
              id: `gps-${id}`,
              round_id: TEST_ROUND_ID,
              hole: h.number,
              player_id: pid,
              client_id: `gps-${id}`,
              accuracy: 5,
              to_front: sh.from - 12,
              to_middle: sh.from,
              to_back: sh.from + 12,
              from_tee: null,
              source: "gps",
              seq,
              ignored: false,
              author_name: null,
              taken_at: at(h.number, seq * 20 - 5),
            });
        });
      }
      entries.push({ id: `e-${game}-${h.number}`, round_id: TEST_ROUND_ID, game, hole: h.number, scores, ctp_winner: null, ld_winner: null, conceded: null, updated_by: null, updated_at: at(h.number, 200) });
    }
  const post = (id: string, p: Partial<PostRow>): PostRow => ({
    id,
    tournament_id: TEST_TOURNAMENT_ID,
    round_id: TEST_ROUND_ID,
    hole: null,
    author_name: "Neil Brennan",
    author_player_id: "neil",
    kind: "note",
    body: null,
    tags: [],
    media_path: null,
    visibility: "public",
    hidden: false,
    created_at: T0,
    player_ids: [],
    ...p,
  });
  const posts: PostRow[] =
    told === "scores"
      ? []
      : [
          post("voice-neil-18", { hole: 18, kind: "note", tags: ["voice"], visibility: "report", body: "Couldn't feel my hands over that last putt, honestly.", player_ids: ["neil"], created_at: at(18, 240) }),
          post("voice-paddy-11", { hole: 11, kind: "note", tags: ["voice"], visibility: "report", author_name: "Paddy Walsh", author_player_id: "paddy", body: "Two up now and Neil has gone very quiet.", player_ids: ["paddy"], created_at: at(11, 240) }),
          post("clip-neil-17", { hole: 17, kind: "video", body: "Neil for birdie on 17", player_ids: ["neil"], details: told === "every" ? { shotId: "neil-17-3" } : { seq: 3 } as never, created_at: at(17, 70) }),
        ];
  const holeNotes: HoleNoteRow[] = [{ round_id: TEST_ROUND_ID, game: "g1", hole: 12, wind: "Hurting, strong", by_name: "Neil Brennan", updated_at: at(12) }];
  return {
    tournament,
    players: TEST_PLAYERS,
    rounds: [round],
    entries,
    attestations: [],
    posts,
    comments: [],
    pieces: [],
    votes: [],
    shots,
    gps,
    likes: [],
    cards: [],
    signatures: [],
    holeNotes,
  };
}
