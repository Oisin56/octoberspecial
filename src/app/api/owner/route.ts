import { adminClient } from "@/lib/admin";
import { checkOwnerPin, isOwner, setOwner, setSession } from "@/lib/auth";
import { organiserSession } from "@/lib/accounts";
import { bad, json } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";

export const maxDuration = 60;

/** Every table that belongs to a tournament (all deleted with it). */
const TABLES = [
  "players",
  "rounds",
  "posts",
  "shots",
  "comments",
  "fans",
  "likes",
  "reports",
  "ai_pieces",
  "votes",
  "score_changes",
  "reels",
  "subscribers",
] as const;
/** Kept by round rather than by tournament. */
const ROUND_TABLES = ["hole_entries", "attestations", "cards", "card_signatures"] as const;
const FOLDERS = ["photo", "video", "audio", "image"];

/** Site owner: am I the owner, and (if so) every tournament on the site. */
export async function GET() {
  if (!(await isOwner())) return json({ owner: false });
  const db = adminClient();
  const { data: ts } = await db.from("tournaments").select("id,slug,name,start_date,end_date,published,created_at").order("created_at", { ascending: false });
  const ids = (ts ?? []).map((t) => t.id);
  const count = async (table: string) => {
    const { data } = ids.length ? await db.from(table).select("tournament_id").in("tournament_id", ids) : { data: [] };
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { tournament_id: string }[]) out[r.tournament_id] = (out[r.tournament_id] ?? 0) + 1;
    return out;
  };
  const [players, rounds, posts] = await Promise.all([count("players"), count("rounds"), count("posts")]);
  return json({
    owner: true,
    tournaments: (ts ?? []).map((t) => ({ ...t, players: players[t.id] ?? 0, rounds: rounds[t.id] ?? 0, posts: posts[t.id] ?? 0 })),
  });
}

/**
 *   signin  {pin}            the site owner's PIN
 *   open    {id}             run any tournament as its organiser
 *   export  {id}             everything in a tournament, as one file to keep
 *   delete  {id, name}       the tournament and everything in it, files too (the name typed to confirm)
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "signin") {
    if (tooFast(`owner:${clientIp(req)}`, 8, 600e3)) return bad("Too many tries. Wait a few minutes.", 429);
    if (!checkOwnerPin(String(b.pin ?? ""))) return bad("That isn't the site owner PIN", 401);
    await setOwner();
    return json({ ok: true });
  }
  if (!(await isOwner())) return bad("Site owner only", 401);
  const { data: t } = await db.from("tournaments").select("*").eq("id", String(b.id ?? "")).maybeSingle();
  if (!t) return bad("Tournament not found", 404);

  if (b.action === "open") {
    await setSession(t.id, await organiserSession(t.id));
    return json({ slug: t.slug });
  }

  if (b.action === "export") {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), tournament: { ...t, organiser_pin_hash: undefined, contributor_pin_hash: undefined } };
    for (const table of TABLES) {
      const { data } = await db.from(table).select("*").eq("tournament_id", t.id);
      out[table] = (data ?? []).map((r: Record<string, unknown>) => (table === "players" ? { ...r, pin_hash: undefined, link_code: undefined } : r));
    }
    const roundIds = ((out.rounds as { id: string }[]) ?? []).map((r) => r.id);
    for (const table of ROUND_TABLES) {
      const { data } = roundIds.length ? await db.from(table).select("*").in("round_id", roundIds) : { data: [] };
      out[table] = data ?? [];
    }
    return json(out);
  }

  if (b.action === "delete") {
    if (String(b.name ?? "").trim().toLowerCase() !== String(t.name).trim().toLowerCase()) return bad("Type the tournament's name exactly to confirm");
    // Files first (photos, clips, films, music), then the tournament: everything else goes with it
    let files = 0;
    for (const folder of FOLDERS) {
      const prefix = `${folder}/${t.slug}`;
      for (let round = 0; round < 50; round++) {
        const { data: list } = await db.storage.from("media").list(prefix, { limit: 1000 });
        const names = (list ?? []).filter((f) => f.name && f.id !== null).map((f) => `${prefix}/${f.name}`);
        if (!names.length) break;
        const { error } = await db.storage.from("media").remove(names);
        if (error) break;
        files += names.length;
      }
    }
    const { error } = await db.from("tournaments").delete().eq("id", t.id);
    if (error) return bad(error.message, 500);
    return json({ ok: true, files });
  }
  return bad("Unknown action");
}
