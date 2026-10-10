import { createClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Setup check: which settings are present (yes/no only, never values) and whether
 * the database answers. Safe to share: it shows no keys, PINs or personal data.
 */
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    SESSION_SECRET: (process.env.SESSION_SECRET ?? "").length >= 32 ? true : process.env.SESSION_SECRET ? "too short (32+ characters)" : false,
    ORGANISER_PIN: !!process.env.ORGANISER_PIN,
    CONTRIBUTOR_PIN: !!process.env.CONTRIBUTOR_PIN,
    GOLFCOURSEAPI_KEY: !!process.env.GOLFCOURSEAPI_KEY,
    SHOTSTACK_API_KEY: !!process.env.SHOTSTACK_API_KEY,
    ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    SMTP_USER: !!process.env.SMTP_USER,
    SMTP_PASS: !!process.env.SMTP_PASS,
    SITE_URL: process.env.SITE_URL || false,
    SHOTSTACK_ENV: process.env.SHOTSTACK_ENV || "stage (default)",
  };
  const db: Record<string, unknown> = {};
  try {
    const a = adminClient();
    const t = await a.from("tournaments").select("slug,published");
    db.server_tournaments = t.error ? `ERROR: ${t.error.message}` : t.data.map((x) => `${x.slug}${x.published ? "" : " (unpublished)"}`);
    const r = await a.from("rounds").select("id", { count: "exact", head: true });
    db.server_rounds = r.error ? `ERROR: ${r.error.message}` : r.count;
    const p = await a.from("players").select("id", { count: "exact", head: true });
    db.server_players = p.error ? `ERROR: ${p.error.message}` : p.count;
    const g = await a.from("rounds").select("id").not("course_guide", "is", null).limit(1);
    db.course_guides = g.error ? `ERROR: ${g.error.message} (run the latest schema.sql)` : g.data.length > 0;
    const sub = await a.from("subscribers").select("id", { count: "exact", head: true });
    db.subscribers = sub.error ? `ERROR: ${sub.error.message} (run the latest schema.sql)` : sub.count;
    const b = await a.storage.getBucket("media");
    db.media_bucket = b.error ? `ERROR: ${b.error.message}` : "ok";
  } catch (e) {
    db.server = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const v = await pub.from("public_tournaments").select("slug");
    db.public_read = v.error ? `ERROR: ${v.error.message}` : `${v.data.length} tournament(s) visible`;
    const r = await pub.from("rounds").select("id", { count: "exact", head: true });
    db.public_rounds = r.error ? `ERROR: ${r.error.message}` : r.count;
  } catch (e) {
    db.public = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
  return Response.json({ env, db }, { headers: { "cache-control": "no-store" } });
}
