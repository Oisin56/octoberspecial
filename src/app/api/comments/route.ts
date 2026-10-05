import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";

// Light spam guard: per-instance memory of recent posts by IP.
const recent = new Map<string, number>();

/** Followers comment without logging in. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  const name = String(b.name ?? "").trim().slice(0, 40);
  const body = String(b.body ?? "").trim().slice(0, 500);
  if (!name || !body) return bad("Add your name and a comment");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const last = recent.get(ip) ?? 0;
  if (Date.now() - last < 5000) return bad("One comment every few seconds, please", 429);
  recent.set(ip, Date.now());

  let roundId: string | null = b.roundId || null;
  if (roundId) {
    const { data } = await adminClient().from("rounds").select("id").eq("id", roundId).eq("tournament_id", t.id).maybeSingle();
    if (!data) roundId = null;
  }
  const { error } = await adminClient().from("comments").insert({ tournament_id: t.id, round_id: roundId, author_name: name, body });
  if (error) return bad(error.message, 500);
  return json({ ok: true });
}
