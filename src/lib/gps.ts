/**
 * GPS distances: the green's front, middle and back from where you stand, and how the readings people take at
 * their ball are placed on the strokes of a hole. Pure: used on the phone (the panel, the card) and on the server.
 */

export type LatLon = [number, number];

export interface HoleGeo {
  green: { front: LatLon | null; middle: LatLon; back: LatLon | null };
  /** The tee: halfway between the front and back tee markers (GolfAPI has no colours) */
  tee: LatLon | null;
}

export type CourseGeo = Record<string, HoleGeo>;

const R = 6371008.8; // metres
const rad = (d: number) => (d * Math.PI) / 180;
export const YARDS_PER_METRE = 1.0936133;

/** Straight-line distance in metres. */
export function metres(a: LatLon, b: LatLon): number {
  const [la1, lo1] = a.map(rad);
  const [la2, lo2] = b.map(rad);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const yards = (a: LatLon, b: LatLon) => Math.round(metres(a, b) * YARDS_PER_METRE);

/** Yards shown in the chosen units. */
export function inUnits(y: number, units: "yards" | "metres"): number {
  return units === "metres" ? Math.round(y / YARDS_PER_METRE) : Math.round(y);
}
export const unitWord = (units: "yards" | "metres", short = false) => (units === "metres" ? (short ? "m" : "metres") : short ? "yds" : "yards");

/** GolfAPI's points: poi 1 = green (location 1 front, 2 middle, 3 back), 11 = front tee, 12 = back tee. */
export function parseCoordinates(raw: unknown): CourseGeo {
  const list = (raw && typeof raw === "object" && Array.isArray((raw as { coordinates?: unknown }).coordinates) ? (raw as { coordinates: unknown[] }).coordinates : []) as Record<string, unknown>[];
  const byHole: Record<string, { g: Record<number, LatLon>; tees: LatLon[] }> = {};
  for (const c of list) {
    const hole = Number(c.hole);
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    if (!(hole >= 1 && hole <= 18) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const h = (byHole[hole] ??= { g: {}, tees: [] });
    const poi = Number(c.poi);
    if (poi === 1) h.g[Number(c.location) || 2] = [lat, lon];
    if (poi === 11 || poi === 12) h.tees.push([lat, lon]);
  }
  const out: CourseGeo = {};
  for (const [hole, h] of Object.entries(byHole)) {
    const middle = h.g[2] ?? h.g[1] ?? h.g[3];
    if (!middle) continue;
    const tee: LatLon | null = h.tees.length ? [h.tees.reduce((a, t) => a + t[0], 0) / h.tees.length, h.tees.reduce((a, t) => a + t[1], 0) / h.tees.length] : null;
    out[hole] = { green: { front: h.g[1] ?? null, middle, back: h.g[3] ?? null }, tee };
  }
  return out;
}

export interface GreenYards {
  front: number | null;
  middle: number;
  back: number | null;
  /** From the tee (for the drive), when the tee is known */
  fromTee: number | null;
}

export function greenYards(at: LatLon, g: HoleGeo): GreenYards {
  return {
    front: g.green.front ? yards(at, g.green.front) : null,
    middle: yards(at, g.green.middle),
    back: g.green.back ? yards(at, g.green.back) : null,
    fromTee: g.tee ? yards(at, g.tee) : null,
  };
}

// ------------------------------------------------------------ placing readings on strokes

export interface Reading {
  id: string;
  /** Yards to the middle of the green */
  toGreen: number;
  /** Yards from the tee */
  fromTee: number | null;
  takenAt: string;
  /** Placed on this stroke by hand */
  seq?: number | null;
  ignored?: boolean;
}

export interface StrokeHint {
  seq: number;
  /** The kind of shot, when it's been logged */
  kind?: string | null;
}

/** Longest a shot of each kind could plausibly travel (yards): generous, so the unusual still fits. */
const REACH: Record<string, number> = { tee: 320, second: 300, approach: 260, recovery: 240, chip: 90, bunker: 80, putt: 40, penalty: 0 };
/** Furthest from the green each kind is played from. */
const FROM: Record<string, number> = { putt: 45, chip: 80, bunker: 110, approach: 280, second: 360, recovery: 300 };

/** Within this of the tee: the reading was taken on the tee. */
export const ON_TEE_YARDS = 25;

/**
 * Which stroke each reading was taken for. Readings are in the order they were taken, so they belong to strokes in
 * the same order. A reading on the tee is the tee shot; any other goes on the earliest stroke it could plausibly be:
 * the shots before it must be able to cover the ground, and a logged chip or putt is only played from close in.
 * Readings placed by hand stay where they were put; readings taken off the card stay off.
 */
export function placeReadings(readings: Reading[], strokes: number, holeYards: number | null, hints: StrokeHint[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const taken = new Set<number>();
  for (const r of readings)
    if (!r.ignored && r.seq && r.seq >= 1 && r.seq <= strokes) {
      out[r.id] = r.seq;
      taken.add(r.seq);
    }
  const kindOf = (s: number) => hints.find((h) => h.seq === s)?.kind ?? null;
  const free = [...readings].filter((r) => !r.ignored && !(r.id in out)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  let after = 0;
  for (const r of free) {
    // Keep to the order the readings were taken in (hand-placed ones count too)
    const placedBefore = readings.filter((x) => x.id in out && x.takenAt <= r.takenAt).map((x) => out[x.id]);
    const lo = Math.max(after, ...placedBefore, 0) + 1;
    const onTee = r.fromTee != null && r.fromTee <= ON_TEE_YARDS;
    let seq: number | null = null;
    for (let s = lo; s <= strokes; s++) {
      if (taken.has(s)) continue;
      const k = kindOf(s);
      if (onTee) {
        // On the tee: the tee shot (or a reload after out of bounds)
        if (s === 1 || k === "tee") seq = s;
        break;
      }
      if (s === 1 || k === "tee") continue;
      if (k && FROM[k] != null && r.toGreen > FROM[k]) continue;
      // The shots already played must be able to cover the ground to here (measured from the tee when we can)
      const covered = r.fromTee != null ? r.fromTee : holeYards ? holeYards - r.toGreen : null;
      if (covered != null) {
        let reach = 0;
        for (let p = 1; p < s; p++) reach += REACH[kindOf(p) ?? (p === 1 ? "tee" : "approach")] ?? 260;
        if (covered > reach + 20) continue;
      }
      seq = s;
      break;
    }
    if (seq == null) continue;
    out[r.id] = seq;
    taken.add(seq);
    after = seq;
  }
  return out;
}

/** The drive: from the tee to where the second shot was played (only when that spot is known). */
export function driveYards(placed: Record<string, number>, readings: Reading[]): number | null {
  const second = readings.find((r) => placed[r.id] === 2);
  if (!second || second.fromTee == null || second.fromTee < 60) return null;
  return second.fromTee;
}
