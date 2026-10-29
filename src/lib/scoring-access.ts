/**
 * Who can enter a group's scores. Anyone in the group, so one scorer, everyone doing their own, or markers all
 * just work. The organiser can in their own group, and in a group set to "organiser only"; any other group's score
 * they change from Admin, as a logged correction. With "One scorer per group" switched on (or a round that was
 * being played when this went live), only the named scorer can, as before.
 */
import type { Game } from "./engine";
import type { RoundRow, TournamentRow } from "./types";

export interface Who {
  playerId?: string | null;
  role?: string | null;
}

/** Only the named scorer in each group enters its scores. */
export function oneScorer(t: Pick<TournamentRow, "one_scorer"> | null | undefined, round: Pick<RoundRow, "keep_scorer"> | null | undefined) {
  return !!t?.one_scorer || !!round?.keep_scorer;
}

const inGame = (g: Game, pid: string | null | undefined) => !!pid && g.sides.some((s) => s.playerIds.includes(pid));

/** This person may enter this group's scores. */
export function mayScore(t: Pick<TournamentRow, "one_scorer"> | null | undefined, round: Pick<RoundRow, "keep_scorer"> | null | undefined, g: Game, who: Who | null | undefined) {
  if (!who) return false;
  const org = who.role === "organiser";
  if (oneScorer(t, round)) return (!!who.playerId && g.scorerId === who.playerId) || (org && !g.scorerId);
  return inGame(g, who.playerId) || (org && !g.scorerId);
}

/**
 * The groups this person enters scores for, in the order to offer them. A player: their own group. The organiser:
 * their own group if they're playing (and any set to "organiser only").
 */
export function scoringGames(t: Pick<TournamentRow, "one_scorer"> | null | undefined, round: Pick<RoundRow, "keep_scorer"> | null | undefined, games: Game[], who: Who | null | undefined): Game[] {
  if (!who) return [];
  const mine = games.filter((g) => mayScore(t, round, g, who));
  if (who.role === "organiser" && !oneScorer(t, round)) {
    const own = mine.filter((g) => inGame(g, who.playerId));
    if (own.length) return own;
  }
  return mine;
}

/** Anyone in this player's group (or the organiser) may tell this player's shots. */
export function mayTellShots(games: Game[], who: Who | null | undefined, playerId: string) {
  if (!who) return false;
  if (who.role === "organiser") return true;
  if (!who.playerId) return false;
  if (who.playerId === playerId) return true;
  return games.some((g) => inGame(g, playerId) && inGame(g, who.playerId));
}
