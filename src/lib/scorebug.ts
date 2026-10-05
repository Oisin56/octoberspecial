/**
 * The TV-style score panel ("score bug") shown in the corner of highlight clips.
 * Pure: used by the review screen (browser) and the renderer (server), so what
 * you check on screen is exactly what goes into the film. Every number comes
 * from the scoring engine, as of the moment the clip was filmed.
 */
import { ballsOfSide, gameHole, gameShots, gameSummary, sideName, tournamentSummary, type Game, type HoleEntry } from "./engine";
import { shotsOnHole } from "./scoring";
import { toEntries, toRoundCfg, toTournamentCfg, type TournamentState } from "./types";

export interface BugRow {
  name: string;
  value: string;
  /** Handicap shots received on this hole */
  dots: number;
  lead: boolean;
}

export interface ScoreBug {
  round: number;
  course: string;
  hole: number;
  par: number;
  yards: number | null;
  /** "none" = earlier holes not all entered: show hole details only */
  mode: "match" | "stroke" | "stableford" | "skins" | "none";
  /** Holes completed in the game at this moment */
  thru: number;
  rows: BugRow[];
  /** Short state line, e.g. "ALL SQUARE", "DORMIE", "MATCH WON 4&3" */
  status?: string;
  /** Overall tournament points, e.g. "Oisin 45 · Neil 35" */
  footer?: string;
  /** After the hole only: "BIRDIE", "EAGLE", "OISIN WINS THE HOLE"... */
  flash?: string;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n - Math.floor(n) - 0.5) < 1e-9 ? `${Math.floor(n)}½` : n.toFixed(1));
const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `−${-n}`);

/** The game a clip belongs to: the one its tagged players are in, else the first. */
function pickGame(games: Game[], playerIds: string[]): Game | undefined {
  return games.find((g) => g.sides.some((s) => s.playerIds.some((p) => playerIds.includes(p)))) ?? games[0];
}

export function scoreBug(
  s: Pick<TournamentState, "tournament" | "players" | "rounds" | "entries">,
  opts: { round: number; hole: number; after?: boolean; playerIds?: string[] },
): ScoreBug | null {
  const r = s.rounds.find((x) => x.number === opts.round);
  if (!r) return null;
  const h = r.holes.find((x) => x.number === opts.hole);
  if (!h) return null;
  const cfg = toRoundCfg(r, s.players);
  const players = toTournamentCfg(s).players;
  const pids = opts.playerIds ?? [];
  const game = pickGame(cfg.games, pids);
  const bug: ScoreBug = { round: r.number, course: r.course_name, hole: h.number, par: h.par, yards: h.yards ?? null, mode: "none", thru: 0, rows: [] };
  if (!game) return bug;

  const all = toEntries(s.entries);
  const mine = (all[r.id] ?? []).filter((e) => e.game === game.id);
  const upTo = mine.filter((e) => (opts.after ? e.hole <= h.number : e.hole < h.number));
  const shots = gameShots(cfg, game, players);
  const holeRes = (e: HoleEntry) => gameHole(cfg, game, shots, e);

  // Only show a score when every earlier hole is in (otherwise it would be wrong)
  const earlier = r.holes.filter((x) => x.number < h.number).map((x) => x.number);
  const known = earlier.every((n) => {
    const e = mine.find((x) => x.hole === n);
    return e && holeRes(e).complete;
  });
  const thisHole = mine.find((x) => x.hole === h.number);
  const thisDone = !!thisHole && holeRes(thisHole).complete;
  if (!known || (opts.after && !thisDone)) return bug;

  const gs = gameSummary(cfg, game, players, upTo);
  bug.thru = gs.full.holesPlayed;
  const dots = (sideId: string) => {
    const side = game.sides.find((x) => x.id === sideId)!;
    return Math.max(0, ...ballsOfSide(side, cfg.play).map((b) => shotsOnHole(shots[b] ?? 0, h.si)));
  };
  const name = (sideId: string) => sideName(game.sides.find((x) => x.id === sideId)!, players);

  if (cfg.scoring === "match" && game.sides.length === 2) {
    bug.mode = "match";
    const [a, b] = game.sides;
    const diff = (gs.full.value[a.id] ?? 0) - (gs.full.value[b.id] ?? 0);
    const remaining = 18 - bug.thru;
    const up = Math.abs(diff);
    const leader = diff > 0 ? a.id : diff < 0 ? b.id : null;
    const val = up > remaining ? `${up}&${remaining}` : `${up} UP`;
    bug.rows = game.sides.map((sd) => ({ name: name(sd.id), value: sd.id === leader ? val : "", dots: dots(sd.id), lead: sd.id === leader }));
    if (!leader) bug.status = remaining === 0 ? "HALVED" : "ALL SQUARE";
    else if (up > remaining) bug.status = `MATCH WON ${up}&${remaining}`;
    else if (remaining === 0) bug.status = `WON ${up} UP`;
    else if (up === remaining) bug.status = "DORMIE";
  } else if (cfg.scoring === "stroke") {
    bug.mode = "stroke";
    const rel: Record<string, number> = {};
    for (const sd of game.sides) rel[sd.id] = 0;
    for (const e of upTo) {
      const res = holeRes(e);
      if (!res.complete) continue;
      const par = r.holes.find((x) => x.number === e.hole)?.par ?? 0;
      for (const sd of game.sides) if (res.sides[sd.id]?.net != null) rel[sd.id] += res.sides[sd.id].net! - par;
    }
    const best = Math.min(...Object.values(rel));
    bug.rows = [...game.sides]
      .sort((x, y) => rel[x.id] - rel[y.id])
      .map((sd) => ({ name: name(sd.id), value: toPar(rel[sd.id]), dots: dots(sd.id), lead: bug.thru > 0 && rel[sd.id] === best }));
  } else {
    bug.mode = cfg.scoring === "skins" ? "skins" : "stableford";
    const v = gs.full.value;
    const best = Math.max(...game.sides.map((sd) => v[sd.id] ?? 0));
    bug.rows = [...game.sides]
      .sort((x, y) => (v[y.id] ?? 0) - (v[x.id] ?? 0))
      .map((sd) => ({ name: name(sd.id), value: `${fmt(v[sd.id] ?? 0)}${bug.mode === "stableford" ? " pts" : ""}`, dots: dots(sd.id), lead: bug.thru > 0 && (v[sd.id] ?? 0) === best }));
    if (bug.mode === "skins" && gs.full.carry) bug.status = `${gs.full.carry} CARRIED`;
  }
  bug.rows = bug.rows.slice(0, 4);

  // Overall points across the trip, as of this moment
  if (s.rounds.length > 1) {
    const tcfg = toTournamentCfg(s);
    const byRound: Record<string, HoleEntry[]> = {};
    for (const rr of s.rounds) {
      if (rr.number < r.number) byRound[rr.id] = all[rr.id] ?? [];
      else if (rr.id === r.id) byRound[rr.id] = (all[rr.id] ?? []).filter((e) => (opts.after ? e.hole <= h.number : e.hole < h.number));
    }
    // Banked points only: later rounds are empty here, so side-game awards wait for the end
    const t = tournamentSummary(tcfg, byRound);
    const parts = tcfg.teams.length >= 2 ? tcfg.teams.map((tm) => [tm.name, t.teamTotal[tm.id] ?? 0] as const) : tcfg.players.map((p) => [p.name, t.playerTotal[p.id] ?? 0] as const);
    bug.footer = [...parts]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([n, v]) => `${n} ${fmt(v)}`)
      .join(" · ");
  }

  // What happened on this hole (after it's finished)
  if (opts.after && thisHole) {
    const sides = game.sides.filter((sd) => !pids.length || sd.playerIds.some((p) => pids.includes(p)));
    let bestGross: number | null = null;
    for (const sd of sides)
      for (const b of ballsOfSide(sd, cfg.play)) {
        const g = thisHole.scores[b]?.gross;
        if (g != null && !thisHole.scores[b]?.pickedUp && (bestGross == null || g < bestGross)) bestGross = g;
      }
    if (bestGross != null) {
      const d = bestGross - h.par;
      if (bestGross === 1) bug.flash = "HOLE IN ONE";
      else if (d <= -3) bug.flash = "ALBATROSS";
      else if (d === -2) bug.flash = "EAGLE";
      else if (d === -1) bug.flash = "BIRDIE";
    }
    if (!bug.flash && bug.mode === "match") {
      const w = holeRes(thisHole).winner;
      if (w && w !== "halved" && sides.some((sd) => sd.id === w)) bug.flash = `${name(w).toUpperCase()} WINS THE HOLE`;
    }
  }
  return bug;
}

/** Plain-text version for the review screen. */
export function bugText(b: ScoreBug | null): string {
  if (!b) return "No round or hole set";
  const head = `R${b.round} · Hole ${b.hole} · Par ${b.par}${b.yards ? ` · ${b.yards} yds` : ""}`;
  if (b.mode === "none") return `${head} (no score shown: earlier holes not all entered)`;
  const rows = b.rows.map((r) => `${r.name}${r.dots ? " " + "•".repeat(r.dots) : ""} ${r.value}`.trim()).join(", ");
  return [head, `${rows}${b.status ? ` · ${b.status}` : ""} · thru ${b.thru}`, b.footer ? `Overall ${b.footer}` : "", b.flash ? `Flash: ${b.flash}` : ""].filter(Boolean).join("\n");
}
