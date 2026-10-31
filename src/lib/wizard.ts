/**
 * The set-up wizard's rules: what can be chosen, the defaults, what's checked, and how the answers become a
 * tournament (formats, handicap allowances, points, groups and matches). Pure, so the wizard checks its answers
 * as it goes and the server builds exactly the same thing. The blueprint: docs/setup-redesign.md.
 */
import type { BonusKind, CourseRating, Game, HandicapRule, PlayType, PointsRule, Prize, ScoringType, SideHoles, StandingsMode, WinRule } from "./engine";
import type { HoleSet, ThemeId, Tone } from "./types";

export type { CourseRating } from "./engine";

export type Who = "solo" | "individuals" | "teams";
/** How the overall winner is decided. */
export type WinChoice = "stableford" | "stroke" | "points" | "knockout" | "skins" | "matches" | "teamscore" | "scramble";
/** What a round is played as. */
export type DayFormat = "stableford" | "stroke" | "match" | "skins" | "fourball" | "foursomes" | "singles" | "scramble";

export const MAX_ROUNDS = 10;
export const MAX_PLAYERS = 40;
export const MAX_TEAMS = 6;

export const WINS: Record<"individuals" | "teams", { id: WinChoice; name: string; note: string }[]> = {
  individuals: [
    { id: "stableford", name: "Most Stableford points", note: "Every round's Stableford points, added up" },
    { id: "stroke", name: "Lowest total score", note: "Net strokes over every round, added up. Lowest wins" },
    { id: "points", name: "A points race", note: "Points for each round's result. Mix formats across the rounds" },
    { id: "knockout", name: "Match play knockout", note: "One against one. Win and you go through" },
    { id: "skins", name: "Most skins", note: "Win a hole outright to win its skin" },
  ],
  teams: [
    { id: "matches", name: "Matches won", note: "Two teams, a point for every match won" },
    { id: "teamscore", name: "Team score", note: "Each team's best Stableford scores on every hole count" },
    { id: "scramble", name: "Texas scramble", note: "One ball per team. Lowest team score wins" },
  ],
};

export const FORMAT_NAMES: Record<DayFormat, { name: string; note: string }> = {
  stableford: { name: "Stableford", note: "Points on every hole after your shots" },
  stroke: { name: "Stroke play", note: "Every shot counts, less your handicap" },
  match: { name: "Match play", note: "One against one, hole by hole" },
  skins: { name: "Skins", note: "Win a hole outright to take its skin" },
  fourball: { name: "Fourballs", note: "Pairs, the better ball counts, match play" },
  foursomes: { name: "Foursomes", note: "Pairs, one ball, alternate shots, match play" },
  singles: { name: "Singles", note: "One against one, match play" },
  scramble: { name: "Texas scramble", note: "The team plays the best shot each time" },
};

export const formatName = (f: DayFormat) => FORMAT_NAMES[f]?.name ?? f;
/** A name in the middle of a sentence: "stroke play", but Stableford and Texas keep their capitals. */
export const inSentence = (s: string) => s.replace(/\b[A-Z][a-z]+/g, (w) => (w === "Stableford" || w === "Texas" ? w : w.toLowerCase()));
export const winName = (w: WinChoice) => [...WINS.individuals, ...WINS.teams].find((x) => x.id === w)?.name ?? w;

/** The ways to win on offer for these answers (Matches won needs exactly two teams; a scramble team is 2 to 4). */
export function winsFor(who: Who, teams: number, sizes: number[] = []): { id: WinChoice; name: string; note: string; off?: string }[] {
  if (who === "solo") return [];
  if (who === "individuals") return WINS.individuals;
  return WINS.teams.map((w) =>
    w.id === "matches" && teams !== 2
      ? { ...w, off: "Needs exactly two teams" }
      : w.id === "scramble" && sizes.some((n) => n > 4)
        ? { ...w, off: "Teams of four or fewer" }
        : w,
  );
}

/** The usual way to win for these answers. */
export function defaultWin(who: Who, teams: number): WinChoice {
  if (who === "teams") return teams === 2 ? "matches" : "teamscore";
  return "stableford";
}

/** Formats a round can be played in. One choice = fixed by the way to win (no question asked). */
export function roundFormats(who: Who, win: WinChoice | null, pairs = false): DayFormat[] {
  if (who === "solo") return ["stableford", "stroke"];
  switch (win) {
    case "points":
      return ["stableford", "stroke", "match", "skins"];
    case "matches":
      return ["fourball", "foursomes", "singles"];
    case "stroke":
      return ["stroke"];
    case "knockout":
      return [pairs ? "fourball" : "match"];
    case "skins":
      return ["skins"];
    case "scramble":
      return ["scramble"];
    default:
      return ["stableford"];
  }
}

/** A round's format before anyone chooses: Ryder Cup weekends open with fourballs, then foursomes, singles last. */
export function defaultFormat(who: Who, win: WinChoice | null, round: number, rounds: number, pairs = false): DayFormat {
  const opts = roundFormats(who, win, pairs);
  if (win === "matches") return rounds === 1 || round === rounds - 1 ? "singles" : round % 2 === 0 ? "fourball" : "foursomes";
  return opts[0];
}

export function playOf(f: DayFormat): { play: PlayType; scoring: ScoringType } {
  if (f === "fourball") return { play: "fourball", scoring: "match" };
  if (f === "foursomes") return { play: "foursomes", scoring: "match" };
  if (f === "scramble") return { play: "scramble", scoring: "stroke" };
  if (f === "singles" || f === "match") return { play: "singles", scoring: "match" };
  return { play: "singles", scoring: f };
}

/** Head-to-head formats need players drawn into matches. */
export const isMatch = (f: DayFormat) => playOf(f).scoring === "match";
/** Pairs on each side. */
export const isPairs = (f: DayFormat) => f === "fourball" || f === "foursomes";

/**
 * The official allowances (World Handicap System), with course handicaps from each tee's slope and rating where
 * known: Stableford and stroke play 95%; team score 85%; singles match play 100% of the difference; fourballs 90%
 * off the lowest; foursomes 50% of the combined difference; skins 100%; a scramble team from its players' handicaps.
 */
export function handicapFor(f: DayFormat, win: WinChoice | null, course: CourseRating | null, override?: number | null): Extract<HandicapRule, { mode: "allowance" }> {
  const base =
    f === "stableford" || f === "stroke"
      ? win === "teamscore"
        ? 85
        : 95
      : f === "fourball"
        ? 90
        : f === "foursomes"
          ? 50
          : 100;
  return { mode: "allowance", pct: override ?? base, relative: isMatch(f), course };
}

export interface RoundPoints {
  /** Match formats: points for winning a match (a half shares it) */
  win?: number;
  /** Stableford and stroke-play rounds: points for 1st, 2nd, 3rd… over the whole field */
  positions?: number[];
  /** Skins: points per skin */
  skin?: number;
  /** Points for the front 9 and back 9 as well as the 18 (off when missing) */
  nines?: { front: number; back: number } | null;
}

/** Places: the winner only with two players, 3-2-1 for three to nine, 5-4-3-2-1 for ten or more. */
export function defaultPoints(f: DayFormat, players: number): RoundPoints {
  if (isMatch(f)) return { win: 1 };
  if (f === "skins") return { skin: 1 };
  return { positions: players <= 2 ? [1] : players <= 9 ? [3, 2, 1] : [5, 4, 3, 2, 1] };
}

/** Rounds earn points only in a points race and Matches won; the other ways to win add up the golf itself. */
export const usesPoints = (win: WinChoice | null) => win === "points" || win === "matches";

export function pointsRule(f: DayFormat, p: RoundPoints | undefined, win: WinChoice | null, players: number): PointsRule {
  if (!usesPoints(win)) return { front: 0, back: 0, full: 0 };
  const d = { ...defaultPoints(f, players), ...p };
  const front = Math.max(0, Number(d.nines?.front) || 0);
  const back = Math.max(0, Number(d.nines?.back) || 0);
  if (isMatch(f)) return { front, back, full: Math.max(0, Number(d.win) || 0) };
  if (f === "skins") return { front: 0, back: 0, full: 0, skin: Math.max(0, Number(d.skin) || 0) };
  return { front, back, full: 0, positions: (d.positions ?? []).map((n) => Math.max(0, Number(n) || 0)), across: true };
}

/** The old `standings` column, kept for the parts of the site that read it. */
export function standingsOf(win: WinChoice): StandingsMode {
  return win === "stableford" || win === "stroke" ? win : "points";
}

// ------------------------------------------------------------------ the answers

export interface WizRound {
  /** A course from the search ("golfapi:…", "gca:…", "local:…"), or none when the card is typed in */
  courseRef?: string | null;
  courseName: string;
  location?: string | null;
  lat?: number | null;
  lon?: number | null;
  tee?: string | null;
  /** Players on other tees, by player key */
  playerTees?: Record<string, string>;
  holeSet: HoleSet;
  /** Typed in by hand: par and stroke index per hole */
  manualCard?: { par: number; si: number }[] | null;
  format: DayFormat;
  date?: string | null;
  time?: string | null;
  points?: RoundPoints;
  /** Picked by hand: the games, each a list of sides, each a list of player keys */
  picks?: string[][][] | null;
  /** Handicaps for this round: the official allowance (default), flat (no shots), or shots set by hand */
  hcp?: RoundHcp;
  /** Shots set by hand, by player key */
  shots?: Record<string, number>;
}

export type RoundHcp = "official" | "flat" | "manual";

/** Shots can be set by hand where each player plays their own ball (not foursomes or a scramble). */
export const shotsByHand = (f: DayFormat | null | undefined) => f !== "foursomes" && f !== "scramble";

/** A round's handicaps from the answers: the official allowance, flat, or the shots set by hand. */
export function roundHandicap(
  f: DayFormat,
  win: WinChoice | null,
  course: CourseRating | null,
  allowance: number | null | undefined,
  r: Pick<WizRound, "hcp" | "shots">,
  idOf: Record<string, string>,
): HandicapRule {
  if (r.hcp === "flat") return { mode: "manual", shots: {} };
  if (r.hcp === "manual" && shotsByHand(f))
    return { mode: "manual", shots: Object.fromEntries(Object.entries(r.shots ?? {}).filter(([k, v]) => idOf[k] && v > 0).map(([k, v]) => [idOf[k], Math.round(v)])) };
  return handicapFor(f, win, course, allowance);
}

export interface WizPlayer {
  /** Stable while setting up (names can change, players can be removed) */
  key: string;
  name: string;
  /** Handicap index (plus handicaps are negative) */
  index: number | null;
  /** Team number (team events) */
  team?: number | null;
  nickname?: string | null;
  /** One line about them, for the writing */
  line?: string | null;
}

export interface KnockoutAnswers {
  pairs: boolean;
  draw: "random" | "seeded" | "pick";
  tie: "backnine" | "extra";
  /** Picked by hand: the first stage in bracket order, by entrant (player key, or "a+b" for a pair); null = bye */
  slots?: (string | null)[] | null;
  /** Pairs picked by hand: player keys, two at a time */
  pairsPicked?: string[][] | null;
}

export interface Wizard {
  who: Who;
  name: string;
  subtitle?: string;
  players: WizPlayer[];
  /** The organiser is the first player */
  organiserPlays: boolean;
  teams: { name: string; color: string }[];
  win: WinChoice;
  ko?: KnockoutAnswers | null;
  /** Most skins: a tied hole's skin carries to the next */
  skinsCarry?: boolean;
  /** Team score: scores counting on each hole (0 = all) */
  teamCount?: number;
  /** Handicap allowance, when changed from the official one (More options) */
  allowance?: number | null;
  rounds: WizRound[];
  /** Points race: bonus points each time */
  bonus?: Partial<Record<BonusKind, number>>;
  /** Points race: closest the pin and long drive bonus holes, round by round (a round missing: every par 3 / par 5) */
  bonusHoles?: SideHoles;
  draw: "random" | "balanced" | "pick";
  /** Minutes between tee times */
  teeGap?: number;
  prizes: Prize[];
  extras: { feed: boolean; ai: boolean; video: boolean };
  tone?: Tone;
  theme: ThemeId;
  /** GPS distances in yards (default) or metres */
  units?: "yards" | "metres";
  /** Where the videos will mostly be shared: upright for phones (default), wide for YouTube and TV */
  share?: "portrait" | "landscape";
  /** Who can watch: anyone with the link (default) or only the people let in */
  privacy?: "friends" | "private";
  /** Private: players sign in with their email as well as their link */
  playersNeedEmail?: boolean;
}

/** The engine's win rule for these answers (the knockout's bracket is added when the players have ids). */
export function winRule(w: Pick<Wizard, "win" | "skinsCarry" | "teamCount" | "bonus" | "bonusHoles">): Exclude<WinRule, { kind: "knockout" }> | null {
  switch (w.win) {
    case "points": {
      const bonus = Object.fromEntries(Object.entries(w.bonus ?? {}).filter(([, v]) => (v ?? 0) > 0)) as Partial<Record<BonusKind, number>>;
      const holes = Object.fromEntries((["ctp", "ld"] as const).filter((k) => (bonus[k] ?? 0) > 0 && w.bonusHoles?.[k]).map((k) => [k, w.bonusHoles![k]!])) as SideHoles;
      return Object.keys(holes).length ? { kind: "points", bonus, bonusHoles: holes } : { kind: "points", bonus };
    }
    case "skins":
      return { kind: "skins", carry: w.skinsCarry !== false };
    case "teamscore":
      return { kind: "teamscore", count: w.teamCount ?? 2 };
    case "knockout":
      return null;
    default:
      return { kind: w.win };
  }
}

// ------------------------------------------------------------------ checks

/** Pairs in a knockout: the player keys, two at a time (picked, or made from the order given). */
export const knockoutEntrants = (w: Pick<Wizard, "players" | "ko">): string[][] =>
  w.ko?.pairs
    ? w.ko.pairsPicked?.length
      ? w.ko.pairsPicked
      : Array.from({ length: Math.floor(w.players.length / 2) }, (_, i) => w.players.slice(i * 2, i * 2 + 2).map((p) => p.key))
    : w.players.map((p) => [p.key]);

/** Stages in a knockout of this many entrants (2 → 1, 3-4 → 2, 5-8 → 3, 9-16 → 4…). */
export const knockoutStages = (entrants: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, entrants))));

/** What would stop the tournament working, in plain words, for the answers so far. */
export function problems(w: Pick<Wizard, "who" | "win" | "players" | "teams" | "rounds" | "ko">): string[] {
  const out: string[] = [];
  const n = w.players.length;
  if (w.who === "solo") return n === 1 ? [] : ["Add your name."];
  if (n < 2) out.push("Add at least two players.");
  if (w.who === "teams") {
    const sizes = w.teams.map((_, i) => w.players.filter((p) => p.team === i).length);
    if (w.players.some((p) => p.team == null || p.team >= w.teams.length)) out.push("Put every player on a team.");
    if (sizes.some((s) => s === 0)) out.push("Each team needs players.");
    if (w.win === "matches") {
      if (w.teams.length !== 2) out.push("Matches won needs exactly two teams.");
      else if (sizes[0] !== sizes[1]) out.push(`The teams need the same number of players for matches (${sizes[0]} and ${sizes[1]} now).`);
      else if (w.rounds.some((r) => isPairs(r.format)) && sizes[0] % 2) out.push("Fourballs and foursomes need an even number on each team, to make pairs.");
    }
    if (w.win === "scramble" && sizes.some((s) => s > 4)) out.push("A scramble team is four players at most.");
  } else {
    const m = w.rounds.findIndex((r) => r.format === "match");
    if (w.win === "points" && m >= 0 && n % 2) out.push(`Match play (round ${m + 1}) needs an even number of players.`);
    if (w.win === "knockout" && w.ko?.pairs && n % 2) out.push("A pairs knockout needs an even number of players.");
    if (w.win === "knockout" && n < (w.ko?.pairs ? 4 : 2)) out.push(w.ko?.pairs ? "A pairs knockout needs at least four players." : "Add at least two players.");
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------ the draw

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Split into groups of at most four, as even as possible (6 → 3 + 3, 9 → 3 + 3 + 3, 10 → 4 + 3 + 3). */
export function groupsOf<T>(ids: T[], max = 4): T[][] {
  if (!ids.length) return [];
  const count = Math.ceil(ids.length / max);
  const out: T[][] = Array.from({ length: count }, () => []);
  const base = Math.floor(ids.length / count);
  let extra = ids.length % count;
  let k = 0;
  for (const g of out) {
    const size = base + (extra-- > 0 ? 1 : 0);
    g.push(...ids.slice(k, k + size));
    k += size;
  }
  return out;
}

/**
 * Balanced groups: players in handicap bands (the lowest few, the next few…), one from each band dealt to every
 * group, shuffled within the band. Each group gets a mix of low and high, and the groups change round to round.
 */
function banded<T>(sorted: T[], groups: number, rnd: () => number): T[][] {
  const out: T[][] = Array.from({ length: groups }, () => []);
  for (let b = 0; b * groups < sorted.length; b++) {
    const band = shuffle(sorted.slice(b * groups, b * groups + groups), rnd);
    // Groups short of a player take the last band first, so sizes stay even
    const order = shuffle(out.map((_, i) => i), rnd).sort((x, y) => out[x].length - out[y].length);
    band.forEach((x, i) => out[order[i]].push(x));
  }
  return out;
}

/** "10:00" + 10 minutes × n */
export function teeTimeAt(first: string | null | undefined, n: number, gap = 10): string | null {
  if (!first || !/^\d{1,2}:\d{2}$/.test(first)) return null;
  const [h, m] = first.split(":").map(Number);
  const t = h * 60 + m + n * gap;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Who plays with whom in a round. `ids` are player ids in the wizard's order; `hcp` and `teamOf` by id; `key` maps
 * the wizard's player keys to ids (for picks). Every game gets a tee time when the round has one: four players to
 * a tee time.
 */
export function drawRound(
  w: Pick<Wizard, "who" | "win" | "draw" | "teeGap">,
  round: Pick<WizRound, "format" | "picks" | "time">,
  roundNo: number,
  ids: string[],
  info: { hcp: Record<string, number | null>; teamOf: Record<string, string | null>; idOf: Record<string, string> },
  rnd: () => number = Math.random,
): Game[] {
  const gid = (i: number) => `r${roundNo}g${i + 1}`;
  const solo = (pid: string) => ({ id: pid, playerIds: [pid], teamId: info.teamOf[pid] ?? null });
  const byHcp = (xs: string[]) => [...xs].sort((a, b) => (info.hcp[a] ?? 54) - (info.hcp[b] ?? 54));
  const order = (xs: string[]) => (w.draw === "balanced" ? byHcp(xs) : shuffle(xs, rnd));
  const pairsFormat = isPairs(round.format);
  let games: Game[];

  if (w.who === "solo") games = [{ id: gid(0), sides: [solo(ids[0])], scorerId: ids[0] }];
  else if (w.draw === "pick" && round.picks?.length) {
    // Picked by hand; anyone left out goes in a group of their own at the end
    const placed = new Set<string>();
    games = round.picks
      .map((g, i) => {
        const sides = g.map((side, si) => {
          const ps = side.map((k) => info.idOf[k]).filter(Boolean);
          ps.forEach((p) => placed.add(p));
          return ps.length > 1 || pairsFormat || round.format === "scramble" ? { id: `${gid(i)}-${si + 1}`, playerIds: ps, teamId: info.teamOf[ps[0]] ?? null } : solo(ps[0]);
        });
        return { id: gid(i), name: isMatch(round.format) ? `Match ${i + 1}` : `Group ${i + 1}`, sides: sides.filter((s) => s.playerIds.length), scorerId: sides[0]?.playerIds[0] ?? null };
      })
      .filter((g) => g.sides.length);
    const left = ids.filter((p) => !placed.has(p));
    groupsOf(left).forEach((g) => games.push({ id: gid(games.length), name: `Group ${games.length + 1}`, sides: g.map(solo), scorerId: g[0] }));
  } else if (round.format === "scramble") {
    // A team is one side, one ball
    const teams = [...new Set(ids.map((p) => info.teamOf[p]).filter(Boolean))] as string[];
    games = teams.map((t, i) => {
      const ps = ids.filter((p) => info.teamOf[p] === t);
      return { id: gid(i), name: `Group ${i + 1}`, sides: [{ id: `${gid(i)}-1`, playerIds: ps, teamId: t }], scorerId: ps[0] };
    });
  } else if (w.who === "teams" && isMatch(round.format)) {
    // Team against team: each side's players lined up (shuffled, or by handicap) and paired off in order
    const teams = [...new Set(ids.map((p) => info.teamOf[p]).filter(Boolean))] as string[];
    const [a, b] = teams.map((t) => order(ids.filter((p) => info.teamOf[p] === t)));
    const per = pairsFormat ? 2 : 1;
    games = [];
    for (let i = 0; a && b && i * per < Math.min(a.length, b.length); i++) {
      const pa = a.slice(i * per, i * per + per);
      const pb = b.slice(i * per, i * per + per);
      if (pa.length < per || pb.length < per) break;
      const side = (ps: string[], k: "a" | "b") => (per === 1 ? solo(ps[0]) : { id: `${gid(i)}-${k}`, playerIds: ps, teamId: info.teamOf[ps[0]] ?? null });
      games.push({ id: gid(i), name: `Match ${i + 1}`, sides: [side(pa, "a"), side(pb, "b")], scorerId: pa[0] });
    }
  } else if (isMatch(round.format)) {
    // One against one: random pairs, or players of similar handicap paired
    const xs = ids.length > 2 ? order(ids) : ids;
    games = [];
    for (let i = 0; i + 1 < xs.length; i += 2) games.push({ id: gid(i / 2), name: `Match ${i / 2 + 1}`, sides: [solo(xs[i]), solo(xs[i + 1])], scorerId: xs[i] });
  } else {
    // Groups of up to four: random, or balanced so each group has a spread of handicaps
    const groups = ids.length <= 4 ? [ids] : w.draw === "balanced" ? banded(byHcp(ids), Math.ceil(ids.length / 4), rnd) : groupsOf(order(ids));
    games = groups.map((g, i) => ({ id: gid(i), name: `Group ${i + 1}`, sides: g.map(solo), scorerId: g[0] }));
  }

  return withTeeTimes(games, round.time, w.teeGap ?? 10);
}

/** Tee times for a round's games from the first one: four players to a tee time. */
export function withTeeTimes(games: Game[], first: string | null | undefined, gap = 10): Game[] {
  let slot = 0;
  let filled = 0;
  return games.map((g) => {
    const n = g.sides.reduce((a, s) => a + s.playerIds.length, 0);
    if (filled && filled + n > 4) {
      slot++;
      filled = 0;
    }
    filled += n;
    return { ...g, teeTime: teeTimeAt(first, slot, gap) };
  });
}

/** The course a saved round came from, as the set-up screens refer to it (null: typed in by hand). */
export const courseRefOf = (slug: string) => (slug.startsWith("manual:") ? null : slug.includes(":") ? slug : `local:${slug}`);

/** The course library's name for a round's course (a typed-in card keeps its own "manual:" name). */
export const libraryRef = (slug: string) => (slug.startsWith("manual:") ? slug : (courseRefOf(slug) as string));

/** A saved round's format as the set-up screens name it. */
export function formatOfRound(r: { play: PlayType | null; format: ScoringType }, who: Who): DayFormat {
  if (r.play === "fourball") return "fourball";
  if (r.play === "foursomes" || r.play === "greensomes") return "foursomes";
  if (r.play === "scramble") return "scramble";
  if (r.format === "match") return who === "teams" ? "singles" : "match";
  return r.format;
}

/** Pairs for a knockout: picked, random, or balanced (the lowest handicap with the highest). */
export function knockoutPairs(keys: string[], hcp: Record<string, number | null>, how: KnockoutAnswers["draw"], picked: string[][] | null | undefined, rnd: () => number = Math.random): string[][] {
  if (how === "pick" && picked?.length) return picked;
  const xs = how === "seeded" ? [...keys].sort((a, b) => (hcp[a] ?? 54) - (hcp[b] ?? 54)) : shuffle(keys, rnd);
  const out: string[][] = [];
  if (how === "seeded") for (let i = 0; i < Math.floor(xs.length / 2); i++) out.push([xs[i], xs[xs.length - 1 - i]]);
  else for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
