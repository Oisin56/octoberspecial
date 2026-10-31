/**
 * The scores, at each level, as the site shows them:
 *   - today's round: each match's state, or a leaderboard across every group
 *   - the tournament: points banked (final cards) and projected (Ryder Cup style: as things stand now)
 * Pure: derived from the scoring engine and the cards.
 */
import { acrossField, gameHole, gameShots, openBonusWords, positionPoints, sideName, type BonusKind, type Game, type GameSummary, type RoundCfg, type SegmentResult, type TournamentCfg, type TournamentSummary } from "./engine";
import { cardInfo, type CardStage } from "./scorecards";
import { toEntries, toRoundCfg, toTournamentCfg, type RoundRow, type TournamentState } from "./types";

export const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n - Math.floor(n) - 0.5) < 1e-9 ? `${Math.floor(n)}½` : n.toFixed(1));
export const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `−${-n}`);

/** The round being followed now: the live one, else none. */
export function liveRound(s: TournamentState): RoundRow | null {
  return s.rounds.find((r) => r.status === "live") ?? null;
}

export interface MatchState {
  gameId: string;
  name: string;
  /** Left and right sides, with team colours where there are teams */
  sides: { id: string; name: string; color: string | null; teamId: string | null }[];
  /** Leading side (null = all square / not started) */
  leader: string | null;
  /** "2 UP", "AS", "4&3", "1 UP" (won) */
  big: string;
  /** "thru 11", "Dormie", "Won 4&3", "Halved", "Not started" */
  small: string;
  thru: number;
  started: boolean;
  over: boolean;
  stage: CardStage;
}

export interface FieldRow {
  sideId: string;
  name: string;
  playerIds: string[];
  pos: string;
  /** "−3", "18 pts", "2 skins" */
  score: string;
  thru: number;
  value: number;
}

export interface RoundBoard {
  round: RoundRow;
  cfg: RoundCfg;
  kind: "match" | "field";
  matches: MatchState[];
  field: FieldRow[];
  /** Team sessions: this round's points per team, as things stand (Ryder Cup style) */
  session: { teamId: string; name: string; color: string; pts: number }[] | null;
  /** Every card at least finished / every card final */
  stage: CardStage;
}

const teamColor = (s: TournamentState, teamId: string | null | undefined) => {
  const i = (s.tournament.teams ?? []).findIndex((t) => t.id === teamId);
  return i < 0 ? null : (s.tournament.teams[i].color || (i === 0 ? "#c8102e" : "#1d4f91"));
};

function matchState(s: TournamentState, round: RoundRow, cfg: RoundCfg, g: Game, gs: GameSummary, gi: number): MatchState {
  const players = toTournamentCfg(s).players;
  const sides = g.sides.map((sd) => {
    const teamId = sd.teamId ?? s.players.find((p) => p.id === sd.playerIds[0])?.team_id ?? null;
    return { id: sd.id, name: sideName(sd, players), color: teamColor(s, teamId), teamId };
  });
  const f = gs.full;
  const [a, b] = g.sides;
  const diff = (f.value[a.id] ?? 0) - (f.value[b.id] ?? 0);
  const up = Math.abs(diff);
  const total = cfg.holes.length;
  const remaining = total - f.holesPlayed;
  const leader = diff > 0 ? a.id : diff < 0 ? b.id : null;
  const decided = f.matchLabel?.match(/won (\d+)&(\d+)/);
  let big = "AS";
  let small = f.holesPlayed ? `thru ${f.holesPlayed}` : "Not started";
  let over = false;
  if (decided) {
    big = `${decided[1]}&${decided[2]}`;
    small = "Won";
    over = true;
  } else if (f.holesPlayed === total) {
    over = true;
    big = leader ? `${up} UP` : "AS";
    small = leader ? "Won" : "Halved";
  } else if (leader) {
    big = `${up} UP`;
    if (up === remaining) small = `Dormie, thru ${f.holesPlayed}`;
  }
  return {
    gameId: g.id,
    name: g.name ?? `Match ${gi + 1}`,
    sides,
    leader,
    big,
    small,
    thru: f.holesPlayed,
    started: f.holesPlayed > 0,
    over,
    stage: cardInfo(s, round.id, g.id).stage,
  };
}

/** One leaderboard across every group in a round: "−3", "18 pts", "2 skins", with tied places. */
function fieldRows(s: TournamentState, summary: TournamentSummary, round: RoundRow): FieldRow[] {
  const rs = summary.rounds[s.rounds.indexOf(round)];
  const cfg = toRoundCfg(round, s.players);
  const players = toTournamentCfg(s).players;
  const field: FieldRow[] = [];
  {
    const entries = toEntries(s.entries.filter((e) => e.round_id === round.id))[round.id] ?? [];
    cfg.games.forEach((g, gi) => {
      const gs = rs.games[gi];
      const shots = gameShots(cfg, g, players);
      for (const sd of g.sides) {
        let rel = 0;
        if (cfg.scoring === "stroke") {
          for (const e of entries.filter((x) => x.game === g.id)) {
            const res = gameHole(cfg, g, shots, e);
            if (!res.complete) continue;
            const par = cfg.holes.find((h) => h.number === e.hole)?.par ?? 0;
            rel += (res.sides[sd.id]?.net ?? par + 2) - par;
          }
        }
        // Most skins: skins are won across the whole field, not within each group
        const across = summary.win.kind === "skins" && summary.skins ? summary.skins.rows.find((r) => r.playerId === sd.playerIds[0]) : null;
        const v = across ? (across.rounds[round.id] ?? 0) : (gs.full.value[sd.id] ?? 0);
        field.push({
          sideId: sd.id,
          name: sideName(sd, players),
          playerIds: sd.playerIds,
          pos: "",
          score: !gs.holesPlayed ? "–" : cfg.scoring === "stroke" ? toPar(rel) : cfg.scoring === "skins" ? `${fmtPts(v)} skin${v === 1 ? "" : "s"}` : `${fmtPts(v)} pts`,
          thru: gs.holesPlayed,
          value: cfg.scoring === "stroke" ? rel : v,
        });
      }
    });
    const lower = cfg.scoring === "stroke";
    field.sort((x, y) => (x.thru ? 0 : 1) - (y.thru ? 0 : 1) || (lower ? x.value - y.value : y.value - x.value) || y.thru - x.thru);
    field.forEach((row, i) => {
      if (!row.thru) return;
      const tied = field.filter((o) => o.thru && o.value === row.value).length > 1;
      const first = field.findIndex((o) => o.thru && o.value === row.value);
      row.pos = `${tied ? "T" : ""}${first + 1}`;
      void i;
    });
  }

  return field;
}

/** Whole-field places as things stand, for a round whose places are over every group (none once paid). */
function acrossLeaders(s: TournamentState, summary: TournamentSummary, round: RoundRow): Record<string, number> {
  const cfg = toRoundCfg(round, s.players);
  if (!acrossField(cfg) || cfg.closed) return {};
  const rs = summary.rounds[s.rounds.indexOf(round)];
  if (!rs || rs.games.every((g) => g.full.complete)) return {};
  const ranking = fieldRows(s, summary, round)
    .filter((r) => r.thru)
    .map((r) => ({ sideId: r.sideId, pos: Number(r.pos.replace("T", "")), value: r.value }));
  return positionPoints(ranking, cfg.points.positions ?? []);
}

/** Today's round: match states, or one leaderboard across every group. */
export function roundBoard(s: TournamentState, summary: TournamentSummary, round: RoundRow): RoundBoard {
  const ri = s.rounds.indexOf(round);
  const rs = summary.rounds[ri];
  const cfg = toRoundCfg(round, s.players);
  const players = toTournamentCfg(s).players;
  const headToHead = cfg.scoring === "match" && cfg.games.every((g) => g.sides.length === 2);
  const matches = headToHead ? cfg.games.map((g, gi) => matchState(s, round, cfg, g, rs.games[gi], gi)) : [];

  const field = headToHead ? [] : fieldRows(s, summary, round);

  const teams = s.tournament.teams ?? [];
  let session: RoundBoard["session"] = null;
  if (teams.length >= 2) {
    const proj = projectRound(s, summary, round);
    session = teams.map((t, i) => ({ teamId: t.id, name: t.name, color: t.color || (i === 0 ? "#c8102e" : "#1d4f91"), pts: proj.team[t.id] ?? 0 }));
  }
  const stages = cfg.games.map((g) => cardInfo(s, round.id, g.id).stage);
  const stage: CardStage = round.status === "complete" || stages.every((x) => x === "final") ? "final" : stages.every((x) => x !== "open") ? "finished" : "open";
  return { round, cfg, kind: headToHead ? "match" : "field", matches, field, session, stage };
}

/** One round's points as things stand: awarded segments plus whoever leads each unfinished one. */
function projectRound(s: TournamentState, summary: TournamentSummary, round: RoundRow) {
  const ri = s.rounds.indexOf(round);
  const cfg = toRoundCfg(round, s.players);
  const rs = summary.rounds[ri];
  const player: Record<string, number> = {};
  const team: Record<string, number> = {};
  const across = acrossLeaders(s, summary, round);
  cfg.games.forEach((g, gi) => {
    const gs = rs.games[gi];
    const pts = { ...gs.points };
    if (!cfg.closed) for (const [k, v] of Object.entries(liveLeaders(cfg, g, gs))) pts[k] = (pts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(across)) if (g.sides.some((sd) => sd.id === k)) pts[k] = (pts[k] ?? 0) + v;
    credit(s, g, pts, player, team);
  });
  return { player, team };
}

/** Points each side would get from the unfinished segments if they ended now. */
function liveLeaders(cfg: RoundCfg, g: Game, gs: GameSummary): Record<string, number> {
  const out: Record<string, number> = {};
  if (cfg.scoring === "skins") return out; // skins pay as they're won
  const seg = (res: SegmentResult, pot: number, positions?: number[]) => {
    if (res.complete || !res.holesPlayed || !res.ranking.length) return;
    if (positions?.length) {
      for (const [k, v] of Object.entries(positionPoints(res.ranking, positions))) out[k] = (out[k] ?? 0) + v;
      return;
    }
    for (const id of res.leaders) out[id] = (out[id] ?? 0) + pot / res.leaders.length;
  };
  const field = g.sides.length > 2 && cfg.points.positions?.length ? cfg.points.positions : undefined;
  seg(gs.front, cfg.points.front);
  seg(gs.back, cfg.points.back);
  // Places over the whole field are worked out once for the round (acrossLeaders)
  if (!acrossField(cfg)) seg(gs.full, cfg.points.full, field);
  return out;
}

function credit(s: TournamentState, g: Game, pts: Record<string, number>, player: Record<string, number>, team: Record<string, number>) {
  for (const sd of g.sides) {
    const p = pts[sd.id] ?? 0;
    for (const pid of sd.playerIds) player[pid] = (player[pid] ?? 0) + p;
    const t = sd.teamId ?? s.players.find((x) => x.id === sd.playerIds[0])?.team_id;
    if (t) team[t] = (team[t] ?? 0) + p;
  }
}

export interface Standings {
  /** Points from final cards (and side games once the tournament is over) */
  banked: Record<string, number>;
  /** If everything finished as it stands now: provisional results, live leaders, side-game leaders */
  projected: Record<string, number>;
  /** Projected differs from banked (something is live or provisional) */
  moving: boolean;
}

/** The tournament: banked and projected points, by player or by team. */
export function standings(s: TournamentState, summary: TournamentSummary, byTeam: boolean): Standings {
  const banked = { ...(byTeam ? summary.teamTotal : summary.playerTotal) };
  const projected = { ...(byTeam ? summary.teamProjected : summary.playerProjected) };
  s.rounds.forEach((round, ri) => {
    const cfg = toRoundCfg(round, s.players);
    const rs = summary.rounds[ri];
    if (!rs) return;
    const across = acrossLeaders(s, summary, round);
    cfg.games.forEach((g, gi) => {
      const gs = rs.games[gi];
      // Not final yet: its awarded points are provisional
      if (cardInfo(s, round.id, g.id).stage !== "final") {
        const p: Record<string, number> = {};
        const t: Record<string, number> = {};
        credit(s, g, gs.points, p, t);
        for (const [k, v] of Object.entries(byTeam ? t : p)) banked[k] = (banked[k] ?? 0) - v;
      }
      if (!cfg.closed) {
        const p: Record<string, number> = {};
        const t: Record<string, number> = {};
        const lead = liveLeaders(cfg, g, gs);
        for (const [k, v] of Object.entries(across)) lead[k] = (lead[k] ?? 0) + v;
        credit(s, g, lead, p, t);
        for (const [k, v] of Object.entries(byTeam ? t : p)) projected[k] = (projected[k] ?? 0) + v;
      }
    });
  });
  for (const k of Object.keys(banked)) banked[k] = Math.max(0, Math.round(banked[k] * 100) / 100);
  for (const k of Object.keys(projected)) projected[k] = Math.round(projected[k] * 100) / 100;
  const moving = Object.keys(projected).some((k) => Math.abs((projected[k] ?? 0) - (banked[k] ?? 0)) > 1e-9);
  return { banked, projected, moving };
}

/** One line for the live strip and the home page's "Today" chip. */
export function liveLine(b: RoundBoard): string {
  if (b.kind === "match") {
    if (b.session) return b.session.map((t) => `${t.name} ${fmtPts(t.pts)}`).join(" – ");
    const one = (m: MatchState) => {
      const lead = m.sides.find((x) => x.id === m.leader)?.name;
      if (!m.started) return `${m.sides.map((x) => x.name).join(" v ")}: not started`;
      if (m.over) return lead ? `${lead} won ${m.big.includes("&") ? m.big : m.big.replace(" UP", " up")}` : "Halved";
      return lead ? `${lead} ${m.big} ${m.small}` : `All square ${m.small}`;
    };
    if (b.matches.length === 1) return one(b.matches[0]);
    const shown = b.matches.slice(0, 2).map(one).join(" · ");
    return b.matches.length > 2 ? `${shown} · +${b.matches.length - 2} more` : shown;
  }
  const top = b.field.filter((r) => r.thru).slice(0, 3);
  if (!top.length) return "Not started";
  return top.map((r) => `${r.pos} ${r.name} ${r.score}`).join(" · ");
}

/** "2nd, 2 behind Neil" for a player in a field round. */
export function fieldPosition(b: RoundBoard, playerId: string): string | null {
  if (b.kind !== "field") return null;
  const me = b.field.find((r) => r.playerIds.includes(playerId));
  if (!me?.thru) return null;
  const lead = b.field[0];
  const n = Number(me.pos.replace("T", ""));
  const ord = n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
  const posText = `${me.pos.startsWith("T") ? "Tied " : ""}${ord}`;
  if (lead.sideId === me.sideId || lead.value === me.value) return `${posText}, ${me.score} thru ${me.thru}`;
  const gap = Math.abs(lead.value - me.value);
  return `${posText}, ${fmtPts(gap)} behind ${lead.name}`;
}


export interface TotalsView {
  kind: "stableford" | "stroke";
  title: string;
  rows: {
    id: string;
    name: string;
    /** "1", "T2", "" (not started) */
    pos: string;
    value: number;
    /** "−3", "54 pts" */
    score: string;
    /** Stroke play: "Gross 154 (+10)" */
    gross: string | null;
    /** Holes played in the live round, if playing in it */
    thru: number | null;
    /** By round: "−2", "36", "" (not played) */
    perRound: string[];
  }[];
}

/** Running Stableford or stroke-play totals, as the site shows them. */
export function totalsView(s: TournamentState, summary: TournamentSummary): TotalsView | null {
  const t = summary.totals;
  if (!t) return null;
  const rounds = [...s.rounds].sort((a, b) => a.number - b.number);
  const live = liveRound(s);
  const fmt = (v: number) => (t.kind === "stroke" ? toPar(v) : `${fmtPts(v)} pts`);
  return {
    kind: t.kind,
    title: t.kind === "stroke" ? "Stroke play (net)" : "Stableford",
    rows: t.rows.map((r) => ({
      id: r.playerId,
      name: s.players.find((p) => p.id === r.playerId)?.name ?? "",
      pos: r.pos ? `${r.tied ? "T" : ""}${r.pos}` : "",
      value: r.value,
      score: r.holes ? fmt(r.value) : "–",
      gross: t.kind === "stroke" && r.holes ? `Gross ${r.gross} (${toPar(r.grossToPar)})` : null,
      thru: live && r.rounds[live.id] && r.rounds[live.id].holes < live.holes.length ? r.rounds[live.id].holes : null,
      perRound: rounds.map((rd) => {
        const x = r.rounds[rd.id];
        return x?.holes ? (t.kind === "stroke" ? toPar(x.value) : fmtPts(x.value)) : "";
      }),
    })),
  };
}

// ---------------------------------------------------------------- points race: where the points came from

export const BONUS_ORDER: BonusKind[] = ["birdies", "eagles", "gir", "ctp", "ld"];
export const BONUS_WORD: Record<BonusKind, string> = { birdies: "birdies", eagles: "eagles", gir: "greens in regulation", ctp: "closest the pin", ld: "long drive" };

export interface PointsPart {
  key: "rounds" | "prizes" | BonusKind;
  label: string;
  value: number;
}

/**
 * A player's total in a points race, split by where it came from: the rounds, prizes, then each bonus. `total` is the
 * total being shown (banked); the rounds are what's left after the prizes and bonuses, so the parts always add up.
 */
export function pointsParts(summary: TournamentSummary, pid: string, total: number): PointsPart[] {
  const by = summary.bonusBy?.[pid] ?? {};
  const prizes = summary.prizePoints?.[pid] ?? 0;
  const bonus = BONUS_ORDER.reduce((a, k) => a + (by[k] ?? 0), 0);
  const rounds = Math.max(0, Math.round((total - prizes - bonus) * 100) / 100);
  const parts: PointsPart[] = [
    { key: "rounds", label: "rounds", value: rounds },
    { key: "prizes", label: "prizes", value: prizes },
    ...BONUS_ORDER.map((k) => ({ key: k, label: BONUS_WORD[k], value: by[k] ?? 0 })),
  ];
  return parts.filter((p) => p.value > 0);
}

/** "Rounds 40, birdies 4, closest the pin 3" (null when there's nothing but rounds, or nothing at all) */
export function pointsLine(parts: PointsPart[]): string | null {
  if (!parts.length || (parts.length === 1 && parts[0].key === "rounds")) return null;
  const s = parts.map((p) => `${p.label} ${fmtPts(p.value)}`).join(", ");
  return s[0].toUpperCase() + s.slice(1);
}

const up = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The board's foot in a points race: "Still to play for: 20 from the rounds, 12 from closest the pin and long
 * drive." and "Birdies and eagles on top." Either can be null.
 */
export function stillToPlay(summary: TournamentSummary, cfg: Pick<TournamentCfg, "win" | "standings" | "teams">): { left: string | null; onTop: string | null } {
  const l = summary.left ?? { rounds: summary.pointsRemaining, prizes: 0, holes: 0, ctp: 0, ld: 0 };
  const rounds = Math.max(0, summary.pointsRemaining - l.prizes - l.holes);
  const w = summary.win;
  const holeWords = (["ctp", "ld"] as const).filter((k) => w.kind === "points" && (w.bonus?.[k] ?? 0) > 0).map((k) => BONUS_WORD[k]).join(" and ");
  const bits = [rounds > 0 ? `${fmtPts(rounds)} from the rounds` : "", l.holes > 0 ? `${fmtPts(l.holes)} from ${holeWords}` : "", l.prizes > 0 ? `${fmtPts(l.prizes)} from prizes` : ""].filter(Boolean);
  const open = openBonusWords(cfg);
  return {
    left: bits.length ? `Still to play for: ${bits.join(", ")}.` : null,
    onTop: open && !summary.complete ? `${up(open)} on top.` : null,
  };
}

export interface TallyBox {
  key: string;
  /** "60", or "+2" for so many each */
  value: string;
  /** "Rounds", "Closest the pin", "Each birdie" */
  label: string;
}

const TALLY_LABEL: Record<BonusKind, string> = { birdies: "Birdies", eagles: "Eagles", gir: "Greens", ctp: "Closest the pin", ld: "Long drive" };
const EACH_LABEL: Record<string, string> = { birdies: "Each birdie", eagles: "Each eagle", gir: "Each green" };

/** A player's breakdown as small boxes: Rounds 40, Birdies 2, Closest the pin 3 (none when it's rounds alone) */
export function pointsTally(parts: PointsPart[]): TallyBox[] {
  if (!parts.length || (parts.length === 1 && parts[0].key === "rounds")) return [];
  return parts.map((p) => ({ key: p.key, value: fmtPts(p.value), label: p.key === "rounds" ? "Rounds" : p.key === "prizes" ? "Prizes" : TALLY_LABEL[p.key] }));
}

/** What's still to play for, as small boxes: Rounds 60, Closest the pin 18, Long drive 18, Prizes 10, then +2 each birdie */
export function stillTally(summary: TournamentSummary): TallyBox[] {
  const l = summary.left ?? { rounds: summary.pointsRemaining, prizes: 0, holes: 0, ctp: 0, ld: 0 };
  const rounds = Math.max(0, summary.pointsRemaining - l.prizes - l.holes);
  const out: TallyBox[] = [];
  if (rounds > 0) out.push({ key: "rounds", value: fmtPts(rounds), label: "Rounds" });
  if (l.ctp > 0) out.push({ key: "ctp", value: fmtPts(l.ctp), label: "Closest the pin" });
  if (l.ld > 0) out.push({ key: "ld", value: fmtPts(l.ld), label: "Long drive" });
  if (l.prizes > 0) out.push({ key: "prizes", value: fmtPts(l.prizes), label: "Prizes" });
  const w = summary.win;
  if (w.kind === "points" && !summary.complete)
    for (const k of ["birdies", "eagles", "gir"] as const) if ((w.bonus?.[k] ?? 0) > 0) out.push({ key: k, value: `+${fmtPts(w.bonus![k]!)}`, label: EACH_LABEL[k] });
  return out;
}
