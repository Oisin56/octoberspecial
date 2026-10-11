import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";
import { DEVICE, clientIp, likerKey, tooFast } from "@/lib/social";

/** Like or unlike a post: anyone, no sign-in, one like per post per phone. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  const postId = String(b.postId ?? "");
  const device = String(b.device ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !DEVICE.test(device)) return bad("Bad like");
  if (tooFast(`like:${clientIp(req)}`, 60, 60e3)) return bad("Slow down a little", 429);
  const db = adminClient();
  const { data: post } = await db.from("posts").select("id").eq("id", postId).eq("tournament_id", t.id).eq("hidden", false).eq("visibility", "public").maybeSingle();
  if (!post) return bad("That post isn't there any more", 404);

  const liker = likerKey(device);
  const want = b.like !== false;
  if (want) {
    const { error } = await db.from("likes").upsert({ post_id: postId, tournament_id: t.id, liker }, { onConflict: "post_id,liker", ignoreDuplicates: true });
    if (error) return bad("Couldn't save the like", 500);
  } else {
    await db.from("likes").delete().eq("post_id", postId).eq("liker", liker);
  }
  const { count } = await db.from("likes").select("liker", { count: "exact", head: true }).eq("post_id", postId);
  return json({ ok: true, liked: want, count: count ?? 0 });
}
