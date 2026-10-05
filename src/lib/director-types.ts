/** The AI director's edit plan. Shared by the server and the review screen. */

export type Aspect = "16:9" | "9:16";

interface Base {
  id: string;
  /** Narration read over this segment (optional). */
  voice?: string;
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
}

export interface VeoSegment extends Base {
  kind: "veo";
  prompt: string;
  seconds: 4 | 6 | 8;
  status: "idle" | "pending" | "done" | "failed";
  op?: string;
  src?: string;
  error?: string;
}

export type Segment = CardSegment | ClipSegment | VeoSegment;

export interface Plan {
  title: string;
  aspect: Aspect;
  voiceOn: boolean;
  musicVolume: number; // 0..1
  segments: Segment[];
}

export interface Brief {
  roundNumber: number | null; // null = whole tournament
  length: 60 | 180 | 300;
  aspect: Aspect;
  voice: boolean;
  veo: boolean;
}

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
  if (!text?.trim()) return 0;
  return text.trim().split(/\s+/).length / WPS + 0.4;
}

export function segmentSeconds(s: Segment): number {
  if (s.kind === "card") return Math.max(s.seconds, voiceSeconds(s.voice));
  if (s.kind === "veo") return s.status === "done" ? s.seconds : 0;
  const end = s.out ?? (s.duration != null ? Math.min(s.duration, s.in + 10) : s.in + 8);
  return Math.max(1, Math.min(30, end - s.in));
}

export function planSeconds(p: Plan) {
  return p.segments.reduce((t, s) => t + segmentSeconds(s), 0);
}
