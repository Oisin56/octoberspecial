import { toRoundCfg, type TournamentState } from "./types";

type Who = { role: "organiser" | "player" | "fan"; playerId?: string } | null;

/** The round being played now, if any */
export const liveRound = (s: Pick<TournamentState, "rounds"> | null) => s?.rounds.find((r) => r.status === "live") ?? null;

/** Does this person enter the scores for a match in the live round? */
export function scoresToday(s: Pick<TournamentState, "rounds" | "players"> | null, who: Who): boolean {
  const live = liveRound(s);
  if (!live || !s || !who) return false;
  return toRoundCfg(live, s.players).games.some((g) => (!!who.playerId && g.scorerId === who.playerId) || (who.role === "organiser" && !g.scorerId));
}

/**
 * Where each person lands when they open the tournament (the home-screen app, a player link, after logging in):
 *   organiser  their organiser home, or the scorecard if they're scoring a live round
 *   player     the scorecard (theirs, or the live card) during a round, else the tournament home
 *   fan        the live page during a round, else the leaderboard
 */
export function landingPath(s: Pick<TournamentState, "rounds" | "players"> | null, who: Who): string {
  const live = !!liveRound(s);
  if (who?.role === "organiser") return live && scoresToday(s, who) ? "/score" : "/admin";
  if (who?.role === "player") return live ? "/score" : "/";
  return live ? "/live" : "/leaderboard";
}
