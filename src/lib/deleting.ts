import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { removeStored } from "./films";
import { BIO_FIELDS } from "./bios";
import { logActivity } from "./activity";

/**
 * People delete what they posted, and their account, themselves. Scores, results, reports and films stay, as the
 * privacy policy says. Two choices: everything they posted goes too, or their posts stay up under their name. Their
 * account, email, bio and photo go either way. Only a scrambled copy of the address is kept, so marketing can never
 * reach it again.
 */

export const deletedHash = (email: string) => createHash("sha256").update(`mgb-deleted:${email.trim().toLowerCase()}`).digest("hex");

/** Live or coming-up trips this person is the only organiser of: they finish them, or add a co-organiser, first */
export async function soleOrganiserOf(accountId: string): Promise<string[]> {
  const db = adminClient();
  const { data: mine } = await db.from("account_tournaments").select("tournament_id").eq("account_id", accountId).eq("role", "organiser");
  const ids = (mine ?? []).map((m) => m.tournament_id);
  if (!ids.length) return [];
  const { data: ts } = await db.from("tournaments").select("id,name,finished_at,solo").in("id", ids);
  const open = (ts ?? []).filter((t) => !t.finished_at && !t.solo);
  const out: string[] = [];
  for (const t of open) {
    const { count } = await db.from("account_tournaments").select("account_id", { count: "exact", head: true }).eq("tournament_id", t.id).eq("role", "organiser");
    if ((count ?? 0) <= 1) out.push(t.name);
  }
  return out;
}

/** A player's spot: the name and scores stay; email, bio, photo and the asks go. Their posts too, if they chose. */
export async function clearSpot(playerId: string, keepPosts: boolean) {
  const db = adminClient();
  const { data: p } = await db.from("players").select("id,tournament_id,photo_path").eq("id", playerId).maybeSingle();
  if (!p) return;
  if (!keepPosts) await removePosts({ playerIds: [playerId] });
  const blank = Object.fromEntries([...BIO_FIELDS, "bio", "quote", "email"].map((f) => [f, null]));
  await db.from("players").update({ ...blank, asks: {} }).eq("id", playerId);
  await removeStored(p.photo_path);
}

/** Their posts (with the photo and video files) and comments. A clip already in a film stays in the film. */
async function removePosts(by: { playerIds?: string[]; fanIds?: string[] }) {
  const db = adminClient();
  const filters = [by.playerIds?.length ? `author_player_id.in.(${by.playerIds.join(",")})` : "", by.fanIds?.length ? `fan_id.in.(${by.fanIds.join(",")})` : ""].filter(Boolean).join(",");
  if (!filters) return;
  for (;;) {
    const { data: posts } = await db.from("posts").select("id,media_path,broadcast_path,author_name").or(filters).neq("author_name", "AI director").limit(500);
    if (!posts?.length) break;
    for (const p of posts) {
      await removeStored(p.media_path);
      await removeStored(p.broadcast_path);
    }
    await db.from("posts").delete().in("id", posts.map((p) => p.id));
    if (posts.length < 500) break;
  }
  await db.from("comments").delete().or(filters);
}

/** Delete the account. Returns the email it was, for the goodbye email. */
export async function deleteAccount(a: { id: string; email: string }, keepPosts: boolean): Promise<void> {
  const db = adminClient();
  const email = a.email.trim().toLowerCase();
  const [{ data: joins }, { data: typed }, { data: fans }] = await Promise.all([
    db.from("account_tournaments").select("player_id").eq("account_id", a.id).not("player_id", "is", null),
    db.from("players").select("id").eq("email", email),
    db.from("fans").select("id,photo_path").eq("email", email),
  ]);
  const spots = [...new Set([...(joins ?? []).map((j) => j.player_id as string), ...(typed ?? []).map((p) => p.id as string)])];
  const fanIds = (fans ?? []).map((f) => f.id as string);
  if (!keepPosts) await removePosts({ playerIds: spots, fanIds });
  for (const id of spots) await clearSpot(id, true);
  for (const f of fans ?? []) await removeStored(f.photo_path);
  // Followers: gone (posts they kept stay under their name)
  if (fanIds.length) await db.from("fans").delete().in("id", fanIds);
  await db.from("subscribers").delete().eq("email", email);
  await db.from("account_offers").delete().eq("email", email);
  await db.from("account_tokens").delete().eq("email", email);
  await db.from("invite_requests").delete().eq("email", email).then(() => null, () => null);
  await db.from("data_requests").delete().eq("email", email);
  await db.from("email_sends").delete().eq("email", email);
  await db.from("email_blocks").delete().eq("email", email);
  await db.from("accounts").delete().eq("id", a.id);
  await db.from("people").delete().eq("email", email);
  await db.from("deleted_emails").upsert({ hash: deletedHash(email), at: new Date().toISOString() }, { onConflict: "hash" });
  await logActivity({ email: "someone", role: "person" }, "account.deleted", { detail: { keptPosts: keepPosts, spots: spots.length, followed: fanIds.length } });
}
