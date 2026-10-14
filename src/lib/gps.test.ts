import { describe, it, expect } from "vitest";
import { driveYards, greenYards, inUnits, metres, parseCoordinates, placeReadings, type Reading } from "./gps";
import { orderShots, strokeRows, strokesLine } from "./strokes";
import type { GpsRow, ShotRow } from "./types";

const r = (id: string, toGreen: number, minute: number, extra: Partial<Reading> = {}): Reading => ({
  id,
  toGreen,
  fromTee: null,
  takenAt: `2026-10-14T10:${String(minute).padStart(2, "0")}:00Z`,
  ...extra,
});

describe("distances", () => {
  it("measures between two points", () => {
    // One thousandth of a degree of latitude is about 111 metres
    expect(metres([53, -7.9], [53.001, -7.9])).toBeCloseTo(111.2, 0);
    expect(inUnits(150, "metres")).toBe(137);
    expect(inUnits(150, "yards")).toBe(150);
  });

  it("reads GolfAPI's greens and tees", () => {
    const geo = parseCoordinates({
      coordinates: [
        { poi: 1, location: 1, hole: 3, latitude: 53.001, longitude: -7.9 },
        { poi: 1, location: 2, hole: 3, latitude: 53.0012, longitude: -7.9 },
        { poi: 1, location: 3, hole: 3, latitude: 53.0014, longitude: -7.9 },
        { poi: 11, location: 2, hole: 3, latitude: 53.0, longitude: -7.9 },
        { poi: 12, location: 2, hole: 3, latitude: 52.9998, longitude: -7.9 },
        { poi: 4, location: 2, hole: 3, latitude: 53.0005, longitude: -7.9 },
      ],
    });
    expect(geo["3"].green.middle).toEqual([53.0012, -7.9]);
    expect(geo["3"].tee?.[0]).toBeCloseTo(52.9999, 4);
    const d = greenYards([53.0, -7.9], geo["3"]);
    expect(d.front! < d.middle && d.middle < d.back!).toBe(true);
    expect(d.fromTee).toBeLessThan(15);
  });
});

describe("placing readings on strokes", () => {
  it("Oisin's example: a par 5 of 530, measured from 320, 140 and 41, scored 7", () => {
    const placed = placeReadings([r("a", 320, 2, { fromTee: 212 }), r("b", 140, 5), r("c", 41, 8)], 7, 530);
    expect(placed).toEqual({ a: 2, b: 3, c: 4 });
    expect(driveYards(placed, [r("a", 320, 2, { fromTee: 212 })])).toBe(212);
  });

  it("a reading on the tee is the tee shot", () => {
    expect(placeReadings([r("t", 178, 1, { fromTee: 5 })], 3, 180)).toEqual({ t: 1 });
  });

  it("a 41-yard reading on a 400-yard par 4 can't be the second shot (nobody drives 360)", () => {
    expect(placeReadings([r("c", 41, 6)], 5, 400)).toEqual({ c: 3 });
  });

  it("a logged chip or putt is only played from close in", () => {
    // Stroke 2 was logged as a putt: a reading from 150 out belongs to a later stroke... none here, so it's left off
    expect(placeReadings([r("x", 150, 4)], 3, 380, [{ seq: 2, kind: "putt" }, { seq: 3, kind: "putt" }])).toEqual({});
    expect(placeReadings([r("x", 30, 4)], 4, 380, [{ seq: 3, kind: "chip" }])).toEqual({ x: 3 });
    expect(placeReadings([r("x", 150, 4)], 4, 380, [{ seq: 2, kind: "approach" }, { seq: 3, kind: "chip" }])).toEqual({ x: 2 });
  });

  it("keeps hand-placed readings where they were put, and readings taken off stay off", () => {
    const placed = placeReadings([r("a", 320, 2, { seq: 3 }), r("b", 140, 5), r("c", 41, 8, { ignored: true })], 7, 530);
    expect(placed).toEqual({ a: 3, b: 4 });
  });

  it("keeps to the order the readings were taken in", () => {
    const placed = placeReadings([r("a", 150, 2), r("b", 160, 4)], 5, 400);
    expect(placed.a).toBeLessThan(placed.b);
  });
});

const shot = (seq: number | null, kind: string, outcome: string, minute: number, extra: Partial<ShotRow> = {}): ShotRow => ({
  id: `s${minute}`,
  seq,
  tournament_id: "t",
  round_id: "r",
  hole: 7,
  player_id: "neil",
  kind,
  outcome,
  club: null,
  distance: null,
  author_name: "Neil",
  client_id: `c${minute}-xxxxxxxx`,
  logged_at: `2026-10-14T10:${String(minute).padStart(2, "0")}:00Z`,
  ...extra,
});
const gps = (id: string, toMiddle: number, minute: number, fromTee: number | null = null): GpsRow => ({
  id,
  round_id: "r",
  hole: 7,
  player_id: "neil",
  client_id: `${id}-xxxxxxxx`,
  accuracy: 6,
  to_front: toMiddle - 12,
  to_middle: toMiddle,
  to_back: toMiddle + 12,
  from_tee: fromTee,
  source: "gps",
  seq: null,
  ignored: false,
  author_name: "Neil",
  taken_at: `2026-10-14T10:${String(minute).padStart(2, "0")}:00Z`,
});

describe("the strokes of a hole", () => {
  it("fills in the tee shot, the distances and the holed last stroke, with nothing logged", () => {
    const rows = strokeRows({ shots: [], readings: [gps("a", 320, 2, 212), gps("b", 140, 5), gps("c", 41, 8)], gross: 7, holeYards: 530 });
    expect(rows).toHaveLength(7);
    expect(rows[0].auto?.kind).toBe("tee");
    expect(rows[0].drive).toBe(212);
    expect(rows.map((x) => x.from)).toEqual([null, 320, 140, 41, null, null, null]);
    expect(rows[6].auto?.outcome).toBe("Holed");
    const line = strokesLine(rows, (k) => ({ tee: "Tee shot", putt: "Putt" })[k] ?? k);
    expect(line).toBe("1 Tee shot, went about 212 yds; 2 from 320 yds; 3 from 140 yds; 4 from 41 yds; 7 holed");
  });

  it("puts logged shots on their strokes, old ones in the order they were logged", () => {
    const m = orderShots([shot(null, "approach", "Short", 9), shot(2, "second", "Laid up", 3), shot(null, "tee", "Fairway", 1)]);
    expect(m.get(1)?.kind).toBe("tee");
    expect(m.get(2)?.outcome).toBe("Laid up");
    expect(m.get(3)?.kind).toBe("approach");
  });

  it("the shot logged tells what was tried; the reading only says where from", () => {
    const rows = strokeRows({ shots: [shot(2, "second", "Laid up", 3, { club: "Long iron" })], readings: [gps("a", 240, 2, 290)], gross: 6, holeYards: 530 });
    expect(strokesLine(rows, (k) => ({ tee: "Tee shot", second: "Second shot" })[k] ?? k)).toContain("2 Second shot: laid up (long iron), from 240 yds");
  });

  it("before the hole is scored: the strokes so far and one more to log", () => {
    expect(strokeRows({ shots: [shot(1, "tee", "Fairway", 1)], readings: [], gross: null, holeYards: 400 })).toHaveLength(2);
    expect(strokeRows({ shots: [shot(1, "tee", "Fairway", 1), shot(2, "putt", "Holed", 5)], readings: [], gross: null, holeYards: 150 })).toHaveLength(2);
  });

  it("goes by the distance from the tee when it's known, not the card's yardage", () => {
    // The card says 560 but the hole measures 378: 151 out, 227 from the tee, is the second
    const rows = strokeRows({ shots: [], readings: [gps("t", 378, 0, 0), gps("f", 151, 1, 227), gps("g", 30, 2, 348)], gross: 6, holeYards: 560 });
    expect(rows.map((r) => r.from)).toEqual([378, 151, 30, null, null, null]);
    expect(rows[0].drive).toBe(227);
  });
});
