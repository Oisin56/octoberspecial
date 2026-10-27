import { winBoard } from "./boards";
import { fmtPts, totalsView } from "./live";
import type { TournamentCfg, TournamentSummary } from "./engine";
import type { PostRow, TournamentState } from "./types";

/**
 * The trip page: how it finished, for any way of winning. Rows in finishing order, the winner (when there's exactly
 * one), and the moments people liked most.
 */
export interface FinalRow {
  key: string;
  pos: string;
  name: string;
  score: string;
  /** The players behind a team's name */
  playerIds: string[];
  team: boolean;
}

export interface Final {
  rows: FinalRow[];
  /** One winner (a player or a team), or none (tied at the top, or nothing played) */
  winner: FinalRow | null;
}

const ranked = <T,>(items: T[], value: (x: T) => number, higherBetter = true) => {
  const sorted = [...items].sort((a, b) => (higherBetter ? value(b) - value(a) : value(a) - value(b)));
  return sorted.map((x) => {
    const pos = sorted.findIndex((y) => value(y) === value(x)) + 1;
    const tied = sorted.filter((y) => value(y) === value(x)).length > 1;
    return { x, pos: `${tied ? "T" : ""}${pos}` };
  });
};

export function finalStandings(s: TournamentState, summary: TournamentSummary, cfg: TournamentCfg): Final {
  const teamPlayers = (teamId: string) => s.players.filter((p) => p.team_id === teamId).map((p) => p.id);
  let rows: FinalRow[] = [];
  const wb = winBoard(s, summary, cfg);
  if (wb?.kind === "knockout") {
    const champ = wb.champion;
    const p = champ ? s.players.find((x) => x.name === champ) : null;
    const w = champ ? { key: "champ", pos: "1", name: champ, score: "Won the knockout", playerIds: p ? [p.id] : [], team: false } : null;
    return { rows: w ? [w] : [], winner: w };
  }
  if (wb?.kind === "teams") {
    rows = wb.rows.filter((r) => r.started).map((r) => ({ key: r.id, pos: r.pos, name: r.name, score: r.score, playerIds: teamPlayers(r.id), team: true }));
  } else if (wb?.kind === "skins") {
    rows = wb.rows.map((r) => ({ key: r.id, pos: r.pos, name: r.name, score: `${fmtPts(r.skins)} skin${r.skins === 1 ? "" : "s"}`, playerIds: [r.id], team: false }));
  } else {
    const totals = totalsView(s, summary);
    if (totals) {
      rows = totals.rows.filter((r) => r.score !== "–").map((r) => ({ key: r.id, pos: r.pos, name: r.name, score: r.score, playerIds: [r.id], team: false }));
    } else if (cfg.teams.length >= 2) {
      rows = ranked(cfg.teams, (t) => summary.teamTotal[t.id] ?? 0).map(({ x, pos }) => ({
        key: x.id,
        pos,
        name: x.name,
        score: `${fmtPts(summary.teamTotal[x.id] ?? 0)} pts`,
        playerIds: teamPlayers(x.id),
        team: true,
      }));
    } else {
      rows = ranked(cfg.players, (p) => summary.playerTotal[p.id] ?? 0).map(({ x, pos }) => ({
        key: x.id,
        pos,
        name: x.name,
        score: `${fmtPts(summary.playerTotal[x.id] ?? 0)} pts`,
        playerIds: [x.id],
        team: false,
      }));
      if (rows.every((r) => r.score === "0 pts")) rows = [];
    }
  }
  const top = rows.filter((r) => r.pos === "1");
  return { rows, winner: top.length === 1 ? top[0] : null };
}

/** The film: the newest one the AI director made */
export const filmPost = (s: TournamentState): PostRow | null =>
  s.posts.filter((p) => p.author_name === "AI director" && p.kind === "video" && !p.hidden).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

/** The most liked photos and clips from the feed (not the film), most liked first, newest breaking ties */
export function bestMoments(s: TournamentState, n = 6): PostRow[] {
  const likes = new Map<string, number>();
  for (const l of s.likes ?? []) likes.set(l.post_id, (likes.get(l.post_id) ?? 0) + 1);
  return s.posts
    .filter((p) => !p.hidden && p.visibility !== "report" && (p.kind === "photo" || p.kind === "video") && p.media_path && p.author_name !== "AI director")
    .sort((a, b) => (likes.get(b.id) ?? 0) - (likes.get(a.id) ?? 0) || b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}
