import { adminClient } from "@/lib/admin";
import { isOrganiser } from "@/lib/auth";
import { bad, context, json, DEMO_READONLY } from "@/lib/server-data";
import { mediaUrl } from "@/lib/supabase";
import { loadServerState } from "@/lib/server-data";
import { cardUrl } from "@/lib/cards";
import { clipBugs, configured, listVoices, fitCommentary, sanitisePlan } from "@/lib/director";
import { LINE_PARTS, lineVoice, recordingOf, voiceKey, type Plan, type ReelRow } from "@/lib/director-types";
import { finishFilm, type FilmReel } from "@/lib/filmJob";

export const maxDuration = 300;

/** Copy the commentary (words, recordings, lengths) from one copy of a plan to the latest saved one. */
function copyCommentary(from: Plan, to: Plan) {
  const keys = ["voice", "voiceSrc", "voiceFor", "voiceSec", "voiceAuto", "payoff", "payoffSrc", "payoffFor", "payoffSec", "payoffAuto", "replayVoice", "replaySrc", "replayFor", "replaySec", "replayAuto", "own", "seats"] as const;
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

function origin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
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
  switch (b.action) {
    case "list": {
      // The film studio: the tournament's films (a render that finished while nobody watched is collected)
      const { data } = await db.from("reels").select("*").eq("tournament_id", t.id).order("created_at", { ascending: false }).limit(20);
      const reels = await Promise.all(((data ?? []) as FilmReel[]).map((r) => (r.status === "rendering" ? finishFilm(r, origin(req)).catch(() => r) : r)));
      return json({ reels, configured: cfg });
    }

    case "voices": {
      if (!cfg.voice) return json({ voices: [] });
      return json({ voices: await listVoices() });
    }

    case "save": {
      const reel = await getReel(String(b.reelId));
      if (!reel) return bad("Film not found", 404);
      if (reel.status === "rendering" || reel.status === "planning") return bad("This film is being made. Wait for it to finish.", 409);
      const plan = sanitisePlan(b.plan as Plan);
      // Clips must be this tournament's own posts; take their address from the database
      const ids = plan.segments.filter((s) => s.kind === "clip").map((s) => (s as { postId: string }).postId);
      const { data: posts } = ids.length
        ? await db.from("posts").select("id,media_path").eq("tournament_id", t.id).in("id", ids)
        : { data: [] as { id: string; media_path: string | null }[] };
      const byId = new Map((posts ?? []).map((p) => [p.id, p.media_path]));
      const prev = new Map((reel.plan?.segments ?? []).map((s) => [s.id, s]));
      plan.segments = plan.segments.filter((s) => {
        // Recordings are the server's record: kept while the words and the voice are unchanged, or the organiser's own
        const was = prev.get(s.id);
        for (const part of LINE_PARTS) {
          const keys = part === "voice" ? (["voiceSrc", "voiceFor", "voiceSec"] as const) : part === "payoff" ? (["payoffSrc", "payoffFor", "payoffSec"] as const) : (["replaySrc", "replayFor", "replaySec"] as const);
          const rec = s as unknown as Record<string, unknown>;
          for (const k of keys) delete rec[k];
          if (!was) continue;
          const old = recordingOf(was, part);
          const ownNow = !!s.own?.[part];
          const text = part === "voice" ? s.voice : s.kind === "clip" ? (part === "payoff" ? s.payoff : s.replay ? s.replayVoice : undefined) : undefined;
          const keep = ownNow ? !!was.own?.[part] && !!old.src : !!old.src && !!text?.trim() && old.key === voiceKey(text, lineVoice(plan, s, part));
          if (keep) {
            rec[keys[0]] = old.src;
            rec[keys[1]] = old.key;
            rec[keys[2]] = old.sec;
          }
        }
        if (s.own) for (const part of LINE_PARTS) if (s.own[part] && !recordingOf(s, part).src) delete s.own[part];
        if (s.kind === "clip") {
          const mp = byId.get(s.postId);
          if (!mp) return false;
          s.src = mediaUrl(mp)!;
        }
        return true;
      });
      // Music is chosen from the site's tracks (kept as the film had it unless a track is picked)
      if (b.plan?.music?.source === "track" && typeof b.plan.music.trackId === "string") plan.music = { source: "track", mood: "epic", trackId: b.plan.music.trackId };
      else if (b.plan?.music?.source === "none") plan.music = { source: "none", mood: "epic" };
      else plan.music = reel.plan?.music ?? plan.music;
      await db.from("reels").update({ plan, status: reel.status === "failed" ? "draft" : reel.status === "done" ? "done" : "draft", updated_at: new Date().toISOString() }).eq("id", reel.id);
      return json({ ok: true, plan });
    }

    case "ownLine": {
      // A line recorded in the organiser's own voice (or put back to the AI voice)
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Film not found", 404);
      if (reel.status === "rendering" || reel.status === "planning") return bad("This film is being made. Wait for it to finish.", 409);
      const part = LINE_PARTS.includes(b.part) ? (b.part as (typeof LINE_PARTS)[number]) : null;
      if (!part) return bad("Which line?");
      const path = b.path ? String(b.path) : null;
      if (path && !new RegExp(`^audio/${t.slug}/[\\w-]+\\.(wav|mp3|m4a)$`).test(path)) return bad("Bad recording");
      const sec = Math.max(0.3, Math.min(30, Number(b.sec) || 0));
      const plan = await patchPlan(reel.id, (p) => {
        const s = p.segments.find((x) => x.id === b.segId);
        if (!s) return;
        const rec = s as unknown as Record<string, unknown>;
        const keys = part === "voice" ? ["voiceSrc", "voiceFor", "voiceSec"] : part === "payoff" ? ["payoffSrc", "payoffFor", "payoffSec"] : ["replaySrc", "replayFor", "replaySec"];
        if (path) {
          s.own = { ...(s.own ?? {}), [part]: true };
          rec[keys[0]] = mediaUrl(path);
          rec[keys[1]] = "own|";
          rec[keys[2]] = sec;
          // the line needs words for the film to place it: keep what was there, or a placeholder
          if (part === "voice" && !s.voice?.trim()) s.voice = "(your recording)";
          if (part === "payoff" && s.kind === "clip" && !s.payoff?.trim()) s.payoff = "(your recording)";
          if (part === "replay" && s.kind === "clip" && !s.replayVoice?.trim()) s.replayVoice = "(your recording)";
        } else {
          if (s.own) delete s.own[part];
          for (const k of keys) delete rec[k];
        }
      });
      return json({ plan });
    }

    case "voiceRecord": {
      // Hear the changed lines before making the film again (a batch per call; the page calls again until done)
      if (!cfg.voice) return bad("ELEVENLABS_API_KEY isn't set, so commentary can't be recorded", 500);
      const reel = await getReel(String(b.reelId));
      if (!reel?.plan) return bad("Film not found", 404);
      if (reel.status === "rendering" || reel.status === "planning") return bad("This film is being made. Wait for it to finish.", 409);
      const work = structuredClone(reel.plan);
      const r = await fitCommentary(t.slug, work, 150_000);
      const plan = await patchPlan(reel.id, (p) => copyCommentary(work, p));
      return json({ plan, remaining: r.remaining, tightened: r.tightened, errors: r.errors });
    }

    case "bugCards": {
      // Preview the score panels for the (possibly unsaved) plan
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

    case "delete": {
      await db.from("reels").delete().eq("id", String(b.reelId)).eq("tournament_id", t.id);
      return json({ ok: true });
    }

    default:
      return bad("Unknown action");
  }
}
