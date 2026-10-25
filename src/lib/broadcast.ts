import "server-only";
import { createHmac } from "node:crypto";
import { adminClient } from "./admin";
import { loadServerState, type TournamentPrivate } from "./server-data";
import { buildTimeline, clipBugs, configured, shotstackRender, shotstackStatus } from "./director";
import { segmentSeconds, type CardSegment, type ClipSegment, type Plan } from "./director-types";
import { plainUrl, storeFor } from "./files";
import { gameHole, gameShots } from "./engine";
import { toEntries, toRoundCfg, toTournamentCfg, type PostRow, type TournamentState } from "./types";

/**
 * Broadcast clips: every clip from the course is turned into a short TV-style video once its hole is finished
 * (or a minute after posting if it has no hole): upright 9:16, the player and hole, a caption from the shot log,
 * the score graphic, a slow-motion replay for the big moments and a one-second branded end card.
 * The feed then plays it, and sharing sends it. Rendered by Shotstack; the organiser can switch it off and
 * sets a monthly limit on what it costs.
 */

/** Shotstack pay-as-you-go: 20 cents a minute of finished video, charged by the second. */
export const CENTS_PER_MINUTE = 20;
const NO_HOLE_WAIT_MS = 60_000;
const MAX_CLIP = 30;

export const signBroadcast = (postId: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(`bc:${postId}`).digest("base64url").slice(0, 24);

export interface Spend {
  cents: number;
  clips: number;
  capCents: number;
  on: boolean;
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

/** What broadcast clips have cost this calendar month. */
export async function monthSpend(t: Pick<TournamentPrivate, "id" | "broadcast_on" | "broadcast_cap_cents">): Promise<Spend> {
  const { data } = await adminClient()
    .from("posts")
    .select("broadcast_seconds")
    .eq("tournament_id", t.id)
    .in("broadcast_status", ["rendering", "done"])
    .gte("broadcast_at", monthStart());
  const secs = (data ?? []).reduce((a, r) => a + Number(r.broadcast_seconds ?? 0), 0);
  return { cents: Math.round((secs / 60) * CENTS_PER_MINUTE * 100) / 100, clips: (data ?? []).length, capCents: t.broadcast_cap_cents ?? 1000, on: t.broadcast_on !== false };
}

const BIG = ["birdie", "eagle", "chip-in", "long putt", "hole in one"];

/** Is this clip ready to turn into a broadcast clip? Its hole is finished, or it has no hole and was posted a minute ago. */
function due(s: TournamentState, p: PostRow, now: number) {
  if (!p.hole || !p.round_id) return now - new Date(p.created_at).getTime() >= NO_HOLE_WAIT_MS;
  const round = s.rounds.find((r) => r.id === p.round_id);
  if (!round) return now - new Date(p.created_at).getTime() >= NO_HOLE_WAIT_MS;
  const cfg = toRoundCfg(round, s.players);
  const players = toTournamentCfg(s).players;
  const ids = p.player_ids ?? [];
  const game = cfg.games.find((g) => g.sides.some((sd) => sd.playerIds.some((x) => ids.includes(x)))) ?? (cfg.games.length === 1 ? cfg.games[0] : undefined);
  if (!game) return now - new Date(p.created_at).getTime() >= NO_HOLE_WAIT_MS;
  const e = (toEntries(s.entries.filter((x) => x.round_id === round.id))[round.id] ?? []).find((x) => x.game === game.id && x.hole === p.hole);
  return !!e && gameHole(cfg, game, gameShots(cfg, game, players), e).complete;
}

/** One clip as a one-segment film plus the end card. */
export function clipPlan(s: TournamentState, p: PostRow): Plan {
  const d = (p.details ?? {}) as Record<string, string>;
  const round = s.rounds.find((r) => r.id === p.round_id);
  const holed = /holed|in the hole|chip-in|hole in one/i.test(d.result ?? "") || p.tags.some((t) => ["chip-in", "hole in one"].includes(t));
  const big = holed || p.tags.some((t) => BIG.includes(t));
  const dur = Number(d.dur) || null;
  const tin = p.trim_in != null ? Number(p.trim_in) : 0;
  const tout = p.trim_out != null ? Number(p.trim_out) : dur != null ? Math.min(dur, tin + MAX_CLIP) : null;
  const caption = (p.body ?? "").trim() || [d.shot, d.result].filter(Boolean).join(", ") || p.author_name;
  const clip: ClipSegment = {
    id: "clip",
    kind: "clip",
    postId: p.id,
    src: plainUrl(p.media_path!),
    caption: caption.slice(0, 90),
    sub: [d.shot && d.result && caption !== `${d.shot}, ${d.result}` ? `${d.shot}, ${d.result.toLowerCase()}` : null, d.club].filter(Boolean).join(" · ") || undefined,
    in: tin,
    out: tout,
    duration: dur,
    round: round?.number ?? null,
    hole: p.hole,
    playerIds: p.player_ids ?? [],
    bug: !!round && p.hole != null,
    finishes: holed,
    portrait: d.shape === "portrait" ? true : d.shape === "landscape" ? false : undefined,
    replay: big,
  };
  const end: CardSegment = {
    id: "end",
    kind: "card",
    card: "title",
    heading: s.tournament.name,
    sub: round ? `Round ${round.number} · ${round.course_name}` : undefined,
    seconds: 1,
  };
  return { title: s.tournament.name, aspect: "9:16", voiceOn: false, musicVolume: 0, music: { source: "none", mood: "upbeat" }, segments: [clip, end] };
}

/** Start the render for one clip (checks the switch and the monthly limit). */
async function startRender(t: TournamentPrivate, s: TournamentState, p: PostRow, origin: string, spend: Spend) {
  const db = adminClient();
  const plan = clipPlan(s, p);
  const seconds = plan.segments.reduce((a, x) => a + segmentSeconds(x), 0);
  const cost = (seconds / 60) * CENTS_PER_MINUTE;
  if (spend.cents + cost > spend.capCents) {
    await db.from("posts").update({ broadcast_status: "capped" }).eq("id", p.id);
    return spend;
  }
  // Claim it first, so two sweeps never render the same clip twice
  const { data: claimed } = await db.from("posts").update({ broadcast_status: "rendering", broadcast_at: new Date().toISOString(), broadcast_seconds: seconds }).eq("id", p.id).is("broadcast_status", null).select("id");
  if (!claimed?.length) return spend;
  try {
    const edit = buildTimeline(plan, {
      origin,
      theme: t.theme,
      colors: t.custom_colors,
      music: null,
      narration: {},
      bugs: clipBugs(s, plan),
      names: Object.fromEntries(s.players.map((pl) => [pl.id, pl.name])),
      eventName: t.name,
      whoosh: null,
    }) as Record<string, unknown>;
    edit.callback = `${origin}/api/broadcast?post=${p.id}&sig=${signBroadcast(p.id)}`;
    const id = await shotstackRender(edit);
    await db.from("posts").update({ broadcast_render: id }).eq("id", p.id);
    return { ...spend, cents: spend.cents + cost, clips: spend.clips + 1 };
  } catch (e) {
    console.error("[broadcast] render failed", p.id, e);
    await db.from("posts").update({ broadcast_status: "failed", broadcast_seconds: 0 }).eq("id", p.id);
    return spend;
  }
}

/** A render has finished: keep the video in our storage (Shotstack's copy expires) and point the post at it. */
export async function finishRender(postId: string): Promise<string> {
  const db = adminClient();
  const { data: p } = await db.from("posts").select("id,tournament_id,broadcast_render,broadcast_status").eq("id", postId).maybeSingle();
  if (!p?.broadcast_render || p.broadcast_status !== "rendering") return p?.broadcast_status ?? "missing";
  const st = await shotstackStatus(p.broadcast_render);
  if (st.status === "failed") {
    await db.from("posts").update({ broadcast_status: "failed" }).eq("id", postId);
    return "failed";
  }
  if (st.status !== "done" || !st.url) return "rendering";
  const { data: t } = await db.from("tournaments").select("slug").eq("id", p.tournament_id).single();
  const v = await fetch(st.url).catch(() => null);
  if (!v?.ok) return "rendering";
  const path = `video/${t!.slug}/bc-${postId}.mp4`;
  const { error } = await (await storeFor(path)).upload(path, await v.arrayBuffer(), { contentType: "video/mp4", upsert: true });
  if (error) {
    console.error("[broadcast] store failed", error.message);
    return "rendering";
  }
  if (st.poster) {
    const pr = await fetch(st.poster).catch(() => null);
    if (pr?.ok) await (await storeFor(path)).upload(`${path}.jpg`, await pr.arrayBuffer(), { contentType: "image/jpeg", upsert: true });
  }
  await db.from("posts").update({ broadcast_status: "done", broadcast_path: path }).eq("id", postId);
  return "done";
}

// One sweep per tournament at a time per server, and not more than every few seconds
const lastSweep = new Map<string, number>();

/**
 * Start renders for every clip that's due and collect any that have finished. Called after a hole is saved,
 * after a clip is posted, and now and then by phones with the site open (so nothing waits on a timer).
 */
export async function sweep(tournamentId: string, origin: string, force = false) {
  if (!configured().shotstack) return { started: 0, finished: 0 };
  const now = Date.now();
  if (!force && now - (lastSweep.get(tournamentId) ?? 0) < 8000) return { started: 0, finished: 0 };
  lastSweep.set(tournamentId, now);
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("*").eq("id", tournamentId).single();
  if (!t) return { started: 0, finished: 0 };
  let finished = 0;
  // Renders that should be done by now (in case Shotstack's call back didn't arrive)
  const { data: pending } = await db.from("posts").select("id,broadcast_at").eq("tournament_id", tournamentId).eq("broadcast_status", "rendering");
  for (const p of pending ?? []) {
    if (now - new Date(p.broadcast_at).getTime() < 20_000) continue;
    if ((await finishRender(p.id)) === "done") finished++;
  }
  if (t.broadcast_on === false) return { started: 0, finished };
  const s = await loadServerState(tournamentId);
  const candidates = s.posts.filter(
    (p) =>
      p.kind === "video" &&
      p.media_path &&
      !p.media_path.startsWith("http") &&
      !(p.body ?? "").startsWith("Highlights reel") &&
      !p.hidden &&
      p.visibility === "public" &&
      !p.broadcast_status &&
      !p.fan_id &&
      // only fresh clips (never a back catalogue the day this is switched on)
      now - new Date(p.created_at).getTime() < 48 * 3600e3,
  );
  let spend = await monthSpend(t);
  let started = 0;
  for (const p of candidates.filter((p) => due(s, p, now)).slice(0, 6)) {
    const before = spend.clips;
    spend = await startRender(t, s, p, origin, spend);
    if (spend.clips > before) started++;
  }
  return { started, finished };
}
