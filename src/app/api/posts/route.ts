import { adminClient } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { bad, json, getTournamentId } from "@/lib/server-data";

const TAGS = new Set([
  "birdie", "eagle", "chip-in", "long putt", "3-putt", "water", "bunker", "OB", "lip-out",
  "shank", "great drive", "near miss", "banter", "weather", "rules",
]);

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return bad("Log in to post", 401);
  const b = await req.json().catch(() => ({}));
  const kind = ["note", "photo", "video"].includes(b.kind) ? b.kind : "note";
  const body = String(b.body ?? "").trim().slice(0, 2000);
  const mediaPath = b.mediaPath ? String(b.mediaPath) : null;
  if (!body && !mediaPath) return bad("Nothing to post");
  if (mediaPath && !/^(photo|video)\/[\w\-/.]+$/.test(mediaPath)) return bad("Bad media path");

  const tags = Array.isArray(b.tags) ? b.tags.filter((t: string) => TAGS.has(t)).slice(0, 5) : [];
  const hole = b.hole ? Math.max(1, Math.min(18, Number(b.hole))) : null;

  const { data, error } = await adminClient()
    .from("posts")
    .insert({
      tournament_id: await getTournamentId(),
      round_id: b.roundId || null,
      hole,
      author_name: s.name,
      author_player_id: s.playerId ?? null,
      kind,
      body: body || null,
      tags,
      media_path: mediaPath,
      visibility: b.visibility === "report" ? "report" : "public",
    })
    .select()
    .single();
  if (error) return bad(error.message, 500);
  return json({ post: data });
}
