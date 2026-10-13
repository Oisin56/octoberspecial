import "server-only";
import { adminClient } from "./admin";

/**
 * GolfAPI.io: course coordinates (front, centre and back of each green, tees, bunkers, water…).
 * Every answer is kept in our storage the first time it's fetched, so a course is only ever paid for once
 * (their licence allows storing the data). Searches cost 0.1 of a call, a course or its coordinates 1 call.
 */
const BASE = process.env.GOLFAPI_BASE_URL || "https://www.golfapi.io/api/v2.3";

export const golfApiConfigured = () => !!process.env.GOLFAPI_KEY;

/** What each point-of-interest code means (GolfAPI's own numbering). */
export const POI: Record<number, string> = {
  1: "Green",
  2: "Green bunker",
  3: "Fairway bunker",
  4: "Water",
  5: "Trees",
  6: "100 marker",
  7: "150 marker",
  8: "200 marker",
  9: "Dogleg",
  10: "Road",
  11: "Front tee",
  12: "Back tee",
};
export const LOCATION: Record<number, string> = { 1: "front", 2: "centre", 3: "back" };

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);

async function cached(path: string): Promise<unknown | null> {
  const { data } = await adminClient().storage.from("media").download(path);
  if (!data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function keep(path: string, body: unknown) {
  await adminClient()
    .storage.from("media")
    .upload(path, JSON.stringify(body), { contentType: "application/json", upsert: true });
}

export class GolfApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** One GolfAPI request, kept in storage so it's never paid for twice. */
async function call(endpoint: string, cacheKey: string): Promise<{ data: Record<string, unknown>; fromStore: boolean }> {
  const path = `golfapi/${cacheKey}.json`;
  const hit = await cached(path);
  if (hit) return { data: hit as Record<string, unknown>, fromStore: true };
  const key = process.env.GOLFAPI_KEY;
  if (!key) throw new GolfApiError("GOLFAPI_KEY isn't set in Vercel", 500);
  const r = await fetch(`${BASE}${endpoint}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" });
  const text = await r.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GolfApiError(`GolfAPI answered ${r.status}: ${text.slice(0, 200)}`, 502);
  }
  if (!r.ok) throw new GolfApiError(`GolfAPI answered ${r.status}: ${String(data.message ?? data.error ?? text).slice(0, 200)}`, 502);
  await keep(path, data);
  return { data, fromStore: false };
}

export const searchClubs = (name: string) => call(`/clubs?name=${encodeURIComponent(name.trim())}`, `search/${safe(name)}`);
export const courseDetails = (id: string) => call(`/courses/${encodeURIComponent(id)}`, `course/${safe(id)}`);
export const courseCoordinates = (id: string) => call(`/coordinates/${encodeURIComponent(id)}`, `coords/${safe(id)}`);
