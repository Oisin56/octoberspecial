import { adminClient } from "@/lib/admin";
import { bad, json, getTournamentId } from "@/lib/server-data";

// Very light spam guard: per-instance memory of recent posts by IP.
const recent = new Map<string, number>();

/** Followers comment without logging in. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 40);
  const body = String(b.body ?? "").trim().slice(0, 500);
  if (!name || !body) return bad("Name and comment please");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const last = recent.get(ip) ?? 0;
  if (Date.now() - last < 5000) return bad("Easy — one comment every few seconds", 429);
  recent.set(ip, Date.now());

  const { error } = await adminClient().from("comments").insert({
    tournament_id: await getTournamentId(),
    round_id: b.roundId || null,
    author_name: name,
    body,
  });
  if (error) return bad(error.message, 500);
  return json({ ok: true });
}
