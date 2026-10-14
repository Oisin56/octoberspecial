/**
 * The on-course shot log: what to offer for each shot on each kind of hole, what's likely next,
 * and the questions the scores raise ("How did Neil make birdie?"). Pure: used on the phone and by the AI.
 */
import type { ShotRow } from "./types";

export type ShotKind = "tee" | "second" | "approach" | "chip" | "bunker" | "putt" | "recovery" | "penalty";

export const KIND_LABEL: Record<ShotKind, string> = {
  tee: "Tee shot",
  second: "Second shot",
  approach: "Approach",
  chip: "Chip",
  bunker: "Bunker",
  putt: "Putt",
  recovery: "Recovery",
  penalty: "Penalty",
};

/** The less common words, one tap deeper: what any shot can be. */
export const MORE_WORDS: { group: string; words: string[] }[] = [
  { group: "Strike", words: ["Duffed", "Chunked", "Thinned", "Topped", "Shanked"] },
  { group: "Direction", words: ["Sliced", "Hooked", "Pulled", "Pushed"] },
  { group: "Distance", words: ["Short", "Long", "Bombed it", "Airmailed the green"] },
  { group: "Trouble", words: ["Water", "Bunker", "Out of bounds", "Trees"] },
  { group: "Putting", words: ["Lipped out", "Tap-in", "Holed", "Three-putt"] },
];

/** A close putt and the tap-in, in one go. */
export const CLOSE_THEN_TAP = "Close, then tap-in";

export const CLUB_GROUPS = ["Driver", "Wood/Hybrid", "Long iron", "Mid iron", "Short iron", "Wedge"] as const;
export const DISTANCES = ["Under 100", "100–150", "150–200", "200+"] as const;

export interface HoleInfo {
  par: number;
  yards?: number | null;
  /** The course guide's note for the hole (hazards are read from it) */
  note?: string;
}

const has = (note: string | undefined, re: RegExp) => !!note && re.test(note);

/** The kinds of shot offered on this hole, in playing order (no more than 7). */
export function kindsFor(h: HoleInfo): ShotKind[] {
  if (h.par === 3) return ["tee", "chip", "bunker", "putt", "recovery"];
  if (h.par >= 5) return ["tee", "second", "approach", "chip", "bunker", "putt", "recovery"];
  return ["tee", "approach", "chip", "bunker", "putt", "recovery"];
}

/** Up to six outcomes for a kind of shot, shaped by the hole (par, and hazards in the course guide). */
export function outcomesFor(kind: ShotKind, h: HoleInfo): string[] {
  const water = has(h.note, /water|lake|pond|river|stream|burn|sea|hazard/i);
  const sand = has(h.note, /bunker|sand/i);
  const trees = has(h.note, /tree|wood|forest|gorse|whin/i);
  switch (kind) {
    case "tee":
      if (h.par === 3) return ["On the green", "Missed left", "Missed right", "Short", water ? "Water" : "Long", "Bunker"];
      {
        const list = ["Fairway", "Left", "Right", "Bunker", "Trees", "Out of bounds"];
        // Water in play (from the course guide): it takes the place of the least likely trouble
        if (water) list[!sand ? 3 : !trees ? 4 : 5] = "Water";
        return list;
      }
    case "second":
      return ["On in two", "Just short", "Laid up", "Bunker", water ? "Water" : "Missed left", "Trees"];
    case "approach":
      return ["Stiff", "On the green", "Missed left", "Missed right", sand ? "Bunker" : "Short", water ? "Water" : "Long"];
    case "chip":
      return ["Holed", "Close", "On the green", "Too strong", "Duffed", "Bunker"];
    case "bunker":
      return ["Holed", "Close", "On the green", "Still in it", "Thinned it", "Over the green"];
    case "putt":
      return ["Holed, tap-in", "Holed from 10 ft", "Holed from 30 ft+", "Lip-out", "Missed", "Three-putt"];
    case "recovery":
      return ["Great escape", "Back in play", "On the green", "Still in trouble", water ? "Water" : "Unplayable", "Holed"];
    case "penalty":
      return ["Penalty stroke"];
  }
}

/** The likely kind of a stroke from where it was played (yards to the green) and which stroke it is. */
export function kindFromDistance(from: number | null, seq: number, par: number): ShotKind | null {
  if (seq === 1) return "tee";
  if (from == null) return null;
  if (from <= 15) return "putt";
  if (from <= 60) return "chip";
  if (par >= 5 && seq === 2 && from > 200) return "second";
  return "approach";
}

const holed = (o: string) => /^Holed/.test(o);

/** The likely next shot for a player, from their shots on this hole so far (null once they've holed out). */
export function nextKind(shots: { kind: string; outcome: string }[], h: HoleInfo): ShotKind | null {
  const last = shots[shots.length - 1];
  if (!last) return "tee";
  const o = last.outcome;
  if (holed(o)) return null;
  switch (last.kind as ShotKind) {
    case "tee":
      if (h.par === 3) return o === "On the green" ? "putt" : o === "Bunker" ? "bunker" : o === "Water" ? "tee" : "chip";
      if (o === "Out of bounds") return "tee";
      if (o === "Trees") return "recovery";
      return h.par >= 5 ? "second" : "approach";
    case "second":
      return o === "On in two" ? "putt" : o === "Just short" ? "chip" : o === "Bunker" ? "bunker" : o === "Trees" ? "recovery" : "approach";
    case "approach":
      return o === "Stiff" || o === "On the green" ? "putt" : o === "Bunker" ? "bunker" : "chip";
    case "chip":
    case "bunker":
      return o === "Bunker" || o === "Still in it" ? "bunker" : o === "Close" || o === "On the green" ? "putt" : "chip";
    case "putt":
      return "putt";
    case "recovery":
      return o === "On the green" ? "putt" : o === "Still in trouble" ? "recovery" : "approach";
    case "penalty":
      return shots.length >= 2 ? nextKind(shots.slice(0, -1), h) : "approach";
  }
  return null;
}

/** Shots worth asking the club for (a good one, or a disaster). */
export function clubWorthAsking(kind: string, outcome: string) {
  if (kind === "putt") return false;
  return /Stiff|Holed|On in two|Fairway|On the green|Great escape|Close/.test(outcome) || /Water|Out of bounds|Duffed|Thinned/.test(outcome);
}

/** A short line for a shot: "Tee shot: right" / "Putt: holed from 30 ft+". */
export function shotLine(s: { kind: string; outcome: string; club?: string | null; distance?: string | null }) {
  const k = KIND_LABEL[s.kind as ShotKind] ?? s.kind;
  return `${k}: ${s.outcome.toLowerCase()}${s.club ? ` (${s.club.toLowerCase()})` : ""}${s.distance ? `, ${s.distance} yds` : ""}`;
}

// ------------------------------------------------------------ questions the scores raise

export interface Prompt {
  playerId: string;
  /** "How did Neil make birdie?" */
  question: string;
  /** One-tap answers, each logging a shot */
  answers: { label: string; kind: ShotKind; outcome: string }[];
  /** A badge for the player's tab */
  badge: string;
}

/** Birdie or better, or double bogey or worse: a question with likely answers. */
export function scorePrompt(name: string, playerId: string, gross: number | null | undefined, h: HoleInfo): Prompt | null {
  if (gross == null) return null;
  const toPar = gross - h.par;
  if (toPar <= -1) {
    const word = toPar === -1 ? "birdie" : toPar === -2 ? (gross === 1 ? "a hole in one" : "eagle") : "albatross";
    if (gross === 1) return { playerId, question: `A hole in one for ${name}!`, badge: "Ace", answers: [{ label: "Straight in", kind: "tee", outcome: "Holed" }] };
    return {
      playerId,
      question: `How did ${name} make ${word}?`,
      badge: word === "birdie" ? "Birdie" : "Eagle",
      answers: [
        { label: "Long putt", kind: "putt", outcome: "Holed from 30 ft+" },
        { label: "Holed a 10-footer", kind: "putt", outcome: "Holed from 10 ft" },
        { label: "Stiff approach, tap-in", kind: "approach", outcome: "Stiff" },
        { label: "Chip-in", kind: "chip", outcome: "Holed" },
        h.par >= 5 ? { label: "On in two", kind: "second", outcome: "On in two" } : { label: "Holed out", kind: "approach", outcome: "Holed" },
        { label: "From the bunker", kind: "bunker", outcome: "Holed" },
      ],
    };
  }
  if (toPar >= 2) {
    return {
      playerId,
      question: `What went wrong for ${name}?`,
      badge: toPar === 2 ? "Double" : `+${toPar}`,
      answers: [
        { label: "Water", kind: h.par === 3 ? "tee" : "approach", outcome: "Water" },
        { label: "Out of bounds", kind: "tee", outcome: "Out of bounds" },
        { label: "Trees", kind: "tee", outcome: "Trees" },
        { label: "Bunker trouble", kind: "bunker", outcome: "Still in it" },
        { label: "Duffed a chip", kind: "chip", outcome: "Duffed" },
        { label: "Three-putt", kind: "putt", outcome: "Three-putt" },
      ],
    };
  }
  return null;
}

/**
 * Matchplay: only the big moments. diffs = match margin (side A minus side B) after each hole played, in order.
 * Returns the headline, or null.
 */
export function matchMoment(diffs: number[], hole: number, total: number, winnerName: string | null, aName: string, bName: string): string | null {
  if (!diffs.length) return null;
  const after = diffs[diffs.length - 1];
  const before = diffs.length > 1 ? diffs[diffs.length - 2] : 0;
  const remaining = total - diffs.length;
  const lead = after > 0 ? aName : bName;
  if (after !== 0 && Math.abs(before) <= total - (diffs.length - 1) && Math.abs(after) > remaining) return `${lead} wins the match`;
  if (after !== 0 && remaining > 0 && Math.abs(after) === remaining && Math.abs(before) !== remaining + 1) return `${lead} goes dormie`;
  if (after === 0 && before !== 0 && diffs.slice(0, -1).some((d) => Math.abs(d) >= 2)) return `Back to all square${winnerName ? `: ${winnerName} fights back` : ""}`;
  // Late on, going ahead from all square when the other side had led earlier: the lead has changed hands
  if (hole >= 15 && after !== 0 && before === 0 && diffs.some((d) => Math.sign(d) === -Math.sign(after))) return `${lead} takes the lead`;
  return null;
}

/** Shots for one player on one hole, in the order they were logged. */
export function playerShots(shots: ShotRow[] | undefined, roundId: string, hole: number, playerId: string) {
  return (shots ?? []).filter((s) => s.round_id === roundId && s.hole === hole && s.player_id === playerId).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
}

/** Feed and film tags that follow from a shot. */
export function tagsFor(kind: string, outcome: string): string[] {
  const t: string[] = [];
  if (/^Holed/.test(outcome) && (kind === "chip" || kind === "bunker")) t.push("chip-in");
  if (outcome === "Holed from 30 ft+") t.push("long putt");
  if (outcome === "Lip-out") t.push("lip-out");
  if (outcome === "Three-putt") t.push("3-putt");
  if (outcome === "Water") t.push("water");
  if (outcome === "Bunker" || outcome === "Still in it" || kind === "bunker") t.push("bunker");
  if (outcome === "Out of bounds") t.push("OB");
  if (outcome === "Great escape") t.push("great recovery");
  if (outcome === "Shanked") t.push("shank");
  if (outcome === "Lipped out") t.push("lip-out");
  if (outcome === "Missed" || outcome === "Just short") t.push("near miss");
  return [...new Set(t)].slice(0, 5);
}

/** Per-hole, per-player timelines for the AI: "H7 Neil: tee shot: right; approach: stiff (wedge)". */
export function shotsTimeline(shots: ShotRow[] | undefined, roundId: string, names: Record<string, string>): string {
  const mine = (shots ?? []).filter((s) => s.round_id === roundId).sort((a, b) => a.hole - b.hole || a.logged_at.localeCompare(b.logged_at));
  const lines: string[] = [];
  const keys = [...new Set(mine.map((s) => `${s.hole}|${s.player_id}`))];
  for (const k of keys) {
    const [hole, pid] = k.split("|");
    const list = mine.filter((s) => String(s.hole) === hole && s.player_id === pid);
    lines.push(`- H${hole} ${names[pid] ?? pid}: ${list.map(shotLine).join("; ")}`);
  }
  return lines.join("\n");
}
