import { adminClient } from "@/lib/admin";
import { isOrganiser } from "@/lib/auth";
import { bad, context, json } from "@/lib/server-data";
import { mediaUrl } from "@/lib/supabase";
import { loadServerState } from "@/lib/server-data";
import { cardUrl } from "@/lib/cards";
import {
  buildTimeline,
  clipBugs,
  composeMusic,
  configured,
  listVoices,
  publishReel,
  fitCommentary,
  sanitisePlan,
  shotstackRender,
  shotstackStatus,
  veoPoll,
  whooshSound,
  veoStart,
  writePlan,
} from "@/lib/director";
import { COMMENTARY, LINE_PARTS, lineSeconds, lineText, recordingOf, musicFits, planSeconds, voiceKey, type Brief, type ClipProbe, type Plan, type ReelRow } from "@/lib/director-types";

/** Clip shapes, lengths and stills sent by the browser: checked and capped. */
function cleanProbes(raw: unknown): ClipProbe[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((p) => {
    if (!p || typeof p !== "object" || typeof p.id !== "string") return [];
    const w = Number(p.w), h = Number(p.h);
    const frames = Array.isArray(p.frames) ? p.frames.filter((f: unknown) => typeof f === "string" && f.length < 200_000 && /^[A-Za-z0-9+/=]+$/.test(f)).slice(0, 3) : [];
    return [{ id: p.id, w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0, duration: Number.isFinite(Number(p.duration)) ? Number(p.duration) : null, frames }];
  });
}

export const maxDuration = 300;

/** Copy the commentary (words, recordings, lengths) from one copy of a plan to the latest saved one. */
function copyCommentary(from: Plan, to: Plan) {
  const keys = ["voice", "voiceSrc", "voiceFor", "voiceSec", "voiceAuto", "payoff", "payoffSrc", "payoffFor", "payoffSec", "payoffAuto", "replayVoice", "replaySrc", "replayFor", "replaySec", "replayAuto"] as const;
  for (const s of to.segments) {
    const f = from.segments.find((x) => x.id === s.id);
    if (!f) continue;
    for (const k of keys) {
      const v = (f as unknown as Record<string, unknown>)[k];
      if (v === undefined) delete (s as unknown as Record<string, unknown>)[k];
      else (s as unknown as Record<string, unknown>)[k] = v;
    }
  }
}

/** Which clips have a still saved next to them (made when the clip was posted, or by the director page). */
async function clipPosters(plan: Plan): Promise<Record<string, string>> {
  const clips = plan.segments.filter((s) => s.kind === "clip");
  const found = await Promise.all(
    clips.map(async (c) => {
      const url = `${c.src}.jpg`;
      const r = await fetch(url, { method: "HEAD" }).catch(() => null);
      return r?.ok && (r.headers.get("content-type") ?? "").startsWith("image") ? ([c.id, url] as const) : null;
    }),
  );
  return Object.fromEntries(found.filter((x): x is readonly [string, string] => !!x));
}

function origin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (!isOrganiser(session)) return bad("Organiser only", 403);
  const db = adminClient();
  const cfg = configured();

  const getReel = async (id: string) => {
    const { data } = await db.from("reels").select("*").eq("id", id).eq("tournament_id", t.id).maybeSingle();
    return data as ReelRow | null;
  };
  const savePlan = async (id: string, plan: Plan, extra: Record<string, unknown> = {}) => {
    await db.from("reels").update({ plan, updated_at: new Date().toISOString(), ...extra }).eq("id", id);
  };
  /** Change one part of the latest saved plan (slow steps like composing or Veo must not overwrite each other). */
  const patchPlan = async (id: string, change: (p: Plan) => void) => {
    const fresh = await getReel(id);
    if (!fresh?.plan) return null;
    change(fresh.plan);
    await savePlan(id, fresh.plan);
    return fresh.plan;
  };
  /** Check one generating Veo shot with Google and record the result on the latest plan. */
  const pollShot = async (reelId: string, segId: string, op: string) => {
    let r: Awaited<ReturnType<typeof veoPoll>>;
    try {
      r = await veoPoll(t.slug, op);
    } catch (e) {
      r = { done: true, error: e instanceof Error ? e.message : "Veo failed" };
    }
    if (!r.done) return null;
    const plan = await patchPlan(reelId, (p) => {
      const s = p.segments.find((x) => x.id === segId);
      if (s && s.kind === "veo" && s.status === "pending") {
        s.status = r.src ? "done" : "failed";
        s.src = r.src;
        s.error = r.error;
        s.refetch = !!r.refetch;
      }
    });
    return plan?.segments.find((x) => x.id === segId) ?? null;
  };

  /** Check a rendering film with the renderer; when it's done, save it and post it to Highlights. */
  const advance = async (reel: ReelRow): Promise<{ reel: ReelRow; progress?: string; copied?: boolean }> => {
    if (reel.status !== "rendering" || !reel.render_id) return { reel };
    const st = await shotstackStatus(reel.render_id).catch(() => ({ status: "rendering" }) as { status: string; url?: string; poster?: string; error?: string });
    if (st.status === "done" && st.url) {
      // Claim it: whichever request clears render_id first does the saving and posting
      const { data: claimed } = await db.from("reels").update({ render_id: null }).eq("id", reel.id).eq("render_id", reel.render_id).select().maybeSingle();
      if (!claimed) return { reel: { ...reel, render_id: null } };
      let pub;
      try {
        pub = await publishReel(t.id, t.slug, reel.id, st.url, reel.plan?.title ?? "Highlights", reel.round_id, st.poster);
      } catch (e) {
        const { data } = await db.from("reels").update({ status: "failed", error: `Rendered, but saving failed: ${e instanceof Error ? e.message : e}. Film: ${st.url}` }).eq("id", reel.id).select().single();
        return { reel: data as ReelRow };
      }
      const { data } = await db
        .from("reels")
        .update({ status: "done", video_path: pub.mediaPath, post_id: pub.postId, updated_at: new Date().toISOString() })
        .eq("id", reel.id)
        .select()
        .single();
      return { reel: data as ReelRow, copied: pub.copied };
    }
    if (st.status === "failed") {
      const { data } = await db.from("reels").update({ status: "failed", error: st.error ?? "Render failed" }).eq("id", reel.id).select().single();
      return { reel: data as ReelRow };
    }
    return { reel, progress: st.status };
  };

  switch (b.action) {
    case "list": {
      const { data } = await db.from("reels").select("*").eq("tournament_id", t.id).order("created_at", { ascending: false }).limit(20);
      // Finish any film that completed while nobody had this page open
      let reels = await Promise.all(((data ?? []) as ReelRow[]).map((r) => (r.status === "rendering" ? advance(r).then((x) => x.reel).catch(() => r) : r)));
      // ...and any AI shots that finished while nobody was watching
      const pending = reels.flatMap((r) => (r.plan?.segments ?? []).filter((s) => s.kind === "veo" && s.status === "pending" && s.op).map((s) => ({ r, s })));
      if (pending.length) {
        await Promise.all(pending.map(({ r, s }) => pollShot(r.id, s.id, (s as { op: string }).op).catch(() => null)));
        const { data: again } = await db.from("reels").select("*").eq("tournament_id", t.id).order("created_at", { ascending: false }).limit(20);
        reels = (again ?? reels) as ReelRow[];
      }
      return json({ reels, configured: cfg, music: mediaUrl(t.reel_music_path ?? null) });
    }

    case "voices": {
      if (!cfg.voice) return json({ voices: [] });
      return json({ voices: await listVoices() });
    }

    case "setMusic": {
      const path = b.path ? String(b.path) : null;
      if (path && !/^(audio|video)\/[\w-]+\/[\w-]+\.[a-z0-9]+$/.test(path)) return bad("Bad music path");
      await db.from("tournaments").update({ reel_music_path: path }).eq("id", t.id);
      return json({ ok: true });
    }

    case "plan": {
      if (!cfg.claude) return bad("ANTHROPIC_API_KEY isn't set, so the director can't write a plan", 500);
      const brief: Brief = {
        roundNumber: b.brief?.roundNumber == null || b.brief.roundNumber === "" ? null : Number(b.brief.roundNumber),
        length: [60, 180, 300].includes(Number(b.brief?.length)) ? Number(b.brief.length) as Brief["length"] : 180,
        aspect: b.brief?.aspect === "9:16" ? "9:16" : "16:9",
        voice: !!b.brief?.voice && cfg.voice,
        veo: !!b.brief?.veo && cfg.veo,
        style: COMMENTARY.some((c) => c.id === b.brief?.style) ? b.brief.style : "classic",
        amount: b.brief?.amount === "light" ? "light" : "full",
        voiceId: typeof b.brief?.voiceId === "string" && /^[\w-]{6,64}$/.test(b.brief.voiceId) ? b.brief.voiceId : undefined,
      };
      let roundId: string | null = null;
      if (brief.roundNumber != null) {
        const { data: r } = await db.from("rounds").select("id").eq("tournament_id", t.id).eq("number", brief.roundNumber).maybeSingle();
        if (!r) return bad("Round not found");
        roundId = r.id;
      }
      try {
        const plan = await writePlan(t.id, brief, cleanProbes(b.probes));
        const { data, error } = await db.from("reels").insert({ tournament_id: t.id, round_id: roundId, brief, plan, status: "draft" }).select().single();
        if (error) return bad(error.message, 500);
        return json({ reel: data });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "Couldn't write the plan", 500);
      }
    }

    case "save": {
      const reel = await getReel(String(b.reelId));
      if (!reel) return bad("Reel not found", 404);
      if (reel.status === "rendering") return bad("This reel is rendering. Wait for it to finish.", 409);
      const plan = sanitisePlan(b.plan as Plan);
      // Clips must be this tournament's own posts; take their address from the database
      const ids = plan.segments.filter((s) => s.kind === "clip").map((s) => (s as { postId: string }).postId);
      const { data: posts } = ids.length
        ? await db.from("posts").select("id,media_path").eq("tournament_id", t.id).in("id", ids)
        : { data: [] as { id: string; media_path: string | null }[] };
      const byId = new Map((posts ?? []).map((p) => [p.id, p.media_path]));
      const storagePrefix = mediaUrl("x")!.slice(0, -1);
      const prev = new Map((reel.plan?.segments ?? []).map((s) => [s.id, s]));
      plan.segments = plan.segments.filter((s) => {
        // Recorded commentary is the server's record: keep it while the line and voice are unchanged
        const was = prev.get(s.id);
        if (was?.voiceSrc && s.voice?.trim() && was.voiceFor === voiceKey(s.voice, plan.voiceId)) {
          s.voiceSrc = was.voiceSrc;
          s.voiceFor = was.voiceFor;
          s.voiceSec = was.voiceSec;
        }
        if (s.kind === "clip" && was?.kind === "clip" && was.payoffSrc && s.payoff?.trim() && was.payoffFor === voiceKey(s.payoff, plan.voiceId)) {
          s.payoffSrc = was.payoffSrc;
          s.payoffFor = was.payoffFor;
          s.payoffSec = was.payoffSec;
        }
        if (s.kind === "clip" && was?.kind === "clip" && was.replaySrc && s.replay && s.replayVoice?.trim() && was.replayFor === voiceKey(s.replayVoice, plan.voiceId)) {
          s.replaySrc = was.replaySrc;
          s.replayFor = was.replayFor;
          s.replaySec = was.replaySec;
        }
        if (s.kind === "clip") {
          const mp = byId.get(s.postId);
          if (!mp) return false;
          s.src = mediaUrl(mp)!;
        }
        if (s.kind === "veo") {
          // Generation state is the server's; keep what we recorded
          const old = prev.get(s.id);
          if (old && old.kind === "veo") {
            s.op = old.op;
            s.src = old.src;
            s.status = old.status;
            s.error = old.error;
            s.refetch = old.refetch;
          } else {
            s.op = undefined;
            s.src = undefined;
            s.status = "idle";
          }
          if (s.src && !s.src.startsWith(storagePrefix)) s.src = undefined;
        }
        return true;
      });
      // A composed track is the server's record; keep it unless the mood changed (then it's composed afresh)
      const oldMusic = reel.plan?.music;
      if (plan.music) {
        const keep = oldMusic?.src && oldMusic.mood === plan.music.mood;
        plan.music.src = keep ? oldMusic!.src : undefined;
        plan.music.seconds = keep ? oldMusic!.seconds : undefined;
      }
      await savePlan(reel.id, plan, { status: "draft", error: null });
      return json({ ok: true, plan });
    }

    case "composeMusic": {
      if (!cfg.voice) return bad("ELEVENLABS_API_KEY isn't set, so music can't be composed", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      if (reel.status === "rendering") return bad("This reel is rendering. Wait for it to finish.", 409);
      const plan = reel.plan;
      plan.music = { ...(plan.music ?? { mood: "epic" }), source: "made" };
      try {
        const m = await composeMusic(t.slug, plan.music.mood, planSeconds(plan));
        const music = { ...plan.music, src: m.src, seconds: m.seconds, error: undefined };
        await patchPlan(reel.id, (p) => (p.music = music));
        return json({ music });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "Music didn't compose", 500);
      }
    }

    case "voiceRecord": {
      // Record the commentary lines that aren't recorded yet (a batch per call; the page calls again until done)
      if (!cfg.voice) return bad("ELEVENLABS_API_KEY isn't set, so commentary can't be recorded", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      if (reel.status === "rendering") return bad("This reel is rendering. Wait for it to finish.", 409);
      const work = structuredClone(reel.plan);
      const before = JSON.stringify(work.segments.map((x) => LINE_PARTS.map((pt) => recordingOf(x, pt).key)));
      const r = await fitCommentary(t.slug, work, 150_000);
      const plan = await patchPlan(reel.id, (p) => copyCommentary(work, p));
      const recorded = JSON.stringify(work.segments.map((x) => LINE_PARTS.map((pt) => recordingOf(x, pt).key))) !== before;
      return json({ plan, recorded: recorded ? 1 : 0, remaining: r.remaining, tightened: r.tightened, errors: r.errors });
    }

    case "veoStart": {
      if (!cfg.veo) return bad("GEMINI_API_KEY isn't set, so Veo shots are off", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      const seg = reel.plan.segments.find((s) => s.id === b.segmentId);
      if (!seg || seg.kind !== "veo") return bad("Shot not found");
      let upd: Partial<typeof seg>;
      try {
        upd = { op: await veoStart(seg.prompt, reel.plan.aspect, seg.seconds), status: "pending", error: undefined, src: undefined, refetch: false };
      } catch (e) {
        upd = { status: "failed", error: e instanceof Error ? e.message : "Veo failed", refetch: false };
      }
      const plan = await patchPlan(reel.id, (p) => {
        const s = p.segments.find((x) => x.id === seg.id);
        if (s && s.kind === "veo") Object.assign(s, upd);
      });
      return json({ segment: plan?.segments.find((x) => x.id === seg.id) ?? { ...seg, ...upd } });
    }

    case "veoPoll": {
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      const seg = reel.plan.segments.find((s) => s.id === b.segmentId);
      if (!seg || seg.kind !== "veo" || !seg.op) return bad("Shot not started");
      if (seg.status !== "pending") return json({ segment: seg });
      const done = await pollShot(reel.id, seg.id, seg.op);
      return json({ segment: done ?? seg });
    }

    case "veoRefetch": {
      // Google already made (and charged for) this shot: fetch it again, no new charge
      const plan = await patchPlan(String(b.reelId), (p) => {
        const s = p.segments.find((x) => x.id === b.segmentId);
        // Any shot Google started can be fetched again (older plans don't carry the refetch flag)
        if (s && s.kind === "veo" && s.op && s.status === "failed") {
          s.status = "pending";
          s.error = undefined;
          s.refetch = false;
        }
      });
      const seg = plan?.segments.find((x) => x.id === b.segmentId);
      if (!seg || seg.kind !== "veo" || !seg.op) return bad("Shot not found");
      const done = await pollShot(String(b.reelId), seg.id, seg.op);
      return json({ segment: done ?? seg });
    }

    case "bugCards": {
      // Preview the score panels for the (possibly unsaved) plan on the review screen
      const plan = sanitisePlan(b.plan as Plan);
      const bugs = clipBugs(await loadServerState(t.id), plan);
      const portrait = plan.aspect === "9:16";
      const wholeTrip = new Set(plan.segments.filter((x) => x.kind === "clip" && x.round != null).map((x) => (x.kind === "clip" ? x.round : null))).size > 1;
      const url = (bug: (typeof bugs)[string]["before"]) =>
        cardUrl(origin(req), { k: "bug", h: "", b: bug, wt: wholeTrip, theme: t.theme, colors: t.custom_colors, w: portrait ? 1080 : 1920, ht: portrait ? 1920 : 1080 });
      return json({
        bugs: Object.fromEntries(Object.entries(bugs).map(([id, x]) => [id, { before: x.before, after: x.after, beforeUrl: url(x.before), afterUrl: x.after ? url(x.after) : null }])),
      });
    }

    case "render": {
      if (!cfg.shotstack) return bad("SHOTSTACK_API_KEY isn't set, so the film can't be rendered", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      if (reel.status === "rendering") return bad("Already rendering", 409);
      const plan = reel.plan;
      if (plan.segments.some((s) => s.kind === "veo" && s.status === "pending")) return bad("Wait for the AI shots to finish (or remove them) first");
      // Commentary: recorded and fitted (anything already recorded is reused)
      const narration: Record<string, { src: string; sec: number }> = {};
      let warning: string | null = null;
      if (plan.voiceOn && cfg.voice) {
        const r = await fitCommentary(t.slug, plan, 150_000);
        await patchPlan(reel.id, (p) => copyCommentary(plan, p));
        let lines = 0;
        for (const s of plan.segments) {
          for (const part of LINE_PARTS) {
            const text = lineText(s, part);
            if (!text) continue;
            lines++;
            const { src, key } = recordingOf(s, part);
            if (src && key === voiceKey(text, plan.voiceId)) narration[`${s.id}:${part}`] = { src, sec: lineSeconds(s, part) };
          }
        }
        const missing = lines - Object.keys(narration).length;
        if (missing > 0) {
          warning =
            missing === lines
              ? `The commentary didn't record (${r.errors[0] ?? "voice service busy"}), so this film has music and captions only.`
              : `${missing} of ${lines} commentary lines didn't record${r.errors[0] ? ` (${r.errors[0]})` : ""}; the rest are in.`;
        }
      }
      // Music: composed for this film (reused if it still fits), the uploaded track, or none
      let musicUrl: string | null = null;
      let composed = false;
      const pm = plan.music ?? { source: "upload" as const, mood: "epic" as const };
      if (pm.source === "upload") musicUrl = mediaUrl(t.reel_music_path ?? null);
      if (pm.source === "made") {
        if (musicFits(pm, planSeconds(plan))) {
          musicUrl = pm.src!;
          composed = true;
        } else if (cfg.voice) {
          try {
            const m = await composeMusic(t.slug, pm.mood, planSeconds(plan));
            plan.music = { ...pm, src: m.src, seconds: m.seconds, error: undefined };
            await patchPlan(reel.id, (p) => (p.music = plan.music));
            musicUrl = m.src;
            composed = true;
          } catch (e) {
            const why = e instanceof Error ? e.message : "music service error";
            warning = `${warning ? `${warning} ` : ""}The music didn't compose (${why}), so this film has no music.`;
          }
        }
      }
      const state = await loadServerState(t.id);
      const edit = buildTimeline(plan, {
        origin: origin(req),
        theme: t.theme,
        colors: t.custom_colors,
        music: musicUrl,
        musicComposed: composed,
        narration,
        bugs: clipBugs(state, plan),
        posters: await clipPosters(plan),
        names: Object.fromEntries(state.players.map((pl) => [pl.id, pl.name])),
        eventName: t.name,
        whoosh: cfg.voice ? await whooshSound() : null,
      });
      try {
        const id = await shotstackRender(edit);
        await db.from("reels").update({ status: "rendering", render_id: id, error: warning, updated_at: new Date().toISOString() }).eq("id", reel.id);
        return json({ ok: true, renderId: id, warning });
      } catch (e) {
        await db.from("reels").update({ status: "failed", error: e instanceof Error ? e.message : "Render failed" }).eq("id", reel.id);
        return bad(e instanceof Error ? e.message : "Render failed", 500);
      }
    }

    case "status": {
      const reel = await getReel(String(b.reelId));
      if (!reel) return bad("Reel not found", 404);
      const r = await advance(reel);
      return json(r);
    }

    case "delete": {
      await db.from("reels").delete().eq("id", String(b.reelId)).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
