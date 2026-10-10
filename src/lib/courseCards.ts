/** Choices for the on-course cards (clip details and after-hole moments). Plain words, big buttons. */
import type { TournamentState } from "./types";
import { toRoundCfg } from "./types";

export const SHOTS = ["Tee shot", "Approach", "Chip", "Bunker shot", "Putt", "Recovery"] as const;

export const RESULTS: Record<string, string[]> = {
  "Tee shot": ["Great drive", "Fairway", "Rough", "Trees", "Water", "Out of bounds"],
  Approach: ["Holed", "Stiff", "On the green", "Just off", "Bunker", "Water"],
  Chip: ["Holed", "Stiff", "On the green", "Too strong", "Duffed", "Bunker"],
  "Bunker shot": ["Holed", "Stiff", "On the green", "Still in it", "Thinned it", "Over the green"],
  Putt: ["Holed", "Lip-out", "Just missed", "Short", "Long", "Three-putt"],
  Recovery: ["Great escape", "On the green", "Back in play", "Still in trouble", "Water", "Holed"],
};

export const CLUBS = ["Driver", "3 wood", "5 wood", "Hybrid", "4 iron", "5 iron", "6 iron", "7 iron", "8 iron", "9 iron", "PW", "GW", "SW", "LW", "Putter"];

/** Tags (used by the feed and the AI director) that follow from what was picked. */
export function resultTags(shot?: string, result?: string): string[] {
  const t: string[] = [];
  if (result === "Holed" && shot === "Chip") t.push("chip-in");
  if (result === "Holed" && shot === "Bunker shot") t.push("chip-in");
  if (result === "Holed" && shot === "Putt") t.push("long putt");
  if (result === "Lip-out") t.push("lip-out");
  if (result === "Just missed") t.push("near miss");
  if (result === "Three-putt") t.push("3-putt");
  if (result === "Water") t.push("water");
  if (result === "Bunker" || result === "Still in it" || shot === "Bunker shot") t.push("bunker");
  if (result === "Great drive") t.push("great drive");
  if (result === "Out of bounds") t.push("OB");
  if (result === "Great escape") t.push("great recovery");
  return [...new Set(t)].slice(0, 5);
}

/** After a hole: what the scorecard won't show. */
export const MOMENTS: { label: string; tag: string }[] = [
  { label: "Lip-out", tag: "lip-out" },
  { label: "Water", tag: "water" },
  { label: "Bunker", tag: "bunker" },
  { label: "Lost ball", tag: "lost ball" },
  { label: "Shank", tag: "shank" },
  { label: "Great recovery", tag: "great recovery" },
  { label: "Three-putt", tag: "3-putt" },
  { label: "Banter", tag: "banter" },
];

/** The players in the group being scored (the match on the scorer's card), else everyone in the round. */
export function groupPlayers(state: TournamentState, roundId: string, gameId?: string | null, playerId?: string | null) {
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return [];
  const cfg = toRoundCfg(round, state.players);
  const game = cfg.games.find((g) => g.id === gameId) ?? cfg.games.find((g) => playerId && g.sides.some((s) => s.playerIds.includes(playerId)));
  const ids = game ? game.sides.flatMap((s) => s.playerIds) : cfg.games.flatMap((g) => g.sides.flatMap((s) => s.playerIds));
  return [...new Set(ids)].map((id) => state.players.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
}
