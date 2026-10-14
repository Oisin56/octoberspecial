import "server-only";
import { createHmac } from "node:crypto";
import { adminClient } from "./admin";
import { loadServerState } from "./server-data";
import { mediaUrl } from "./supabase";
import { buildTimeline, clipBugs, fitCommentary, publishReel, shotstackRender, shotstackStatus, whooshSound, writePlan, configured } from "./director";
import { LINE_PARTS, lineRecorded, lineSeconds, lineText, planSeconds, recordingOf, type Plan, type ReelRow } from "./director-types";
import { COST, estimateCents, type Shape } from "./film";
import { brandPack, filmLimits, filmSpend, musicTracks, tournamentFilms } from "./site";
import { filmReadyEmail, mailConfigured, sendOne } from "./email";
import type { TournamentRow } from "./types";

/**
 * Making the film on the server, a step at a time, so the organiser can put the phone away:
 *   plan → voices (in batches) → render → rendering (the renderer calls back, or the page asks) → done.
 * Each step runs in its own request and starts the next. A step that stalls (a request that died) is picked up
 * again by the next status check.
 */
export type Stage = "plan" | "voices" | "render" | "rendering" | "done";
export type FilmReel = ReelRow & { stage?: Stage | null; stage_at?: string | null; cost_cents?: number; done_at?: string | null; renders?: number };

/** A step taking longer than a request can run has died: start it again. */
const STALE_MS = 5.5 * 60e3;

const secret = () => process.env.FILM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "mgs-film";
export const filmKey = (reelId: string) => createHmac("sha256", secret()).update(`film:${reelId}`).digest("hex").slice(0, 40);

/** Start the next step in a fresh request (it answers straight away and carries on by itself). */
export async function kick(origin: string, reelId: string) {
  try {
    await fetch(`${origin}/api/film/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reelId, k: filmKey(reelId), origin }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // the status check picks it up
  }
}

export const isStale = (r: FilmReel) => !!r.stage && r.stage !== "done" && r.stage !== "rendering" && r.status === "planning" && (!r.stage_at || Date.now() - Date.parse(r.stage_at) > STALE_MS);

async function tournamentOf(id: string): Promise<TournamentRow | null> {
  const { data } = await adminClient().from("tournaments").select("*").eq("id", id).maybeSingle();
  return (data as TournamentRow) ?? null;
}

/** The finished film's edit for the renderer: commentary, music, the brand pack, the score panels. */
export async function filmEdit(t: TournamentRow, plan: Plan, origin: string) {
  const narration: Record<string, { src: string; sec: number }> = {};
  let lines = 0;
  for (const s of plan.voiceOn ? plan.segments : []) {
    for (const part of LINE_PARTS) {
      if (!lineText(s, part) && !s.own?.[part]) continue;
      lines++;
      if (lineRecorded(plan, s, part)) narration[`${s.id}:${part}`] = { src: recordingOf(s, part).src!, sec: lineSeconds(s, part) };
    }
  }
  const missing = lines - Object.keys(narration).length;
  // Music: the site's tracks (the chosen one first), or an older film's own track
  let tracks: { src: string; sec: number }[] | undefined;
  let music: string | null = null;
  let composed = false;
  const pm = plan.music;
  if (pm?.source === "track" && pm.trackId) {
    const all = await musicTracks();
    const chosen = all.find((x) => x.id === pm.trackId);
    if (chosen) tracks = [chosen, ...all.filter((x) => x.id !== chosen.id)].map((x) => ({ src: mediaUrl(x.path)!, sec: x.sec }));
  } else if (pm?.source === "made" && pm.src) {
    music = pm.src;
    composed = true;
  } else if (pm?.source === "upload") music = mediaUrl(t.reel_music_path ?? null);
  // The brand pack, in this film's shape
  const shape: Shape = plan.aspect === "9:16" ? "portrait" : "landscape";
  const bp = await brandPack();
  const slot = (k: "intro" | "outro" | "transition") => {
    const c = bp[k]?.[shape];
    return c?.path && c.sec > 0 ? { src: mediaUrl(c.path)!, sec: c.sec } : undefined;
  };
  const state = await loadServerState(t.id);
  const posters: Record<string, string> = {};
  await Promise.all(
    plan.segments
      .filter((s) => s.kind === "clip")
      .map(async (c) => {
        const url = `${(c as { src: string }).src}.jpg`;
        const r = await fetch(url, { method: "HEAD" }).catch(() => null);
        if (r?.ok && (r.headers.get("content-type") ?? "").startsWith("image")) posters[c.id] = url;
      }),
  );
  const brand = { intro: slot("intro"), outro: slot("outro"), transition: slot("transition") };
  const edit = buildTimeline(plan, {
    origin,
    theme: t.theme,
    colors: t.custom_colors,
    music,
    musicComposed: composed,
    tracks,
    brand,
    narration,
    bugs: clipBugs(state, plan),
    posters,
    names: Object.fromEntries(state.players.map((pl) => [pl.id, pl.name])),
    eventName: t.name,
    whoosh: configured().voice ? await whooshSound() : null,
  });
  const seconds = planSeconds(plan) + (brand.intro?.sec ?? 0) + (brand.outro?.sec ?? 0);
  const warning = missing > 0 && plan.voiceOn ? `${missing} commentary line${missing > 1 ? "s" : ""} didn't record, so ${missing > 1 ? "they're" : "it's"} left out.` : null;
  return { edit, seconds, warning };
}

async function fail(id: string, message: string) {
  await adminClient().from("reels").update({ status: "failed", error: message, stage_at: null, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Take the step if nobody else is on it. */
async function claim(r: FilmReel): Promise<boolean> {
  if (r.stage_at && Date.now() - Date.parse(r.stage_at) < STALE_MS) return false;
  let q = adminClient().from("reels").update({ stage_at: new Date().toISOString() }).eq("id", r.id).eq("stage", r.stage!);
  q = r.stage_at ? q.eq("stage_at", r.stage_at) : q.is("stage_at", null);
  const { data } = await q.select("id").maybeSingle();
  return !!data;
}

/** Run the reel's current step; returns true when another step should follow straight away. */
export async function runStage(reelId: string, origin: string): Promise<boolean> {
  const db = adminClient();
  const { data } = await db.from("reels").select("*").eq("id", reelId).maybeSingle();
  const reel = data as FilmReel | null;
  if (!reel || !reel.stage || reel.stage === "done" || reel.status === "failed" || reel.status === "draft" || reel.status === "done") return false;
  if (reel.stage === "rendering") {
    await finishFilm(reel, origin);
    return false;
  }
  if (!(await claim(reel))) return false;
  const t = await tournamentOf(reel.tournament_id);
  if (!t) return false;
  const save = (patch: Record<string, unknown>) => db.from("reels").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", reel.id);
  try {
    if (reel.stage === "plan") {
      const plan = await writePlan(t.id, reel.brief);
      await save({ plan, stage: plan.voiceOn && configured().voice ? "voices" : "render", stage_at: null, cost_cents: COST.plan });
      return true;
    }
    if (reel.stage === "voices") {
      const plan = reel.plan!;
      const r = await fitCommentary(t.slug, plan, 200_000);
      const cost = Number(reel.cost_cents ?? 0) + estimateCents(0, r.chars, false);
      await save({ plan, cost_cents: cost, stage: r.remaining > 0 ? "voices" : "render", stage_at: null });
      return true;
    }
    if (reel.stage === "render") {
      if (!configured().shotstack) {
        await fail(reel.id, "The film can't be put together: the video service isn't set up (SHOTSTACK_API_KEY).");
        return false;
      }
      const plan = reel.plan!;
      const { edit, seconds, warning } = await filmEdit(t, plan, origin);
      const est = estimateCents(seconds, 0, false);
      const [lim, spend, made] = await Promise.all([filmLimits(), filmSpend(), tournamentFilms(t.id)]);
      if (spend.cents + est > lim.monthlyCents) {
        await fail(reel.id, "This month's film budget for the site is used up. The site owner can raise it, or it resets on the 1st.");
        return false;
      }
      if (made.made >= lim.perTournament) {
        await fail(reel.id, `This tournament has made all ${lim.perTournament} of its films. The site owner can allow more.`);
        return false;
      }
      edit.callback = `${origin}/api/film/callback?reel=${reel.id}&k=${filmKey(reel.id)}`;
      const id = await shotstackRender(edit);
      await save({ status: "rendering", render_id: id, stage: "rendering", stage_at: null, error: warning, cost_cents: Number(reel.cost_cents ?? 0) + est });
      return false;
    }
  } catch (e) {
    await fail(reel.id, e instanceof Error ? e.message : "Something went wrong making the film");
  }
  return false;
}

/** The renderer has finished (it called back, or the page asked): save the film, post it, tell the organiser. */
export async function finishFilm(reel: FilmReel, origin: string): Promise<FilmReel> {
  const db = adminClient();
  if (reel.status !== "rendering" || !reel.render_id) return reel;
  const st = await shotstackStatus(reel.render_id).catch(() => ({ status: "rendering" }) as { status: string; url?: string; poster?: string; error?: string });
  if (st.status === "failed") {
    const { data } = await db.from("reels").update({ status: "failed", stage: "render", error: st.error ?? "The video service couldn't put the film together" }).eq("id", reel.id).select().single();
    return data as FilmReel;
  }
  if (st.status !== "done" || !st.url) return reel;
  // Claim it: whichever request clears render_id first does the saving and posting
  const { data: claimed } = await db.from("reels").update({ render_id: null }).eq("id", reel.id).eq("render_id", reel.render_id).select().maybeSingle();
  if (!claimed) return { ...reel, render_id: null };
  const t = await tournamentOf(reel.tournament_id);
  if (!t) return reel;
  let pub;
  try {
    pub = await publishReel(t.id, t.slug, reel.id, st.url, reel.plan?.title ?? "Highlights", reel.round_id, st.poster);
  } catch (e) {
    const { data } = await db.from("reels").update({ status: "failed", error: `Made, but saving failed: ${e instanceof Error ? e.message : e}. Film: ${st.url}` }).eq("id", reel.id).select().single();
    return data as FilmReel;
  }
  // A film made again replaces the last one in Highlights
  if (reel.post_id && reel.post_id !== pub.postId) await db.from("posts").delete().eq("id", reel.post_id).eq("tournament_id", t.id);
  const now = new Date().toISOString();
  const { data } = await db
    .from("reels")
    .update({ status: "done", stage: "done", stage_at: null, video_path: pub.mediaPath, post_id: pub.postId, done_at: now, renders: Number(reel.renders ?? 0) + 1, updated_at: now })
    .eq("id", reel.id)
    .select()
    .single();
  // Tell the organiser (everyone signed in with email to this tournament)
  if (reel.stage && mailConfigured()) {
    const { data: links } = await db.from("account_tournaments").select("account_id").eq("tournament_id", t.id);
    const ids = (links ?? []).map((l) => l.account_id);
    if (ids.length) {
      const { data: accts } = await db.from("accounts").select("email").in("id", ids);
      const msg = filmReadyEmail(t, `${origin}/t/${t.slug}/film?reel=${reel.id}`);
      for (const a of accts ?? []) await sendOne(t, a.email, msg).catch(() => null);
    }
  }
  return data as FilmReel;
}
