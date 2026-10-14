/** The AI director's edit plan. Shared by the server and the review screen. */
import type { ClipType } from "./types";
import type { Seat, Sound } from "./film";

export type Aspect = "16:9" | "9:16";

interface Base {
  id: string;
  /** Narration read over this segment (optional). */
  voice?: string;
  /** The recorded narration, and what it was recorded from (text + voice), so it's reused until either changes */
  voiceSrc?: string;
  voiceFor?: string;
  /** Measured length of the recording, in seconds */
  voiceSec?: number;
  /** The line was shortened automatically to fit */
  voiceAuto?: boolean;
  /** Who says each line: 1 the commentator, 2 the pundit (unset: the usual split) */
  seats?: Partial<Record<LinePart, Seat>>;
  /** Lines the organiser recorded in their own voice (the recording is theirs: never re-recorded by the AI) */
  own?: Partial<Record<LinePart, boolean>>;
}

export interface CardSegment extends Base {
  kind: "card";
  card: "title" | "chapter" | "result" | "standings";
  heading: string;
  sub?: string;
  eyebrow?: string;
  /** Label + value rows. Values come from the scoring engine, never from the AI. */
  rows?: [string, string][];
  seconds: number;
}

export interface ClipSegment extends Base {
  kind: "clip";
  postId: string;
  src: string;
  caption: string;
  sub?: string;
  /** Trim: start and end in seconds within the source clip */
  in: number;
  out: number | null;
  /** Source length if known (read by the browser) */
  duration?: number | null;
  round?: number | null;
  hole?: number | null;
  /** Players in the shot (from the post); picks the match shown on the score panel */
  playerIds?: string[];
  /** TV-style score panel in the corner (default on) */
  bug?: boolean;
  /** The clip finishes the hole: the panel updates near the end, with a BIRDIE / HOLE WON flash */
  finishes?: boolean;
  /** Filmed upright (read by the browser). A clip of the other shape gets a blurred fill behind it */
  portrait?: boolean;
  /** Where the golfer is across a wide clip (0 left to 1 right): an upright film keeps the slice around them */
  focusX?: number;
  /** Not a shot: an interview, a prediction, scene-setting (no score panel; its own sound) */
  clipType?: ClipType;
  /** The line is said before the footage starts, over a still, so the clip plays with its own sound */
  leadIn?: boolean;
  /**
   * Clips have two lines: `voice` is the set-up, read from the start and never giving away the result;
   * `payoff` is a short reaction timed to end just before the clip does, once the result is on screen.
   */
  payoff?: string;
  payoffSrc?: string;
  payoffFor?: string;
  payoffSec?: number;
  payoffAuto?: boolean;
  /** Slow-motion replay of the finish after the hold (big moments only), with its own short line */
  replay?: boolean;
  replayVoice?: string;
  replaySrc?: string;
  replayFor?: string;
  replaySec?: number;
  replayAuto?: boolean;
}

export interface VeoSegment extends Base {
  kind: "veo";
  prompt: string;
  seconds: 4 | 6 | 8;
  status: "idle" | "pending" | "done" | "failed";
  op?: string;
  src?: string;
  error?: string;
  /** Google made the shot (and charged for it) but we couldn't fetch it: it can be fetched again for free */
  refetch?: boolean;
}

export type Segment = CardSegment | ClipSegment | VeoSegment;

export type Mood = "epic" | "upbeat" | "light" | "celtic";

/** Moods for composed music. The prompt is what the composer is asked for. */
export const MOODS: { id: Mood; name: string; prompt: string }[] = [
  { id: "epic", name: "Epic", prompt: "Cinematic orchestral sports-highlights theme with strings, brass and timpani, steady rising tension that builds to a triumphant finish" },
  { id: "upbeat", name: "Upbeat", prompt: "Upbeat, feel-good sports montage with driving acoustic and electric guitars, claps and light drums, bright and positive" },
  { id: "light", name: "Light-hearted", prompt: "Playful, light-hearted comedy underscore with pizzicato strings, woodwinds and a cheeky whistled-style melody" },
  { id: "celtic", name: "Celtic", prompt: "Proud, sweeping Irish cinematic piece with tin whistle, fiddle, uilleann pipes and bodhrán, building to a rousing finish" },
];

export interface PlanMusic {
  /** track = one of the site's tracks; made = composed (older films); upload = the tournament's own track; none */
  source: "track" | "made" | "upload" | "none";
  /** The site's track (source "track") */
  trackId?: string;
  mood: Mood;
  /** The composed track and the film length it was made for */
  src?: string;
  seconds?: number;
  error?: string;
}

export interface Plan {
  title: string;
  aspect: Aspect;
  voiceOn: boolean;
  musicVolume: number; // 0..1
  music?: PlanMusic;
  /** ElevenLabs voice for the commentary (default narrator when unset) */
  voiceId?: string;
  /** The pundit's voice, when there are two in the booth */
  voice2Id?: string;
  /** Two in the booth: a commentator and a pundit */
  booth?: 1 | 2;
  /** What you hear: the commentary, the clips' own sound, or both */
  sound?: Sound;
  /** Wide clips in an upright film: kept around the golfer (default) */
  reframe?: boolean;
  segments: Segment[];
}

/** What the browser learns about each clip before the director plans: its shape, length and a few stills. */
export interface ClipProbe {
  id: string;
  w: number;
  h: number;
  duration: number | null;
  /** Small JPEG stills (base64, no data: prefix): near the start, middle and end */
  frames: string[];
}

/** Delivery tags the commentary may use (Eleven v3); stripped for voices that don't understand them. */
export const VOICE_TAGS = ["[whispers]", "[excited]", "[laughs]", "[sighs]", "[calm]", "[impressed]"] as const;
export const stripTags = (s: string) => s.replace(/\[(?:[a-z ]{2,24})\]\s*/gi, "").trim();

/** Composed music is reused while the film length stays within this many seconds of what it was made for. */
export const MUSIC_SLACK = 2;
export const musicFits = (m: PlanMusic | undefined, seconds: number) => !!m?.src && m.seconds != null && Math.abs(m.seconds - Math.ceil(seconds)) <= MUSIC_SLACK;

export type CommentaryStyle = "classic" | "excitable" | "dry" | "banter";
export const COMMENTARY: { id: CommentaryStyle; name: string; note: string; persona: string }[] = [
  {
    id: "classic",
    name: "Classic TV golf",
    note: "Calm, knowledgeable, lifts for the big moments",
    persona: "a seasoned TV golf commentator on a major championship broadcast: authoritative, warm, economical, with a feel for tension. Hushed and sparing over putts; lift for birdies; dry wit for mishaps",
  },
  {
    id: "excitable",
    name: "Excitable",
    note: "Big calls, high drama, every shot an event",
    persona: "an excitable sports commentator calling it like a Ryder Cup Sunday: big calls, rising excitement, theatrical but never silly",
  },
  {
    id: "dry",
    name: "Dry and witty",
    note: "Understated, deadpan, quietly cutting",
    persona: "a bone-dry, understated commentator: deadpan, precise, quietly cutting about the bad shots and grudgingly impressed by the good ones",
  },
  {
    id: "banter",
    name: "Banter",
    note: "Like a mate on the mic, friendly ribbing",
    persona: "a funny friend of the group on the mic: warm, cheeky ribbing, in-jokes from the articles and player profiles, never nasty",
  },
];

export interface Brief {
  roundNumber: number | null; // null = whole tournament
  length: number;
  aspect: Aspect;
  voice: boolean;
  veo: boolean;
  /** How the commentary sounds and how much of it there is */
  style?: CommentaryStyle;
  amount?: "light" | "full";
  voiceId?: string;
  /** The film flow (Phase E) */
  sound?: Sound;
  booth?: 1 | 2;
  voice2Id?: string;
  /** One of the site's music tracks; null = no music */
  trackId?: string | null;
  /** Clips filmed the other way: fitted in (reframed or blurred sides) or left out */
  otherShape?: "fit" | "leave";
}

/** Key for a recorded line: re-record when the words or the voice change. */
export const voiceKey = (text: string, voiceId?: string) => `${voiceId ?? "default"}|${text.trim()}`;

export interface ReelRow {
  id: string;
  tournament_id: string;
  round_id: string | null;
  brief: Brief;
  plan: Plan | null;
  status: "planning" | "draft" | "rendering" | "done" | "failed";
  render_id: string | null;
  error: string | null;
  video_path: string | null;
  post_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Words per second a narrator comfortably reads. */
export const WPS = 2.6;

export function voiceSeconds(text?: string) {
  const words = stripTags(text ?? "");
  if (!words) return 0;
  return words.split(/\s+/).length / WPS + 0.4;
}

export type LinePart = "voice" | "payoff" | "replay";
export const LINE_PARTS: LinePart[] = ["voice", "payoff", "replay"];

/** A segment's line of commentary for one part (clips: set-up, payoff and replay line; cards and AI shots just one). */
export function lineText(s: Segment, part: LinePart): string {
  const t = part === "voice" ? s.voice : s.kind !== "clip" ? undefined : part === "payoff" ? s.payoff : s.replay ? s.replayVoice : undefined;
  return (t ?? "").trim();
}

type Rec = { src?: string; key?: string; sec?: number; auto?: boolean };
/** The recording held for one part of a segment. */
export function recordingOf(s: Segment, part: LinePart): Rec {
  if (part === "voice") return { src: s.voiceSrc, key: s.voiceFor, sec: s.voiceSec, auto: s.voiceAuto };
  if (s.kind !== "clip") return {};
  return part === "payoff"
    ? { src: s.payoffSrc, key: s.payoffFor, sec: s.payoffSec, auto: s.payoffAuto }
    : { src: s.replaySrc, key: s.replayFor, sec: s.replaySec, auto: s.replayAuto };
}

/** Who says a line: the pundit reacts (payoffs), talks over the replays and sums up each round; the commentator calls the rest. */
export function seatOf(s: Segment, part: LinePart): Seat {
  const set = s.seats?.[part];
  if (set === 1 || set === 2) return set;
  if (s.kind === "clip") return part === "voice" ? 1 : 2;
  return s.kind === "card" && s.card === "result" ? 2 : 1;
}

export const OWN_VOICE = "own";

/** The voice a line is recorded in: the organiser's own, the pundit's (two in the booth), or the commentator's. */
export function lineVoice(p: Pick<Plan, "voiceId" | "voice2Id" | "booth">, s: Segment, part: LinePart): string | undefined {
  if (s.own?.[part]) return OWN_VOICE;
  return p.booth === 2 && seatOf(s, part) === 2 ? p.voice2Id : p.voiceId;
}

/** Is the line's recording up to date (the organiser's own recordings always are)? */
export function lineRecorded(p: Pick<Plan, "voiceId" | "voice2Id" | "booth">, s: Segment, part: LinePart): boolean {
  const r = recordingOf(s, part);
  if (s.own?.[part]) return !!r.src;
  const text = lineText(s, part);
  return !!text && !!r.src && r.key === voiceKey(text, lineVoice(p, s, part));
}

/** Seconds the line takes: measured once recorded (same words), estimated before. */
export function lineSeconds(s: Segment, part: LinePart): number {
  const text = lineText(s, part);
  if (!text) return 0;
  const r = recordingOf(s, part);
  if (s.own?.[part] && r.src && r.sec != null) return r.sec;
  if (r.key && r.sec != null && r.key.slice(r.key.indexOf("|") + 1) === text) return r.sec;
  return voiceSeconds(text);
}

/** Broadcast timing, in seconds */
export const LEAD_IN = 0.8; // first words this long after a cut (the picture lands first)
export const TAIL = 0.3; // a payoff with no hold ends this long before the cut
export const GAP = 0.4; // quiet between set-up and payoff (the shot itself)
export const HOLD = 1.4; // the result stays on screen this long after the footage, before moving on
export const INTO_HOLD = 0.5; // a payoff may run this far into the hold
export const STING = 0.94; // the branded swipe between holes and scenes

/** How a clip's time is spent: the footage itself, the hold on the result, and an optional slow-motion replay. */
export function clipParts(s: ClipSegment) {
  const end = s.out ?? (s.duration != null ? Math.min(s.duration, s.in + 10) : s.in + 8);
  const real = Math.max(1, Math.min(30, end - s.in));
  const hold = s.payoff?.trim() || s.finishes || s.replay ? HOLD : 0;
  // More footage after the chosen end? Hold on that; otherwise the last moments play at half speed
  const spare = s.duration != null ? Math.max(0, s.duration - (s.in + real)) : 0;
  const replay = s.replay ? Math.round(2 * Math.min(3, real) * 100) / 100 : 0;
  // Said before the footage, over a still: as long as the line, and a beat either side
  const said = s.leadIn ? lineSeconds(s, "voice") : 0;
  const lead = said ? Math.round((said + LEAD_IN + 0.5) * 100) / 100 : 0;
  return { real, hold, spare, replay, lead };
}

/** Timing inside a clip: when each line starts, and the most each may take. */
export function clipLayout(real: number, hold: number, setupSec: number, payoffSec: number) {
  const payoffEnd = hold ? real + INTO_HOLD : real - TAIL;
  const payoffMax = Math.max(1.4, Math.min(3.2, real * 0.4 + (hold ? INTO_HOLD : 0)));
  const payoffStart = payoffSec ? Math.max(LEAD_IN, payoffEnd - payoffSec) : real + hold;
  const setupEndBy = payoffSec ? payoffStart - GAP : real - 0.3;
  return { setupStart: LEAD_IN, setupMax: Math.max(0, setupEndBy - LEAD_IN), payoffStart, payoffMax };
}

/** Does this line fit its slot? (cards stretch, so they're only checked loosely) */
export function lineFits(s: Segment, part: LinePart): { fits: boolean; sec: number; max: number } {
  const sec = lineSeconds(s, part);
  if (!sec) return { fits: true, sec: 0, max: 0 };
  if (s.kind === "card") return { fits: sec <= 12, sec, max: 12 };
  const len = segmentSeconds(s);
  if (s.kind === "veo") return { fits: sec <= len - LEAD_IN, sec, max: len - LEAD_IN };
  const p = clipParts(s);
  if (part === "voice" && s.leadIn) return { fits: sec <= 14, sec, max: 14 };
  if (part === "replay") return { fits: sec <= p.replay - LEAD_IN - 0.3 + 0.15, sec, max: p.replay - LEAD_IN - 0.3 };
  const L = clipLayout(p.real, p.hold, lineSeconds(s, "voice"), lineSeconds(s, "payoff"));
  const max = part === "voice" ? L.setupMax : Math.min(L.payoffMax, p.real + (p.hold ? INTO_HOLD : 0) - LEAD_IN);
  return { fits: sec <= max + 0.15, sec, max };
}

export function segmentSeconds(s: Segment): number {
  // Cards stay up until their line has finished
  if (s.kind === "card") return Math.max(s.seconds, lineSeconds(s, "voice") ? lineSeconds(s, "voice") + LEAD_IN + 0.7 : 0);
  if (s.kind === "veo") return s.status === "done" ? s.seconds : 0;
  const p = clipParts(s);
  return Math.round((p.lead + p.real + p.hold + p.replay) * 100) / 100;
}

export function planSeconds(p: Plan) {
  return p.segments.reduce((t, s) => t + segmentSeconds(s), 0);
}
