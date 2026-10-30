/**
 * The story finder: before a word is written, the app reads the grid and lists the moments worth telling, ranked,
 * each tied to the rows that prove it. Plain rules, not AI, so it's quick, costs nothing and finds the same moments
 * every time. Also picks the shape of a round report from what happened.
 *
 * Pure: built from the grid and the figures.
 */
import { nth, type GridRow } from "./grid";
import { matchFigures, playerFigures, roundFigures, type MatchFigures } from "./figures";
import type { PlayerRow } from "./types";

export type MomentKind =
  | "decided"
  | "leadChange"
  | "comeback"
  | "leadLost"
  | "bigHole"
  | "disaster"
  | "run"
  | "againstType"
  | "repeat"
  | "callBack"
  | "first"
  | "shotOfDay"
  | "result";

export const MOMENT_WORD: Record<MomentKind, string> = {
  decided: "decided it",
  leadChange: "a lead changed",
  comeback: "a comeback",
  leadLost: "a lead let slip",
  bigHole: "a big hole",
  disaster: "a disaster",
  run: "a run",
  againstType: "against type",
  repeat: "a repeat",
  callBack: "a call-back",
  first: "a first or a best",
  shotOfDay: "shot of the day",
  result: "their round",
};

/** What a moment changed: the trip, a match (or the round), a stretch of holes, a single hole */
export type Scope = 1 | 2 | 3 | 4;

export interface Ref {
  round: number;
  hole: number;
  playerId: string;
}

export interface Moment {
  id: string;
  kind: MomentKind;
  /** The fact, in plain words, from the grid and the figures only */
  text: string;
  /** Who it's about, the main one first */
  who: string[];
  refs: Ref[];
  scope: Scope;
  /** How rare: 0 (a birdie) to 3 (a hole in one) */
  rarity: number;
  /** Its shots were told, it was filmed or something was said about it */
  detail: boolean;
  clips: string[];
  said: { voice: string[]; posted: string[] };
  score: number;
}

/** The loser's side of a margin: "1 up" becomes "1 down"; "5&4" stays */
const loserMargin = (m: string | null) => (m ?? "").replace(/ up$/, " down");
const first = (name: string) => name.split(" ")[0];
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

interface Ctx {
  rows: GridRow[];
  earlier: GridRow[][];
  players: PlayerRow[];
  /** The tournament is over (call-backs and bests of the trip) */
  end: boolean;
  /** Written for the end of the trip (the review): a call-back is about the whole trip */
  review?: boolean;
  lastHole: number;
}

function make(c: Ctx, kind: MomentKind, text: string, who: string[], refs: Ref[], scope: Scope, rarity: number): Moment {
  const rows = refs.map((r) => c.rows.find((x) => x.hole === r.hole && x.playerId === r.playerId && x.round === r.round)).filter((x): x is GridRow => !!x);
  const clips = [...new Set(rows.flatMap((r) => [...r.clips, ...r.strokes.map((s) => s.clipId).filter((x): x is string => !!x)]))];
  const said = { voice: [...new Set(rows.flatMap((r) => r.said.voice))], posted: [...new Set(rows.flatMap((r) => r.said.posted))] };
  const detail = rows.some((r) => r.told !== "score") || clips.length > 0 || said.voice.length + said.posted.length > 0;
  const score = scope * 100 + rarity * 20 + (detail ? 10 : 0) + (clips.length ? 5 : 0);
  return { id: `${kind}:${refs.map((r) => `${r.round}.${r.hole}.${r.playerId}`).join(",") || who.join(",")}`, kind, text, who, refs, scope, rarity, detail, clips, said, score };
}

/** The holed stroke when it wasn't a putt (a chip-in, a holed approach, an ace) */
function holedFromOff(r: GridRow) {
  return r.strokes.find((s) => s.outcomeFrom === "told" && /^Holed/i.test(s.outcome ?? "") && s.kind && s.kind !== "putt");
}

function matchMoments(c: Ctx, m: MatchFigures): Moment[] {
  const out: Moment[] = [];
  const rowsOf = (hole: number, sid: string | null) => c.rows.filter((r) => r.gameId === m.gameId && r.hole === hole && (!sid || r.sideId === sid));
  const refs = (hole: number) => rowsOf(hole, null).map((r) => ({ round: r.round, hole, playerId: r.playerId }));
  const all = [...new Set(c.rows.filter((r) => r.gameId === m.gameId).map((r) => r.playerId))];
  const lastCard = Math.max(...c.rows.map((r) => r.index));
  if (!m.finished) {
    const now = m.path[m.path.length - 1];
    if (now) out.push(make(c, "leadChange", now.up === 0 ? `${m.a} and ${m.b} are all square through the ${nth(now.hole)}` : `${now.up > 0 ? m.a : m.b} is ${Math.abs(now.up)} up on ${now.up > 0 ? m.b : m.a} through the ${nth(now.hole)}`, all, refs(now.hole), 3, 0));
    return out;
  }
  const end = m.endHole!;
  const onLast = rowsOf(end, null)[0]?.index === lastCard;
  if (m.winnerId) {
    const W = m.winner!;
    const L = m.winner === m.a ? m.b : m.a;
    const wr = rowsOf(end, m.winnerId)[0];
    const lr = rowsOf(end, m.loserId)[0];
    const how =
      wr?.game.hole === "won"
        ? `, winning the ${nth(end)}${wr.score.word && wr.score.gross != null ? ` with ${article(wr.score.word)} ${wr.score.word}` : ""}${lr?.score.pickedUp ? ` after ${L} picked up` : ""}`
        : wr?.game.hole === "halved"
          ? `, a half on the ${nth(end)} enough`
          : "";
    const turnIdx = m.turnedOn != null ? (rowsOf(m.turnedOn, null)[0]?.index ?? 0) : 0;
    const turned = m.turnedOn && m.turnedOn !== end && turnIdx >= 3 ? ` It turned on the ${nth(m.turnedOn)}, where ${W} went ahead for good.` : "";
    out.push(make(c, "decided", `${W} beat ${L} ${m.margin}${onLast ? " on the last" : ""}${how}.${turned}`, [m.winnerId, m.loserId!], refs(end), 3, onLast ? 2 : 1));
    if (m.deepest && m.deepest.down >= 2) {
      const at = c.rows.find((r) => r.gameId === m.gameId && r.hole === m.deepest!.hole);
      const left = at?.game.left;
      out.push(make(c, "comeback", `${m.deepest.name} was ${m.deepest.down} down after the ${nth(m.deepest.hole)}${left ? ` with ${left} to play` : ""} and won ${m.margin}; ${L} let that lead slip.`, [m.winnerId, m.loserId!], refs(m.deepest.hole), 3, m.deepest.down >= 3 ? 3 : 2));
    }
    // The same story from the other side: only when it isn't already the comeback
    if (m.loserBest && m.loserBest.up >= 2 && !(m.deepest && m.deepest.down >= 2))
      out.push(make(c, "leadLost", `${m.loserBest.name} was ${m.loserBest.up} up after the ${nth(m.loserBest.hole)}, with ${m.loserBest.left} to play, and lost ${loserMargin(m.margin)}.`, [m.loserId!, m.winnerId], refs(m.loserBest.hole), 3, 2));
  } else {
    out.push(make(c, "decided", `${m.a} and ${m.b} halved their match${onLast ? " on the last" : ""}.`, all, refs(end), 3, onLast ? 2 : 1));
    if (m.deepest && m.deepest.down >= 2) out.push(make(c, "comeback", `${m.deepest.name} was ${m.deepest.down} down after the ${nth(m.deepest.hole)} and halved the match.`, all, refs(m.deepest.hole), 3, 2));
  }
  if (m.swaps >= 2) out.push(make(c, "leadChange", `The lead in ${m.a} v ${m.b} changed hands ${m.swaps} times.`, all, m.changes.flatMap((ch) => refs(ch.hole)).slice(0, 8), 3, 1));
  return out;
}

function fieldMoments(c: Ctx): Moment[] {
  const out: Moment[] = [];
  if (!c.rows.some((r) => r.game.kind === "field")) return out;
  const f = roundFigures(c.rows);
  const last = f.leaders[f.leaders.length - 1];
  if (last && last.names.length === 1) {
    const went = f.leadChanges[f.leadChanges.length - 1];
    const pid = c.rows.find((r) => r.name === last.names[0])!.playerId;
    if (went && f.leadChanges.length > 1) out.push(make(c, "leadChange", `${first(last.names[0])} went top of the round on the ${nth(went.hole)} and stayed there.`, [pid], [{ round: c.rows[0].round, hole: went.hole, playerId: pid }], 2, f.leadChanges.length >= 3 ? 1 : 0));
  }
  return out;
}

function rowMoments(c: Ctx, r: GridRow): Moment[] {
  const out: Moment[] = [];
  const N = first(r.name);
  const ref = [{ round: r.round, hole: r.hole, playerId: r.playerId }];
  const ctx = r.game.kind === "match" && !r.game.over && r.game.hole === "won" ? ` (the match: ${r.game.before} › ${r.game.after})` : "";
  const g = r.score.gross;
  // A big hole
  if (g != null) {
    const off = holedFromOff(r);
    const d = g - r.par;
    let big: [string, number] | null = null;
    if (g === 1) big = [`${N} made a hole in one on the ${nth(r.hole)}`, 3];
    else if (d <= -3) big = [`${N} made an albatross on the ${nth(r.hole)}`, 3];
    else if (d === -2) big = [`${N} made an eagle ${g} on the ${nth(r.hole)}${off ? `, holing the ${off.kind === "chip" ? "chip" : off.kind === "bunker" ? "bunker shot" : "shot"}${off.from != null ? ` from ${off.from} yds` : ""}` : ""}`, 2];
    else if (off) big = [`${N} holed ${off.kind === "chip" ? "a chip" : off.kind === "bunker" ? "from the bunker" : "the shot"}${off.from != null ? ` from ${off.from} yds` : ""} on the ${nth(r.hole)} for ${article(r.score.word ?? "par")} ${r.score.word ?? "par"}`, 2];
    else if (d === -1) {
      const long = r.strokes.find((s) => s.kind === "putt" && /^30 ft/.test(s.length ?? "") && /^Holed/i.test(s.outcome ?? ""));
      big = [`${N} birdied the ${nth(r.hole)}${r.si === 1 ? ", the hardest hole on the course" : ""}${long ? ", holing from 30 ft or more" : ""}`, r.si === 1 || long ? 1 : 0];
    }
    if (big) out.push(make(c, "bigHole", `${big[0]}${ctx}.`, [r.playerId], ref, 1, big[1]));
  }
  // A disaster (told kindly; a pick-up only when it cost a match)
  const trouble = r.strokes.find((s) => s.outcomeFrom === "told" && /^(Out of bounds|Water)$/i.test(s.outcome ?? ""));
  const found = trouble ? (trouble.outcome === "Water" ? "found the water" : "went out of bounds") : null;
  const settled = r.score.pickedUp && r.game.kind === "match" && r.game.hole === "lost" && /^lost/.test(r.game.after ?? "");
  if (settled) out.push(make(c, "disaster", `${N} ${found ? `${found} and ` : ""}picked up on the ${nth(r.hole)}, the hole that settled the match.`, [r.playerId], ref, 3, 0));
  else if (g != null && g >= r.par + 3) out.push(make(c, "disaster", `${N} took ${g} on the par ${r.par} ${nth(r.hole)}${found ? ` after finding ${trouble!.outcome === "Water" ? "the water" : "out of bounds"}` : ""}.`, [r.playerId], ref, 1, g >= r.par + 4 ? 2 : 1));
  else if (found && r.game.kind === "match" && r.game.hole === "lost") out.push(make(c, "disaster", `${N} ${found} on the ${nth(r.hole)} and lost the hole.`, [r.playerId], ref, 1, 1));
  return out;
}

function playerMoments(c: Ctx, pid: string): Moment[] {
  const out: Moment[] = [];
  const rows = c.rows.filter((r) => r.playerId === pid).sort((a, b) => a.index - b.index);
  if (!rows.length) return out;
  const p = c.players.find((x) => x.id === pid);
  const f = playerFigures(rows);
  const N = first(f.name);
  const round = rows[0].round;
  const at = (hole: number) => ({ round, hole, playerId: pid });
  // Runs: birdies close together, a long stretch at par or better, a long stretch without a point
  for (let i = 0; i < f.birdies.length; i++) {
    const idx = (h: number) => rows.find((r) => r.hole === h)!.index;
    const three = f.birdies.filter((h) => idx(h) >= idx(f.birdies[i]) && idx(h) <= idx(f.birdies[i]) + 4);
    if (three.length >= 3 || (three.length >= 2 && idx(three[1]) - idx(three[0]) <= 2)) {
      out.push(make(c, "run", `${N} made ${three.length} birdies in ${idx(three[three.length - 1]) - idx(three[0]) + 1} holes (${three.map((h) => `the ${nth(h)}`).join(", ")}).`, [pid], three.map(at), 2, three.length >= 3 ? 2 : 1));
      break;
    }
  }
  const need = (p?.handicap ?? 0) >= 15 ? 4 : 6;
  if (f.bestRun && f.bestRun.length >= need) out.push(make(c, "run", `${N} played ${f.bestRun.length} holes in a row at par or better, the ${nth(f.bestRun.from)} to the ${nth(f.bestRun.to)}${(p?.handicap ?? 0) >= 15 ? ` (off a handicap of ${p!.handicap})` : ""}.`, [pid], [at(f.bestRun.from), at(f.bestRun.to)], 2, 1));
  if (f.pts != null && f.worstRun && f.worstRun.length >= 5) out.push(make(c, "run", `${N} went ${f.worstRun.length} holes without a point, the ${nth(f.worstRun.from)} to the ${nth(f.worstRun.to)}.`, [pid], [at(f.worstRun.from)], 2, 0));
  // Against type: what they said about their game, against what the grid shows
  if (p) {
    const fw = f.fairways;
    if (/driver/i.test(p.worst_club ?? "") && fw.told >= 5 && fw.hit * 3 >= fw.told * 2) out.push(make(c, "againstType", `${N} names the driver as the worst club in the bag, then found ${fw.hit} of the ${fw.told} fairways told.`, [pid], [], 2, 1));
    if (/driver/i.test(p.best_club ?? "") && fw.told >= 5 && fw.hit * 2 <= fw.told) out.push(make(c, "againstType", `${N} names the driver as the best club in the bag, and found ${fw.hit} of the ${fw.told} fairways told.`, [pid], [], 2, 1));
    if (/putt/i.test(p.best_club ?? "") && f.putts.threePutts.length >= 2) out.push(make(c, "againstType", `${N} names the putter as the best club in the bag, then three-putted ${f.putts.threePutts.length} times (${f.putts.threePutts.map((h) => `the ${nth(h)}`).join(", ")}).`, [pid], f.putts.threePutts.map(at), 2, 1));
    if (/bunker/i.test(p.weakness ?? "") && f.bunkers.told >= 2 && f.bunkers.out === f.bunkers.told) out.push(make(c, "againstType", `${N} says bunkers are the weakness, then got out onto the green ${f.bunkers.out} of the ${f.bunkers.told} times told.`, [pid], [], 2, 1));
  }
  // A repeat: the same trouble on the same hole of the same course in an earlier round
  for (const r of rows) {
    const bad = (x: GridRow) => x.strokes.find((s) => s.outcomeFrom === "told" && /^(Out of bounds|Water)$/i.test(s.outcome ?? ""))?.outcome ?? (x.score.gross != null && x.score.gross >= x.par + 2 ? "double" : null);
    const now = bad(r);
    if (!now) continue;
    for (const rs of c.earlier) {
      const then = rs.find((x) => x.playerId === pid && x.hole === r.hole && x.courseSlug === r.courseSlug);
      if (then && bad(then) === now) {
        out.push(make(c, "repeat", `${now === "Water" ? "The water" : now === "Out of bounds" ? "Out of bounds" : "A double bogey or worse"} on the ${nth(r.hole)} again for ${N}, as in Round ${then.round}.`, [pid], [at(r.hole)], 1, 1));
        break;
      }
    }
  }
  // A call-back: what they said before the trip, against how it went
  if (c.end && p?.quote) {
    const m = [...new Set(rows.map((r) => r.gameId))].map((gid) => matchFigures(c.rows.filter((r) => r.gameId === gid))).find((x) => x && (x.aId === pid || x.bId === pid || c.rows.some((r) => r.gameId === x.gameId && r.playerId === pid)));
    const res = m?.finished ? (m.winnerId === rows[0].sideId ? `won ${m.margin}` : m.winnerId ? `lost ${m.margin}` : "halved") : f.pts != null ? `scored ${f.pts} pts` : f.gross != null ? `went round in ${f.gross}` : null;
    if (res) out.push(make(c, "callBack", `Before the trip ${N} said: “${p.quote}” ${N} ${res}.`, [pid], [], c.review || c.earlier.length ? 4 : 2, 1));
  }
  return out;
}

/** The single best told shot on a hole that mattered */
function shotOfDay(c: Ctx): Moment | null {
  let best: { r: GridRow; seq: number; v: number } | null = null;
  for (const r of c.rows) {
    if (r.told === "score") continue;
    const mattered = (r.game.kind === "match" && r.game.hole === "won" && !r.game.over) || (r.score.gross != null && r.score.gross < r.par);
    if (!mattered) continue;
    for (const s of r.strokes) {
      if (s.outcomeFrom !== "told" || s.kind === "penalty") continue;
      const holed = /^Holed/i.test(s.outcome ?? "");
      const close = /^(Close|On the green|Stiff)/i.test(s.outcome ?? "");
      if (!holed && !close) continue;
      let v = (holed ? 3 : 1) + (s.clipId ? 2 : 0) + (s.kind !== "putt" ? 1 : 0) + (r.game.after && /^won/.test(r.game.after) ? 3 : 0) + (r.game.after === "all square" && r.game.before !== "all square" ? 1 : 0);
      if (s.kind === "putt" && !/10 to 30|30 ft/.test(s.length ?? "")) v -= 2;
      if (!best || v > best.v) best = { r, seq: s.seq, v };
    }
  }
  if (!best || best.v < 3) return null;
  const { r, seq } = best;
  const s = r.strokes.find((x) => x.seq === seq)!;
  const what = s.kind === "putt" ? `putt${s.length ? ` (${s.length})` : ""}` : `${s.club ?? s.kind}${s.from != null ? ` from ${s.from} yds` : ""}`;
  const ctx = r.game.kind === "match" && r.game.hole === "won" ? ` (the match: ${r.game.before} › ${r.game.after})` : "";
  return make(c, "shotOfDay", `${first(r.name)}'s ${what} on the ${nth(r.hole)}: ${(s.outcome ?? "").toLowerCase()}, for ${article(r.score.word ?? "par")} ${r.score.word ?? "score"}${ctx}${s.clipId ? " (filmed)" : ""}.`, [r.playerId], [{ round: r.round, hole: r.hole, playerId: r.playerId }], 1, 1);
}

/** Firsts and bests of the trip */
function firsts(c: Ctx): Moment[] {
  const out: Moment[] = [];
  const before = c.earlier.flat().some((r) => r.score.gross != null && r.score.gross < r.par);
  if (!before && c.earlier.length) {
    const fb = [...c.rows].sort((a, b) => a.index - b.index).find((r) => r.score.gross != null && r.score.gross < r.par);
    if (fb) out.push(make(c, "first", `${first(fb.name)} made the first birdie of the trip, on the ${nth(fb.hole)}.`, [fb.playerId], [{ round: fb.round, hole: fb.hole, playerId: fb.playerId }], 1, 1));
  }
  return out;
}

/** Every moment in a round, best first. `earlier` = the rounds before it on this trip. */
export function findMoments(rows: GridRow[], opts: { earlier?: GridRow[][]; players?: PlayerRow[]; end?: boolean; review?: boolean } = {}): Moment[] {
  if (!rows.length) return [];
  const c: Ctx = { rows, earlier: opts.earlier ?? [], players: opts.players ?? [], end: !!opts.end, review: !!opts.review, lastHole: Math.max(...rows.map((r) => r.index)) };
  const out: Moment[] = [];
  for (const gid of [...new Set(rows.map((r) => r.gameId))]) {
    const m = matchFigures(rows.filter((r) => r.gameId === gid));
    if (m) out.push(...matchMoments(c, m));
  }
  out.push(...fieldMoments(c));
  for (const r of rows) out.push(...rowMoments(c, r));
  for (const pid of [...new Set(rows.map((r) => r.playerId))]) out.push(...playerMoments(c, pid));
  const sod = shotOfDay(c);
  if (sod) out.push(sod);
  out.push(...firsts(c));
  // One moment per id
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort((a, b) => b.score - a.score);
}

/**
 * The top `n`, in order: what it changed, then how rare, then whether there's detail. In a group, everybody gets a
 * mention and nobody takes it over.
 */
export function pickMoments(all: Moment[], n: number, rows: GridRow[]): Moment[] {
  const pids = [...new Set(rows.map((r) => r.playerId))];
  const cap = Math.max(2, Math.ceil((n / Math.max(1, pids.length)) * 2));
  const lead = (m: Moment) => m.who[0];
  const chosen: Moment[] = [];
  const count = (pid: string) => chosen.filter((m) => lead(m) === pid).length;
  for (const m of all) {
    if (chosen.length >= n) break;
    if (m.scope < 3 && count(lead(m)) >= cap) continue;
    chosen.push(m);
  }
  // Everyone mentioned: a player in none of them gets their best moment, or their round in a line
  for (const pid of pids) {
    if (chosen.some((m) => m.who.includes(pid))) continue;
    const theirs = all.find((m) => m.who.includes(pid)) ?? resultMoment(rows.filter((r) => r.playerId === pid));
    if (!theirs) continue;
    if (chosen.length < n) chosen.push(theirs);
    else {
      // Swap out the lowest-ranked moment of someone who has more than one
      for (let i = chosen.length - 1; i >= 0; i--) {
        if (chosen[i].scope < 3 && count(lead(chosen[i])) > 1) {
          chosen[i] = theirs;
          break;
        }
      }
    }
  }
  return chosen.sort((a, b) => b.score - a.score);
}

function resultMoment(rows: GridRow[]): Moment | null {
  if (!rows.length) return null;
  const f = playerFigures(rows);
  const line = f.pts != null ? `${f.pts} pts` : f.gross != null ? `a round of ${f.gross}` : `${f.played} holes finished`;
  const extra = f.birdies.length ? `, with ${f.birdies.length} birdie${f.birdies.length === 1 ? "" : "s"}` : "";
  const c: Ctx = { rows, earlier: [], players: [], end: false, lastHole: 0 };
  return make(c, "result", `${first(f.name)}: ${line}${extra}.`, [f.playerId], [], 1, 0);
}

// ------------------------------------------------------------ the shape of a round report

export type Shape = "last" | "runaway" | "comeback" | "close" | "order";

export const SHAPES: Record<Shape, { label: string; open: string; then: string }> = {
  last: { label: "Won on the last", open: "the scene on the last tee", then: "build through the turning points to the last hole" },
  runaway: { label: "A runaway", open: "the winner's best run of holes", then: "the fight for second, then the rest" },
  comeback: { label: "A comeback", open: "the low point", then: "how it turned, hole by hole" },
  close: { label: "Close all day", open: "the lead changes", then: "who blinked, and where" },
  order: { label: "In order", open: "the top moment", then: "the rest of the round in the order it happened" },
};

export function shapeOf(top: Moment[], rows: GridRow[]): Shape {
  const lead = top[0];
  if (!lead) return "order";
  if (lead.kind === "comeback") return "comeback";
  const matches = [...new Set(rows.map((r) => r.gameId))].map((g) => matchFigures(rows.filter((r) => r.gameId === g))).filter((m): m is MatchFigures => !!m);
  if (lead.kind === "decided" && /on the last/.test(lead.text)) return "last";
  if (matches.some((m) => m.swaps >= 3)) return "close";
  if (rows.some((r) => r.game.kind === "field")) {
    const f = roundFigures(rows);
    if (f.leadChanges.length >= 4) return "close";
    const pids = [...new Set(rows.map((r) => r.playerId))];
    const pts = pids.map((p) => playerFigures(rows.filter((r) => r.playerId === p)).pts ?? 0).sort((a, b) => b - a);
    if (pts.length >= 2 && pts[0] - pts[1] >= 5) return "runaway";
  }
  if (matches.length && matches.every((m) => m.finished && m.margin && /&/.test(m.margin) && Number(m.margin.split("&")[0]) >= 4)) return "runaway";
  return "order";
}

// ------------------------------------------------------------ as the writer reads them

export function momentsText(list: Moment[]): string {
  return list
    .map((m, i) => {
      const extra = [
        m.refs.length ? `rows: ${[...new Set(m.refs.map((r) => `R${r.round} H${r.hole}`))].join(", ")}` : null,
        m.detail ? "told in detail" : "score only",
        m.clips.length ? "filmed" : null,
        m.said.voice.length ? `said to the commentators (paraphrase only): ${m.said.voice.join(" / ")}` : null,
        m.said.posted.length ? `posted: ${m.said.posted.map((x) => `“${x}”`).join(" / ")}` : null,
      ].filter(Boolean);
      return `${i + 1}. [${MOMENT_WORD[m.kind]}] ${m.text} (${extra.join("; ")})`;
    })
    .join("\n");
}
