/**
 * A player's hole as a list of strokes: one row per stroke (the score says how many), with what was logged, the
 * distances from GPS readings placed on the strokes they were taken for, the drive, clips, and the obvious bits
 * filled in (stroke 1 is the tee shot, the last is holed). Pure: the "what happened" card and the AI writer share it.
 */
import { driveYards, inUnits, placeReadings, unitWord, type Reading } from "./gps";
import { toRoundCfg, type GpsRow, type PostRow, type ShotRow, type TournamentState } from "./types";

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

export function strokeRows({ shots, readings, gross, holeYards, clips = [] }: StrokeInput): StrokeRow[] {
  const bySeq = orderShots(shots);
  const maxSeq = Math.max(0, ...bySeq.keys());
  const lastShot = bySeq.get(maxSeq);
  // Unscored yet: the strokes logged so far, and one more to log (unless he's holed out)
  const n = gross != null && gross > 0 ? Math.max(gross, maxSeq) : maxSeq + (holed(lastShot?.outcome) ? 0 : 1);
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
    const clip = (shot && clips.find((c) => c.details && (c.details as Record<string, unknown>).shotId === shot.client_id)) || null;
    const auto = shot ? null : seq === 1 ? { kind: "tee" } : gross != null && seq === n ? { kind: "putt", outcome: "Holed" } : null;
    rows.push({ seq, shot, from: reading?.to_middle ?? null, reading, drive: seq === 1 ? drive : null, clip, auto });
  }
  return rows;
}

/** What the AI writer is told about a hole: only what was logged or measured, in stroke order. */
export function strokesLine(rows: StrokeRow[], label: (kind: string) => string, units: "yards" | "metres" = "yards"): string {
  const unit = unitWord(units, true);
  const bits: string[] = [];
  for (const r of rows) {
    const what = r.shot ? `${label(r.shot.kind)}: ${r.shot.outcome.toLowerCase()}${r.shot.club ? ` (${r.shot.club.toLowerCase()})` : ""}` : r.auto ? (r.auto.outcome ? r.auto.outcome.toLowerCase() : label(r.auto.kind)) : "";
    const where = r.from != null ? `from ${inUnits(r.from, units)} ${unit}` : "";
    const drive = r.drive != null ? `went about ${inUnits(r.drive, units)} ${unit}` : "";
    const parts = [what, where, drive].filter(Boolean);
    if (parts.length) bits.push(`${r.seq} ${parts.join(", ")}`);
  }
  return bits.join("; ");
}

/** Every hole of a round, player by player, for the AI writer: "H7 Neil (7): 1 tee shot, went about 212 yds; 2 from 320 yds…". */
export function roundTimeline(s: TournamentState, roundId: string, label: (kind: string) => string): string {
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return "";
  const cfg = toRoundCfg(round, s.players);
  const shots = (s.shots ?? []).filter((x) => x.round_id === roundId);
  const readings = (s.gps ?? []).filter((x) => x.round_id === roundId);
  const clips = s.posts.filter((p) => p.kind === "video" && p.round_id === roundId);
  const lines: string[] = [];
  for (const h of round.holes) {
    const pids = new Set([...shots.filter((x) => x.hole === h.number).map((x) => x.player_id), ...readings.filter((x) => x.hole === h.number).map((x) => x.player_id)]);
    for (const pid of pids) {
      let gross: number | null = null;
      for (const e of s.entries.filter((x) => x.round_id === roundId && x.hole === h.number)) {
        const side = cfg.games.find((g) => g.id === (e.game ?? "main"))?.sides.find((sd) => sd.playerIds.includes(pid));
        const b = e.scores[pid] ?? (side ? e.scores[side.id] : undefined);
        if (b?.gross != null && !b.pickedUp) gross = b.gross;
      }
      const rows = strokeRows({
        shots: shots.filter((x) => x.hole === h.number && x.player_id === pid),
        readings: readings.filter((x) => x.hole === h.number && x.player_id === pid),
        gross,
        holeYards: h.yards ?? null,
        clips: clips.filter((c) => c.hole === h.number),
      });
      const line = strokesLine(rows, label, s.tournament.units === "metres" ? "metres" : "yards");
      if (line) lines.push(`- H${h.number} ${s.players.find((p) => p.id === pid)?.name ?? pid}${gross != null ? ` (${gross})` : ""}: ${line}`);
    }
  }
  return lines.join("\n");
}
