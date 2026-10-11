/**
 * A match's card, from first hole to final result. Pure: used on the phone and the server.
 *
 *   open       scores still going in
 *   finished   every hole needed is in (or the match is decided): the result is provisional
 *   submitted  the scorer has handed the card in and it's waiting for the players to sign it
 *   final      locked: only the organiser can change it (every change is logged)
 *
 * A round whose status is "complete" with no card record (rounds from before cards existed,
 * or closed by the organiser) counts as final.
 */
import { gameSummary, type Game } from "./engine";
import { toEntries, toRoundCfg, toTournamentCfg, type CardRow, type TournamentState } from "./types";

export type CardStage = "open" | "finished" | "submitted" | "final";

export interface CardInfo {
  stage: CardStage;
  card: CardRow | null;
  /** Players who must sign (everyone in the match) */
  players: string[];
  /** Of those, who has signed */
  signed: string[];
  /** Signing is required before the card is final */
  needsSignatures: boolean;
  amended: boolean;
  flag: { by: string; note: string } | null;
}

type S = Pick<TournamentState, "tournament" | "players" | "rounds" | "entries"> & Partial<Pick<TournamentState, "cards" | "signatures">>;

export function gameComplete(s: S, roundId: string, game: Game): boolean {
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return false;
  const cfg = toRoundCfg(round, s.players);
  const entries = toEntries(s.entries.filter((e) => e.round_id === roundId))[roundId] ?? [];
  return gameSummary(cfg, game, toTournamentCfg(s as TournamentState).players, entries).complete;
}

export function cardInfo(s: S, roundId: string, gameId: string): CardInfo {
  const round = s.rounds.find((r) => r.id === roundId);
  const cfg = round ? toRoundCfg(round, s.players) : null;
  const game = cfg?.games.find((g) => g.id === gameId);
  const players = game ? [...new Set(game.sides.flatMap((sd) => sd.playerIds))] : [];
  const card = (s.cards ?? []).find((c) => c.round_id === roundId && c.game === gameId) ?? null;
  const signed = (s.signatures ?? []).filter((x) => x.round_id === roundId && x.game === gameId && players.includes(x.player_id)).map((x) => x.player_id);
  const base = {
    card,
    players,
    signed,
    needsSignatures: !!s.tournament.require_attestation,
    amended: !!card?.amended,
    flag: card?.flag_by ? { by: card.flag_by, note: card.flag_note ?? "" } : null,
  };
  if (card?.status === "final" || (!card && round?.status === "complete")) return { ...base, stage: "final" };
  if (card?.status === "submitted") return { ...base, stage: "submitted" };
  return { ...base, stage: game && gameComplete(s, roundId, game) ? "finished" : "open" };
}

/** The whole round: final once every card is final; provisional once every card is at least finished. */
export function roundStage(s: S, roundId: string): CardStage {
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) return "open";
  if (round.status === "complete") return "final";
  const cfg = toRoundCfg(round, s.players);
  if (!cfg.games.length) return "open";
  const stages = cfg.games.map((g) => cardInfo(s, roundId, g.id).stage);
  if (stages.every((x) => x === "final")) return "final";
  if (stages.every((x) => x !== "open")) return "finished";
  return "open";
}

/** Short label for the card's state, for badges. */
export function cardLabel(i: CardInfo, names: Record<string, string>): string {
  const who = (ids: string[]) => ids.map((id) => names[id] ?? id).join(" and ");
  if (i.stage === "final") {
    const byOrg = !!i.card?.finalised_by?.endsWith("(organiser)") && i.signed.length < i.players.length;
    const sig = byOrg ? ", made final by the organiser" : i.signed.length ? `, signed by ${who(i.signed)}` : "";
    return `Final${sig}${i.amended ? ". Amended by the organiser" : ""}`;
  }
  if (i.stage === "submitted") {
    const waiting = i.players.filter((p) => !i.signed.includes(p));
    return i.flag ? `${i.flag.by} says something's not right` : `Waiting for ${who(waiting)} to sign`;
  }
  if (i.stage === "finished") return "Provisional: the card hasn't been submitted yet";
  return "Live";
}
