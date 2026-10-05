import { adminClient } from "@/lib/admin";
import { checkOwnerPin, clearSession, hashPin, isOwner, safeEqual, setOwner, setSession } from "@/lib/auth";
import { bad, context, json } from "@/lib/server-data";

export async function GET(req: Request) {
  const { t, session } = await context(req);
  return json({ session: t ? session : null, owner: await isOwner() });
}

export async function DELETE(req: Request) {
  const { t } = await context(req);
  if (t) await clearSession(t.id);
  return json({ ok: true });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pin = String(body.pin ?? "").trim();
  const mode = body.mode as "owner" | "organiser" | "player" | "contributor";
  if (!pin) return bad("Enter your PIN");

  if (mode === "owner") {
    if (!checkOwnerPin(pin)) return bad("Wrong PIN", 401);
    await setOwner();
    return json({ ok: true });
  }

  const { t } = await context(req, body);
  if (!t) return bad("Tournament not found", 404);

  if (mode === "organiser") {
    const ok = checkOwnerPin(pin) || (!!t.organiser_pin_hash && safeEqual(hashPin(pin), t.organiser_pin_hash));
    if (!ok) return bad("Wrong PIN", 401);
    let name = "Organiser";
    const playerId = t.organiser_player_id || undefined;
    if (playerId) {
      const { data } = await adminClient().from("players").select("name").eq("id", playerId).maybeSingle();
      if (data) name = data.name;
    }
    await setSession(t.id, { role: "organiser", name, playerId });
    return json({ ok: true });
  }

  if (mode === "player") {
    const { data: p } = await adminClient()
      .from("players")
      .select("id,name,pin_hash")
      .eq("tournament_id", t.id)
      .eq("id", String(body.playerId ?? ""))
      .maybeSingle();
    if (!p?.pin_hash) return bad("No PIN set for this player yet. Ask the organiser.", 401);
    if (!safeEqual(hashPin(pin), p.pin_hash)) return bad("Wrong PIN", 401);
    await setSession(t.id, { role: "player", name: p.name, playerId: p.id });
    return json({ ok: true });
  }

  if (mode === "contributor") {
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!name) return bad("Enter your name");
    const envPin = process.env.CONTRIBUTOR_PIN ?? "";
    const ok =
      (!!t.contributor_pin_hash && safeEqual(hashPin(pin), t.contributor_pin_hash)) ||
      (!t.contributor_pin_hash && !!envPin && safeEqual(pin, envPin));
    if (!ok) return bad("Wrong PIN", 401);
    await setSession(t.id, { role: "contributor", name });
    return json({ ok: true });
  }

  return bad("Unknown login type");
}
