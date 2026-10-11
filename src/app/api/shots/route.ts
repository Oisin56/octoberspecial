import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";
import { CLUB_GROUPS, DISTANCES, KIND_LABEL } from "@/lib/shots";

const OUTCOME = /^[\w ,.+'&–-]{1,40}$/;

/** Log, change or remove one shot. Saves are idempotent by the phone's id for the shot. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (!session) return bad("Log in to log shots", 401);
  const clientId = String(b.clientId ?? "");
  if (!/^[\w-]{8,64}$/.test(clientId)) return bad("Bad shot id");
  const db = adminClient();

  if (b.op === "delete") {
    const { error } = await db.from("shots").delete().eq("client_id", clientId).eq("tournament_id", t.id);
    if (error) return bad(missing(error.message), 500);
    return json({ ok: true });
  }

  const kind = String(b.kind ?? "");
  const outcome = String(b.outcome ?? "");
  if (!(kind in KIND_LABEL) || !OUTCOME.test(outcome)) return bad("Bad shot");
  const hole = Number(b.hole);
  if (!(hole >= 1 && hole <= 18)) return bad("Bad hole");
  const club = b.club == null || b.club === "" ? null : String(b.club);
  if (club && !([...CLUB_GROUPS, "Putter"] as string[]).includes(club)) return bad("Bad club");
  const distance = b.distance == null || b.distance === "" ? null : String(b.distance);
  if (distance && !(DISTANCES as readonly string[]).includes(distance)) return bad("Bad distance");
  const [{ data: round }, { data: player }] = await Promise.all([
    db.from("rounds").select("id").eq("id", String(b.roundId ?? "")).eq("tournament_id", t.id).maybeSingle(),
    db.from("players").select("id").eq("id", String(b.playerId ?? "")).eq("tournament_id", t.id).maybeSingle(),
  ]);
  if (!round) return bad("Round not found", 404);
  if (!player) return bad("Player not found", 404);
  const loggedAt = b.loggedAt && !Number.isNaN(Date.parse(b.loggedAt)) ? new Date(b.loggedAt).toISOString() : new Date().toISOString();

  const { data, error } = await db
    .from("shots")
    .upsert(
      { tournament_id: t.id, round_id: round.id, hole, player_id: player.id, kind, outcome, club, distance, author_name: session.name, client_id: clientId, logged_at: loggedAt },
      { onConflict: "client_id" },
    )
    .select()
    .single();
  if (error) return bad(missing(error.message), 500);
  return json({ shot: data });
}

const missing = (m: string) => (/relation .*shots|shots.*does not exist|schema cache/i.test(m) ? "The shot log needs the latest database update: re-run supabase/schema.sql in Supabase." : m);
