/**
 * What the writer is handed, the grid way: the grid, the figures, the moments worth telling (ranked, with a running
 * order and a word count), the rounds before, the story so far and how earlier pieces opened. Also the facts the fact
 * check reads. Pure: built from the tournament's state; the server adds the weather.
 */
import { buildGrid, gridText, toldLevel, type GridOpts, type GridRow } from "./grid";
import { figuresText, matchFigures, playerFigures, tripFiguresText, tripFigures } from "./figures";
import { findMoments, momentsText, pickMoments, shapeOf, SHAPES, type Moment, type Shape } from "./moments";
import type { AiPieceRow, TournamentState } from "./types";

export type PieceKind = AiPieceRow["kind"];

/** Tired phrases the writer must never use */
export const BANNED_PHRASES = [
  "a round to remember",
  "a day to remember",
  "the stuff of legend",
  "stuff of legends",
  "the rest is history",
  "wrote his name",
  "etched in history",
  "a masterclass",
  "when the dust settled",
  "rose to the occasion",
  "dug deep",
  "nerves of steel",
  "a tale of two halves",
  "a game of two halves",
  "left it all out there",
  "one for the ages",
];

/** How many moments each kind of piece gets */
export const MOMENT_COUNT: Record<PieceKind, number> = { report: 8, bulletin: 3, tournament: 12, preview: 4 };

export interface WriterBrief {
  /** Every round's grid used (in round order) */
  rows: GridRow[];
  moments: Moment[];
  shape: Shape | null;
  told: "scores" | "some" | "most";
  /** The blocks for the writer, each with its heading */
  blocks: { head: string; text: string }[];
  /** What the fact check reads */
  facts: string;
}

/** A player's round in a line, every hole's score: "Neil R1: 5 4 3 6 … (78)" */
function cardLines(rows: GridRow[]): string {
  const out: string[] = [];
  for (const pid of [...new Set(rows.map((r) => r.playerId))]) {
    const mine = rows.filter((r) => r.playerId === pid).sort((a, b) => a.index - b.index);
    const f = playerFigures(mine);
    out.push(`${mine[0].name} R${mine[0].round}: ${mine.map((r) => `${r.hole}:${r.score.pickedUp ? "P" : (r.score.gross ?? "-")}`).join(" ")}${f.gross != null ? ` (${f.gross})` : f.pts != null ? ` (${f.pts} pts)` : ""}`);
  }
  return out.join("\n");
}

/** The rounds before, each player in a line, so the story finder's repeats and turnarounds have their background */
function earlierText(byRound: GridRow[][]): string {
  const out: string[] = [];
  for (const rows of byRound) {
    if (!rows.length) continue;
    for (const pid of [...new Set(rows.map((r) => r.playerId))]) {
      const mine = rows.filter((r) => r.playerId === pid).sort((a, b) => a.index - b.index);
      const f = playerFigures(mine);
      const trouble = mine.filter((r) => r.strokes.some((s) => s.outcomeFrom === "told" && /^(Out of bounds|Water)$/i.test(s.outcome ?? ""))).map((r) => `H${r.hole}`);
      const bits = [
        f.pts != null ? `${f.pts} pts` : f.gross != null ? `${f.gross} gross` : null,
        f.birdies.length ? `birdies ${f.birdies.map((h) => `H${h}`).join(", ")}` : null,
        f.doubles.length ? `doubles or worse ${f.doubles.map((h) => `H${h}`).join(", ")}` : null,
        f.putts.threePutts.length ? `three-putts ${f.putts.threePutts.map((h) => `H${h}`).join(", ")}` : null,
        trouble.length ? `water or out of bounds ${trouble.join(", ")}` : null,
      ].filter(Boolean);
      out.push(`R${mine[0].round} ${mine[0].name}: ${bits.join("; ")}`);
    }
    for (const gid of [...new Set(rows.map((r) => r.gameId))]) {
      const m = matchFigures(rows.filter((r) => r.gameId === gid));
      if (m?.finished) out.push(`R${m.round} ${m.winner ? `${m.winner} beat ${m.winner === m.a ? m.b : m.a} ${m.margin}` : `${m.a} and ${m.b} halved`}`);
    }
  }
  return out.join("\n");
}

/** The first sentence of each earlier piece on the trip, so the next one doesn't open the same way */
export function openingsOf(s: Pick<TournamentState, "pieces">, roundId: string | null, kind: PieceKind): string[] {
  return s.pieces
    .filter((p) => p.status === "published" && p.body && (kind !== "bulletin" ? p.kind !== "bulletin" : p.round_id === roundId))
    .sort((a, b) => (a.published_at ?? a.created_at).localeCompare(b.published_at ?? b.created_at))
    .slice(-6)
    .map((p) => (p.body.split(/\n\s*\n/)[0].match(/^[^.!?]+[.!?]/)?.[0] ?? p.body.slice(0, 140)).trim());
}

/** The storylines earlier pieces left (threads to pick up), newest last */
export function storylinesOf(s: Pick<TournamentState, "pieces" | "rounds">): string[] {
  const out: string[] = [];
  for (const p of [...s.pieces].filter((x) => x.status === "published" && x.kind !== "bulletin").sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-6)) {
    const lines = Array.isArray(p.storylines) ? p.storylines.filter((x): x is string => typeof x === "string") : [];
    const r = s.rounds.find((x) => x.id === p.round_id);
    const where = p.kind === "tournament" ? "the review" : `${p.kind}${r ? `, Round ${r.number}` : ""}`;
    if (lines.length) out.push(`From the ${where}: ${lines.join("; ")}`);
    else if (p.title) out.push(`From the ${where}: headline “${p.title}”`);
  }
  return out;
}

export interface BriefOpts extends GridOpts {
  /** The weather's wind for each round (by round id) */
  weatherFor?: (roundId: string) => GridOpts["weatherWind"];
  gameId?: string;
  hole?: number;
}

/** Everything the grid writer is handed for a piece */
export function writerBrief(s: TournamentState, kind: PieceKind, roundId: string | null, opts: BriefOpts = {}): WriterBrief {
  const units = s.tournament.units === "metres" ? "metres" : "yards";
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  const round = roundId ? rounds.find((r) => r.id === roundId) ?? null : null;
  const gridOf = (id: string) => buildGrid(s, id, { weatherWind: opts.weatherFor?.(id) ?? opts.weatherWind });
  const byRound = new Map(rounds.map((r) => [r.id, gridOf(r.id)]));
  const before = round ? rounds.filter((r) => r.number < round.number) : [];
  const earlier = before.map((r) => byRound.get(r.id)!).filter((x) => x.length);
  const end = kind === "tournament" || !!s.tournament.finished_at;
  const blocks: WriterBrief["blocks"] = [];
  const facts: string[] = [];
  let rows: GridRow[] = [];
  let moments: Moment[] = [];
  let shape: Shape | null = null;

  if (round && (kind === "report" || kind === "bulletin")) {
    rows = byRound.get(round.id) ?? [];
    if (kind === "bulletin") {
      // The game the bulletin is about (or all of them), up to the hole just played
      const games = opts.gameId ? rows.filter((r) => r.gameId === opts.gameId) : rows;
      const upTo = opts.hole != null ? (games.find((r) => r.hole === opts.hole)?.index ?? Infinity) : Infinity;
      rows = games.filter((r) => r.index <= upTo);
    }
    const all = findMoments(rows, { earlier, players: s.players, end });
    if (kind === "bulletin" && opts.hole != null) {
      // What just happened comes first
      const now = all.filter((m) => m.refs.some((r) => r.hole === opts.hole));
      moments = pickMoments([...now, ...all.filter((m) => !now.includes(m))], MOMENT_COUNT.bulletin, rows);
    } else moments = pickMoments(all, MOMENT_COUNT[kind], rows);
    if (kind === "report") shape = shapeOf(moments, rows);
    const grid = gridText(rows, units);
    const figs = figuresText(rows, earlier, units);
    blocks.push({ head: `THE GRID, ROUND ${round.number} (one row for each player on each hole; told, known from the score, or not told)`, text: grid });
    blocks.push({ head: "THE FIGURES (worked out by the app: quote them as given, with what they're out of; never as percentages; never count again)", text: figs });
    blocks.push({ head: "THE MOMENTS WORTH TELLING (found by the app from the grid, best first; each names the rows that prove it)", text: momentsText(moments) || "None stand out: tell it straight from the grid." });
    facts.push(`THE GRID\n${grid}`, `THE FIGURES\n${figs}`, `EVERY SCORE\n${cardLines(rows)}`);
  } else if (kind === "tournament") {
    // The review: each round's best moments, the trip's figures, and every score
    const all = rounds.map((r) => byRound.get(r.id)!).filter((x) => x.length);
    rows = all.flat();
    const lastRound = all[all.length - 1] ?? [];
    const picked: Moment[] = [];
    all.forEach((rs, i) => {
      const found = findMoments(rs, { earlier: all.slice(0, i), players: s.players, end: rs === lastRound, review: rs === lastRound });
      picked.push(...pickMoments(found, rs === lastRound ? 5 : 3, rs));
    });
    moments = pickMoments(picked.sort((a, b) => b.score - a.score), MOMENT_COUNT.tournament, rows);
    const trip = tripFiguresText(tripFigures(all));
    const figs = all.map((rs) => figuresText(rs, [], units)).join("\n\n");
    blocks.push({ head: "THE MOMENTS OF THE TRIP (found by the app, best first)", text: momentsText(moments) || "None stand out: tell it from the standings and the cards." });
    blocks.push({ head: "THE FIGURES, ROUND BY ROUND (quote as given, never as percentages, never count again)", text: figs });
    if (trip) blocks.push({ head: "THE TRIP IN FIGURES", text: trip });
    // The holes the moments are about, in full
    const keys = new Set(moments.flatMap((m) => m.refs.map((r) => `${r.round}|${r.hole}`)));
    const detail = rows.filter((r) => keys.has(`${r.round}|${r.hole}`));
    if (detail.length) blocks.push({ head: "THE GRID FOR THOSE HOLES", text: gridText(detail, units) });
    facts.push(`THE FIGURES\n${figs}`, trip ? `THE TRIP\n${trip}` : "", detail.length ? `THE GRID FOR THE MOMENTS' HOLES\n${gridText(detail, units)}` : "", `EVERY SCORE\n${all.map(cardLines).join("\n")}`);
  } else if (kind === "preview") {
    // Form from the rounds before
    const all = before.map((r) => byRound.get(r.id)!).filter((x) => x.length);
    if (all.length) {
      const picked = all.flatMap((rs, i) => pickMoments(findMoments(rs, { earlier: all.slice(0, i), players: s.players }), 3, rs));
      moments = picked;
      blocks.push({ head: "WHAT HAPPENED IN THE ROUNDS BEFORE (found by the app)", text: momentsText(picked) });
      const trip = tripFiguresText(tripFigures(all));
      if (trip) blocks.push({ head: "FORM SO FAR", text: trip });
      facts.push(`EARLIER ROUNDS\n${earlierText(all)}`, trip);
    }
  }

  if (earlier.length && kind !== "tournament") {
    const t = earlierText(earlier);
    blocks.push({ head: "THE ROUNDS BEFORE THIS ONE (each player in a line)", text: t });
    facts.push(`THE ROUNDS BEFORE\n${t}`);
  }
  const story = storylinesOf(s);
  if (story.length) blocks.push({ head: "THE STORY SO FAR (storylines from earlier pieces: pick up the threads, but don't repeat their lines; facts come from the grid)", text: story.join("\n") });
  const openings = openingsOf(s, roundId, kind);
  if (openings.length) blocks.push({ head: "HOW EARLIER PIECES OPENED (don't open the same way again)", text: openings.map((o) => `- ${o}`).join("\n") });

  return { rows, moments, shape, told: rows.length ? toldLevel(rows) : "scores", blocks, facts: facts.filter(Boolean).join("\n\n") };
}

/** The running order for a round report, from its shape */
export function runningOrder(b: WriterBrief): string {
  if (!b.shape) return "";
  const sh = SHAPES[b.shape];
  return [
    `SHAPE: ${sh.label}. Open with ${sh.open}; then ${sh.then}.`,
    "Then cover each match or group result, the side games, what it means for the trip, and end on a call-back or what's next.",
    "This is a guide, not a template: it must cover the top moment and every result, and you can move things to tell the story better.",
  ].join("\n");
}

/** How long, from how much was told (within the organiser's short, standard or long) */
export function gridLength(kind: PieceKind, told: WriterBrief["told"], whole = false): string {
  if (kind === "bulletin") return "60–110 words, punchy, like a live blog update";
  if (kind === "preview") return whole ? "550–800 words" : "250–380 words";
  if (kind === "report") return told === "scores" ? "about 200 words, crisp" : told === "some" ? "350–500 words" : "500–650 words";
  return told === "scores" ? "300–420 words" : told === "some" ? "450–650 words" : "600–800 words";
}

/** The guard rails added for the grid (today's rules all stay) */
export const GRID_RULES = `RULES FOR THE GRID:
- Not told stays not told. A cell marked not told is never filled in, guessed at or hinted at. "Known from the score" can be said plainly but not dressed up: the last stroke went in, but nobody says it was a putt or a 30-footer unless that was told.
- The score wins. If the shots and the score ever disagree, the score stands and the gap is treated as not told.
- Figures as given: quoted with what they're out of ("5 of the 9 fairways told"), never turned into percentages, never added up again by you.
- Voice notes ("said to the commentators") are paraphrased, never quoted. Quotes come only from things posted publicly (marked "posted") or a player's own pre-trip quote.
- Kind, always. A disaster is told with affection. A player having a bad day isn't the joke in every paragraph, and a pick-up is mentioned lightly or not at all unless it cost a match.
- Everyone in a group gets a mention; nobody takes the piece over.
- Never use these tired phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.`;

