import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";
import { AWARDS } from "@/lib/types";

/** Followers vote for awards (one vote per award per device; can change it). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  const award = String(b.award ?? "");
  if (!AWARDS.some((a) => a.id === award)) return bad("Unknown award");
  const voter = String(b.voter ?? "").slice(0, 64);
  if (voter.length < 16) return bad("Bad voter id");
  const db = adminClient();
  const { data: post } = await db.from("posts").select("id").eq("id", b.postId).eq("tournament_id", t.id).maybeSingle();
  if (!post) return bad("Post not found", 404);
  const { error } = await db
    .from("votes")
    .upsert({ tournament_id: t.id, award, post_id: post.id, voter }, { onConflict: "tournament_id,award,voter" });
  if (error) return bad(error.message, 500);
  return json({ ok: true });
}
