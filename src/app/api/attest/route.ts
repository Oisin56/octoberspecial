import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";

/** A player confirms the card for a nine. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { t, session } = await context(req, body);
  if (!t) return bad("Tournament not found", 404);
  if (!session?.playerId) return bad("Log in as a player to sign the card", 401);
  const segment = body.segment === "back" ? "back" : body.segment === "front" ? "front" : null;
  if (!segment || !body.roundId) return bad("Bad request");
  const db = adminClient();
  const { data: round } = await db.from("rounds").select("id").eq("id", body.roundId).eq("tournament_id", t.id).maybeSingle();
  if (!round) return bad("Round not found", 404);
  const { error } = await db
    .from("attestations")
    .upsert({ round_id: body.roundId, segment, player_id: session.playerId }, { onConflict: "round_id,segment,player_id" });
  if (error) return bad(error.message, 500);
  return json({ ok: true });
}
