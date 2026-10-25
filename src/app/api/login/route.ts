import { adminClient } from "@/lib/admin";
import { checkOwnerPin, clearSession, getAccount, hashPin, isOwner, safeEqual, setOwner, setSession, touch } from "@/lib/auth";
import { SignInError, emailProof, linkRole, organiserSession, playerSession, signIn } from "@/lib/accounts";
import { bad, context, json, DEMO_READONLY, crossSite, CROSS_SITE } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";

export async function GET(req: Request) {
  const account = await touch();
  const { t, session } = await context(req, undefined, { open: true });
  // The old PINs, while any are still in use here (the sign-in page offers them quietly)
  let pins = { organiser: false, players: false };
  if (t && new URL(req.url).searchParams.get("pins")) {
    const { data } = await adminClient().from("players").select("id").eq("tournament_id", t.id).not("pin_hash", "is", null).limit(1);
    pins = { organiser: !!t.organiser_pin_hash, players: !!data?.length };
  }
  return json({ session: t ? session : null, owner: await isOwner(), account: account ? { email: account.email } : null, pins });
}

export async function DELETE(req: Request) {
  const { t } = await context(req, undefined, { open: true });
  if (t) await clearSession(t.id);
  return json({ ok: true });
}

export async function POST(req: Request) {
  if (crossSite(req)) return bad(CROSS_SITE, 403);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode as "organiser" | "player" | "link";
  const { t, session, demo } = await context(req, body, { open: true });
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  const db = adminClient();
  const account = await getAccount();

  // ---- a player's personal link: works once during the trip, on the first phone that says "I'm Neil"
  if (mode === "link") {
    const code = String(body.code ?? "");
    if (!/^[\w-]{16,40}$/.test(code)) return bad("That link isn't complete. Ask the organiser for it again.");
    const { data: p } = await db.from("players").select("id,name,link_used_at,link_gen,email").eq("tournament_id", t.id).eq("link_code", code).maybeSingle();
    if (!p) return bad("That link doesn't work any more. Ask the organiser to send you a new one.", 410);
    // An organiser already signed in here stays organiser
    if (session?.role === "organiser") return json({ ok: true, done: true, name: session.name, role: "organiser", playerId: session.playerId ?? null });
    const thisPhone = session?.role === "player" && session.playerId === p.id;
    const { data: mine } = account ? await db.from("account_tournaments").select("player_id").eq("account_id", account.id).eq("tournament_id", t.id).maybeSingle() : { data: null };
    const theirs = mine?.player_id === p.id;
    const emailed = typeof body.e === "string" && !!p.email && safeEqual(body.e, emailProof(code, p.email));
    if (p.link_used_at && !thisPhone && !theirs) return bad("This link has already been used. Ask the organiser for a new one.", 409);

    if (body.step !== "confirm") {
      return json({
        ok: true,
        name: p.name,
        playerId: p.id,
        signedInAs: account?.email ?? null,
        joined: theirs,
        already: thisPhone,
        privacy: t.privacy ?? "friends",
        // Private, with players signing in by email too
        needEmail: t.privacy === "private" && !!t.players_need_email,
      });
    }

    // Private, with players signing in by email too: only once they're signed in, and it's theirs
    if (t.privacy === "private" && t.players_need_email && !emailed && !(account && (body.join === true || theirs))) return bad("Sign in with your email first", 403);
    // "I'm Neil": the link is used now (two phones at once: only the first gets it)
    if (!p.link_used_at) {
      const { data: took } = await db.from("players").update({ link_used_at: new Date().toISOString() }).eq("id", p.id).eq("tournament_id", t.id).is("link_used_at", null).select("id");
      if (!took?.length && !thisPhone && !theirs) return bad("This link has already been used. Ask the organiser for a new one.", 409);
    }
    try {
      if (emailed && p.email) {
        // Emailed to them: that confirms the email, so they're signed in with it and the spot is theirs
        const a = await signIn(p.email);
        await linkRole(a.id, t.id, "player", p.id);
      } else if (account && body.join === true) {
        await linkRole(account.id, t.id, "player", p.id);
      }
    } catch (e) {
      if (!(e instanceof SignInError)) throw e;
    }
    const s = await playerSession(t.id, p.id, "link");
    if (!s) return bad("That link doesn't work any more. Ask the organiser to send you a new one.", 410);
    await setSession(t.id, s);
    return json({ ok: true, done: true, name: p.name, role: "player", playerId: p.id });
  }

  const pin = String(body.pin ?? "").trim();
  if (!pin) return bad("Enter your PIN");
  if (tooFast(`pin:${clientIp(req)}`, 20, 600e3)) return bad("Too many tries. Wait a few minutes.", 429);

  // ---- organisers from before emails: their PIN, once, then their email from now on
  if (mode === "organiser") {
    if (await checkOwnerPin(pin)) {
      await setOwner();
      await setSession(t.id, await organiserSession(t.id, "owner"));
      return json({ ok: true });
    }
    if (!t.organiser_pin_hash || !safeEqual(hashPin(pin), t.organiser_pin_hash)) return bad("Wrong PIN", 401);
    if (account) {
      // Signed in already: the tournament joins their account and the PIN is retired
      await linkRole(account.id, t.id, "organiser", t.organiser_player_id ?? null);
      await db.from("tournaments").update({ organiser_pin_hash: null }).eq("id", t.id);
      await setSession(t.id, await organiserSession(t.id, "account", t.organiser_player_id ?? null));
      return json({ ok: true });
    }
    // Signed in the old way (no "via"): good until the PIN is retired, which happens when they confirm an email
    await setSession(t.id, await organiserSession(t.id, null));
    return json({ ok: true, needEmail: true });
  }

  // ---- players with an old PIN from the organiser
  if (mode === "player") {
    const { data: p } = await db.from("players").select("id,name,pin_hash").eq("tournament_id", t.id).eq("id", String(body.playerId ?? "")).maybeSingle();
    if (!p?.pin_hash) return bad("No PIN for this player. Ask the organiser to send your link.", 401);
    if (!safeEqual(hashPin(pin), p.pin_hash)) return bad("Wrong PIN", 401);
    const s = await playerSession(t.id, p.id, "pin");
    if (s) await setSession(t.id, s);
    return json({ ok: true });
  }

  return bad("Unknown login type");
}
