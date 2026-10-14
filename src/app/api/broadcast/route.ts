import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { isOrganiser } from "@/lib/auth";
import { finishRender, monthSpend, signBroadcast, sweep } from "@/lib/broadcast";
import { safeEqual } from "@/lib/auth";
import { configured } from "@/lib/director";

export const maxDuration = 60;

/**
 * Broadcast clips.
 *   ?post=…&sig=…   Shotstack calls back when a render is done: keep the video and point the post at it
 *   action "sweep"  start renders for clips that are due and collect finished ones (anyone's open page calls this)
 *   action "spend"  the organiser: what they've cost this month, the switch and the limit
 *   action "settings" the organiser: switch on/off, set the monthly limit
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const postId = url.searchParams.get("post");
  if (postId) {
    if (!safeEqual(url.searchParams.get("sig") ?? "", signBroadcast(postId))) return bad("Bad signature", 403);
    return json({ status: await finishRender(postId) });
  }

  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);

  if (b.action === "sweep") {
    const origin = siteOrigin(req);
    after(async () => {
      try {
        await sweep(t.id, origin);
      } catch (e) {
        console.error("[broadcast] sweep", e);
      }
    });
    return json({ ok: true });
  }

  if (!isOrganiser(session)) return bad("Organiser only", 403);
  if (b.action === "settings") {
    const patch: Record<string, unknown> = {};
    if (typeof b.on === "boolean") patch.broadcast_on = b.on;
    if (b.capCents != null) {
      const c = Math.round(Number(b.capCents));
      if (!(c >= 0 && c <= 100_000)) return bad("The monthly limit should be between $0 and $1,000");
      patch.broadcast_cap_cents = c;
    }
    const { error } = await adminClient().from("tournaments").update(patch).eq("id", t.id);
    if (error) return bad(/broadcast/.test(error.message) ? "Run the latest supabase/schema.sql first" : error.message, 500);
    // A higher limit: clips that were held back go again
    if (patch.broadcast_cap_cents != null || patch.broadcast_on) await adminClient().from("posts").update({ broadcast_status: null }).eq("tournament_id", t.id).eq("broadcast_status", "capped");
  }
  const { data: fresh } = await adminClient().from("tournaments").select("id,broadcast_on,broadcast_cap_cents").eq("id", t.id).single();
  return json({ ...(await monthSpend(fresh ?? t)), configured: configured().shotstack });
}
