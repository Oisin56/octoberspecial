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

/** Links to a private tournament's files, handed over by the server with its state (they expire after an hour). */
const signed = new Map<string, string>();
export function rememberSigned(map: Record<string, string> | null | undefined) {
  for (const [k, v] of Object.entries(map ?? {})) signed.set(k, v);
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const s = signed.get(path);
  if (s) return s;
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
