import "server-only";
import { courseBySlug } from "@/data/courses";
import { bearing } from "./detail";
import { geoFor } from "./gpsServer";
import type { RoundRow } from "./types";
import type { WindDay } from "./windDay";

/** Kept a while per round (it's the same for every phone in the group, and for the writer) */
const kept = new Map<string, { at: number; body: WindDay }>();

/** The wind through the round's day, hour by hour (km/h, and where it comes from), and each hole's direction */
export async function windDay(round: RoundRow): Promise<WindDay> {
  const hit = kept.get(round.id);
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.body;
  const local = courseBySlug(round.course_slug.replace(/^local:/, ""));
  const info = { lat: round.lat ?? local?.lat ?? null, lon: round.lon ?? local?.lon ?? null };
  const day = round.play_date ?? new Date().toISOString().slice(0, 10);
  let hourly: WindDay["hourly"] = null;
  if (info.lat != null && info.lon != null) {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${info.lat}&longitude=${info.lon}` +
        `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=Europe%2FDublin&start_date=${day}&end_date=${day}`;
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const h = (await r.json()).hourly;
        if (h?.time?.length) hourly = { time: h.time, speed: h.wind_speed_10m, dir: h.wind_direction_10m };
      }
    } catch {
      /* no weather: the group can still say */
    }
  }
  const bearings: Record<string, number> = {};
  try {
    const geo = await geoFor(round.course_slug);
    for (const [n, g] of Object.entries(geo ?? {})) {
      if (g.tee && g.green.middle) bearings[n] = Math.round(bearing(g.tee, g.green.middle));
    }
  } catch {
    /* no course data: no direction, so only No wind can be worked out */
  }
  const body = { hourly, bearings };
  kept.set(round.id, { at: Date.now(), body });
  return body;
}
