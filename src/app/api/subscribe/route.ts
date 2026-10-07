import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin } from "@/lib/server-data";
import { EMAIL_RE, ipHash, mailConfigured, sendOne, welcomeEmail } from "@/lib/email";

/** Follower signs up for previews and reports by email. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (b.website) return json({ ok: true }); // bots fill in the hidden field
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const name = String(b.name ?? "").trim().slice(0, 60) || null;
  if (!EMAIL_RE.test(email)) return bad("That email address doesn't look right");
  const db = adminClient();
  const ip = ipHash(req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await db.from("subscribers").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", since);
  if ((count ?? 0) >= 5) return bad("Too many sign-ups from here. Try again later.", 429);

  const { data: existing } = await db.from("subscribers").select("id,token,unsubscribed_at").eq("tournament_id", t.id).ilike("email", email).maybeSingle();
  let token: string;
  if (existing) {
    if (!existing.unsubscribed_at) return json({ ok: true, already: true });
    await db.from("subscribers").update({ unsubscribed_at: null, name }).eq("id", existing.id);
    token = existing.token;
  } else {
    const { data, error } = await db.from("subscribers").insert({ tournament_id: t.id, email, name, ip_hash: ip }).select("token").single();
    if (error) return bad("Couldn't sign you up just now", 500);
    token = data.token;
  }
  if (mailConfigured()) {
    const site = siteOrigin(req);
    const unsubscribe = `${site}/api/unsubscribe?token=${token}`;
    try {
      await sendOne(t, email, welcomeEmail(t, name, { link: `${site}/t/${t.slug}`, unsubscribe }), unsubscribe);
    } catch {
      // still signed up; the welcome email is a courtesy
    }
  }
  return json({ ok: true });
}
