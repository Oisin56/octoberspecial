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

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${url}/storage/v1/object/public/media/${path}`;
}
