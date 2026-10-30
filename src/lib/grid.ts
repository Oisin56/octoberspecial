/**
 * The grid: everything told on the course, as one table the AI writers read. One row for each player on each hole,
 * every row the same shape, whether the hole was told in full or not at all. Built fresh each time something is
 * written, from what's already saved; nobody fills it in.
 *
 * Every cell is one of three kinds, and the writer is told which: told (somebody tapped it, or GPS measured it),
 * known from the score (stroke 1 is the tee shot, the last stroke went in), or not told (left empty, never filled in).
 *
 * Pure: the writer, the film, the fact check and the tests all share it.
 */
import { courseBySlug } from "../data/courses";
import { GUIDES } from "../data/course-guides";
import { inUnits, unitWord } from "./gps";
import { ONE_BALL, cardHole, gameHole, gameShots, playerHoles, type Game, type RoundCfg } from "./engine";
import { KIND_WORD, waterIn } from "./detail";
import { strokeRows } from "./strokes";
import { clipTypeOf } from "./film";
import { toEntries, toRoundCfg, toTournamentCfg, type CourseGuide, type PostRow, type RoundRow, type TournamentState } from "./types";
import type { ShotKind } from "./shots";

// ------------------------------------------------------------ the shape of a row

export type Source = "told" | "score" | "none";

export interface GridStroke {
  seq: number;
  /** tee, approach, chip, putt… */
  kind: string | null;
  kindFrom: Source;
  /** Yards to the middle of the green when it was played (GPS) */
  from: number | null;
  /** The tee shot's length, about (GPS) */
  drive: number | null;
  club: string | null;
  /** A putt's length (Tap-in, 3 to 10 ft…) */
  length: string | null;
  outcome: string | null;
  outcomeFrom: Source;
  contact: string | null;
  shape: string | null;
  flight: string | null;
  /** A clip of this stroke */
  clipId: string | null;
}

export type Told = "score" | "some" | "every";

export interface GridRow {
  roundId: string;
  round: number;
  courseSlug: string;
  hole: number;
  /** Where the hole comes in the round (0 = the first hole played) */
  index: number;
  par: number;
  si: number;
  yards: number | null;
  /** What's in play, from the course guide: water, bunkers, out of bounds */
  inPlay: string[];
  wind: string | null;
  /** Who said what the wind was: the group, or the weather */
  windBy: "group" | "weather" | null;
  playerId: string;
  name: string;
  gameId: string;
  /** The side the player is on in that game */
  sideId: string;
  /** Handicap shots received on this hole */
  received: number;
  score: {
    gross: number | null;
    net: number | null;
    /** birdie, par, double bogey… (null when picked up or not in) */
    word: string | null;
    /** Stableford points (null when the round isn't Stableford) */
    pts: number | null;
    pickedUp: boolean;
    /** Their side gave the hole away */
    conceded: boolean;
  };
  game: {
    kind: "match" | "field" | "skins" | "solo";
    /** Match play: the match before and after the hole, from this player's side ("1 down", "all square") */
    before: string | null;
    after: string | null;
    /** Match play: the hole, from this player's side */
    hole: "won" | "halved" | "lost" | null;
    /** The match was already over before this hole */
    over: boolean;
    /** Match play: holes up (+) or down (−) after the hole, and holes left */
    up: number | null;
    left: number | null;
    /** Stableford or stroke play: their place in the round after the hole ("2nd", "tied 3rd") */
    place: string | null;
    /** Skins: won the skin on this hole */
    skin: boolean | null;
  };
  strokes: GridStroke[];
  clips: string[];
  said: {
    /** Said privately to the commentators: use what was said, never quote it */
    voice: string[];
    /** Posted publicly (a clip's caption, a note): may be quoted */
    posted: string[];
  };
  told: Told;
}

// ------------------------------------------------------------ the course

/** The course guide for a round (the organiser's, or the built-in one). Pure: no server needed. */
export function guideOf(r: Pick<RoundRow, "course_guide" | "course_slug">): CourseGuide | null {
  if (r.course_guide) return r.course_guide;
  const local = courseBySlug(r.course_slug.replace(/^local:/, ""));
  return local ? (GUIDES[local.slug] ?? null) : null;
}

/** What's in play on a hole, read from the guide's note for it */
export function inPlayOf(note?: string | null): string[] {
  if (!note) return [];
  const out: string[] = [];
  if (waterIn(note)) out.push("water");
  if (/bunker|sand/i.test(note)) out.push("bunkers");
  if (/out of bounds|\bO\.?B\b|boundary/i.test(note)) out.push("out of bounds");
  return out;
}

// ------------------------------------------------------------ words

export function scoreWord(gross: number | null | undefined, par: number): string | null {
  if (gross == null || gross <= 0) return null;
  if (gross === 1) return "hole in one";
  const d = gross - par;
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double bogey";
  if (d === 3) return "triple bogey";
  return `${d} over par`;
}

export const nth = (n: number) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

const holedRe = /^Holed/i;
export const holedOut = (st: GridStroke) => !!st.outcome && holedRe.test(st.outcome);

// ------------------------------------------------------------ building it

export interface GridOpts {
  /** The weather's wind on a hole when it was played (the group's word wins) */
  weatherWind?: (hole: number, at: string | null) => string | null;
}

/** Match play, from one side's view: the label after each hole of the card, and whether it was over by then. */
function matchWalk(cfg: RoundCfg, g: Game, shots: Record<string, number>, entries: ReturnType<typeof toEntries>[string], sideId: string) {
  const holes = cfg.holes.map((h) => h.number);
  const total = holes.length;
  let diff = 0;
  let played = 0;
  let over: string | null = null;
  const after = new Map<number, { label: string; hole: "won" | "halved" | "lost" | null; overBefore: boolean; up: number; left: number }>();
  const label = (d: number, left: number) => {
    if (left === 0) return d === 0 ? "halved" : d > 0 ? `won ${d} up` : `lost ${-d} down`;
    if (Math.abs(d) > left) return d > 0 ? `won ${d}&${left}` : `lost ${-d}&${left}`;
    if (d === 0) return "all square";
    return `${Math.abs(d)} ${d > 0 ? "up" : "down"}${Math.abs(d) === left ? " (dormie)" : ""}`;
  };
  for (const n of holes) {
    const gh = gameHole(cfg, g, shots, entries.find((e) => e.game === g.id && e.hole === n));
    const overBefore = !!over;
    let res: "won" | "halved" | "lost" | null = null;
    if (gh.complete) {
      res = gh.winner === sideId ? "won" : gh.winner === "halved" || gh.winner == null ? "halved" : "lost";
      if (!over) {
        played++;
        diff += res === "won" ? 1 : res === "lost" ? -1 : 0;
        const left = total - played;
        if (left === 0 || Math.abs(diff) > left) over = label(diff, left);
      }
    }
    after.set(n, { label: over ?? label(diff, total - played), hole: res, overBefore, up: diff, left: total - played });
  }
  return after;
}

/** Places in the round after each hole (Stableford or stroke play, more than two players): pid|hole → "2nd". */
function fieldPlaces(cfg: RoundCfg, holes: Record<string, Record<number, { pts: number; net: number | null; par: number; done: boolean }>>, stroke: boolean) {
  const out = new Map<string, string>();
  const pids = Object.keys(holes);
  if (pids.length < 3) return out;
  const card = cfg.holes.map((h) => h.number);
  for (let k = 0; k < card.length; k++) {
    const upTo = card.slice(0, k + 1);
    const vals: [string, number][] = [];
    for (const pid of pids) {
      const done = upTo.map((n) => holes[pid][n]).filter((x) => x?.done);
      if (!done.length || !holes[pid][card[k]]?.done) continue;
      vals.push([pid, done.reduce((a, h) => a + (stroke ? (h.net ?? h.par + 2) - h.par : h.pts), 0)]);
    }
    for (const [pid, v] of vals) {
      const better = vals.filter(([, x]) => (stroke ? x < v : x > v)).length;
      const same = vals.filter(([, x]) => x === v).length;
      out.set(`${pid}|${card[k]}`, `${same > 1 ? "tied " : ""}${nth(better + 1)}`);
    }
  }
  return out;
}

export function buildGrid(s: TournamentState, roundId: string, opts: GridOpts = {}): GridRow[] {
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const cfg = toRoundCfg(round, s.players);
  const tcfg = toTournamentCfg(s);
  const byRound = toEntries(s.entries);
  const entries = byRound[roundId] ?? [];
  const ph = playerHoles(tcfg, byRound)[roundId] ?? {};
  const guide = guideOf(round);
  const shots = (s.shots ?? []).filter((x) => x.round_id === roundId);
  const readings = (s.gps ?? []).filter((x) => x.round_id === roundId);
  const clips = s.posts.filter((p) => p.kind === "video" && p.round_id === roundId && !p.hidden && clipTypeOf(p) === "shot");
  const notes = s.posts.filter((p) => p.round_id === roundId && !p.hidden && p.kind !== "photo");
  const name = (pid: string) => s.players.find((p) => p.id === pid)?.name ?? pid;
  const updatedAt = (game: string, hole: number) => s.entries.find((e) => e.round_id === roundId && (e.game ?? "main") === game && e.hole === hole)?.updated_at ?? null;
  const stroke = cfg.scoring === "stroke";
  const places = cfg.scoring === "stableford" || stroke ? fieldPlaces(cfg, ph, stroke) : new Map<string, string>();
  const solo = !!s.tournament.solo;
  const rows: GridRow[] = [];

  for (const g of cfg.games) {
    const shotsOf = gameShots(g.free ? { ...cfg, scoring: "stableford", play: "singles" } : cfg, g, tcfg.players);
    const match = !g.free && cfg.scoring === "match" && g.sides.length === 2;
    const walks = match ? new Map(g.sides.map((sd) => [sd.id, matchWalk(cfg, g, shotsOf, entries, sd.id)])) : null;
    cfg.holes.forEach((h, index) => {
      const entry = entries.find((e) => e.game === g.id && e.hole === h.number);
      const yards = round.holes.find((x) => x.number === h.number)?.yards ?? null;
      const note = guide?.holes[String(h.number)] ?? null;
      const told = (s.holeNotes ?? []).find((n) => n.round_id === roundId && n.game === g.id && n.hole === h.number && n.wind);
      const weather = told ? null : (opts.weatherWind?.(h.number, updatedAt(g.id, h.number)) ?? null);
      const gh = entry && cfg.scoring === "skins" ? gameHole(cfg, g, shotsOf, entry) : null;
      for (const side of g.sides) {
        for (const pid of side.playerIds) {
          const ball = ONE_BALL.includes(cfg.play) ? side.id : pid;
          const b = entry?.scores[ball];
          const mine = shots.filter((x) => x.hole === h.number && x.player_id === pid);
          const reads = readings.filter((x) => x.hole === h.number && x.player_id === pid);
          const conceded = !!entry?.conceded && entry.conceded === side.id;
          if (!b && !mine.length && !reads.length && !conceded) continue;
          const pickedUp = !!b?.pickedUp;
          const gross = b?.gross != null && !pickedUp ? b.gross : null;
          const own = ph[pid]?.[h.number];
          const par = own?.par ?? cardHole(cfg.holes, h.number)?.par ?? h.par;
          const sr = strokeRows({
            shots: mine,
            readings: reads,
            gross,
            holeYards: yards,
            clips: clips.filter((c) => c.hole === h.number),
            pickedUp: pickedUp || (conceded && gross == null),
            playerId: pid,
          });
          const strokes: GridStroke[] = sr.map((r) => {
            const sh = r.shot;
            const autoKind = r.auto?.kind ?? null;
            const autoOut = r.auto?.outcome ?? null;
            return {
              seq: r.seq,
              kind: sh?.kind ?? autoKind,
              kindFrom: sh ? "told" : autoKind ? "score" : "none",
              from: r.from,
              drive: r.drive,
              club: sh?.kind === "putt" ? null : (sh?.club ?? null),
              length: sh?.kind === "putt" ? (sh.distance ?? null) : null,
              outcome: sh?.outcome || autoOut || null,
              outcomeFrom: sh?.outcome ? "told" : autoOut ? "score" : "none",
              contact: sh?.contact ?? null,
              shape: sh?.shape ?? null,
              flight: sh?.flight ?? null,
              clipId: r.clip?.id ?? null,
            };
          });
          const toldN = strokes.filter((x) => x.kindFrom === "told" || x.outcomeFrom === "told" || x.from != null).length;
          const full = strokes.length > 0 && strokes.every((x) => x.outcomeFrom === "told" || (x.outcomeFrom === "score" && x.seq === strokes.length && x.seq > 1));
          const walk = walks?.get(side.id);
          const before = walk ? (index === 0 ? "all square" : walk.get(cfg.holes[index - 1].number)!.label) : null;
          const now = walk?.get(h.number);
          const about = (p: PostRow) => (p.player_ids?.length ? p.player_ids.includes(pid) : p.author_player_id === pid);
          rows.push({
            roundId,
            round: round.number,
            courseSlug: round.course_slug,
            hole: h.number,
            index,
            par,
            si: own ? (cardHole(cfg.playerTees?.[ball]?.holes ?? cfg.holes, h.number)?.si ?? h.si) : h.si,
            yards,
            inPlay: inPlayOf(note),
            wind: told?.wind ?? weather,
            windBy: told?.wind ? "group" : weather ? "weather" : null,
            playerId: pid,
            name: name(pid),
            gameId: g.id,
            sideId: side.id,
            received: own?.shots ?? 0,
            score: {
              gross,
              net: own?.net ?? null,
              word: scoreWord(gross, par),
              pts: cfg.scoring === "stableford" || g.free ? (own?.pts ?? null) : null,
              pickedUp,
              conceded,
            },
            game: {
              kind: solo ? "solo" : match ? "match" : cfg.scoring === "skins" ? "skins" : "field",
              before,
              after: now?.label ?? null,
              hole: now?.hole ?? null,
              over: !!now?.overBefore,
              up: now ? now.up : null,
              left: now ? now.left : null,
              place: places.get(`${pid}|${h.number}`) ?? null,
              skin: gh ? (gh.complete ? gh.winner === side.id : null) : null,
            },
            strokes,
            clips: clips.filter((c) => c.hole === h.number && (c.player_ids ?? []).includes(pid)).map((c) => c.id),
            said: {
              voice: notes.filter((p) => p.hole === h.number && p.tags.includes("voice") && about(p) && p.body).map((p) => p.body!.trim()),
              posted: notes
                .filter((p) => p.hole === h.number && !p.tags.includes("voice") && p.visibility !== "report" && (p.player_ids ?? []).includes(pid) && p.body?.trim())
                .map((p) => p.body!.trim()),
            },
            told: toldN === 0 ? "score" : full ? "every" : "some",
          });
        }
      }
    });
  }
  return rows;
}

// ------------------------------------------------------------ as the writer reads it

const KIND: Record<string, string> = { ...KIND_WORD, tee: "tee shot", second: "second", approach: "approach", chip: "chip", bunker: "bunker shot", putt: "putt", recovery: "recovery", penalty: "penalty" };
const kindWord = (k: string | null) => (k ? (KIND[k as ShotKind] ?? k).toLowerCase() : "");

/** One stroke as the writer reads it: "3 from 25 yds · chip · close · flushed [filmed]" */
export function strokeText(st: GridStroke, units: "yards" | "metres" = "yards"): string {
  const u = unitWord(units, true);
  if (st.kind === "penalty") return `${st.seq} penalty stroke`;
  // The last stroke went in: that's all the score says (not that it was a putt, or how long)
  if (st.kindFrom === "score" && st.outcomeFrom === "score") return `${st.seq} holed (known from the score)${st.clipId ? " [filmed]" : ""}`;
  const bits: string[] = [];
  const told = st.kindFrom === "told" || st.outcomeFrom === "told";
  const kind = st.kind ? (st.kindFrom === "score" && !told ? `${kindWord(st.kind)} (known from the score)` : kindWord(st.kind)) : "stroke";
  bits.push(`${st.seq} ${kind}${st.from != null ? ` from ${inUnits(st.from, units)} ${u}` : ""}`);
  if (st.club) bits.push(st.club);
  if (st.length) bits.push(st.length);
  if (st.outcome) bits.push(st.outcomeFrom === "score" ? `${st.outcome.toLowerCase()} (known from the score)` : st.outcome.toLowerCase());
  else bits.push("outcome not told");
  const extras = [st.contact, st.shape, st.flight && st.flight !== "Normal" ? `${st.flight} flight` : null].filter(Boolean).map((x) => x!.toLowerCase());
  if (extras.length) bits.push(extras.join(", "));
  if (st.drive != null) bits.push(`went about ${inUnits(st.drive, units)} ${u}`);
  return bits.join(" · ") + (st.clipId ? " [filmed]" : "");
}

/** A hole's strokes, with a run of strokes nobody told said once ("2 to 4 not told") */
export function strokeLines(strokes: GridStroke[], units: "yards" | "metres" = "yards"): string[] {
  const out: string[] = [];
  let gap: number[] = [];
  const flush = () => {
    if (gap.length) out.push(gap.length === 1 ? `${gap[0]} not told` : `${gap[0]} to ${gap[gap.length - 1]} not told`);
    gap = [];
  };
  for (const st of strokes) {
    if (st.kindFrom === "none" && st.outcomeFrom === "none" && st.from == null && !st.clipId) {
      gap.push(st.seq);
      continue;
    }
    flush();
    out.push(strokeText(st, units));
  }
  flush();
  return out;
}

const SAID_VOICE = "said to the commentators (use it in your own words, never quote it)";

/** A player's line under the hole: "Neil (gets 1) · 4, birdie, 3 pts · match: 1 down › all square, won the hole" */
export function playerLine(r: GridRow): string {
  const sc = r.score;
  const score = sc.conceded && sc.gross == null ? "conceded the hole" : sc.pickedUp ? `picked up${sc.pts != null ? `, ${sc.pts} pts` : ""}` : sc.gross != null ? [String(sc.gross), sc.word, sc.pts != null ? `${sc.pts} pt${sc.pts === 1 ? "" : "s"}` : null].filter(Boolean).join(", ") : "no score in";
  const game =
    r.game.kind === "match"
      ? r.game.over
        ? "match already over"
        : `match: ${r.game.before} › ${r.game.after}${r.game.hole ? `, ${r.game.hole === "won" ? "won the hole" : r.game.hole === "lost" ? "lost the hole" : "halved the hole"}` : ""}`
      : r.game.kind === "skins"
        ? r.game.skin
          ? "won the skin"
          : null
        : r.game.place
          ? `${r.game.place} in the round after it`
          : null;
  return [`${r.name}${r.received ? ` (gets ${r.received})` : ""}`, score, game].filter(Boolean).join(" · ");
}

/** The whole round, hole by hole, as a caddie's notebook. */
export function gridText(rows: GridRow[], units: "yards" | "metres" = "yards"): string {
  const out: string[] = [];
  const u = unitWord(units, true);
  const keys = [...new Set(rows.map((r) => `${r.round}|${r.index}|${r.gameId}`))];
  const ordered = keys.sort((a, b) => {
    const [ra, ia] = a.split("|").map(Number);
    const [rb, ib] = b.split("|").map(Number);
    return ra - rb || ia - ib;
  });
  let lastHead = "";
  for (const k of ordered) {
    const group = rows.filter((r) => `${r.round}|${r.index}|${r.gameId}` === k);
    const h = group[0];
    const head = [
      `R${h.round} H${h.hole} par ${h.par} SI ${h.si}${h.yards ? ` ${inUnits(h.yards, units)} ${u}` : ""}`,
      h.inPlay.length ? `in play: ${h.inPlay.join(", ")}` : null,
      h.wind ? `wind: ${h.wind.toLowerCase()}${h.windBy === "group" ? " (the group said)" : " (from the weather)"}` : null,
    ];
    const headLine = head.filter(Boolean).join(" · ");
    // The next group on the same hole: the hole once (unless their wind was different)
    if (headLine !== lastHead) {
      if (out.length) out.push("");
      out.push(headLine);
    }
    lastHead = headLine;
    for (const r of group) {
      out.push(playerLine(r));
      if (r.told !== "score") out.push(...strokeLines(r.strokes, units).map((l) => `  ${l}`));
      for (const v of r.said.voice) out.push(`  ${SAID_VOICE}: ${v}`);
      for (const p of r.said.posted) out.push(`  posted: “${p}”`);
      out.push(`  told: ${r.told === "every" ? "every shot" : r.told === "some" ? "some shots" : "score only"}`);
    }
  }
  return out.join("\n").trim();
}

/** How much of a round was told: scores only, some shots, or most holes in detail. */
export function toldLevel(rows: GridRow[]): "scores" | "some" | "most" {
  const played = rows.filter((r) => r.score.gross != null || r.score.pickedUp);
  if (!played.length) return "scores";
  // In detail: every shot told, or at least half of them (a tee shot on its own is "some")
  const toldN = (r: GridRow) => r.strokes.filter((x) => x.outcomeFrom === "told").length;
  const detailed = played.filter((r) => r.told === "every" || (r.strokes.length > 0 && toldN(r) * 2 >= r.strokes.length)).length;
  const any = played.filter((r) => r.told !== "score").length;
  return detailed / played.length >= 0.5 ? "most" : any / played.length >= 0.1 ? "some" : "scores";
}
