import type {
  BallHole,
  Game,
  HandicapRule,
  HoleEntry,
  PlayType,
  PointsRule,
  RoundCfg,
  ScoringType,
  SideGameCfg,
  Team,
  TournamentCfg,
} from "./engine";
import { ONE_BALL, ballsOfGame } from "./engine";

export const DEFAULT_TOURNAMENT = process.env.NEXT_PUBLIC_DEFAULT_TOURNAMENT || "october-special-2026";

export type ThemeId = "clubhouse" | "links" | "championship" | "teamcup" | "custom";
export type Tone = "broadsheet" | "tabloid" | "commentator" | "dry";

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
  end_date: string | null;
  theme: ThemeId;
  custom_colors: { primary?: string; accent?: string; background?: string } | null;
  logo_path: string | null;
  hero_path: string | null;
  tone: Tone;
  side_games: SideGameCfg[];
  side_games_by: "player" | "team";
  teams: Team[];
  auto_bulletins: boolean;
  video_enabled: boolean;
  organiser_player_id: string | null;
  published: boolean;
  reel_music_path?: string | null;
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
  team_id: string | null;
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
  course_location: string | null;
  course_blurb: string | null;
  lat: number | null;
  lon: number | null;
  play_date: string | null;
  tee_time: string | null;
  tee: string | null;
  format: ScoringType;
  play: PlayType;
  nine_points: number;
  full_points: number;
  shots: Record<string, number>;
  holes: HoleRowData[];
  scorer_id: string | null;
  status: "upcoming" | "live" | "complete";
  games: Game[] | null;
  points_rule: PointsRule | null;
  handicap_rule: HandicapRule | null;
}

export interface HoleEntryRow {
  id: string;
  round_id: string;
  game: string;
  hole: number;
  scores: Record<string, BallHole>;
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
  player_ids?: string[];
  clip_start?: number | null;
  clip_end?: number | null;
}

export interface CommentRow {
  id: string;
  tournament_id: string;
  round_id: string | null;
  author_name: string;
  body: string;
  hidden?: boolean;
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

export interface VoteRow {
  id: string;
  tournament_id: string;
  award: string;
  post_id: string;
  voter: string;
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
  votes: VoteRow[];
}

// ------------------------------------------------------------ conversion to engine

export function roundGames(r: RoundRow, players: PlayerRow[]): Game[] {
  if (r.games && r.games.length) return r.games;
  // Legacy: one head-to-head (or field) game of everyone, singles
  return [
    {
      id: "main",
      sides: [...players].sort((a, b) => a.sort - b.sort).map((p) => ({ id: p.id, playerIds: [p.id], teamId: p.team_id })),
      scorerId: r.scorer_id,
    },
  ];
}

export function toRoundCfg(r: RoundRow, players: PlayerRow[]): RoundCfg {
  return {
    id: r.id,
    number: r.number,
    name: r.course_name,
    holes: r.holes.map((h) => ({ number: h.number, par: h.par, si: h.si })),
    play: r.play ?? "singles",
    scoring: r.format,
    games: roundGames(r, players),
    points: r.points_rule ?? { front: r.nine_points, back: r.nine_points, full: r.full_points },
    handicap: r.handicap_rule ?? { mode: "manual", shots: r.shots ?? {} },
    closed: r.status === "complete",
  };
}

export function toTournamentCfg(s: Pick<TournamentState, "tournament" | "players" | "rounds">): TournamentCfg {
  const players = [...s.players].sort((a, b) => a.sort - b.sort);
  return {
    players: players.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, teamId: p.team_id })),
    teams: s.tournament.teams ?? [],
    rounds: [...s.rounds].sort((a, b) => a.number - b.number).map((r) => toRoundCfg(r, players)),
    sideGames: s.tournament.side_games ?? [],
    sideGamesBy: s.tournament.side_games_by ?? "player",
  };
}

export function toEntries(rows: HoleEntryRow[]): Record<string, HoleEntry[]> {
  const out: Record<string, HoleEntry[]> = {};
  for (const r of rows) {
    (out[r.round_id] ??= []).push({
      game: r.game ?? "main",
      hole: r.hole,
      scores: r.scores ?? {},
      ctpWinner: r.ctp_winner,
      ldWinner: r.ld_winner,
    });
  }
  return out;
}

// ------------------------------------------------------------ labels

export const SCORING_LABEL: Record<ScoringType, string> = {
  stableford: "Stableford",
  stroke: "Stroke play",
  match: "Match play",
  skins: "Skins",
};

export const PLAY_LABEL: Record<PlayType, string> = {
  singles: "Singles",
  fourball: "Fourball (better ball)",
  foursomes: "Foursomes (alternate shot)",
  greensomes: "Greensomes",
  scramble: "Scramble",
};

export function formatLabel(r: Pick<RoundRow, "play" | "format">) {
  const play = r.play ?? "singles";
  return play === "singles" ? SCORING_LABEL[r.format] : `${PLAY_LABEL[play].split(" (")[0]} ${SCORING_LABEL[r.format].toLowerCase()}`;
}

export const SIDE_GAME_LABEL = {
  ctp: "Closest to the pin",
  ld: "Long drive",
  gir: "Greens in regulation",
  birdies: "Birdies",
  eagles: "Eagles",
} as const;

/** Display name for a ball (player or side). */
export function ballName(ball: string, game: Game, players: PlayerRow[]): string {
  const side = game.sides.find((s) => s.id === ball);
  if (side) return side.name || side.playerIds.map((p) => players.find((x) => x.id === p)?.name ?? p).join(" & ");
  return players.find((p) => p.id === ball)?.name ?? ball;
}

export function sideLabel(sideId: string, game: Game, players: PlayerRow[]): string {
  const side = game.sides.find((s) => s.id === sideId);
  if (!side) return sideId;
  return side.name || side.playerIds.map((p) => players.find((x) => x.id === p)?.name ?? p).join(" & ");
}

export function isOneBall(play: PlayType) {
  return ONE_BALL.includes(play);
}

export { ballsOfGame };

export const AWARDS = [
  { id: "shot", label: "Shot of the trip" },
  { id: "blunder", label: "Blunder of the trip" },
] as const;

export const TONE_LABEL: Record<Tone, string> = {
  broadsheet: "Broadsheet: witty, warm, a bit of mischief",
  tabloid: "Tabloid: big headlines, puns, drama",
  commentator: "Commentator: breathless and theatrical",
  dry: "Club secretary: deadpan and precise",
};

export const THEMES: { id: ThemeId; name: string; note: string }[] = [
  { id: "clubhouse", name: "Clubhouse", note: "Deep green and white, manual scoreboard tiles" },
  { id: "links", name: "Links", note: "Navy and sand, a coastal links feel" },
  { id: "championship", name: "Championship", note: "Navy, red and white, big-event leaderboard" },
  { id: "teamcup", name: "Team Cup", note: "Two team colours face to face" },
  { id: "custom", name: "Custom", note: "Your own colours" },
];
