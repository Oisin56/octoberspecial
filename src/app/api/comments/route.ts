import { adminClient } from "@/lib/admin";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { isOrganiser } from "@/lib/auth";
import { fanAllowed, tooFast } from "@/lib/social";
import { FEED_CLOSED, feedOpen } from "@/lib/types";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Comments on a post. Players and their group comment as themselves; followers comment once
 * they've joined (name and email, confirmed by a link). action "delete" removes your own.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!session) return bad("Join the conversation to comment", 401);
  const db = adminClient();

  if (b.action === "delete") {
    const id = String(b.id ?? "");
    if (!UUID.test(id)) return bad("Bad comment");
    const { data: c } = await db.from("comments").select("id,fan_id,author_player_id").eq("id", id).eq("tournament_id", t.id).maybeSingle();
    if (!c) return json({ ok: true });
    const mine = (session.fanId && c.fan_id === session.fanId) || (session.playerId && c.author_player_id === session.playerId) || isOrganiser(session);
    if (!mine) return bad("You can only delete your own comments", 403);
    await db.from("comments").delete().eq("id", id);
    return json({ ok: true });
  }

  if (!feedOpen(t)) return bad(FEED_CLOSED, 403);
  const body = String(b.body ?? "").replace(/\s+\n/g, "\n").trim().slice(0, 500);
  if (!body) return bad("Write a comment first");
  const postId = String(b.postId ?? "");
  if (!UUID.test(postId)) return bad("Pick a post to comment on");
  const { data: post } = await db.from("posts").select("id,round_id").eq("id", postId).eq("tournament_id", t.id).eq("hidden", false).maybeSingle();
  if (!post) return bad("That post isn't there any more", 404);
  if (session.fanId && !(await fanAllowed(t.id, session.fanId))) return bad("You can't comment here any more", 403);
  if (t.feed_on === false && !isOrganiser(session)) return bad("The feed is switched off for this tournament", 403);
  if (tooFast(`comment:${session.fanId ?? session.playerId ?? session.name}`, 6, 60e3)) return bad("One comment every few seconds, please", 429);

  const { data, error } = await db
    .from("comments")
    .insert({
      tournament_id: t.id,
      round_id: post.round_id,
      post_id: post.id,
      author_name: session.name,
      fan_id: session.fanId ?? null,
      author_player_id: session.playerId ?? null,
      body,
    })
    .select()
    .single();
  if (error) return bad(/post_id|fan_id/.test(error.message) ? "Comments need the latest database update" : error.message, 500);
  return json({ ok: true, comment: data });
}
