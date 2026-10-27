import { adminClient } from "@/lib/admin";
import { after } from "next/server";
import { bad, context, json, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { sweep } from "@/lib/broadcast";
import { isCrew, isOrganiser } from "@/lib/auth";
import { fanAllowed, tooFast } from "@/lib/social";
import { FEED_CLOSED, feedOpen } from "@/lib/types";
import { removeStored } from "@/lib/films";

export const maxDuration = 60;

const TAGS = new Set([
  "birdie", "eagle", "chip-in", "long putt", "3-putt", "water", "bunker", "OB", "lip-out",
  "shank", "great drive", "near miss", "banter", "weather", "rules", "lost ball", "great recovery", "gimme",
]);
const DETAIL = /^[\w '&-]{1,30}$/;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!session) return bad("Log in to post", 401);

  // Delete your own post (the organiser can delete any)
  if (b.action === "delete") {
    const id = String(b.id ?? "");
    const { data: p } = await adminClient().from("posts").select("id,fan_id,author_player_id,author_name,media_path,broadcast_path").eq("id", id).eq("tournament_id", t.id).maybeSingle();
    if (!p) return json({ ok: true });
    const mine =
      (session.fanId && p.fan_id === session.fanId) ||
      (!session.fanId && !p.fan_id && (session.playerId ? p.author_player_id === session.playerId : p.author_name === session.name)) ||
      isOrganiser(session);
    if (!mine) return bad("You can only delete your own posts", 403);
    await adminClient().from("posts").delete().eq("id", id);
    // The photo or clip goes too (a film keeps what it was made with; the film itself is looked after on its own page)
    if (p.author_name !== "AI director") {
      await removeStored(p.media_path);
      await removeStored(p.broadcast_path);
    }
    return json({ ok: true });
  }

  // Finished more than 30 days ago (or the organiser closed it): the feed is read-only
  if (!feedOpen(t)) return bad(FEED_CLOSED, 403);

  // Fans post photos (with a caption if they like) to the public feed: no clips, no notes on the play
  if (session.fanId) {
    if (t.feed_on === false) return bad("The feed is switched off for this tournament", 403);
    const text = String(b.body ?? "").trim().slice(0, 500);
    const photo = b.mediaPath ? String(b.mediaPath) : "";
    if (!(await fanAllowed(t.id, session.fanId))) return bad("You can't post here any more", 403);
    if (!photo) return bad("Add a photo to post. You can comment on anything in the feed.");
    if (!/^photo\/[\w-]+\/[\w-]+\.[a-z0-9]+$/.test(photo)) return bad("Photos only");
    if (tooFast(`fanpost:${session.fanId}`, 3, 60e3)) return bad("Give it a minute before posting again", 429);
    const { data, error } = await adminClient()
      .from("posts")
      .insert({ tournament_id: t.id, author_name: session.name, fan_id: session.fanId, kind: "photo", media_path: photo, body: text || null, visibility: "public" })
      .select()
      .single();
    if (error) return bad(/fan_id/.test(error.message) ? "Posting needs the latest database update" : error.message, 500);
    return json({ post: data });
  }
  // Clips, notes and course photos: players and the organiser
  if (!isCrew(session)) return bad("Log in as a player to post here", 403);
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

  const trimIn = num(b.trimIn);
  const trimOut = num(b.trimOut);
  const d = (b.details ?? {}) as Record<string, unknown>;
  const details: Record<string, string> = Object.fromEntries(
    (["shot", "result", "club"] as const).filter((k) => typeof d[k] === "string" && DETAIL.test(String(d[k]))).map((k) => [k, String(d[k])]),
  );
  // the logged shot this clip shows
  if (typeof d.shotId === "string" && /^[\w-]{8,64}$/.test(d.shotId)) details.shotId = d.shotId;
  // the recording's shape and length (for the broadcast version)
  if (d.shape === "portrait" || d.shape === "landscape") details.shape = d.shape;
  if (d.dur != null && Number(d.dur) > 0 && Number(d.dur) < 600) details.dur = String(Math.round(Number(d.dur) * 10) / 10);
  // not a shot: an interview, a prediction, scene-setting (and when it was filmed)
  if (d.clipType === "interview" || d.clipType === "prediction" || d.clipType === "scene" || d.clipType === "other") details.clipType = d.clipType;
  if (d.when === "pre" || d.when === "post") details.when = d.when;
  const row = {
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
  };
  const extra = {
    trim_in: trimIn,
    trim_out: trimOut != null && trimIn != null && trimOut <= trimIn ? null : trimOut,
    details: Object.keys(details).length ? details : null,
  };
  let { data, error } = await adminClient().from("posts").insert({ ...row, ...extra }).select().single();
  // Database not updated yet (schema.sql not re-run): keep the post, lose only the trim and details
  if (error && /trim_in|trim_out|details/.test(error.message)) {
    console.error("[posts] run the latest supabase/schema.sql to keep clip trims and details:", error.message);
    ({ data, error } = await adminClient().from("posts").insert(row).select().single());
  }
  if (error) return bad(error.message, 500);
  // A clip: its broadcast version is made once the hole is finished (or in a minute, with no hole)
  if (kind === "video") {
    const origin = siteOrigin(req);
    after(async () => {
      try {
        await sweep(t.id, origin, true);
      } catch (e) {
        console.error("[broadcast] sweep after post", e);
      }
    });
  }
  return json({ post: data });
}
