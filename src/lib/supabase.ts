import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browserClient: SupabaseClient | null = null;

/** Read-only public client (browser + server). Safe to expose. */
export function publicClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    browserClient ??= createClient(url, anon, { auth: { persistSession: false } });
    return browserClient;
  }
  return createClient(url, anon, { auth: { persistSession: false } });
}

/**
 * Links to a private tournament's files, handed over by the server with its state (they expire after an hour), or made
 * by the server itself before a film or an email. Each is used only while it has at least 10 minutes left.
 */
const signed = new Map<string, { url: string; until: number }>();
export function rememberSigned(map: Record<string, string> | null | undefined, secs = 3600) {
  const until = Date.now() + secs * 1000;
  for (const [k, v] of Object.entries(map ?? {})) signed.set(k, { url: v, until });
  if (signed.size > 20000) signed.clear();
}

/** Forget the links to one tournament's files (its files have moved store). */
export function forgetSigned(slug: string) {
  for (const k of signed.keys()) if (k.split("/")[1] === slug) signed.delete(k);
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const s = signed.get(path);
  if (s && s.until - Date.now() > 10 * 60e3) return s.url;
  if (path.startsWith("http")) return path;
  if (path.startsWith("/")) return path; // the site's own files (the sample round's clip)
  return `${url}/storage/v1/object/public/media/${path}`;
}


/** A posted clip's address, played from/to its trim points where it was trimmed on the phone. */
export function clipUrl(post: { media_path: string | null; trim_in?: number | null; trim_out?: number | null }) {
  const u = mediaUrl(post.media_path);
  if (!u || (post.trim_in == null && post.trim_out == null)) return u;
  return `${u}#t=${post.trim_in ?? 0}${post.trim_out != null ? `,${post.trim_out}` : ""}`;
}
