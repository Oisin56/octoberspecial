import { adminClient } from "@/lib/admin";
import { checkOwnerPin, clearAccount, getAccount, getSession, hashPin, safeEqual, setAccount, setSession } from "@/lib/auth";
import { LINK_MINUTES, accountTournaments, linkTournament, newToken, organiserSession, organiserSessions, tokenHash } from "@/lib/accounts";
import { EMAIL_RE, accountLinkEmail, mailConfigured, sendOne } from "@/lib/email";
import { bad, json, siteOrigin, tournamentBySlug } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";

/** Who's signed in, and their tournaments */
export async function GET() {
  const account = await getAccount();
  if (!account) return json({ account: null, tournaments: [] });
  return json({ account, tournaments: await accountTournaments(account.id) });
}

/**
 *   send    email a one-tap sign-in link
 *   verify  sign in from the link (works once, for 30 minutes)
 *   link    add a tournament you organise to your account (organiser already, or its organiser PIN)
 *   signout
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const db = adminClient();

  if (b.action === "send") {
    const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
    if (!mailConfigured()) return bad("Email isn't set up on this site yet, so sign-in by email isn't available.", 503);
    if (tooFast(`acct:${clientIp(req)}`, 8, 3600e3) || tooFast(`acct:${email}`, 4, 3600e3)) return bad("Too many sign-in emails. Try again in a while.", 429);
    const token = newToken();
    const { error } = await db.from("account_tokens").insert({ token_hash: tokenHash(token), email, expires_at: new Date(Date.now() + LINK_MINUTES * 60e3).toISOString() });
    if (error) return bad(/account_tokens/.test(error.message) ? "Sign-in needs the latest database update (schema.sql)" : "Couldn't send just now. Try again.", 500);
    const next = typeof b.next === "string" && /^\/[\w/-]*$/.test(b.next) ? `&next=${encodeURIComponent(b.next)}` : "";
    try {
      await sendOne({ name: "MyGolfSpecial" }, email, accountLinkEmail(`${siteOrigin(req)}/account/in?token=${token}${next}`));
    } catch {
      return bad("Couldn't send the email just now. Check the address and try again.", 502);
    }
    return json({ ok: true, sent: true });
  }

  if (b.action === "verify") {
    const token = String(b.token ?? "");
    if (!/^[\w-]{20,64}$/.test(token)) return bad("That link isn't complete. Open it from the email again.");
    const { data: row } = await db.from("account_tokens").select("email,expires_at,used_at").eq("token_hash", tokenHash(token)).maybeSingle();
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return bad("That link has expired or been used. Ask for a new one.", 410);
    await db.from("account_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", tokenHash(token));
    let { data: acct } = await db.from("accounts").select("id,email").ilike("email", row.email).maybeSingle();
    if (!acct) ({ data: acct } = await db.from("accounts").insert({ email: row.email }).select("id,email").single());
    if (!acct) return bad("Couldn't sign you in just now. Try again.", 500);
    await setAccount({ id: acct.id, email: acct.email }, await organiserSessions(acct.id));
    return json({ ok: true });
  }

  const account = await getAccount();
  if (b.action === "signout") {
    await clearAccount();
    return json({ ok: true });
  }
  if (!account) return bad("Sign in with your email first", 401);

  if (b.action === "link") {
    const slug = String(b.t ?? "").replace(/^.*\/t\//, "").replace(/[/?#].*$/, "").trim();
    const t = await tournamentBySlug(slug);
    if (!t) return bad("Couldn't find that tournament. Paste its link or check the name.", 404);
    const s = await getSession(t.id);
    const pin = String(b.pin ?? "").trim();
    // Same as the organiser log-in: the tournament's organiser PIN (or the site owner's)
    const ok = s?.role === "organiser" || (!!pin && (checkOwnerPin(pin) || (!!t.organiser_pin_hash && safeEqual(hashPin(pin), t.organiser_pin_hash))));
    if (!ok) return bad(pin ? "That organiser PIN isn't right" : "Enter the tournament's organiser PIN", 401);
    await linkTournament(account.id, t.id);
    if (s?.role !== "organiser") await setSession(t.id, await organiserSession(t.id));
    return json({ ok: true, tournaments: await accountTournaments(account.id) });
  }

  return bad("Unknown action");
}
