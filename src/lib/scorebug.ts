/**
 * The TV-style score graphic shown on highlight clips. Pure: used by the review screen (browser) and the
 * renderer (server), so what you check on screen is exactly what goes into the film. Every number comes
 * from the scoring engine, as things stood when the clip was filmed.
 *
 *   match play   a match bar: OISIN | 2 UP | NEIL, thru 11 (the clip's own match)
 *   stroke play, stableford, skins
 *                a mini leaderboard for the round across every group: the top 5, with the player on camera
 *                highlighted, or added as a sixth row under a divider when he's outside the top 5
 *
 * The clip's own match must have every earlier hole entered, or only the hole details are shown. Other groups
 * count with what they had entered by the moment the clip was posted.
 */
import { ballsOfSide, gameShots, tournamentSummary, type Game, type ScoringType } from "./engine";
import { roundBoard } from "./live";
import { gameHole, holeShots } from "./engine";
import { toEntries, toRoundCfg, toTournamentCfg, type HoleEntryRow, type TournamentState } from "./types";

export interface BugRow {
  pos: string;
  name: string;
  /** "−3", "18 pts", "2 skins" */
  value: string;
  thru: number;
  /** Every hole of the round played (shown as F) */
  finished?: boolean;
  /** In the clip */
  onCamera: boolean;
  lead: boolean;
  /** Shown under a divider (outside the top 5) */
  gap?: boolean;
  /** Handicap shots received on this hole */
  dots: number;
}

export interface ScoreBug {
  round: number;
  course: string;
  hole: number;
  par: number;
  yards: number | null;
  /** "none" = earlier holes not all entered: show hole details only */
  mode: "match" | "field" | "none";
  scoring: ScoringType;
  /** Holes completed in the clip's match at this moment */
  thru: number;
  match?: {
    sides: { name: string; color: string | null; lead: boolean; dots: number }[];
    /** "2 UP", "AS", "4&3" */
    big: string;
    /** "thru 11", "Dormie, thru 15", "Won", "Halved" */
    small: string;
  };
  rows: BugRow[];
  /** Short state line, e.g. "ALL SQUARE", "DORMIE", "MATCH WON 4&3" */
  status?: string;
  /** After the hole only: "BIRDIE", "EAGLE", "OISIN WINS THE HOLE"... */
  flash?: string;
}

type S = Pick<TournamentState, "tournament" | "players" | "rounds" | "entries">;

/** The game a clip belongs to: the one its tagged players are in, else the first. */
function pickGame(games: Game[], playerIds: string[]): Game | undefined {
  return games.find((g) => g.sides.some((s) => s.playerIds.some((p) => playerIds.includes(p)))) ?? games[0];
}

export function scoreBug(s: S, opts: { round: number; hole: number; after?: boolean; playerIds?: string[]; at?: string }): ScoreBug | null {
  const r = s.rounds.find((x) => x.number === opts.round);
  if (!r) return null;
  const h = r.holes.find((x) => x.number === opts.hole);
  if (!h) return null;
  const cfg = toRoundCfg(r, s.players);
  const players = toTournamentCfg(s as TournamentState).players;
  const pids = opts.playerIds ?? [];
  const game = pickGame(cfg.games, pids);
  const bug: ScoreBug = { round: r.number, course: r.course_name, hole: h.number, par: h.par, yards: h.yards ?? null, mode: "none", scoring: cfg.scoring, thru: 0, rows: [] };
  if (!game) return bug;

  const shots = gameShots(cfg, game, players);
  const all = toEntries(s.entries.filter((e) => e.round_id === r.id))[r.id] ?? [];
  const mine = all.filter((e) => e.game === game.id);
  // Only show a score when every earlier hole of the clip's match is in (otherwise it would be wrong)
  const earlier = r.holes.filter((x) => x.number < h.number).map((x) => x.number);
  const known = earlier.every((n) => {
    const e = mine.find((x) => x.hole === n);
    return e && gameHole(cfg, game, shots, e).complete;
  });
  const thisHole = mine.find((x) => x.hole === h.number);
  const thisDone = !!thisHole && gameHole(cfg, game, shots, thisHole).complete;
  if (!known || (opts.after && !thisDone)) return bug;

  // The round as it stood: the clip's match up to this hole; other groups as entered by then
  const asOf = (e: HoleEntryRow) =>
    (e.game ?? "main") === game.id ? (opts.after ? e.hole <= h.number : e.hole < h.number) : !opts.at || !e.updated_at || e.updated_at <= opts.at;
  const then = { ...(s as TournamentState), rounds: [r], entries: s.entries.filter((e) => e.round_id === r.id && asOf(e)), cards: [], signatures: [] } as TournamentState;
  const summary = tournamentSummary(toTournamentCfg(then), toEntries(then.entries));
  const board = roundBoard(then, summary, r);
  const dots = (sideId: string, g: Game = game) => {
    const side = g.sides.find((x) => x.id === sideId);
    if (!side) return 0;
    const sh = gameShots(cfg, g, players);
    return Math.max(0, ...ballsOfSide(side, cfg.play).map((b) => holeShots(cfg, sh[b] ?? 0, h.number)));
  };

  if (board.kind === "match") {
    const m = board.matches.find((x) => x.gameId === game.id);
    if (!m) return bug;
    bug.mode = "match";
    bug.thru = m.thru;
    bug.match = {
      sides: m.sides.map((sd) => ({ name: sd.name, color: sd.color, lead: m.leader === sd.id, dots: dots(sd.id) })),
      big: m.big,
      small: m.small,
    };
    if (!m.leader) bug.status = m.thru === cfg.holes.length ? "HALVED" : "ALL SQUARE";
    else if (m.big.includes("&")) bug.status = `MATCH WON ${m.big}`;
    else if (m.over) bug.status = `WON ${m.big}`;
    else if (m.small.startsWith("Dormie")) bug.status = "DORMIE";
  } else {
    const rows = board.field.filter((x) => x.thru > 0);
    if (!rows.length) return bug;
    bug.mode = "field";
    bug.thru = mine.filter((e) => (opts.after ? e.hole <= h.number : e.hole < h.number)).length;
    const gameOf = (sideId: string) => cfg.games.find((g) => g.sides.some((x) => x.id === sideId));
    const row = (x: (typeof rows)[number], gap = false): BugRow => ({
      pos: x.pos,
      name: x.name,
      value: x.score,
      thru: x.thru,
      finished: x.thru >= cfg.holes.length,
      onCamera: x.playerIds.some((p) => pids.includes(p)),
      lead: x.pos === "1" || x.pos === "T1",
      gap,
      dots: dots(x.sideId, gameOf(x.sideId)),
    });
    const top = rows.slice(0, 5).map((x) => row(x));
    const onCam = rows.slice(5).find((x) => x.playerIds.some((p) => pids.includes(p)));
    bug.rows = onCam ? [...top, row(onCam, true)] : top;
    if (cfg.scoring === "skins") {
      const gs = summary.rounds[0]?.games[cfg.games.indexOf(game)];
      if (gs?.full.carry) bug.status = `${gs.full.carry} CARRIED`;
    }
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
      const w = gameHole(cfg, game, shots, thisHole).winner;
      const side = game.sides.find((sd) => sd.id === w);
      if (side && sides.some((sd) => sd.id === w)) bug.flash = `${(bug.match?.sides[game.sides.indexOf(side)]?.name ?? "").toUpperCase()} WINS THE HOLE`;
    }
  }
  return bug;
}

/** Plain-text version for the review screen. */
export function bugText(b: ScoreBug | null): string {
  if (!b) return "No round or hole set";
  const head = `R${b.round} · Hole ${b.hole} · Par ${b.par}${b.yards ? ` · ${b.yards} yds` : ""}`;
  if (b.mode === "none") return `${head} (no score shown: earlier holes not all entered)`;
  if (b.mode === "match" && b.match) {
    const [a, c] = b.match.sides;
    return [head, `${a.name} | ${b.match.big} | ${c.name} · ${b.match.small}${b.status ? ` · ${b.status}` : ""}`, b.flash ? `Flash: ${b.flash}` : ""].filter(Boolean).join("\n");
  }
  const rows = b.rows.map((r) => `${r.gap ? "… " : ""}${r.pos} ${r.name}${r.onCamera ? " (on camera)" : ""} ${r.value} thru ${r.thru}`).join(", ");
  return [head, rows, b.flash ? `Flash: ${b.flash}` : ""].filter(Boolean).join("\n");
}
