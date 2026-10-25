import { canSee, context, fanStatus, json, loadServerState } from "@/lib/server-data";
import { pathsIn, signedUrls } from "@/lib/files";
import { adminClient } from "@/lib/admin";

/**
 * A private tournament, for the people let in: everything followers see, with links to its files that work for an
 * hour. Anyone else learns only that it's private, and where they stand (asking to follow, say).
 */
export async function GET(req: Request) {
  const { t, session } = await context(req, undefined, { open: true });
  if (!t) return json({ error: "Tournament not found" }, 404);
  if (!(await canSee(t, session))) {
    // Asking to follow: waiting (or still to confirm their email, which is what lets the players see it)
    let status: string = "none";
    if (session?.role === "fan" && session.fanId) {
      const st = await fanStatus(t.id, session.fanId);
      if (st === "asking" || st === "declined") {
        const { data: f } = await adminClient().from("fans").select("verified_at,email").eq("id", session.fanId).maybeSingle();
        status = f?.email && !f.verified_at ? "confirm" : "asking";
      }
    }
    return json({ private: true, status }, 403);
  }
  const state = await loadServerState(t.id, { asPublic: true });
  const media = t.privacy === "private" ? await signedUrls([...pathsIn(state, t.slug)]) : {};
  return Response.json({ state, media }, { headers: { "cache-control": "no-store" } });
}
