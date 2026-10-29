import { toRoundCfg, type TournamentState } from "./types";
import { oneScorer } from "./scoring-access";

type Who = { role: "organiser" | "player" | "fan"; playerId?: string } | null;

/** The round being played now, if any */
export const liveRound = (s: Pick<TournamentState, "rounds"> | null) => s?.rounds.find((r) => r.status === "live") ?? null;

/** Does this person enter the scores for a group in the live round? (Anyone in a group does, unless One scorer per group is on.) */
export function scoresToday(s: (Pick<TournamentState, "rounds" | "players"> & { tournament?: TournamentState["tournament"] }) | null, who: Who): boolean {
  const live = liveRound(s);
  if (!live || !s || !who) return false;
  const games = toRoundCfg(live, s.players).games;
  if (oneScorer(s.tournament, live)) return games.some((g) => (!!who.playerId && g.scorerId === who.playerId) || (who.role === "organiser" && !g.scorerId));
  return games.some((g) => !!who.playerId && g.sides.some((sd) => sd.playerIds.includes(who.playerId!)));
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
