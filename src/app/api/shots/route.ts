import { isCrew, isOrganiser, type Session } from "@/lib/auth";
import { adminClient } from "@/lib/admin";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { CLUB_GROUPS, DISTANCES, KIND_LABEL } from "@/lib/shots";
import { BAG, CONTACT, FLIGHT, PUTT_LENGTHS, SHAPE } from "@/lib/detail";
import { mayTellShots } from "@/lib/scoring-access";
import type { Game } from "@/lib/engine";

/** How it finished: optional now (a shot can be told with only its club) */
const OUTCOME = /^[\w ,.+'&–-]{0,40}$/;
const CLUBS = new Set<string>([...BAG, ...CLUB_GROUPS, "Putter"]);
const LENGTHS = new Set<string>([...DISTANCES, ...PUTT_LENGTHS]);
const oneOf = (v: unknown, list: readonly string[]) => (v == null || v === "" ? null : list.includes(String(v)) ? String(v) : undefined);

/** Log, change or remove one shot. Saves are idempotent by the phone's id for the shot. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isCrew(session)) return bad("Log in to log shots", 401);
  const clientId = String(b.clientId ?? "");
  if (!/^[\w-]{8,64}$/.test(clientId)) return bad("Bad shot id");
  const db = adminClient();

  // Changing or removing a shot already logged: whoever logged it, the player, his scorer, or the organiser
  const { data: existing } = await db.from("shots").select("player_id,round_id,author_name,author_player_id").eq("client_id", clientId).eq("tournament_id", t.id).maybeSingle();
  if (existing && !(await mayChange(existing, session))) return bad(`Only players in this group can change this shot`, 403);

  if (b.op === "delete") {
    const { error } = await db.from("shots").delete().eq("client_id", clientId).eq("tournament_id", t.id);
    if (error) return bad(missing(error.message), 500);
    return json({ ok: true });
  }

  const seq = b.seq == null || b.seq === "" ? null : Math.round(Number(b.seq));
  if (seq != null && !(seq >= 1 && seq <= 15)) return bad("Bad stroke");
  const kind = String(b.kind ?? "");
  const outcome = String(b.outcome ?? "");
  if (!(kind in KIND_LABEL) || !OUTCOME.test(outcome)) return bad("Bad shot");
  const hole = Number(b.hole);
  if (!(hole >= 1 && hole <= 18)) return bad("Bad hole");
  const club = b.club == null || b.club === "" ? null : String(b.club);
  if (club && !CLUBS.has(club)) return bad("Bad club");
  const distance = b.distance == null || b.distance === "" ? null : String(b.distance);
  if (distance && !LENGTHS.has(distance)) return bad("Bad distance");
  const contact = oneOf(b.contact, CONTACT);
  const shape = oneOf(b.shape, SHAPE);
  const flight = oneOf(b.flight, FLIGHT);
  if (contact === undefined || shape === undefined || flight === undefined) return bad("Bad shot");
  const [{ data: round }, { data: player }] = await Promise.all([
    db.from("rounds").select("id").eq("id", String(b.roundId ?? "")).eq("tournament_id", t.id).maybeSingle(),
    db.from("players").select("id").eq("id", String(b.playerId ?? "")).eq("tournament_id", t.id).maybeSingle(),
  ]);
  if (!round) return bad("Round not found", 404);
  if (!player) return bad("Player not found", 404);
  // A new shot: anyone in the player's group (or the organiser)
  if (!existing && !(await mayChange({ player_id: player.id, round_id: round.id, author_name: "", author_player_id: null }, session))) return bad("Only players in this group can tell these shots", 403);
  const loggedAt = b.loggedAt && !Number.isNaN(Date.parse(b.loggedAt)) ? new Date(b.loggedAt).toISOString() : new Date().toISOString();

  const row: Record<string, unknown> = {
        tournament_id: t.id,
        round_id: round.id,
        hole,
        player_id: player.id,
        kind,
        outcome,
        club,
        distance,
        contact,
        shape,
        flight,
        seq,
        // A change keeps the original author (they still own it)
        author_name: existing?.author_name ?? session.name,
        author_player_id: existing ? existing.author_player_id : (session.playerId ?? null),
        client_id: clientId,
        logged_at: loggedAt,
      };
  let { data, error } = await db.from("shots").upsert(row, { onConflict: "client_id" }).select().single();
  if (error && /contact|shape|flight/.test(error.message)) {
    // Database not updated yet: the shot still saves, without the extras
    delete row.contact;
    delete row.shape;
    delete row.flight;
    ({ data, error } = await db.from("shots").upsert(row, { onConflict: "client_id" }).select().single());
  }
  if (error && /seq|author_player_id/.test(error.message)) {
    // Database not updated yet: the shot still saves, just without its stroke number
    delete row.seq;
    delete row.author_player_id;
    ({ data, error } = await db.from("shots").upsert(row, { onConflict: "client_id" }).select().single());
  }
  if (error) return bad(missing(error.message), 500);
  return json({ shot: data });
}

const missing = (m: string) => (/relation .*shots|shots.*does not exist|schema cache|seq|author_player_id/i.test(m) ? "The shot log needs the latest database update: re-run supabase/schema.sql in Supabase." : m);

/** Anyone in the player's group can tell (and change) his shots; whoever logged one can always change it; the organiser anything. */
async function mayChange(shot: { player_id: string; round_id: string; author_name: string; author_player_id: string | null }, s: Session) {
  if (isOrganiser(s)) return true;
  if (s.playerId && (shot.player_id === s.playerId || shot.author_player_id === s.playerId)) return true;
  if (!shot.author_player_id && shot.author_name && shot.author_name === s.name) return true;
  if (!s.playerId) return false;
  const { data } = await adminClient().from("rounds").select("games,scorer_id").eq("id", shot.round_id).maybeSingle();
  const games = (data?.games ?? []) as Game[];
  // A round with no groups set: everyone's in one group
  if (!games.length) return true;
  return mayTellShots(games, { playerId: s.playerId, role: s.role }, shot.player_id);
}
