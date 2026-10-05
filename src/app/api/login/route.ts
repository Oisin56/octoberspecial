import { adminClient } from "@/lib/admin";
import { hashPin, safeEqual, setSession, clearSession, getSession } from "@/lib/auth";
import { bad, json, getTournamentId } from "@/lib/server-data";

export async function GET() {
  return json({ session: await getSession() });
}

export async function DELETE() {
  await clearSession();
  return json({ ok: true });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pin = String(body.pin ?? "").trim();
  const mode = body.mode as "organiser" | "player" | "contributor";
  if (!pin) return bad("Enter your PIN");

  if (mode === "organiser") {
    const expected = process.env.ORGANISER_PIN ?? "";
    if (!expected || !safeEqual(pin, expected)) return bad("Wrong PIN", 401);
    const playerId = process.env.ORGANISER_PLAYER_ID || undefined;
    let name = "Organiser";
    if (playerId) {
      const { data } = await adminClient().from("players").select("name").eq("id", playerId).maybeSingle();
      if (data) name = data.name;
    }
    await setSession({ role: "organiser", name, playerId });
    return json({ ok: true });
  }

  if (mode === "player") {
    const tid = await getTournamentId();
    const { data: p } = await adminClient()
      .from("players")
      .select("id,name,pin_hash")
      .eq("tournament_id", tid)
      .eq("id", String(body.playerId ?? ""))
      .maybeSingle();
    if (!p?.pin_hash) return bad("No PIN set for this player yet — ask the organiser", 401);
    if (!safeEqual(hashPin(pin), p.pin_hash)) return bad("Wrong PIN", 401);
    await setSession({ role: "player", name: p.name, playerId: p.id });
    return json({ ok: true });
  }

  if (mode === "contributor") {
    const expected = process.env.CONTRIBUTOR_PIN ?? "";
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!name) return bad("Enter your name");
    if (!expected || !safeEqual(pin, expected)) return bad("Wrong PIN", 401);
    await setSession({ role: "contributor", name });
    return json({ ok: true });
  }

  return bad("Unknown login type");
}
