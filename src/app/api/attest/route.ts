import { adminClient } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { bad, json } from "@/lib/server-data";

/** A player confirms the card for a nine. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s?.playerId) return bad("Log in as a player to attest", 401);
  const body = await req.json().catch(() => ({}));
  const segment = body.segment === "back" ? "back" : body.segment === "front" ? "front" : null;
  if (!segment || !body.roundId) return bad("Bad request");
  const { error } = await adminClient()
    .from("attestations")
    .upsert({ round_id: body.roundId, segment, player_id: s.playerId }, { onConflict: "round_id,segment,player_id" });
  if (error) return bad(error.message, 500);
  return json({ ok: true });
}
