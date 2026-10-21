/**
 * The set-up answers as the phone keeps them while the wizard runs (kept in localStorage so a locked screen or a
 * phone call loses nothing), which screens to show for them, and the tidy version sent to the server.
 */
import type { BonusKind, Prize } from "@/lib/engine";
import type { HoleSet, ThemeId, Tone } from "@/lib/types";
import {
  defaultFormat,
  defaultWin,
  isMatch,
  knockoutEntrants,
  knockoutStages,
  problems,
  roundFormats,
  usesPoints,
  type DayFormat,
  type KnockoutAnswers,
  type RoundHcp,
  type RoundPoints,
  type WinChoice,
  type Who,
  type Wizard,
} from "@/lib/wizard";

export interface Tee {
  name: string;
  par: number[];
  si?: number[];
  yards: number[];
  rating?: number;
  slope?: number;
}

export interface DPlayer {
  key: string;
  name: string;
  /** As typed: "12.4" (the sign is the plus switch) */
  index: string;
  plus: boolean;
  team: number | null;
  nickname: string;
  line: string;
}

export interface DRound {
  courseRef: string | null;
  courseName: string;
  location?: string | null;
  lat?: number | null;
  lon?: number | null;
  tees?: Tee[];
  tee?: string | null;
  playerTees: Record<string, string>;
  holeSet: HoleSet;
  manual?: boolean;
  manualCard?: { par: number; si: number }[] | null;
  format: DayFormat | null;
  date: string | null;
  time: string | null;
  points?: RoundPoints;
  picks?: string[][][] | null;
  /** Handicaps for this round: official (default), flat, or shots set by hand (by player key) */
  hcp?: RoundHcp;
  shots?: Record<string, number>;
  /** The card, for a saved round whose tees aren't listed (par and yards, hole by hole) */
  card?: { par: number; yards?: number }[] | null;
}

export interface Draft {
  v: 2;
  step: string;
  who: Who | null;
  name: string;
  subtitle: string;
  organiserPlays: boolean | null;
  players: DPlayer[];
  teams: { name: string; color: string }[];
  win: WinChoice | null;
  ko: KnockoutAnswers;
  skinsCarry: boolean;
  teamCount: number;
  allowance: number | null;
  count: number | null;
  rounds: DRound[];
  bonus: Partial<Record<BonusKind, number>>;
  draw: "random" | "balanced" | "pick";
  teeGap: number;
  prizes: Prize[];
  extras: { feed: boolean; ai: boolean; video: boolean };
  tone: Tone;
  units: "yards" | "metres";
  share: "portrait" | "landscape";
  theme: ThemeId | null;
  keep: "email" | "pin" | null;
  email: string;
  pin: string;
}

export const TEAM_COLOURS = ["#c8102e", "#1d4f91", "#2e7d4f", "#a8741f", "#5b3f8c", "#1b1b1b"];

export const newKey = () => Math.random().toString(36).slice(2, 9);

export const blankPlayer = (): DPlayer => ({ key: newKey(), name: "", index: "", plus: false, team: null, nickname: "", line: "" });

export const fresh = (): Draft => ({
  v: 2,
  step: "who",
  who: null,
  name: "",
  subtitle: "",
  organiserPlays: null,
  players: [],
  teams: [
    { name: "", color: TEAM_COLOURS[0] },
    { name: "", color: TEAM_COLOURS[1] },
  ],
  win: null,
  ko: { pairs: false, draw: "random", tie: "backnine" },
  skinsCarry: true,
  teamCount: 2,
  allowance: null,
  count: null,
  rounds: [],
  bonus: {},
  draw: "random",
  teeGap: 10,
  prizes: [],
  extras: { feed: true, ai: true, video: true },
  tone: "broadsheet",
  units: "yards",
  share: "portrait",
  theme: null,
  keep: null,
  email: "",
  pin: "",
});

export const emptyRound = (): DRound => ({ courseRef: null, courseName: "", holeSet: "all", format: null, date: null, time: null, playerTees: {} });

/** The handicap index typed, plus handicaps negative; null when blank or not a number. */
export function indexOf(p: Pick<DPlayer, "index" | "plus">): number | null {
  const t = p.index.trim().replace(",", ".").replace(/^\+/, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 54) return null;
  return p.plus ? -n : n;
}

export const badIndex = (p: DPlayer) => p.index.trim() !== "" && indexOf(p) == null;

export const holesOf = (r: DRound) => (r.manual ? r.manualCard?.length ?? 18 : r.tees?.[0]?.par.length ?? 18);

/** Players with a name, in order. */
export const named = (d: Draft) => d.players.filter((p) => p.name.trim());

/** How many rounds a knockout needs for the players so far. */
export const koRounds = (d: Draft) => knockoutStages(knockoutEntrants({ players: named(d).map((p) => ({ key: p.key, name: p.name, index: null })), ko: d.ko }).length);

/** The answers with the rounds made to match the count, and every round's format fixed where there's no choice. */
export function settle(d: Draft): Draft {
  const who = d.who ?? "individuals";
  const count = d.win === "knockout" && who !== "solo" ? koRounds(d) : d.count ?? 0;
  const opts = roundFormats(who, d.who === "solo" ? null : d.win, d.ko.pairs);
  const rounds = Array.from({ length: count }, (_, i) => {
    const r = d.rounds[i] ?? emptyRound();
    // Unanswered: the usual format is already chosen (fourballs first on a Ryder Cup weekend, singles last)
    const format = r.format && opts.includes(r.format) ? r.format : d.who === "solo" && i > 0 ? d.rounds[0]?.format ?? opts[0] : defaultFormat(who, d.who === "solo" ? null : d.win, i, count, d.ko.pairs);
    return { ...r, format };
  });
  return { ...d, count: count || d.count, rounds };
}

/** Is there more than one group or match to arrange? (Otherwise who plays with whom answers itself.) */
export function needsGroups(d: Draft): boolean {
  if (d.who === "solo" || !d.win) return false;
  const n = named(d).length;
  if (d.win === "knockout") return d.ko.draw === "pick";
  if (d.win === "scramble") return false;
  if (d.who === "teams" && d.win === "matches") return true;
  return d.rounds.slice(0, d.count ?? 0).some((r) => (r.format && isMatch(r.format) ? n > 2 : n > 4));
}

/** Every screen, in order, for the answers so far. */
export function stepsFor(d: Draft): string[] {
  const s = ["who", "name", "players"];
  const solo = d.who === "solo";
  if (d.who === "teams") s.push("teams");
  if (!solo) s.push("win");
  if (d.win === "knockout" || d.win === "skins" || d.win === "teamscore") s.push("winmore");
  if (solo || d.win !== "knockout") s.push("count");
  const n = solo || d.win !== "knockout" ? d.count ?? 0 : koRounds(d);
  const opts = roundFormats(d.who ?? "individuals", solo ? null : d.win, d.ko.pairs);
  for (let i = 0; i < n; i++) {
    const r = d.rounds[i];
    s.push(`course:${i}`);
    if (r && !r.manual && (r.tees?.length ?? 0) > 1) s.push(`tee:${i}`);
    if (r && holesOf(r) === 18) s.push(`holes:${i}`);
    if (opts.length > 1 && (!solo || i === 0)) s.push(`format:${i}`);
    s.push(`when:${i}`);
  }
  if (!solo && usesPoints(d.win)) s.push("points");
  if (needsGroups(d)) s.push("groups");
  if (!solo) s.push("prizes");
  s.push("extras", "look");
  if (!solo) s.push("about");
  s.push("safe");
  return s;
}

/** Answers that stop the wizard going on, in plain words. */
export function draftProblems(d: Draft): string[] {
  return problems(toWizardLoose(d));
}

/** The answers for the checks, before everything's filled in. */
function toWizardLoose(d: Draft): Pick<Wizard, "who" | "win" | "players" | "teams" | "rounds" | "ko"> {
  return {
    who: d.who ?? "individuals",
    win: d.win ?? defaultWin(d.who ?? "individuals", d.teams.length),
    players: named(d).map((p) => ({ key: p.key, name: p.name, index: indexOf(p), team: p.team })),
    teams: d.teams,
    rounds: d.rounds.slice(0, d.count ?? 0).map((r) => ({ ...r, format: r.format ?? "stableford" })),
    ko: d.ko,
  };
}

/** What's sent to the server: the answers, tidied. */
export function toWizard(d: Draft): Wizard {
  const who = d.who ?? "individuals";
  const s = settle(d);
  // On your own: the running total is the format you play
  const win = who === "solo" ? (s.rounds[0]?.format === "stroke" ? "stroke" : "stableford") : d.win ?? defaultWin(who, d.teams.length);
  return {
    who,
    name: d.name.trim(),
    subtitle: d.subtitle.trim() || undefined,
    players: named(d).map((p) => ({ key: p.key, name: p.name.trim(), index: indexOf(p), team: who === "teams" ? p.team : null, nickname: p.nickname.trim() || null, line: p.line.trim() || null })),
    organiserPlays: who === "solo" ? true : !!d.organiserPlays,
    teams: who === "teams" ? d.teams.map((t, i) => ({ name: t.name.trim() || `Team ${i + 1}`, color: t.color })) : [],
    win,
    ko: win === "knockout" ? d.ko : null,
    skinsCarry: d.skinsCarry,
    teamCount: d.teamCount,
    allowance: d.allowance,
    rounds: s.rounds.map((r, i) => ({
      courseRef: r.manual ? null : r.courseRef,
      courseName: r.courseName,
      location: r.location,
      lat: r.lat,
      lon: r.lon,
      tee: r.tee,
      playerTees: r.playerTees,
      holeSet: r.holeSet,
      manualCard: r.manual ? r.manualCard : null,
      format: r.format ?? defaultFormat(who, win, i, s.rounds.length, d.ko.pairs),
      date: r.date,
      time: r.time,
      points: r.points,
      picks: d.draw === "pick" ? r.picks : null,
      hcp: r.hcp ?? "official",
      shots: r.hcp === "manual" ? r.shots : undefined,
    })),
    bonus: d.bonus,
    draw: d.draw,
    teeGap: d.teeGap,
    prizes: d.prizes,
    extras: d.extras,
    tone: d.tone,
    theme: d.theme ?? "spring",
    units: d.units,
    share: d.share,
  };
}
