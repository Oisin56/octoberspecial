import { adminClient } from "@/lib/admin";
import { checkOwnerPin, isOwner, setOwner, setSession } from "@/lib/auth";
import { organiserSession } from "@/lib/accounts";
import { bad, json } from "@/lib/server-data";
import { clientIp, tooFast } from "@/lib/social";
import { mediaUrl } from "@/lib/supabase";
import { brandPack, filmLimits, filmSpend, musicTracks, setSetting } from "@/lib/site";
import { BRAND_SLOTS, MAX_TRACKS, type BrandPack, type BrandSlot, type MusicTrack, type Shape } from "@/lib/film";

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
  const [brand, music, limits, spend] = await Promise.all([brandPack(), musicTracks(), filmLimits(), filmSpend()]);
  return json({
    owner: true,
    films: {
      brand: Object.fromEntries(
        Object.entries(brand).map(([slot, shapes]) => [slot, Object.fromEntries(Object.entries(shapes ?? {}).map(([shape, c]) => [shape, c ? { ...c, src: mediaUrl(c.path) } : null]))]),
      ),
      music: music.map((m) => ({ ...m, src: mediaUrl(m.path) })),
      limits,
      spend,
    },
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

  // ---- films: the brand pack, the music, the spending limits
  const removeFile = async (path?: string) => {
    if (path) await db.storage.from("media").remove([path]).catch(() => null);
  };
  if (b.action === "setBrand") {
    const slot = BRAND_SLOTS.find((x) => x.id === b.slot)?.id as BrandSlot | undefined;
    const shape = b.shape === "portrait" || b.shape === "landscape" ? (b.shape as Shape) : null;
    if (!slot || !shape) return bad("Which clip?");
    const path = b.path ? String(b.path) : null;
    if (path && !/^video\/site\/[\w-]+\.(mp4|mov|webm)$/.test(path)) return bad("Bad video");
    const sec = Math.max(0.3, Math.min(30, Number(b.sec) || 0));
    if (path && !(Number(b.sec) > 0)) return bad("That video's length couldn't be read. Try an MP4.");
    const brand: BrandPack = await brandPack();
    await removeFile(brand[slot]?.[shape]?.path);
    brand[slot] = { ...(brand[slot] ?? {}), [shape]: path ? { path, sec } : undefined };
    try {
      await setSetting("brand", JSON.parse(JSON.stringify(brand)));
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    return json({ ok: true });
  }
  if (b.action === "addTrack") {
    const path = String(b.path ?? "");
    if (!/^audio\/site\/[\w-]+\.(mp3|m4a|wav|aac|mpeg)$/.test(path)) return bad("Bad music file");
    const music = await musicTracks();
    if (music.length >= MAX_TRACKS) return bad(`Up to ${MAX_TRACKS} tracks. Remove one first.`);
    const name = String(b.name ?? "").trim().slice(0, 40);
    if (!name) return bad("Give the track a name");
    const track: MusicTrack = { id: crypto.randomUUID().slice(0, 8), name, mood: String(b.mood ?? "").trim().slice(0, 60), path, sec: Math.max(5, Math.min(1200, Number(b.sec) || 0)) };
    if (!(Number(b.sec) > 0)) return bad("That track's length couldn't be read. Try an MP3.");
    try {
      await setSetting("music", [...music, track]);
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    return json({ ok: true });
  }
  if (b.action === "removeTrack") {
    const music = await musicTracks();
    const gone = music.find((m) => m.id === b.trackId);
    await removeFile(gone?.path);
    await setSetting("music", music.filter((m) => m.id !== b.trackId));
    return json({ ok: true });
  }
  if (b.action === "setLimits") {
    const monthly = Math.round(Number(b.monthlyDollars) * 100);
    const per = Math.round(Number(b.perTournament));
    if (!(monthly >= 0 && monthly <= 100000) || !(per >= 0 && per <= 50)) return bad("Check the numbers");
    try {
      await setSetting("films", { monthlyCents: monthly, perTournament: per });
    } catch (e) {
      return bad(e instanceof Error ? e.message : "Didn't save", 500);
    }
    return json({ ok: true });
  }

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
