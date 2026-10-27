import "server-only";
import { adminClient } from "./admin";
import { storeFor } from "./files";

/**
 * A player's bio: home club, best and worst club, known weakness, nickname and photo. Given on their own phone (or typed
 * in by the organiser), it gives the commentary its colour. Once the player has an account, it's kept there too, and
 * every later trip they join starts with it filled in.
 */
export const BIO_FIELDS = ["home_club", "best_club", "worst_club", "weakness", "nickname", "photo_path"] as const;
export type BioField = (typeof BIO_FIELDS)[number];
export type Bio = Partial<Record<BioField, string | null>>;

export const CLUBS = ["Driver", "Woods", "Hybrid", "Irons", "Wedges", "Putter"];
export const WEAKNESSES = ["Three-putts", "The slice", "Bunkers", "The 19th hole"];

const LIMIT: Record<BioField, number> = { home_club: 60, best_club: 30, worst_club: 30, weakness: 80, nickname: 30, photo_path: 200 };

/** Tidy what was sent: plain text, short; a photo only from this tournament's own folder. Unsent fields are left out. */
export function cleanBio(raw: unknown, slug: string): Bio {
  const x = (raw ?? {}) as Record<string, unknown>;
  const out: Bio = {};
  for (const f of BIO_FIELDS) {
    if (!(f in x)) continue;
    const v = x[f] == null ? "" : String(x[f]).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, LIMIT[f]);
    if (f === "photo_path" && v && !new RegExp(`^photo/${slug}/[\\w-]+\\.[a-z0-9]+$`).test(v)) continue;
    out[f] = v || null;
  }
  return out;
}

export const hasBio = (p: Bio) => BIO_FIELDS.some((f) => !!p[f]);

export async function accountBio(accountId: string): Promise<Bio | null> {
  const { data, error } = await adminClient().from("accounts").select("bio").eq("id", accountId).maybeSingle();
  if (error) return null;
  return (data?.bio as Bio | null) ?? null;
}

/** A photo kept for one tournament, copied into another's folder (each tournament's files live with it). */
async function copyPhoto(from: string, toSlug: string): Promise<string | null> {
  try {
    const { data } = await (await storeFor(from)).download(from);
    if (!data) return null;
    const ext = from.split(".").pop() ?? "jpg";
    const to = `photo/${toSlug}/bio-${crypto.randomUUID()}.${ext}`;
    const { error } = await (await storeFor(to)).upload(to, await data.arrayBuffer(), { contentType: data.type || "image/jpeg" });
    return error ? null : to;
  } catch {
    return null;
  }
}

/** The player's own answers, kept on their account (only what they gave; empty answers don't wipe the account's). */
export async function bioToAccount(accountId: string, tid: string, playerId: string) {
  const db = adminClient();
  const { data: p } = await db.from("players").select(BIO_FIELDS.join(",")).eq("id", playerId).eq("tournament_id", tid).maybeSingle();
  if (!p) return;
  const now = (await accountBio(accountId)) ?? {};
  const next: Bio = { ...now };
  for (const f of BIO_FIELDS) if ((p as Bio)[f]) next[f] = (p as Bio)[f];
  await db.from("accounts").update({ bio: next }).eq("id", accountId);
}

/** A spot joining an account: anything the spot doesn't have yet comes from the account's bio. */
export async function bioFromAccount(accountId: string, tid: string, playerId: string) {
  const bio = await accountBio(accountId);
  if (!bio || !hasBio(bio)) return;
  const db = adminClient();
  const [{ data: p }, { data: t }] = await Promise.all([
    db.from("players").select(BIO_FIELDS.join(",")).eq("id", playerId).eq("tournament_id", tid).maybeSingle(),
    db.from("tournaments").select("slug").eq("id", tid).maybeSingle(),
  ]);
  if (!p || !t) return;
  const patch: Bio = {};
  for (const f of BIO_FIELDS) {
    if ((p as Bio)[f] || !bio[f]) continue;
    if (f === "photo_path") {
      const own = bio.photo_path!.split("/")[1] === t.slug;
      const path = own ? bio.photo_path! : await copyPhoto(bio.photo_path!, t.slug);
      if (path) patch.photo_path = path;
    } else patch[f] = bio[f];
  }
  if (Object.keys(patch).length) await db.from("players").update(patch).eq("id", playerId).eq("tournament_id", tid);
}
