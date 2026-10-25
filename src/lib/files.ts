import "server-only";
import { adminClient } from "./admin";
import { forgetSigned, mediaUrl, rememberSigned } from "./supabase";

/**
 * Photos, clips and films. A Friends and family tournament's files sit in the public store ("media"); a private
 * tournament's sit in a locked store ("media-private"), opened only by links that expire. A file's tournament is the
 * second part of its path: photo/<slug>/…, video/<slug>/…, audio/<slug>/…, image/<slug>/….
 */
export const PRIVATE_BUCKET = "media-private";
export const FOLDERS = ["photo", "video", "audio", "image", "transcripts"] as const;
const PATH = /^(photo|video|audio|image|transcripts)\/([a-z0-9-]+)\/[^\s"']+$/i;

/** How long a link to a private file works in the app (an hour), and for a film being made or an email (longer) */
export const VIEW_SECS = 3600;
export const WORK_SECS = 24 * 3600;
export const EMAIL_SECS = 30 * 24 * 3600;

/** Folders the site keeps its own files in (music, sounds, the sample round): never a tournament's slug */
export const RESERVED_SLUGS = new Set(["site", "samples", "sfx", "t"]);

const privateSlugs = new Map<string, { at: number; v: boolean }>();

/**
 * Is this slug's tournament private? Remembered for 20 seconds, except where a file is about to be stored (fresh).
 * If the database can't say, it throws rather than guess "not private".
 */
export async function slugPrivate(slug: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  const c = privateSlugs.get(slug);
  if (!opts.fresh && c && Date.now() - c.at < 20e3) return c.v;
  const { data, error } = await adminClient().from("tournaments").select("privacy").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Couldn't check the tournament: ${error.message}`);
  const v = data?.privacy === "private";
  privateSlugs.set(slug, { at: Date.now(), v });
  return v;
}

export function forgetPrivacy(slug: string) {
  privateSlugs.delete(slug);
  for (const k of primed.keys()) if (k.startsWith(`${slug}:`)) primed.delete(k);
  for (const k of signed.keys()) if (k.split(":")[1]?.split("/")[1] === slug) signed.delete(k);
  forgetSigned(slug);
}

export const slugOf = (path: string) => path.match(PATH)?.[2] ?? null;

/** Which store a tournament's files go in (checked fresh: a file put in the wrong one would be open to anyone) */
export async function bucketFor(slug: string | null | undefined): Promise<string> {
  return slug && (await slugPrivate(slug, { fresh: true })) ? PRIVATE_BUCKET : "media";
}

const signed = new Map<string, { url: string; until: number }>();

/** Links to private files, reused while they've at least half their time left. */
export async function signedUrls(paths: string[], secs = VIEW_SECS): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const need: string[] = [];
  for (const p of new Set(paths)) {
    const c = signed.get(`${secs}:${p}`);
    if (c && c.until - Date.now() > (secs * 1000) / 2) out[p] = c.url;
    else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const batch = need.slice(i, i + 100);
    const { data } = await adminClient().storage.from(PRIVATE_BUCKET).createSignedUrls(batch, secs);
    for (const d of data ?? []) {
      if (!d.path || !d.signedUrl) continue;
      const url = d.signedUrl.startsWith("http") ? d.signedUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${d.signedUrl}`;
      out[d.path] = url;
      signed.set(`${secs}:${d.path}`, { url, until: Date.now() + secs * 1000 });
    }
  }
  if (signed.size > 20000) signed.clear();
  return out;
}

/** A file's address for the server's own use (making a film, an email): a link that expires if it's private. */
export async function fileUrl(path: string | null | undefined, secs = WORK_SECS): Promise<string | null> {
  if (!path) return null;
  const slug = slugOf(path);
  if (!slug || !(await slugPrivate(slug))) return mediaUrl(path);
  return (await signedUrls([path], secs))[path] ?? null;
}

/** Every file path in a tournament's state (and each clip's still frame), for signing in one go */
export function pathsIn(x: unknown, slug: string, out = new Set<string>()): Set<string> {
  if (typeof x === "string") {
    const m = x.match(PATH);
    if (m && m[2] === slug) {
      out.add(x);
      if (m[1] === "video" && !x.endsWith(".jpg")) out.add(`${x}.jpg`);
    }
  } else if (Array.isArray(x)) for (const v of x) pathsIn(v, slug, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) pathsIn(v, slug, out);
  return out;
}

/**
 * Move a tournament's files into the store its setting says (the locked one when it's private). Safe to run again:
 * on every save of the setting, and each day, it picks up any file that landed in the wrong store.
 */
export async function moveFiles(slug: string, toPrivate: boolean): Promise<number> {
  if (RESERVED_SLUGS.has(slug)) return 0;
  const db = adminClient();
  const from = toPrivate ? "media" : PRIVATE_BUCKET;
  const to = toPrivate ? PRIVATE_BUCKET : "media";
  let moved = 0;
  for (const folder of FOLDERS) {
    const prefix = `${folder}/${slug}`;
    for (let round = 0; round < 50; round++) {
      const { data: list } = await db.storage.from(from).list(prefix, { limit: 200 });
      const names = (list ?? []).filter((f) => f.name && f.id !== null).map((f) => `${prefix}/${f.name}`);
      if (!names.length) break;
      for (const n of names) {
        const { error } = await db.storage.from(from).copy(n, n, { destinationBucket: to });
        if (error && !/exists/i.test(error.message)) throw new Error(`Couldn't move ${n}: ${error.message}`);
      }
      await db.storage.from(from).remove(names);
      moved += names.length;
    }
  }
  forgetPrivacy(slug);
  return moved;
}

/** The store a file belongs in (the server writing a film, a voice or a transcript for a tournament). */
export async function storeFor(path: string) {
  return adminClient().storage.from(await bucketFor(slugOf(path)));
}

const primed = new Map<string, number>();

/**
 * Before the server builds a film, a broadcast clip or an email for a private tournament: links to all its files, so
 * the usual mediaUrl() gives working addresses (for a day, or a month in emails).
 */
export async function primeFiles(slug: string | null | undefined, secs = WORK_SECS) {
  if (!slug || !(await slugPrivate(slug))) return;
  const key = `${slug}:${secs}`;
  if (Date.now() - (primed.get(key) ?? 0) < 20 * 60e3) return;
  const db = adminClient();
  const paths: string[] = [];
  for (const folder of FOLDERS) {
    for (let offset = 0; offset < 5000; offset += 1000) {
      const { data } = await db.storage.from(PRIVATE_BUCKET).list(`${folder}/${slug}`, { limit: 1000, offset });
      const names = (data ?? []).filter((f) => f.name && f.id !== null).map((f) => `${folder}/${slug}/${f.name}`);
      paths.push(...names);
      if (names.length < 1000) break;
    }
  }
  rememberSigned(await signedUrls(paths, secs), secs / 2);
  primed.set(key, Date.now());
}

/**
 * Links kept in a film's plan are the plain (public-store) form, which never expires. Before they're handed to the
 * renderer or a phone, those that point at a private tournament's files become links that work for a while.
 */
export async function signStoredLinks<T>(x: T, secs = WORK_SECS, onlySlug?: string): Promise<T> {
  const prefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/`;
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith(prefix)) found.add(v.slice(prefix.length).split("?")[0]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(x);
  const priv: string[] = [];
  for (const p of found) {
    const slug = slugOf(p);
    if (slug && (!onlySlug || slug === onlySlug) && (await slugPrivate(slug))) priv.push(p);
  }
  if (!priv.length) return x;
  const map = await signedUrls(priv, secs);
  const swap = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith(prefix)) {
      const p = v.slice(prefix.length).split("?")[0];
      return map[p] ?? v;
    }
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, w]) => [k, swap(w)]));
    return v;
  };
  return swap(x) as T;
}

/** A file's plain (public-store) address, never a link that expires: for keeping in a plan. */
export function plainUrl(path: string) {
  if (path.startsWith("http") || path.startsWith("/")) return path;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

/** A route answering a private tournament's phone: links to its files in the answer work for an hour. */
export function withSignedLinks(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const asked = await req
      .clone()
      .json()
      .catch(() => ({}));
    const slug = String(asked?.t ?? new URL(req.url).searchParams.get("t") ?? "");
    const res = await handler(req);
    if (!slug) return res;
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
    const body = await res.json().catch(() => null);
    if (body === null) return res;
    const signed = await signStoredLinks(body, VIEW_SECS, slug);
    return Response.json(signed, { status: res.status, headers: { "cache-control": res.headers.get("cache-control") ?? "no-store" } });
  };
}
