import { tournamentSummary } from "./engine";
import { fmtPts, toPar } from "./live";
import { toEntries, toTournamentCfg, type TournamentState } from "./types";

/**
 * A round (or a trip) on your own: no leaderboard, just your score. Stableford shows points ("36 points"), stroke play
 * shows your strokes and where they leave you against par ("79, +7").
 */
export interface SoloRound {
  id: string;
  number: number;
  course: string;
  date: string | null;
  holes: number;
  played: number;
  kind: "stableford" | "stroke";
  /** "36 points" or "79, +7" (empty before a hole is in) */
  score: string;
  /** The big number: 36, or 79 */
  big: string;
  /** Under the big number: "points", or "+7" */
  small: string;
}

export function soloRounds(s: TournamentState): SoloRound[] {
  const cfg = toTournamentCfg(s);
  const sum = tournamentSummary(cfg, toEntries(s.entries));
  const kind: "stableford" | "stroke" = s.tournament.win?.kind === "stroke" || s.tournament.standings === "stroke" ? "stroke" : "stableford";
  const pid = s.players[0]?.id;
  const row = sum.totals?.rows.find((r) => r.playerId === pid);
  return [...s.rounds]
    .sort((a, b) => a.number - b.number)
    .map((r) => {
      const entries = s.entries.filter((e) => e.round_id === r.id);
      const mine = pid ? entries.map((e) => ({ hole: e.hole, sc: e.scores[pid] })).filter((x) => x.sc && (x.sc.gross != null || x.sc.pickedUp)) : [];
      const played = mine.length;
      let big = "";
      let small = "";
      if (played) {
        if (kind === "stroke") {
          const gross = mine.reduce((a, x) => a + (x.sc!.gross ?? 0), 0);
          const par = mine.filter((x) => x.sc!.gross != null).reduce((a, x) => a + (r.holes.find((h) => h.number === x.hole)?.par ?? 0), 0);
          big = String(gross);
          small = toPar(gross - par);
        } else {
          const pts = row?.rounds[r.id]?.value ?? sum.rounds[s.rounds.indexOf(r)]?.playerPoints[pid!] ?? 0;
          big = fmtPts(pts);
          small = pts === 1 ? "point" : "points";
        }
      }
      return {
        id: r.id,
        number: r.number,
        course: r.course_name,
        date: r.play_date,
        holes: r.holes.length,
        played,
        kind,
        big,
        small,
        score: !played ? "" : kind === "stroke" ? `${big}, ${small}` : `${big} ${small}`,
      };
    });
}

/** The whole trip's score, for a trip of several rounds */
export function soloTotal(rounds: SoloRound[]): string {
  const done = rounds.filter((r) => r.played);
  if (done.length < 2) return "";
  if (done[0].kind === "stroke") return `${done.reduce((a, r) => a + Number(r.big), 0)} strokes`;
  const pts = done.reduce((a, r) => a + Number(r.big.replace("½", ".5")), 0);
  return `${fmtPts(pts)} points`;
}
