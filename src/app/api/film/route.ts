import { after } from "next/server";
import { adminClient } from "@/lib/admin";
import { isOrganiser } from "@/lib/auth";
import { bad, context, json, loadServerState, siteOrigin, DEMO_READONLY } from "@/lib/server-data";
import { mediaUrl } from "@/lib/supabase";
import { configured, defaultVoices, listVoices, speak } from "@/lib/director";
import { COMMENTARY, type Brief } from "@/lib/director-types";
import { FILM_LENGTHS, SOUNDS, canLeaveOut, clipTypeOf, filmClips, filmShape, filmUnlock, lengthsFor, shapeMix, type Shape } from "@/lib/film";
import { filmLimits, filmSpend, musicTracks, tournamentFilms } from "@/lib/site";
import { finishFilm, isStale, kick, type FilmReel } from "@/lib/filmJob";

export const maxDuration = 120;

/** A short line in each style, for "Hear it" (the commentator's, then the pundit's answer). */
const SAMPLES: Record<string, [string, string]> = {
  classic: ["Downhill, left to right. Twelve feet for the match.", "He has to give this a chance. And he does."],
  excitable: ["Here it comes, the big one, for the whole thing!", "Unbelievable! That's why he's here!"],
  dry: ["Twelve feet. Downhill. What could possibly go wrong.", "Well. He'll be telling everyone about that one."],
  banter: ["Right lads, twelve feet, and he's been talking all week.", "Fair play. I take back everything I said."],
};

const REEL_FIELDS = "id,status,stage,error,brief,plan,video_path,post_id,created_at,updated_at,done_at,renders,render_id,stage_at,cost_cents";

/** The organiser's film: what's ready, the questions' answers, making it, its progress. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { t, session, demo } = await context(req, b);
  if (!t) return bad("Tournament not found", 404);
  if (demo) return bad(DEMO_READONLY, 403);
  if (!isOrganiser(session)) return bad("Only the organiser can make the film", 403);
  const db = adminClient();
  const origin = siteOrigin(req);
  const cfg = configured();

  const getReel = async (id: string) => {
    const { data } = await db.from("reels").select("*").eq("id", id).eq("tournament_id", t.id).maybeSingle();
    return data as FilmReel | null;
  };
  /** A step that stalled is started again; a finished render is collected. */
  const refresh = async (r: FilmReel): Promise<FilmReel> => {
    if (r.status === "rendering") return finishFilm(r, origin).catch(() => r);
    if (isStale(r)) after(() => kick(origin, r.id));
    return r;
  };

  switch (b.action) {
    case "state": {
      const s = await loadServerState(t.id);
      const unlock = filmUnlock(s);
      const clips = filmClips(s);
      const mix = shapeMix(clips);
      const shape = filmShape(t.share_shape, mix);
      const shots = clips.filter((c) => clipTypeOf(c) === "shot").length;
      const [tracks, lim, made, spend] = await Promise.all([musicTracks(), filmLimits(), tournamentFilms(t.id), filmSpend()]);
      const { data, error } = await db.from("reels").select(REEL_FIELDS).eq("tournament_id", t.id).not("stage", "is", null).order("created_at", { ascending: false }).limit(10);
      const reels = await Promise.all(((data ?? []) as unknown as FilmReel[]).map(refresh));
      return json({
        unlock,
        clips: clips.length,
        shots,
        mix,
        shape,
        canLeave: canLeaveOut(mix, shape),
        lengths: lengthsFor(shots),
        sounds: SOUNDS,
        styles: COMMENTARY.map((c) => ({ id: c.id, name: c.name, note: c.note })),
        tracks: tracks.map((x) => ({ id: x.id, name: x.name, mood: x.mood, src: mediaUrl(x.path), sec: x.sec })),
        limits: { per: lim.perTournament, left: Math.max(0, lim.perTournament - made.made), budgetOk: spend.cents < lim.monthlyCents, busy: made.inProgress },
        ready: { claude: cfg.claude, video: cfg.shotstack, voice: cfg.voice },
        schemaOk: !error,
        reels,
      });
    }

    case "make": {
      if (!cfg.claude || !cfg.shotstack) return bad("Films aren't set up on this site yet (the AI writer or the video service is missing).", 500);
      const s = await loadServerState(t.id);
      const unlock = filmUnlock(s);
      if (!unlock.ok) return bad(`The film is made once the tournament is over. Still to do: ${unlock.missing.join(" ")}`, 409);
      const [lim, made, spend] = await Promise.all([filmLimits(), tournamentFilms(t.id), filmSpend()]);
      if (made.inProgress) return bad("A film is being made already. It'll be ready soon.", 409);
      if (made.made >= lim.perTournament) return bad(`This tournament has made all ${lim.perTournament} of its films.`, 409);
      if (spend.cents >= lim.monthlyCents) return bad("This month's film budget for the site is used up. It resets on the 1st.", 409);
      const q = b.brief ?? {};
      const tracks = await musicTracks();
      const shape: Shape = q.shape === "portrait" || q.shape === "landscape" ? q.shape : filmShape(t.share_shape, shapeMix(filmClips(s)));
      const sound = SOUNDS.some((x) => x.id === q.sound) ? q.sound : "commentary";
      const brief: Brief = {
        roundNumber: null,
        length: FILM_LENGTHS.includes(Number(q.length) as never) ? Number(q.length) : 300,
        aspect: shape === "portrait" ? "9:16" : "16:9",
        voice: sound !== "own" && cfg.voice,
        veo: false,
        sound,
        booth: q.booth === 2 ? 2 : 1,
        style: COMMENTARY.some((c) => c.id === q.style) ? q.style : "classic",
        amount: sound === "both" ? "light" : "full",
        trackId: tracks.some((x) => x.id === q.trackId) ? q.trackId : null,
        otherShape: q.otherShape === "leave" ? "leave" : "fit",
      };
      const { data, error } = await db.from("reels").insert({ tournament_id: t.id, brief, status: "planning", stage: "plan" }).select(REEL_FIELDS).single();
      if (error) return bad(/stage/.test(error.message) ? "Films need the latest database update (run supabase/schema.sql)." : error.message, 500);
      after(() => kick(origin, (data as unknown as FilmReel).id));
      return json({ reel: data });
    }

    case "status": {
      const r = await getReel(String(b.reelId));
      if (!r) return bad("Film not found", 404);
      return json({ reel: await refresh(r) });
    }

    case "retry": {
      const r = await getReel(String(b.reelId));
      if (!r || r.status !== "failed") return bad("Nothing to try again", 409);
      const { data } = await db.from("reels").update({ status: "planning", error: null, stage_at: null, stage: r.stage && r.stage !== "done" && r.stage !== "rendering" ? r.stage : r.plan ? "render" : "plan" }).eq("id", r.id).select(REEL_FIELDS).single();
      after(() => kick(origin, r.id));
      return json({ reel: data });
    }

    case "again": {
      // The film studio's changes: record what's new and put the film together again
      const r = await getReel(String(b.reelId));
      if (!r?.plan) return bad("Film not found", 404);
      if (r.status === "rendering" || (r.status === "planning" && !isStale(r))) return bad("This film is being made already.", 409);
      const [lim, made] = await Promise.all([filmLimits(), tournamentFilms(t.id)]);
      if (made.made >= lim.perTournament) return bad(`This tournament has made all ${lim.perTournament} of its films.`, 409);
      const { data } = await db.from("reels").update({ status: "planning", error: null, stage_at: null, stage: r.plan.voiceOn && cfg.voice ? "voices" : "render" }).eq("id", r.id).select(REEL_FIELDS).single();
      after(() => kick(origin, r.id));
      return json({ reel: data });
    }

    case "sample": {
      // Hear the commentary style before choosing it (each sample is recorded once and kept)
      if (!cfg.voice) return json({ urls: [] });
      const style = SAMPLES[b.style] ? String(b.style) : "classic";
      const v = defaultVoices();
      const lines = b.booth === 2 ? [[SAMPLES[style][0], v.commentator], [SAMPLES[style][1], v.pundit]] : [[SAMPLES[style][0], v.commentator]];
      try {
        const urls = await Promise.all(
          lines.map(async ([text, voice]) => {
            const path = `audio/samples/${voice}-${style}-${text === SAMPLES[style][0] ? 1 : 2}.mp3`;
            const head = await fetch(mediaUrl(path)!, { method: "HEAD" }).catch(() => null);
            if (head?.ok) return mediaUrl(path)!;
            return (await speak(t.slug, text, voice, path)).src;
          }),
        );
        return json({ urls });
      } catch (e) {
        return bad(e instanceof Error ? e.message : "The sample didn't record", 502);
      }
    }

    case "voices": {
      if (!cfg.voice) return json({ voices: [], defaults: defaultVoices() });
      return json({ voices: await listVoices(), defaults: defaultVoices() });
    }

    default:
      return bad("Unknown action");
  }
}
