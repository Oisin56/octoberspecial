import { adminClient } from "@/lib/admin";
import { checkOwnerPin, clearSession, getSession, hashPin, isOwner, safeEqual, setOwner, setSession } from "@/lib/auth";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";

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
  const mode = body.mode as "owner" | "organiser" | "player" | "link";
  if (!pin && mode !== "link") return bad("Enter your PIN");

  if (mode === "owner") {
    if (!checkOwnerPin(pin)) return bad("Wrong PIN", 401);
    await setOwner();
    return json({ ok: true });
  }

  const { t, demo } = await context(req, body);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);

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

  // A player's personal link: tapping it logs them in on that phone (an organiser already logged in stays organiser)
  if (mode === "link") {
    const code = String(body.code ?? "");
    if (!/^[\w-]{16,40}$/.test(code)) return bad("That link isn't complete. Ask the organiser for it again.");
    const { data: p } = await adminClient().from("players").select("id,name").eq("tournament_id", t.id).eq("link_code", code).maybeSingle();
    if (!p) return bad("That link doesn't work any more. Ask the organiser to send you a new one.", 410);
    const now = await getSession(t.id);
    if (now?.role === "organiser") return json({ ok: true, name: now.name, role: "organiser", playerId: now.playerId ?? null });
    await setSession(t.id, { role: "player", name: p.name, playerId: p.id });
    return json({ ok: true, name: p.name, role: "player", playerId: p.id });
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

  return bad("Unknown login type");
}
