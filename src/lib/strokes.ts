/**
 * A player's hole as a list of strokes: one row per stroke (the score says how many), with what was logged, the
 * distances from GPS readings placed on the strokes they were taken for, the drive, clips, and the obvious bits
 * filled in (stroke 1 is the tee shot, the last is holed). Pure: the "what happened" card and the AI writer share it.
 */
import { driveYards, inUnits, placeReadings, unitWord, type Reading } from "./gps";
import type { GpsRow, PostRow, ShotRow } from "./types";
import { extrasWords, shotWords } from "./detail";

export interface StrokeRow {
  seq: number;
  /** What was logged for this stroke */
  shot: ShotRow | null;
  /** Yards to the middle of the green when it was played (from a reading) */
  from: number | null;
  /** The reading that gave it */
  reading: GpsRow | null;
  /** The tee shot's length, about (from the tee to where the second was played) */
  drive: number | null;
  /** A clip of this stroke */
  clip: PostRow | null;
  /** Filled in without anyone saying so: the tee shot, the holed last stroke */
  auto: { kind: string; outcome?: string } | null;
}

export interface StrokeInput {
  shots: ShotRow[];
  readings: GpsRow[];
  /** Strokes taken on the hole (the score), when known */
  gross: number | null;
  holeYards: number | null;
  clips?: PostRow[];
  /** The player picked up: the strokes told so far, and no holed last stroke */
  pickedUp?: boolean;
  /** Whose strokes (to find clips filmed of a stroke before it was told) */
  playerId?: string;
}

/** Shots in stroke order: those placed on a stroke keep it; the rest fill the gaps in the order they were logged. */
export function orderShots(shots: ShotRow[]): Map<number, ShotRow> {
  const out = new Map<number, ShotRow>();
  for (const s of shots) if (s.seq && s.seq >= 1 && !out.has(s.seq)) out.set(s.seq, s);
  let next = 1;
  for (const s of [...shots].filter((x) => !(x.seq && out.get(x.seq) === x)).sort((a, b) => a.logged_at.localeCompare(b.logged_at))) {
    while (out.has(next)) next++;
    out.set(next, s);
  }
  return out;
}

const holed = (o?: string | null) => !!o && /^Holed/.test(o);

/** A clip's stroke, when it was filmed before the stroke was told */
const clipSeq = (c: PostRow) => {
  const v = (c.details as Record<string, unknown> | null)?.seq;
  return typeof v === "number" && v >= 1 ? v : null;
};

export function strokeRows({ shots, readings, gross, holeYards, clips = [], pickedUp = false, playerId }: StrokeInput): StrokeRow[] {
  const bySeq = orderShots(shots);
  const mineClips = playerId ? clips.filter((c) => clipSeq(c) != null && (c.player_ids ?? []).length === 1 && c.player_ids?.[0] === playerId) : [];
  const maxSeq = Math.max(0, ...bySeq.keys(), ...mineClips.map((c) => clipSeq(c)!));
  const lastShot = bySeq.get(maxSeq);
  // Picked up: the strokes told so far. Unscored yet: those and one more to tell (unless he's holed out)
  const n = pickedUp ? maxSeq : gross != null && gross > 0 ? Math.max(gross, maxSeq) : maxSeq + (holed(lastShot?.outcome) ? 0 : 1);
  // A clip's spot only counts when the player didn't measure that shot himself (within a few minutes of it)
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) < 4 * 60e3;
  readings = readings.filter((r) => r.source !== "clip" || !readings.some((x) => x.source !== "clip" && near(x.taken_at, r.taken_at)));
  const rs: Reading[] = readings.map((r) => ({ id: r.client_id, toGreen: r.to_middle ?? 0, fromTee: r.from_tee, takenAt: r.taken_at, seq: r.seq, ignored: r.ignored }));
  const placed = placeReadings(
    rs.filter((r) => r.toGreen > 0 || r.seq),
    n,
    holeYards,
    [...bySeq.entries()].map(([seq, s]) => ({ seq, kind: s.kind })),
  );
  const drive = driveYards(placed, rs);
  const rows: StrokeRow[] = [];
  for (let seq = 1; seq <= n; seq++) {
    const shot = bySeq.get(seq) ?? null;
    const reading = readings.find((r) => placed[r.client_id] === seq) ?? null;
    const clip = (shot && clips.find((c) => c.details && (c.details as Record<string, unknown>).shotId === shot.client_id)) || mineClips.find((c) => clipSeq(c) === seq) || null;
    // Known without anyone saying: stroke 1 is the tee shot; with the score in, the last stroke went in
    const last = !pickedUp && gross != null && seq === n;
    const auto = shot ? null : seq === 1 && !last ? { kind: "tee" } : last ? { kind: seq === 1 ? "tee" : "putt", outcome: "Holed" } : null;
    rows.push({ seq, shot, from: reading?.to_middle ?? null, reading, drive: seq === 1 ? drive : null, clip, auto });
  }
  return rows;
}

/** What the AI writer is told about a hole: only what was logged or measured, in stroke order. */
export function strokesLine(rows: StrokeRow[], label: (kind: string) => string, units: "yards" | "metres" = "yards"): string {
  const unit = unitWord(units, true);
  const bits: string[] = [];
  for (const r of rows) {
    const extras = r.shot ? extrasWords(r.shot) : "";
    const what = r.shot ? `${shotWords(r.shot).toLowerCase()}${extras ? ` (${extras})` : ""}` : r.auto ? (r.auto.outcome ? `${r.auto.outcome.toLowerCase()} (known from the score)` : label(r.auto.kind)) : "";
    const where = r.from != null ? `from ${inUnits(r.from, units)} ${unit}` : "";
    const drive = r.drive != null ? `went about ${inUnits(r.drive, units)} ${unit}` : "";
    const parts = [what, where, drive].filter(Boolean);
    if (parts.length) bits.push(`${r.seq} ${parts.join(", ")}`);
  }
  return bits.join("; ");
}
