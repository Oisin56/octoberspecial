import { adminClient } from "@/lib/admin";
import { isCrew, isOrganiser } from "@/lib/auth";
import { WIND } from "@/lib/detail";
import { windDay } from "@/lib/windServer";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { mayTellShots } from "@/lib/scoring-access";
import type { Game } from "@/lib/engine";
import type { RoundRow } from "@/lib/types";

export const maxDuration = 30;

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
  const { data: round } = await adminClient().from("rounds").select("*").eq("id", roundId).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  return json(await windDay(round as RoundRow));
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
