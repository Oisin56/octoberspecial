import { adminClient } from "@/lib/admin";
import { bad, context, json } from "@/lib/server-data";

const TAGS = new Set([
  "birdie", "eagle", "chip-in", "long putt", "3-putt", "water", "bunker", "OB", "lip-out",
  "shank", "great drive", "near miss", "banter", "weather", "rules",
]);

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (!session) return bad("Log in to post", 401);
  const kind = ["note", "photo", "video"].includes(b.kind) ? b.kind : "note";
  const body = String(b.body ?? "").trim().slice(0, 2000);
  const mediaPath = b.mediaPath ? String(b.mediaPath) : null;
  if (!body && !mediaPath) return bad("Nothing to post");
  if (mediaPath && !/^(photo|video)\/[\w-]+\/[\w-]+\.[a-z0-9]+$/.test(mediaPath)) return bad("Bad media path");

  const tags = Array.isArray(b.tags) ? b.tags.filter((x: string) => TAGS.has(x)).slice(0, 5) : [];
  let playerIds: string[] = [];
  if (Array.isArray(b.playerIds) && b.playerIds.length) {
    const { data: ps } = await adminClient().from("players").select("id").eq("tournament_id", t.id).in("id", b.playerIds.map(String).slice(0, 8));
    playerIds = (ps ?? []).map((p) => p.id);
  }
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  const hole = b.hole ? Math.max(1, Math.min(18, Number(b.hole))) : null;
  let roundId: string | null = b.roundId || null;
  if (roundId) {
    const { data } = await adminClient().from("rounds").select("id").eq("id", roundId).eq("tournament_id", t.id).maybeSingle();
    if (!data) roundId = null;
  }

  const { data, error } = await adminClient()
    .from("posts")
    .insert({
      tournament_id: t.id,
      round_id: roundId,
      hole,
      author_name: session.name,
      author_player_id: session.playerId ?? null,
      kind,
      body: body || null,
      tags,
      media_path: mediaPath,
      visibility: b.visibility === "report" ? "report" : "public",
      player_ids: playerIds,
      clip_start: num(b.clipStart),
      clip_end: num(b.clipEnd),
    })
    .select()
    .single();
  if (error) return bad(error.message, 500);
  return json({ post: data });
}
