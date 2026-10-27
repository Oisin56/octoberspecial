import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { EMAIL_RE, ipHash } from "@/lib/email";
import { deliver, mailConfigured } from "@/lib/mail/send";
import { signedUpMail, stoppedBeforeMail } from "@/lib/mail/emails";

/** Follower signs up for previews and reports by email. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (b.website) return json({ ok: true }); // bots fill in the hidden field
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(b.name ?? "").trim().slice(0, 60) || null;
  if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  const db = adminClient();
  const ip = ipHash(req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await db.from("subscribers").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", since);
  if ((count ?? 0) >= 5) return bad("Too many sign-ups from here. Try again later.", 429);

  const { data: existing } = await db.from("subscribers").select("id,unsubscribed_at").eq("tournament_id", t.id).eq("email", String(email).toLowerCase()).maybeSingle();
  if (existing) {
    if (!existing.unsubscribed_at) return json({ ok: true, already: true });
    await db.from("subscribers").update({ unsubscribed_at: null, name }).eq("id", existing.id);
  } else {
    const { error } = await db.from("subscribers").insert({ tournament_id: t.id, email, name, ip_hash: ip });
    if (error) return bad("Couldn't sign you up just now", 500);
  }
  if (mailConfigured()) {
    try {
      const { data: p } = await db.from("people").select("updates_stopped_at").eq("email", email).maybeSingle();
      // They'd stopped every email: nothing comes unless they turn updates back on themselves (this form doesn't
      // prove the address is theirs), so tell them how
      if (p?.updates_stopped_at) await deliver(await stoppedBeforeMail(siteOrigin(req), t, email));
      else await deliver(await signedUpMail(siteOrigin(req), t, name, email));
    } catch {
      // still signed up; the welcome email is a courtesy
    }
  }
  return json({ ok: true });
}
