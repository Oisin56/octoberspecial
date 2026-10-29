import { mayTellShots } from "@/lib/scoring-access";
import type { Game } from "@/lib/engine";
import { adminClient } from "@/lib/admin";
import { isCrew, isOrganiser } from "@/lib/auth";
import { GolfApiError } from "@/lib/golfapi";
import { greenYards, type CourseGeo } from "@/lib/gps";
import { geoFor } from "@/lib/gpsServer";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";

export const maxDuration = 30;

/** GET ?t=slug&round=<id>: the greens and tees for the round's course, for the GPS panel. */
export async function GET(req: Request) {
  const { t, session } = await context(req);
  if (!t) return bad("Tournament not found", 404);
  if (!isCrew(session)) return bad("Log in to use GPS", 401);
  const roundId = new URL(req.url).searchParams.get("round") ?? "";
  const { data: round } = await adminClient().from("rounds").select("id,course_slug").eq("id", roundId).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  try {
    const geo = await geoFor(round.course_slug);
    return json({ geo });
  } catch (e) {
    if (e instanceof GolfApiError) return json({ geo: null, error: e.message });
    throw e;
  }
}

/**
 *   save   a reading at your ball: {clientId, roundId, hole, playerId?, lat, lon, accuracy, takenAt, source}
 *   place  put a reading on another stroke, or take it off the card: {clientId, seq | ignored}
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isCrew(session)) return bad("Log in to use GPS", 401);
  const clientId = String(b.clientId ?? "");
  if (!/^[\w-]{8,64}$/.test(clientId)) return bad("Bad reading id");
  const db = adminClient();

  if (b.op === "place") {
    const { data: r } = await db.from("gps_readings").select("id,player_id,round_id,author_name").eq("client_id", clientId).eq("tournament_id", t.id).maybeSingle();
    if (!r) return bad("Reading not found", 404);
    const mine = r.player_id === session.playerId || r.author_name === session.name || isOrganiser(session) || (await scoresFor(r.round_id, session.playerId, r.player_id));
    if (!mine) return bad("Only the player, his scorer or whoever measured it can move this", 403);
    const patch = b.ignored ? { ignored: true, seq: null } : { ignored: false, seq: b.seq == null ? null : Math.max(1, Math.min(15, Math.round(Number(b.seq)))) };
    const { error } = await db.from("gps_readings").update(patch).eq("client_id", clientId);
    if (error) return bad(error.message, 500);
    return json({ ok: true });
  }

  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const hole = Number(b.hole);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || !(hole >= 1 && hole <= 18)) return bad("Bad reading");
  const playerId = String(b.playerId || session.playerId || "");
  const { data: round } = await db.from("rounds").select("id,course_slug").eq("id", String(b.roundId ?? "")).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  const { data: player } = await db.from("players").select("id").eq("id", playerId).eq("tournament_id", t.id).maybeSingle();
  if (!player) return bad("Whose ball? Log in as a player to save readings", 400);
  let geo: CourseGeo | null = null;
  try {
    geo = await geoFor(round.course_slug);
  } catch {
    geo = null;
  }
  const g = geo?.[String(hole)];
  if (!g) return bad("No GPS for this hole", 404);
  const d = greenYards([lat, lon], g);
  // More than a mile out: not on this hole (or the phone's fix was nonsense)
  if (d.middle > 1760) return json({ ok: false, skipped: "too far from the green" });
  const takenAt = b.takenAt && !Number.isNaN(Date.parse(b.takenAt)) ? new Date(b.takenAt).toISOString() : new Date().toISOString();
  const { error } = await db.from("gps_readings").upsert(
    {
      tournament_id: t.id,
      round_id: round.id,
      hole,
      player_id: player.id,
      client_id: clientId,
      lat,
      lon,
      accuracy: Number.isFinite(Number(b.accuracy)) ? Math.round(Number(b.accuracy)) : null,
      to_front: d.front,
      to_middle: d.middle,
      to_back: d.back,
      from_tee: d.fromTee,
      source: b.source === "clip" ? "clip" : "gps",
      author_name: session.name,
      taken_at: takenAt,
    },
    { onConflict: "client_id" },
  );
  if (error) return bad(/gps_readings/.test(error.message) ? "GPS needs the latest database update (schema.sql)" : error.message, 500);
  return json({ ok: true, ...d });
}

/** Is this player in the other's group in the round (anyone in the group can place his readings)? */
async function scoresFor(roundId: string, me: string | undefined, playerId: string) {
  if (!me) return false;
  const { data } = await adminClient().from("rounds").select("games,scorer_id").eq("id", roundId).maybeSingle();
  const games = (data?.games ?? []) as Game[];
  if (!games.length) return true;
  return mayTellShots(games, { playerId: me, role: "player" }, playerId);
}
