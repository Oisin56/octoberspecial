/**
 * The end-of-tournament film: when it can be made, what the questions offer, the camera's "what are you filming?",
 * the commentary seats, the music under the film and what a film costs. Pure: the phone and the server share it.
 */
import { cardInfo, roundStage } from "./scorecards";
import { toRoundCfg, type ClipType, type PostRow, type TournamentState } from "./types";

export const FILM_LENGTHS = [180, 300, 480] as const;
export type FilmLength = (typeof FILM_LENGTHS)[number];
export type Sound = "commentary" | "own" | "both";
export type Shape = "portrait" | "landscape";

export const SOUNDS: { id: Sound; name: string; note: string }[] = [
  { id: "commentary", name: "Commentary", note: "The commentary team talks you through every shot" },
  { id: "own", name: "The clips' own sound", note: "No commentator: hear the strikes, the shouts and anyone talking to camera" },
  { id: "both", name: "Both", note: "The commentator sets up each shot, goes quiet while it plays, and comes back for the replay" },
];

/** Clips the film can use: videos with a file, not hidden, not a film itself. */
export function filmClips(s: Pick<TournamentState, "posts">): PostRow[] {
  return s.posts.filter((p) => p.kind === "video" && !!p.media_path && !p.hidden && p.author_name !== "AI director" && !(p.body ?? "").startsWith("Highlights reel"));
}

/**
 * The film is made once, at the end: every round played and every card final. What's still missing, in plain words.
 */
export function filmUnlock(s: Pick<TournamentState, "tournament" | "players" | "rounds" | "entries" | "posts"> & Partial<Pick<TournamentState, "cards" | "signatures">>): {
  ok: boolean;
  missing: string[];
  clips: number;
} {
  const missing: string[] = [];
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  if (!rounds.length) missing.push("There are no rounds yet.");
  const names = Object.fromEntries(s.players.map((p) => [p.id, p.name]));
  for (const r of rounds) {
    if (r.status === "complete") continue;
    const played = s.entries.some((e) => e.round_id === r.id);
    if (r.status === "upcoming" && !played) {
      missing.push(`Round ${r.number} hasn't been played yet.`);
      continue;
    }
    if (roundStage(s, r.id) === "final") continue;
    const cfg = toRoundCfg(r, s.players);
    const open = cfg.games.filter((g) => cardInfo(s, r.id, g.id).stage !== "final");
    if (!open.length) missing.push(`Round ${r.number} isn't finished yet.`);
    for (const g of open) {
      const who = g.name ?? g.sides.map((sd) => sd.playerIds.map((id) => names[id] ?? id).join(" & ")).join(" v ");
      missing.push(`Round ${r.number}: ${who}'s card isn't final yet.`);
    }
  }
  const clips = filmClips(s).length;
  if (!clips) missing.push("There are no clips to make a film from yet.");
  const shown = missing.length > 5 ? [...missing.slice(0, 4), `…and ${missing.length - 4} more.`] : missing;
  return { ok: !missing.length, missing: shown, clips };
}

/** The lengths worth offering for this many clips, and the one that suits them best. */
export function lengthsFor(clips: number): { options: FilmLength[]; best: FilmLength } {
  const options: FilmLength[] = [180];
  if (clips >= 10) options.push(300);
  if (clips >= 24) options.push(480);
  const best: FilmLength = clips >= 32 ? 480 : clips >= 16 ? 300 : 180;
  return { options, best: options.includes(best) ? best : options[options.length - 1] };
}

export const lengthName = (l: number) => `${Math.round(l / 60)} minutes`;

/** How the clips were filmed. */
export function shapeMix(clips: PostRow[]) {
  const out = { portrait: 0, landscape: 0, unknown: 0 };
  for (const c of clips) out[c.details?.shape ?? "unknown"]++;
  return out;
}

/** The film's shape: the tournament's setting, else whichever way most clips were filmed. */
export function filmShape(share: Shape | null | undefined, mix: ReturnType<typeof shapeMix>): Shape {
  if (share === "portrait" || share === "landscape") return share;
  return mix.portrait > mix.landscape ? "portrait" : "landscape";
}

/** Leaving out the clips filmed the other way is offered only when plenty are left. */
export const canLeaveOut = (mix: ReturnType<typeof shapeMix>, shape: Shape) => mix[shape] >= 8 && mix[shape === "portrait" ? "landscape" : "portrait"] > 0;

// ------------------------------------------------------------ the camera: what are you filming?

export const CLIP_TYPES: Record<Exclude<ClipType, "shot">, { name: string; prompt: string }> = {
  prediction: { name: "Prediction", prompt: "Ask: who's going to win, and by how much?" },
  interview: { name: "Interview", prompt: "Ask: how did it go out there? What was the best moment?" },
  scene: { name: "Scene-setting", prompt: "Show where you are: the clubhouse, the first tee, the view" },
  other: { name: "Something else", prompt: "" },
};

/**
 * When no round is live, the camera asks what you're filming, with the likeliest first: before the event,
 * predictions; between rounds and after the last, interviews about the round just played.
 */
export function cameraChoices(s: Pick<TournamentState, "rounds">): { order: Exclude<ClipType, "shot">[]; when: "pre" | "post"; roundId: string | null } | null {
  if (s.rounds.some((r) => r.status === "live")) return null;
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  const played = rounds.filter((r) => r.status === "complete");
  if (!played.length) return { order: ["prediction", "scene", "interview", "other"], when: "pre", roundId: null };
  const last = played[played.length - 1];
  const allDone = played.length === rounds.length;
  return { order: allDone ? ["interview", "other", "scene", "prediction"] : ["interview", "prediction", "scene", "other"], when: "post", roundId: last.id };
}

export const clipTypeOf = (p: Pick<PostRow, "details">): ClipType => p.details?.clipType ?? "shot";

// ------------------------------------------------------------ the commentary team

/** Seat 1 is the commentator (calls the play), seat 2 the pundit (reacts, analyses the replays and the results). */
export type Seat = 1 | 2;
export const SEAT_NAMES: Record<Seat, string> = { 1: "Commentator", 2: "Pundit" };

// ------------------------------------------------------------ the music under the film

export interface MusicSpan {
  start: number;
  end: number;
  /** How loud the music is here, 0 to 1 (before the film's music volume) */
  level: number;
  /** A round starts here: a good place to move on to the next track */
  chapter?: boolean;
}

export interface MusicPiece {
  src: string;
  trim: number;
  start: number;
  length: number;
  volume: number;
  effect?: "fadeIn" | "fadeOut" | "fadeInFadeOut";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lay the chosen track (then the others, in turn) under the film: louder on the cards, down under commentary and
 * right down under clips with their own sound. When a track runs out, the next starts at a round change where
 * possible, fading out and in; the last fades out at the end.
 */
export function musicPieces(spans: MusicSpan[], tracks: { src: string; sec: number }[], base: number): MusicPiece[] {
  if (!spans.length || !tracks.length) return [];
  const end = spans[spans.length - 1].end;
  const start = spans[0].start;
  // Where each track plays: from its start until the next one takes over
  const runs: { src: string; from: number; to: number }[] = [];
  let at = start;
  for (let i = 0; at < end - 0.5 && i < 50; i++) {
    const tr = tracks[i % tracks.length];
    const usable = Math.max(5, tr.sec - 1);
    let to = Math.min(end, at + usable);
    if (to < end) {
      // Move on at the latest round change inside this track (at least 20 seconds in)
      const change = spans.filter((s) => s.chapter && s.start >= at + 20 && s.start <= at + usable).map((s) => s.start);
      if (change.length) to = change[change.length - 1];
    }
    runs.push({ src: tr.src, from: at, to });
    at = to;
  }
  const out: MusicPiece[] = [];
  for (const run of runs) {
    const mine: MusicPiece[] = [];
    for (const sp of spans) {
      const a = Math.max(sp.start, run.from);
      const b = Math.min(sp.end, run.to);
      if (b - a < 0.05) continue;
      const volume = r2(Math.max(0, Math.min(1, sp.level * base)));
      const prev = mine[mine.length - 1];
      if (prev && prev.volume === volume && Math.abs(prev.start + prev.length - a) < 0.02) prev.length = r2(prev.length + (b - a));
      else mine.push({ src: run.src, trim: r2(a - run.from), start: r2(a), length: r2(b - a), volume });
    }
    if (!mine.length) continue;
    mine[0].effect = "fadeIn";
    const last = mine[mine.length - 1];
    last.effect = last === mine[0] ? "fadeInFadeOut" : "fadeOut";
    out.push(...mine);
  }
  return out;
}

// ------------------------------------------------------------ framing a clip filmed the other way

/**
 * A wide clip in an upright film: keep the upright slice around the golfer (focusX, 0 to 1 across the frame).
 * Returns the fractions to crop from the left and right.
 */
export function uprightCrop(focusX: number | undefined, clipW = 16, clipH = 9): { left: number; right: number } {
  const keep = Math.min(1, (9 / 16) / (clipW / clipH));
  const fx = Number.isFinite(focusX) ? Math.max(0, Math.min(1, focusX!)) : 0.5;
  const left = Math.max(0, Math.min(1 - keep, fx - keep / 2));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { left: r3(left), right: r3(1 - keep - left) };
}

// ------------------------------------------------------------ cost

/** Rough prices, in US cents: Shotstack pay-as-you-go per minute of finished film, voices per 1,000 characters, the plan. */
export const COST = { renderPerMinute: 20, voicePer1k: 30, plan: 15 };

export function estimateCents(filmSeconds: number, voiceChars: number, planned = true): number {
  return Math.round(((filmSeconds / 60) * COST.renderPerMinute + (voiceChars / 1000) * COST.voicePer1k + (planned ? COST.plan : 0)) * 100) / 100;
}

export interface FilmLimits {
  /** Across the whole site, per calendar month, in cents */
  monthlyCents: number;
  /** Films each tournament can make */
  perTournament: number;
}
export const DEFAULT_LIMITS: FilmLimits = { monthlyCents: 3000, perTournament: 3 };

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ------------------------------------------------------------ the site owner's brand pack and music

export interface BrandClip {
  path: string;
  sec: number;
}
export type BrandSlot = "intro" | "outro" | "transition";
export type BrandPack = Partial<Record<BrandSlot, Partial<Record<Shape, BrandClip>>>>;
export const BRAND_SLOTS: { id: BrandSlot; name: string; note: string }[] = [
  { id: "intro", name: "Intro", note: "Plays first, before the tournament's title" },
  { id: "outro", name: "Ending", note: "Plays last, after the final standings" },
  { id: "transition", name: "Transition", note: "Plays between rounds" },
];

export interface MusicTrack {
  id: string;
  name: string;
  mood: string;
  path: string;
  sec: number;
}
export const MAX_TRACKS = 5;
