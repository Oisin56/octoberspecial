import { adminClient } from "@/lib/admin";
import { followWaitingEmail, mailConfigured, sendOne } from "@/lib/email";
import { json, siteOrigin } from "@/lib/server-data";
import type { TournamentRow } from "@/lib/types";

export const maxDuration = 60;

/**
 * Once a day (Vercel runs it each morning): organisers of private tournaments hear about anyone who has been waiting
 * more than 12 hours to follow. Each request is mentioned once, so running it again sends nothing new.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not allowed" }, 401);
  if (!mailConfigured()) return json({ ok: true, sent: 0 });
  const db = adminClient();
  const before = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { data: waiting } = await db.from("fans").select("id,name,tournament_id,email,verified_at").eq("status", "asking").is("reminded_at", null).lt("created_at", before);
  const ready = (waiting ?? []).filter((f) => !f.email || f.verified_at);
  const byT = new Map<string, typeof ready>();
  for (const f of ready) byT.set(f.tournament_id, [...(byT.get(f.tournament_id) ?? []), f]);
  let sent = 0;
  for (const [tid, fans] of byT) {
    const { data: t } = await db.from("tournaments").select("*").eq("id", tid).maybeSingle();
    if (!t) continue;
    const { data: rows } = await db.from("account_tournaments").select("account_id").eq("tournament_id", tid).eq("role", "organiser");
    const ids = (rows ?? []).map((r) => r.account_id);
    const { data: accts } = ids.length ? await db.from("accounts").select("email").in("id", ids) : { data: [] };
    const msg = followWaitingEmail(t as TournamentRow, fans.map((f) => f.name), `${siteOrigin(req)}/t/${t.slug}/following`);
    for (const a of accts ?? []) if (await sendOne(t, a.email, msg).then(() => true, () => false)) sent++;
    await db.from("fans").update({ reminded_at: new Date().toISOString() }).in("id", fans.map((f) => f.id));
  }
  return json({ ok: true, sent });
}
