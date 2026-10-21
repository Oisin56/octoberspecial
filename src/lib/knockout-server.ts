import "server-only";
import { adminClient } from "./admin";
import { loadServerState } from "./server-data";
import { knockoutGames } from "./engine";
import { toEntries, toTournamentCfg } from "./types";
import { teeTimeAt } from "./wizard";

/**
 * A knockout fills itself in: once a match is decided its winner goes into the next round's match, and the
 * players already out are put in groups to play for the prizes. Run after scores are saved; changes nothing
 * when nothing has moved on.
 */
export async function syncKnockout(tournamentId: string): Promise<void> {
  const s = await loadServerState(tournamentId);
  const win = s.tournament.win;
  if (win?.kind !== "knockout") return;
  const cfg = toTournamentCfg(s);
  const games = knockoutGames(cfg, toEntries(s.entries), win.knockout);
  const db = adminClient();
  for (const r of s.rounds) {
    const next = games[r.id];
    if (!next) continue;
    // Keep the tee times already set; new games get the next free ones
    const old = r.games ?? [];
    let slot = old.length;
    const withTimes = next.map((g) => {
      const was = old.find((o) => o.id === g.id);
      return { ...g, teeTime: was?.teeTime ?? teeTimeAt(r.tee_time, Math.floor(slot++ / (win.knockout.pairs ? 1 : 2))) };
    });
    const same = (a: { id: string; sides: { playerIds: string[] }[]; free?: boolean }[]) => JSON.stringify(a.map((g) => [g.id, g.sides.map((x) => x.playerIds), !!g.free]));
    if (same(withTimes) !== same(old)) await db.from("rounds").update({ games: withTimes, scorer_id: withTimes[0]?.scorerId ?? null }).eq("id", r.id);
  }
}
