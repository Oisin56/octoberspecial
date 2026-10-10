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
  publishReel,
  sanitisePlan,
  shotstackRender,
  shotstackStatus,
  speak,
  veoPoll,
  veoStart,
  writePlan,
} from "@/lib/director";
import { musicFits, planSeconds, type Brief, type Plan, type ReelRow } from "@/lib/director-types";

export const maxDuration = 300;

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

  switch (b.action) {
    case "list": {
      const { data } = await db.from("reels").select("*").eq("tournament_id", t.id).order("created_at", { ascending: false }).limit(20);
      return json({ reels: data ?? [], configured: cfg, music: mediaUrl(t.reel_music_path ?? null) });
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
      };
      let roundId: string | null = null;
      if (brief.roundNumber != null) {
        const { data: r } = await db.from("rounds").select("id").eq("tournament_id", t.id).eq("number", brief.roundNumber).maybeSingle();
        if (!r) return bad("Round not found");
        roundId = r.id;
      }
      try {
        const plan = await writePlan(t.id, brief);
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
        plan.music = { ...plan.music, src: m.src, seconds: m.seconds, error: undefined };
        await savePlan(reel.id, plan);
        return json({ music: plan.music });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "Music didn't compose", 500);
      }
    }

    case "veoStart": {
      if (!cfg.veo) return bad("GEMINI_API_KEY isn't set, so Veo shots are off", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      const seg = reel.plan.segments.find((s) => s.id === b.segmentId);
      if (!seg || seg.kind !== "veo") return bad("Shot not found");
      try {
        seg.op = await veoStart(seg.prompt, reel.plan.aspect, seg.seconds);
        seg.status = "pending";
        seg.error = undefined;
        seg.src = undefined;
      } catch (e) {
        seg.status = "failed";
        seg.error = e instanceof Error ? e.message : "Veo failed";
      }
      await savePlan(reel.id, reel.plan);
      return json({ segment: seg });
    }

    case "veoPoll": {
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Reel not found", 404);
      const seg = reel.plan.segments.find((s) => s.id === b.segmentId);
      if (!seg || seg.kind !== "veo" || !seg.op) return bad("Shot not started");
      if (seg.status !== "pending") return json({ segment: seg });
      let r: Awaited<ReturnType<typeof veoPoll>>;
      try {
        r = await veoPoll(t.slug, seg.op);
      } catch (e) {
        r = { done: true, error: e instanceof Error ? e.message : "Veo failed" };
      }
      if (r.done) {
        seg.status = r.src ? "done" : "failed";
        seg.src = r.src;
        seg.error = r.error;
        await savePlan(reel.id, reel.plan);
      }
      return json({ segment: seg });
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
      // Narration audio for each segment with a voice line
      let narration: Record<string, string> = {};
      let warning: string | null = null;
      if (plan.voiceOn && cfg.voice) {
        try {
          for (const s of plan.segments) if (s.voice?.trim()) narration[s.id] = await speak(t.slug, s.voice.trim());
        } catch (e) {
          // A voice problem shouldn't cost the whole film: render without narration and say why
          narration = {};
          warning = `The voice-over didn't record (${e instanceof Error ? e.message : "voice service error"}), so this film has music and captions only.`;
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
            await savePlan(reel.id, plan);
            musicUrl = m.src;
            composed = true;
          } catch (e) {
            const why = e instanceof Error ? e.message : "music service error";
            warning = `${warning ? `${warning} ` : ""}The music didn't compose (${why}), so this film has no music.`;
          }
        }
      }
      const edit = buildTimeline(plan, {
        origin: origin(req),
        theme: t.theme,
        colors: t.custom_colors,
        music: musicUrl,
        musicComposed: composed,
        narration,
        bugs: clipBugs(await loadServerState(t.id), plan),
      });
      try {
        const id = await shotstackRender(edit);
        await db.from("reels").update({ status: "rendering", render_id: id, error: null, updated_at: new Date().toISOString() }).eq("id", reel.id);
        return json({ ok: true, renderId: id, warning });
      } catch (e) {
        await db.from("reels").update({ status: "failed", error: e instanceof Error ? e.message : "Render failed" }).eq("id", reel.id);
        return bad(e instanceof Error ? e.message : "Render failed", 500);
      }
    }

    case "status": {
      const reel = await getReel(String(b.reelId));
      if (!reel) return bad("Reel not found", 404);
      if (reel.status !== "rendering" || !reel.render_id) return json({ reel });
      const st = await shotstackStatus(reel.render_id).catch(() => ({ status: "rendering" }) as { status: string; url?: string; error?: string });
      if (st.status === "done" && st.url) {
        let pub;
        try {
          pub = await publishReel(t.id, t.slug, reel.id, st.url, reel.plan?.title ?? "Highlights", reel.round_id);
        } catch (e) {
          const { data } = await db.from("reels").update({ status: "failed", error: `Rendered, but saving failed: ${e instanceof Error ? e.message : e}. Film: ${st.url}` }).eq("id", reel.id).select().single();
          return json({ reel: data });
        }
        const { data } = await db
          .from("reels")
          .update({ status: "done", video_path: pub.mediaPath, post_id: pub.postId, updated_at: new Date().toISOString() })
          .eq("id", reel.id)
          .select()
          .single();
        return json({ reel: data, copied: pub.copied });
      }
      if (st.status === "failed") {
        const { data } = await db.from("reels").update({ status: "failed", error: st.error ?? "Render failed" }).eq("id", reel.id).select().single();
        return json({ reel: data });
      }
      return json({ reel, progress: st.status });
    }

    case "delete": {
      await db.from("reels").delete().eq("id", String(b.reelId)).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
