import { adminClient } from "@/lib/admin";
import { followWaitingEmail, mailConfigured, sendOne } from "@/lib/email";
import { json, siteOrigin } from "@/lib/server-data";
import { moveFiles } from "@/lib/files";
import { consoleDaily } from "@/lib/console-jobs";
import type { TournamentRow } from "@/lib/types";

export const maxDuration = 60;

/**
 * Each morning (Vercel runs it at 6 and 7 UTC, sending the CRON_SECRET setting, so one run lands on 7am Irish time
 * whatever the season):
 *  - the console's daily work: tournament figures, the day's snapshot, the Needs you sweep, and the 7am email
 *  - any photo or clip that reached the wrong store as its tournament changed who can watch is moved
 *  - organisers of private tournaments hear about anyone who has been waiting more than 12 hours to follow. Each
 *    request is mentioned once, so running it again sends nothing new.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET isn't set in Vercel, so the daily jobs didn't run");
    return json({ error: "Not set up" }, 503);
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not allowed" }, 401);
  const db = adminClient();
  // The console's work first (the 7am email can't wait behind anything)
  const console_ = await consoleDaily();
  // Files: tournaments that changed who can watch in the last two days (an upload link given out just before can
  // still land in the old store)
  let moved = 0;
  const { data: changed } = await db.from("tournaments").select("slug,privacy").gte("privacy_changed_at", new Date(Date.now() - 2 * 864e5).toISOString()).limit(500);
  for (const t of changed ?? []) moved += await moveFiles(t.slug, t.privacy === "private").catch((e) => (console.error("[cron] files", t.slug, e), 0));
  if (!mailConfigured()) return json({ ok: true, sent: 0, moved, console: console_ });
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
  return json({ ok: true, sent, moved, console: console_ });
}
