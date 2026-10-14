import { adminClient } from "@/lib/admin";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { REPORTS_TO_HIDE, clientIp, reporterKey, tooFast } from "@/lib/social";

const UUID = /^[0-9a-f-]{36}$/i;

/** Anyone can report a post or comment. Three reports from different people hide it until the organiser looks. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  const table = b.commentId ? "comments" : "posts";
  const id = String(b.commentId ?? b.postId ?? "");
  if (!UUID.test(id)) return bad("Bad report");
  if (tooFast(`report:${clientIp(req)}`, 20, 3600e3)) return bad("Too many reports from here. Try again later.", 429);
  const db = adminClient();
  const { data: item } = await db.from(table).select("id,hidden").eq("id", id).eq("tournament_id", t.id).maybeSingle();
  if (!item) return bad("That isn't there any more", 404);

  const col = table === "posts" ? "post_id" : "comment_id";
  const { error } = await db.from("reports").insert({ tournament_id: t.id, [col]: id, reporter: reporterKey(req, session) });
  // Reported already by this person: fine, counts once
  if (error && !/duplicate|unique/i.test(error.message)) return bad("Couldn't send the report", 500);

  const { count } = await db.from("reports").select("id", { count: "exact", head: true }).eq(col, id);
  let hidden = !!item.hidden;
  if (!hidden && (count ?? 0) >= REPORTS_TO_HIDE) {
    await db.from(table).update({ hidden: true, hidden_by_reports: true }).eq("id", id);
    hidden = true;
  }
  return json({ ok: true, hidden });
}
