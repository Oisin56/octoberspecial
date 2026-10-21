/**
 * What the boards show for the ways to win that aren't a points table or a running total: team score, Texas
 * scramble, most skins and the knockout draw; and the prizes beside them. Plain data for the pages to draw.
 */
import { stageName, type KoMatch, type PrizeResult, type TournamentCfg, type TournamentSummary } from "./engine";
import type { TournamentState } from "./types";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n - Math.floor(n) - 0.5) < 1e-9 ? `${Math.floor(n) || ""}½` : n.toFixed(1));
export const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `−${-n}`);
const ordinal = (pos: number, tied: boolean) => (pos ? `${tied ? "T" : ""}${pos}` : "");

export interface TeamBoardRow {
  id: string;
  name: string;
  color: string;
  pos: string;
  value: number;
  /** "42 pts", "−3", "–" (not started) */
  score: string;
  started: boolean;
  /** Round by round: "36", "−2", "" (not played) */
  perRound: string[];
}

export interface SkinsBoardRow {
  id: string;
  name: string;
  pos: string;
  skins: number;
  perRound: string[];
}

export interface KoSideView {
  name: string;
  /** Not known yet (waiting on a match), or a bye */
  empty: "tbd" | "bye" | null;
  won: boolean;
}
export interface KoMatchView {
  a: KoSideView;
  b: KoSideView;
  /** "Neil won 3&2", "Neil 2 UP thru 12", "Not started", "Bye" */
  label: string;
  live: boolean;
  done: boolean;
}
export interface KoStageView {
  name: string;
  matches: KoMatchView[];
}

export type WinBoard =
  | { kind: "teams"; title: string; note: string; unit: "pts" | "toPar"; rows: TeamBoardRow[] }
  | { kind: "skins"; title: string; note: string; rows: SkinsBoardRow[]; carrying: string | null }
  | { kind: "knockout"; title: string; current: number; stages: KoStageView[]; champion: string | null; out: { name: string; stage: string }[] };

const sorted = (s: TournamentState) => [...s.rounds].sort((a, b) => a.number - b.number);

/** The board for team score, Texas scramble, skins and knockouts; null for the others (points and totals). */
export function winBoard(s: TournamentState, summary: TournamentSummary, cfg: TournamentCfg): WinBoard | null {
  const win = summary.win;
  const rounds = sorted(s);
  const player = (id: string) => cfg.players.find((p) => p.id === id)?.name ?? "";

  if ((win.kind === "teamscore" || win.kind === "scramble") && summary.teamRows) {
    const stroke = win.kind === "scramble";
    const rows: TeamBoardRow[] = summary.teamRows
      .map((r) => {
        const i = cfg.teams.findIndex((t) => t.id === r.teamId);
        const team = cfg.teams[i];
        return {
          id: r.teamId,
          name: team?.name ?? "",
          color: team?.color || `var(--team-${i})`,
          pos: r.holes ? ordinal(r.pos, r.tied) : "",
          value: r.value,
          score: !r.holes ? "–" : stroke ? toPar(r.value) : `${fmt(r.value)} pts`,
          started: r.holes > 0,
          perRound: rounds.map((rd) => (rd.id in r.rounds ? (stroke ? toPar(r.rounds[rd.id]) : fmt(r.rounds[rd.id])) : "")),
        };
      })
      .sort((a, b) => Number(b.started) - Number(a.started) || (stroke ? a.value - b.value : b.value - a.value));
    const count = win.kind === "teamscore" ? win.count : 0;
    return {
      kind: "teams",
      title: stroke ? "Texas scramble" : "Team score",
      unit: stroke ? "toPar" : "pts",
      note: stroke ? "Each team's net score to par, added up over every round." : count ? `The best ${count} Stableford score${count === 1 ? "" : "s"} on each hole count for the team.` : "Every Stableford score counts for the team.",
      rows,
    };
  }

  if (win.kind === "skins" && summary.skins) {
    const t = summary.skins;
    const rows = t.rows
      .map((r) => ({ id: r.playerId, name: player(r.playerId), pos: r.skins ? ordinal(r.pos, r.tied) : "", skins: r.skins, perRound: rounds.map((rd) => (rd.id in r.rounds ? fmt(r.rounds[rd.id]) : "")) }))
      .sort((a, b) => b.skins - a.skins);
    // Skins riding on the next hole, in the round being played
    const live = rounds.find((r) => r.status === "live");
    let carrying: string | null = null;
    const n = live ? (t.carrying[live.id] ?? 0) : 0;
    if (live && n > 0) {
      const next = (t.holes[live.id] ?? []).find((h) => !h.decided);
      carrying = `${fmt(n)} skin${n === 1 ? "" : "s"} carried${next ? ` to the ${ordinalHole(next.hole)}` : ""}`;
    }
    return { kind: "skins", title: "Most skins", note: win.carry ? "A tied hole's skin carries to the next." : "A tied hole wins nobody a skin.", rows, carrying };
  }

  if (win.kind === "knockout" && summary.knockout) {
    const ko = summary.knockout;
    const entrant = (id: string | null) => {
      const e = win.knockout.entrants.find((x) => x.id === id);
      return e ? e.playerIds.map(player).join(" & ") : "";
    };
    const total = ko.stages.length;
    const stages: KoStageView[] = ko.stages.map((matches, si) => ({
      name: stageName(si, total),
      matches: matches.map((m) => matchView(m, si, entrant, rounds[si]?.status === "live")),
    }));
    // The stage being played now (or next): the first with a match still to finish
    let current = ko.stages.findIndex((ms) => ms.some((m) => !m.winner));
    if (current < 0) current = total - 1;
    const out = Object.entries(ko.out)
      .sort((a, b) => b[1] - a[1])
      .map(([pid, st]) => ({ name: player(pid), stage: stageName(st, total) }));
    return { kind: "knockout", title: ko.champion ? "Champion" : "The draw", current, stages, champion: ko.champion ? entrant(ko.champion) : null, out };
  }
  return null;
}

function matchView(m: KoMatch, stage: number, entrant: (id: string | null) => string, roundLive: boolean): KoMatchView {
  const side = (id: string | null): KoSideView => ({ name: id ? entrant(id) : stage === 0 ? "Bye" : "To be decided", empty: id ? null : stage === 0 ? "bye" : "tbd", won: !!id && m.winner === id });
  const done = !!m.winner;
  const started = !!m.label && m.label !== "Not started" && !/ v /.test(m.label);
  return {
    a: side(m.a),
    b: side(m.b),
    label: m.how === "bye" ? "Bye" : (done || started ? m.label : m.a && m.b ? "Not started" : "").replace(/ UP\b/, " up"),
    live: roundLive && started && !done,
    done,
  };
}

const ordinalHole = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// ------------------------------------------------------------ prizes

export const PRIZE_NAME: Record<PrizeResult["kind"], string> = {
  ctp: "Closest the pin",
  ld: "Long drive",
  nines: "Front 9 and back 9",
  birdies: "Most birdies",
  gir: "Most greens in regulation",
  skins: "Skins",
  bestround: "Best round",
};

export interface PrizeLine {
  key: string;
  /** "Closest the pin", "Front 9, round 2" */
  title: string;
  /** "Neil 2, Oisin 1", "Declan, 19 pts" */
  detail: string;
  /** "Leads", "Won", "Shared", "Nobody yet" */
  status: string;
  won: boolean;
  /** Points race: "+2 points" for the winner */
  points: string | null;
}

/** One line per prize (whole-trip prizes first, then round by round). */
export function prizeLines(s: TournamentState, summary: TournamentSummary, cfg: TournamentCfg): PrizeLine[] {
  const rounds = sorted(s);
  const player = (id: string) => cfg.players.find((p) => p.id === id)?.name ?? "";
  const stroke = summary.win.kind === "stroke";
  const prizeOf = (kind: PrizeResult["kind"]) => (cfg.prizes ?? []).find((p) => p.kind === kind);
  const lines = summary.prizes.map((r, i): PrizeLine & { order: number } => {
    const rn = r.roundId ? rounds.findIndex((x) => x.id === r.roundId) + 1 : 0;
    const base = r.kind === "nines" ? (r.nine === "front" ? "Front 9" : "Back 9") : PRIZE_NAME[r.kind];
    const title = rn && (rounds.length > 1 || r.kind === "nines") ? `${base}, round ${rn}` : base;
    const ids = Object.keys(r.value).filter((id) => r.lowerBetter || r.value[id] > 0);
    const counts = r.kind === "ctp" || r.kind === "ld" || r.kind === "birdies" || r.kind === "gir" || r.kind === "skins";
    let detail: string;
    if (!r.leaders.length) detail = "";
    else if (counts)
      detail = [...ids]
        .sort((a, b) => r.value[b] - r.value[a])
        .slice(0, 3)
        .map((id) => `${player(id)} ${fmt(r.value[id])}`)
        .join(", ");
    else {
      const v = r.value[r.leaders[0]];
      detail = `${r.leaders.map(player).join(" and ")}, ${r.lowerBetter || stroke ? toPar(v) : `${fmt(v)} pts`}`;
    }
    const status = !r.leaders.length ? "Nobody yet" : r.decided ? (r.leaders.length > 1 ? "Shared" : "Won") : r.leaders.length > 1 ? "Level" : "Leads";
    const p = prizeOf(r.kind)?.points;
    const share = p && r.leaders.length ? p / r.leaders.length : 0;
    return { key: `${r.kind}-${r.roundId ?? "trip"}-${r.nine ?? ""}-${i}`, title, detail, status, won: r.decided && r.leaders.length > 0, points: share ? `+${fmt(share)} point${share === 1 ? "" : "s"}` : null, order: rn * 10 + i / 100 };
  });
  return lines.sort((a, b) => a.order - b.order).map(({ order, ...l }) => (void order, l));
}
