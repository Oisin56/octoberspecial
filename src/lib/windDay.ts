/**
 * The weather's wind through a round's day (hour by hour) and each hole's direction, turned into golfers' words for a
 * hole at the time it was played. Pure: the phone and the server share it.
 */
import { windWord } from "./detail";

export interface WindDay {
  hourly: { time: string[]; speed: number[]; dir: number[] } | null;
  bearings: Record<string, number>;
}

/** The wind on a hole when it was played (`at`; now when not known), or null when it can't be worked out */
export function windAt(day: WindDay | null | undefined, hole: number, at?: string | null): string | null {
  if (!day?.hourly?.time.length) return null;
  // The hour it was played (Dublin time, as the weather's hours are)
  const when = at ? new Date(at) : new Date();
  const hh = Number(when.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Dublin" })) % 24;
  const i = Math.min(day.hourly.time.length - 1, Math.max(0, day.hourly.time.findIndex((x) => Number(x.slice(11, 13)) === hh)));
  return windWord(day.hourly.speed[i], day.hourly.dir[i], day.bearings[String(hole)] ?? null);
}
