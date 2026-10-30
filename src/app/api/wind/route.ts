import { adminClient } from "@/lib/admin";
import { isCrew, isOrganiser } from "@/lib/auth";
import { courseInfo } from "@/lib/ai";
import { bearing, WIND } from "@/lib/detail";
import { geoFor } from "@/lib/gpsServer";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { mayTellShots } from "@/lib/scoring-access";
import type { Game } from "@/lib/engine";
import type { RoundRow } from "@/lib/types";

export const maxDuration = 30;

/** The weather's wind through the day, kept a while per round (it's the same for every phone in the group). */
const kept = new Map<string, { at: number; body: unknown }>();

/**
 * GET ?t=slug&round=<id>: the wind through the round's day, hour by hour (km/h, and the direction it comes from),
 * and each hole's direction from the tee to the green when the course data has it. The phone turns these into
 * "Hurting, light", "Left to right, strong" and so on for each hole.
 */
export async function GET(req: Request) {
  const { t, session } = await context(req);
  if (!t) return bad("Tournament not found", 404);
  if (!isCrew(session)) return bad("Log in first", 401);
  const roundId = new URL(req.url).searchParams.get("round") ?? "";
  const hit = kept.get(roundId);
  if (hit && Date.now() - hit.at < 20 * 60e3) return json(hit.body);
  const { data: round } = await adminClient().from("rounds").select("*").eq("id", roundId).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  const info = courseInfo(round as RoundRow);
  const day = (round as RoundRow).play_date ?? new Date().toISOString().slice(0, 10);

  let hourly: { time: string[]; speed: number[]; dir: number[] } | null = null;
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
    const geo = await geoFor((round as RoundRow).course_slug);
    for (const [n, g] of Object.entries(geo ?? {})) {
      if (g.tee && g.green.middle) bearings[n] = Math.round(bearing(g.tee, g.green.middle));
    }
  } catch {
    /* no course data: no direction, so only No wind can be worked out */
  }
  const body = { hourly, bearings };
  kept.set(roundId, { at: Date.now(), body });
  return json(body);
}

/** Correct the wind on a hole for a group: {roundId, game, hole, wind} (wind null = back to the weather's). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isCrew(session)) return bad("Log in first", 401);
  const hole = Number(b.hole);
  if (!(hole >= 1 && hole <= 27)) return bad("Bad hole");
  const wind = b.wind == null || b.wind === "" ? null : String(b.wind);
  if (wind && !(WIND as readonly string[]).includes(wind)) return bad("Bad wind");
  const db = adminClient();
  const { data: round } = await db.from("rounds").select("id,games").eq("id", String(b.roundId ?? "")).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  const gameId = String(b.game ?? "main");
  const games = ((round.games ?? []) as Game[]).filter((g) => g.id === gameId);
  if (!isOrganiser(session) && games.length && !games[0].sides.some((s) => s.playerIds.some((p) => mayTellShots(games, { playerId: session.playerId, role: session.role }, p))))
    return bad("Only players in this group can change its wind", 403);
  const { error } = await db
    .from("hole_notes")
    .upsert({ round_id: round.id, game: gameId, hole, wind, by_name: session.name, updated_at: new Date().toISOString() }, { onConflict: "round_id,game,hole" });
  if (error) return bad(/hole_notes/.test(error.message) ? "The wind needs the latest database update (schema.sql)" : error.message, 500);
  return json({ ok: true });
}
