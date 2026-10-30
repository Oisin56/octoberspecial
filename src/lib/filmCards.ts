/**
 * The film's side of the grid: a card for each clip (the exact shot, the hole so far, the match before and after,
 * the moment it belongs to, what was said), and which clips belong to the moments that matter. Pure.
 */
import { MOMENT_WORD, findMoments, pickMoments, type Moment } from "./moments";
import { buildGrid, nth, strokeText, type GridRow } from "./grid";
import type { PostRow, TournamentState } from "./types";

export interface ClipMoment {
  /** "a comeback, 2nd in the round" */
  label: string;
  /** Its place among the round's moments (1 = the biggest) */
  rank: number;
  /** A moment that decided something, or a big hole: the only clips that get a slow-motion replay */
  replayOk: boolean;
}

export interface ClipCards {
  cards: Map<string, string>;
  moments: Map<string, ClipMoment>;
  /** The rows of each round with clips (for the fact check) */
  rows: Map<string, GridRow[]>;
}

const first = (n: string) => n.split(" ")[0];

/** One clip's card, built from its row in the grid */
export function clipCard(row: GridRow, clipId: string, m?: ClipMoment, units: "yards" | "metres" = "yards"): string {
  const filmed = row.strokes.find((s) => s.clipId === clipId);
  const lines: string[] = [];
  lines.push(`${first(row.name)} · Round ${row.round}, the ${nth(row.hole)}, par ${row.par}${filmed ? ` · the stroke filmed: ${strokeText(filmed, units).replace(/ \[filmed\]$/, "")}` : " · which stroke was filmed: not told"}`);
  if (row.game.kind === "match" && !row.game.over) lines.push(`The match: ${row.game.before} before · ${row.game.after} after`);
  else if (row.game.place) lines.push(`After the hole: ${row.game.place} in the round`);
  const before = filmed ? row.strokes.filter((s) => s.seq < filmed.seq) : [];
  const after = filmed ? row.strokes.filter((s) => s.seq > filmed.seq) : [];
  if (before.length) lines.push(`The hole so far: ${before.map((s) => strokeText(s, units)).join("; ")}`);
  const result = row.score.pickedUp ? "picked up" : row.score.gross != null ? `${row.score.gross}, ${row.score.word}` : "no score in";
  lines.push(`Then: ${after.length ? `${after.map((s) => strokeText(s, units)).join("; ")}; ` : ""}the hole: ${result}`);
  if (m) lines.push(`The moment: ${m.label}`);
  for (const v of row.said.voice) lines.push(`Said to the commentators (in your own words, never quoted): ${v}`);
  return lines.join("\n");
}

/** Cards and moments for every shot clip in the film */
export function filmCards(s: TournamentState, clips: PostRow[]): ClipCards {
  const units = s.tournament.units === "metres" ? "metres" : "yards";
  const cards = new Map<string, string>();
  const moments = new Map<string, ClipMoment>();
  const rowsBy = new Map<string, GridRow[]>();
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  const earlier: GridRow[][] = [];
  for (const r of rounds) {
    const rows = buildGrid(s, r.id);
    const mine = clips.filter((c) => c.round_id === r.id);
    if (mine.length && rows.length) {
      rowsBy.set(r.id, rows);
      const top = pickMoments(findMoments(rows, { earlier: [...earlier], players: s.players, end: r === rounds[rounds.length - 1] }), 10, rows);
      for (const c of mine) {
        const pid = (c.player_ids ?? [])[0];
        const row = rows.find((x) => x.hole === c.hole && x.playerId === pid);
        // The biggest moment this clip belongs to: the clip itself, or the hole and player it shows
        const hit = top.findIndex((m: Moment) => m.clips.includes(c.id)) >= 0 ? top.findIndex((m) => m.clips.includes(c.id)) : top.findIndex((m) => m.refs.some((x) => x.hole === c.hole && (c.player_ids ?? []).includes(x.playerId)));
        const m = hit >= 0 ? top[hit] : null;
        const cm = m ? { label: `${MOMENT_WORD[m.kind]}, ${nth(hit + 1)} in the round`, rank: hit + 1, replayOk: m.kind === "decided" || m.kind === "bigHole" || m.kind === "shotOfDay" || m.scope >= 3 } : undefined;
        if (cm) moments.set(c.id, cm);
        if (row) cards.set(c.id, clipCard(row, c.id, cm, units));
      }
    }
    if (rows.length) earlier.push(rows);
  }
  return { cards, moments, rows: rowsBy };
}
