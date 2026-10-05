import type { Format, HoleEntry, PlayerHole, RoundConfig, TournamentConfig } from "./scoring";

export const TOURNAMENT_SLUG =
  process.env.NEXT_PUBLIC_TOURNAMENT_SLUG || "october-special-2026";

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  ctp_points: number;
  ld_points: number;
  gir_points: number;
}

export interface PlayerRow {
  id: string;
  tournament_id: string;
  name: string;
  nickname: string | null;
  handicap: number | null;
  home_club: string | null;
  bio: string | null;
  best_club: string | null;
  worst_club: string | null;
  weakness: string | null;
  quote: string | null;
  photo_path: string | null;
  sort: number;
}

export interface HoleRowData {
  number: number;
  par: number;
  si: number;
  yards?: number;
}

export interface RoundRow {
  id: string;
  tournament_id: string;
  number: number;
  course_slug: string;
  course_name: string;
  play_date: string | null;
  tee_time: string | null;
  tee: string | null;
  format: Format;
  nine_points: number;
  full_points: number;
  shots: Record<string, number>;
  holes: HoleRowData[];
  scorer_id: string | null;
  status: "upcoming" | "live" | "complete";
}

export interface HoleEntryRow {
  id: string;
  round_id: string;
  hole: number;
  scores: Record<string, PlayerHole>;
  ctp_winner: string | null;
  ld_winner: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface AttestationRow {
  round_id: string;
  segment: "front" | "back";
  player_id: string;
  at: string;
}

export interface PostRow {
  id: string;
  tournament_id: string;
  round_id: string | null;
  hole: number | null;
  author_name: string;
  author_player_id: string | null;
  kind: "note" | "photo" | "video";
  body: string | null;
  tags: string[];
  media_path: string | null;
  visibility: "public" | "report";
  hidden: boolean;
  created_at: string;
}

export interface CommentRow {
  id: string;
  tournament_id: string;
  round_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

export interface AiPieceRow {
  id: string;
  tournament_id: string;
  round_id: string | null;
  kind: "preview" | "bulletin" | "report" | "tournament";
  title: string | null;
  body: string;
  trigger: string | null;
  status: "draft" | "published" | "hidden";
  created_at: string;
  published_at: string | null;
}

export interface TournamentState {
  tournament: TournamentRow;
  players: PlayerRow[];
  rounds: RoundRow[];
  entries: HoleEntryRow[];
  attestations: AttestationRow[];
  posts: PostRow[];
  comments: CommentRow[];
  pieces: AiPieceRow[];
}

export function toRoundConfig(r: RoundRow): RoundConfig {
  return {
    id: r.id,
    number: r.number,
    name: r.course_name,
    format: r.format,
    ninePoints: r.nine_points,
    fullPoints: r.full_points,
    shots: r.shots ?? {},
    holes: r.holes.map((h) => ({ number: h.number, par: h.par, si: h.si })),
  };
}

export function toTournamentConfig(s: Pick<TournamentState, "tournament" | "players" | "rounds">): TournamentConfig {
  return {
    players: [...s.players].sort((a, b) => a.sort - b.sort).map((p) => p.id),
    rounds: [...s.rounds].sort((a, b) => a.number - b.number).map(toRoundConfig),
    ctpPoints: s.tournament.ctp_points,
    ldPoints: s.tournament.ld_points,
    girPoints: s.tournament.gir_points,
  };
}

export function toEntries(rows: HoleEntryRow[]): Record<string, HoleEntry[]> {
  const out: Record<string, HoleEntry[]> = {};
  for (const r of rows) {
    (out[r.round_id] ??= []).push({
      hole: r.hole,
      scores: r.scores ?? {},
      ctpWinner: r.ctp_winner,
      ldWinner: r.ld_winner,
    });
  }
  return out;
}

export const FORMAT_LABEL: Record<Format, string> = {
  stableford: "Stableford",
  stroke: "Stroke Play",
  match: "Match Play",
};
