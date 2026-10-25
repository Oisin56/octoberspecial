import { randomBytes } from "node:crypto";
import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { EMAIL_RE, fanLinkEmail, mailConfigured, sendOne } from "@/lib/email";
import { isCrew, setSession } from "@/lib/auth";
import { signIn } from "@/lib/accounts";
import { clientIp, tooFast } from "@/lib/social";

const TOKEN = /^[\w-]{20,64}$/;
const LINK_HOURS = 48;

/**
 * Followers join the conversation with their own name and email (16 or over, and they agree).
 * We email a one-tap link; opening it signs them in on that phone. No password.
 * action "join" sends the link; action "verify" signs in from the link.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  const db = adminClient();

  if (b.action === "verify") {
    const token = String(b.token ?? "");
    if (!TOKEN.test(token)) return bad("That link isn't complete. Open it from the email again.");
    const { data: fan } = await db.from("fans").select("id,name,email,blocked,token_expires").eq("tournament_id", t.id).eq("token", token).maybeSingle();
    if (!fan || !fan.token_expires || new Date(fan.token_expires).getTime() < Date.now())
      return bad("That link has expired. Ask for a new one from the feed.", 410);
    if (fan.blocked) return bad("This email can't join the conversation.", 403);
    await db.from("fans").update({ verified_at: new Date().toISOString(), token: null }).eq("id", fan.id);
    // The email is confirmed, so they're signed in with it: this tournament shows under Following in My golf
    await signIn(fan.email).catch(() => null);
    // Already signed in as a player or organiser on this phone? Keep that (it can do more)
    if (!isCrew(session)) await setSession(t.id, { role: "fan", name: fan.name, fanId: fan.id });
    return json({ ok: true, name: fan.name, crew: isCrew(session) });
  }

  // join
  if (b.website) return json({ ok: true, sent: true }); // bots fill in the hidden field
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!name) return bad("Add your name");
  if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  if (b.over16 !== true) return bad("You need to be 16 or over to join");
  if (b.consent !== true) return bad("Tick the box to agree");
  if (tooFast(`fanjoin:${clientIp(req)}`, 10, 3600e3)) return bad("Too many sign-ups from here. Try again later.", 429);

  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + LINK_HOURS * 3600e3).toISOString();
  const { data: existing } = await db.from("fans").select("id,blocked").eq("tournament_id", t.id).eq("email", String(email).toLowerCase()).maybeSingle();
  let fanId: string;
  if (existing) {
    if (existing.blocked) return bad("This email can't join the conversation.", 403);
    await db.from("fans").update({ name, token, token_expires: expires, consent_at: new Date().toISOString() }).eq("id", existing.id);
    fanId = existing.id;
  } else {
    const { data, error } = await db.from("fans").insert({ tournament_id: t.id, name, email, token, token_expires: expires }).select("id").single();
    if (error || !data) return bad("Couldn't sign you up just now. Try again.", 500);
    fanId = data.id;
  }

  // No email set up for this site: sign in straight away on this phone
  if (!mailConfigured()) {
    await db.from("fans").update({ verified_at: new Date().toISOString() }).eq("id", fanId);
    if (!isCrew(session)) await setSession(t.id, { role: "fan", name, fanId });
    return json({ ok: true, signedIn: true });
  }
  const link = `${siteOrigin(req)}/t/${t.slug}/join?token=${token}`;
  try {
    await sendOne(t, email, fanLinkEmail(t, name, link));
  } catch {
    return bad("Couldn't send the email just now. Check the address and try again.", 502);
  }
  return json({ ok: true, sent: true });
}
