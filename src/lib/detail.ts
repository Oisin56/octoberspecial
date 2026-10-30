/**
 * Telling a shot: the same four rows every time (shot, club, outcome, more), each with its likeliest answers
 * first, shaped by the hole and where the shot was played from. Pure: used on the phone, by the clips and by
 * the AI writer. Nothing here fills anything in: these are suggestions, saved only when someone taps one.
 */
import type { ShotKind } from "./shots";

// ------------------------------------------------------------ the bag

export const BAG = [
  "Driver",
  "3 wood",
  "5 wood",
  "7 wood",
  "Hybrid",
  "3 iron",
  "4 iron",
  "5 iron",
  "6 iron",
  "7 iron",
  "8 iron",
  "9 iron",
  "Pitching wedge",
  "Gap wedge",
  "Sand wedge",
  "Lob wedge",
  "Putter",
] as const;

/** Shorter names for a tile when space is tight */
export const CLUB_SHORT: Record<string, string> = { "Pitching wedge": "PW", "Gap wedge": "GW", "Sand wedge": "SW", "Lob wedge": "LW" };

/** Clubs from before (a group, not a club): still read and shown */
export const OLD_CLUBS = ["Wood/Hybrid", "Long iron", "Mid iron", "Short iron", "Wedge"];

// ------------------------------------------------------------ the rest of a shot

export const PUTT_LENGTHS = ["Tap-in", "3 to 10 ft", "10 to 30 ft", "30 ft+"] as const;
export const CONTACT = ["Flushed", "Heel", "Toe", "Topped", "Chunked", "Shanked"] as const;
export const SHAPE = ["Dead straight", "Draw", "Fade", "Hook", "Slice"] as const;
export const FLIGHT = ["High", "Normal", "Low"] as const;
/** The wind on a hole: which way it blows for the hole, then how strong. "No wind" needs no strength. */
export const WIND_DIRECTIONS = ["Hurting", "Helping", "Left to right", "Right to left", "No wind"] as const;
export const WIND_STRENGTHS = ["Light", "Strong"] as const;
/** Every wind that can be saved: "No wind", or a direction and a strength ("Hurting, strong") */
export const WIND: string[] = ["No wind", ...WIND_DIRECTIONS.filter((d) => d !== "No wind").flatMap((d) => WIND_STRENGTHS.map((s) => `${d}, ${s.toLowerCase()}`))];
export const windOf = (direction: string, strength?: string | null) => (direction === "No wind" ? "No wind" : `${direction}, ${(strength ?? "Light").toLowerCase()}`);

/** Every kind of shot, in the order Other shows them */
export const ALL_KINDS: ShotKind[] = ["tee", "second", "approach", "chip", "bunker", "putt", "recovery", "penalty"];

/** What a stroke is called on its card */
export const KIND_WORD: Record<ShotKind, string> = {
  tee: "Tee shot",
  second: "Second",
  approach: "Approach",
  chip: "Chip",
  bunker: "Bunker shot",
  putt: "Putt",
  recovery: "Recovery",
  penalty: "Penalty",
};

// ------------------------------------------------------------ what comes first

/**
 * The three likeliest kinds for a stroke that isn't the tee shot. `from` = yards to the middle of the green when it
 * was played (null when not measured); `before` = the kind of the stroke before, when told.
 */
export function kindOrder(from: number | null, par: number, before: ShotKind | null, onGreen = false): ShotKind[] {
  if (onGreen || (from != null && from <= 15)) return ["putt", "chip", "bunker"];
  if (from != null && from < 60) return ["chip", "bunker", "putt"];
  if (from != null && par >= 5 && from >= 200) return ["second", "recovery", "approach"];
  if (from != null) return ["approach", "recovery", "chip"];
  // Not measured: whatever usually follows the stroke before
  switch (before) {
    case "tee":
      return par >= 5 ? ["second", "approach", "recovery"] : par === 3 ? ["chip", "putt", "bunker"] : ["approach", "recovery", "chip"];
    case "second":
      return ["approach", "chip", "recovery"];
    case "approach":
    case "recovery":
      return ["chip", "putt", "bunker"];
    case "chip":
    case "bunker":
    case "putt":
      return ["putt", "chip", "bunker"];
    default:
      return par === 3 ? ["chip", "putt", "bunker"] : ["approach", "chip", "putt"];
  }
}

/** The bands of the club table: over this many yards (so 165 is in "150 to 165"), these three first */
const CLUB_BANDS: [number, string[]][] = [
  [199, ["3 wood", "5 wood", "Hybrid"]],
  [180, ["5 wood", "Hybrid", "5 iron"]],
  [165, ["6 iron", "5 iron", "Hybrid"]],
  [150, ["7 iron", "6 iron", "8 iron"]],
  [135, ["8 iron", "7 iron", "9 iron"]],
  [120, ["9 iron", "8 iron", "Pitching wedge"]],
  [100, ["Pitching wedge", "9 iron", "Gap wedge"]],
  [59, ["Gap wedge", "Pitching wedge", "Sand wedge"]],
  [-1, ["Sand wedge", "Lob wedge", "Pitching wedge"]],
];

/** A player's own past choices: the club and the yards it was played from */
export interface ClubUse {
  club: string;
  from: number;
}

/**
 * The three likeliest clubs. A tee shot on a par 4 or 5: Driver, 3 wood, Hybrid. Otherwise by the yards it was played
 * from (a par 3's tee shot: the hole's length). Once a player has picked a club a few times from about this far, it
 * moves to the front for them.
 */
export function clubOrder(kind: ShotKind, par: number, from: number | null, history: ClubUse[] = []): string[] {
  if (kind === "putt") return ["Putter"];
  if (kind === "bunker") return withHistory(["Sand wedge", "Lob wedge", "Gap wedge"], from, history);
  if (kind === "tee" && par >= 4) return withHistory(["Driver", "3 wood", "Hybrid"], from, history, true);
  if (from == null) {
    if (kind === "chip") return ["Sand wedge", "Pitching wedge", "Lob wedge"];
    if (kind === "second") return ["3 wood", "5 wood", "Hybrid"];
    return ["7 iron", "8 iron", "6 iron"];
  }
  const band = CLUB_BANDS.find(([min]) => from > min)![1];
  return withHistory(band, from, history);
}

function withHistory(base: string[], from: number | null, history: ClubUse[], tee = false): string[] {
  // Their own club from about this far (within 10 yards), picked at least twice
  const near = history.filter((h) => h.club !== "Putter" && (tee || (from != null && Math.abs(h.from - from) <= 10)));
  const counts = new Map<string, number>();
  for (const h of near) counts.set(h.club, (counts.get(h.club) ?? 0) + 1);
  const theirs = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([c]) => c)[0];
  if (!theirs) return base;
  return [theirs, ...base.filter((c) => c !== theirs)].slice(0, 3);
}

export interface HoleSigns {
  par: number;
  /** Water in play (from the course guide) */
  water?: boolean;
}

/** Water in play, read from the course guide's note for the hole */
export const waterIn = (note?: string | null) => !!note && /water|lake|pond|river|stream|burn|sea|ditch/i.test(note);

/** Six outcomes for a kind of shot on this hole, likeliest first. Water takes the last place when it's in play. */
export function outcomeOrder(kind: ShotKind, h: HoleSigns): string[] {
  const list = ((): string[] => {
    switch (kind) {
      case "tee":
        return h.par === 3 ? ["On the green", "Short", "Left", "Right", "Long", "Bunker"] : ["Fairway", "Left rough", "Right rough", "Bunker", "Trees", "Out of bounds"];
      case "second":
        return ["Fairway", "Left rough", "Right rough", "Short of the green", "On the green", "Bunker"];
      case "approach":
        return ["On the green", "Short", "Left", "Right", "Long", "Bunker"];
      case "chip":
        return ["Close", "On the green", "Short", "Long", "Still off the green", "Bunker"];
      case "bunker":
        return ["On the green", "Close", "Still in the bunker", "Short", "Over the green", "Left in the rough"];
      case "recovery":
        return ["Back in play", "Short of the green", "On the green", "Still in trouble", "Bunker", "Out of bounds"];
      case "putt":
        return ["Close", "Short", "Long", "Missed left", "Missed right", "Lipped out"];
      case "penalty":
        return [];
    }
  })();
  if (h.water && list.length && !list.includes("Water")) list[list.length - 1] = "Water";
  return list;
}

/** Outcomes that add a penalty stroke after them */
export const PENALTY_OUTCOMES = ["Water", "Out of bounds"];

/** Every outcome the app has ever offered (for checking what's sent) */
export const ALL_OUTCOMES = new Set<string>([
  ...(["tee", "second", "approach", "chip", "bunker", "recovery", "putt"] as ShotKind[]).flatMap((k) => [...outcomeOrder(k, { par: 3 }), ...outcomeOrder(k, { par: 4 }), "Water"]),
  "Holed",
  "Penalty",
]);

// ------------------------------------------------------------ the wind

/**
 * The wind on a hole, in golfers' words, from the weather (speed in km/h, the direction it comes FROM in degrees)
 * and the hole's direction (from the tee to the green, degrees from north). Null when either isn't known.
 */
export function windWord(speedKmh: number | null | undefined, fromDeg: number | null | undefined, holeBearing: number | null | undefined): string | null {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return null;
  if (speedKmh < 8) return "No wind";
  if (fromDeg == null || holeBearing == null) return null;
  // 0 = blowing straight into the player's face (coming from the green), 180 = straight behind
  const a = (((fromDeg - holeBearing) % 360) + 360) % 360;
  const strength = speedKmh >= 25 ? "Strong" : "Light";
  if (a <= 45 || a >= 315) return windOf("Hurting", strength);
  if (a >= 135 && a <= 225) return windOf("Helping", strength);
  // From the right of the line (45 to 135) it blows right to left
  return windOf(a < 180 ? "Right to left" : "Left to right", strength);
}

/** Degrees from north, from one point to another */
export function bearing(from: [number, number], to: [number, number]) {
  const r = Math.PI / 180;
  const [la1, lo1] = [from[0] * r, from[1] * r];
  const [la2, lo2] = [to[0] * r, to[1] * r];
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

// ------------------------------------------------------------ words

/** A shot in one line: "Tee shot, 7 iron: on the green". Putts: "Putt, 10 to 30 ft: holed". */
export function shotWords(s: { kind: string; outcome?: string | null; club?: string | null; distance?: string | null }) {
  const k = KIND_WORD[s.kind as ShotKind] ?? s.kind;
  const what = s.kind === "putt" ? (s.distance ?? null) : s.club && s.club !== "Putter" ? s.club : null;
  const how = s.outcome ? s.outcome.toLowerCase() : null;
  return `${k}${what ? `, ${what}` : ""}${how ? `: ${how}` : ""}`;
}

/** The extras in a few words: "flushed, draw, high" */
export function extrasWords(s: { contact?: string | null; shape?: string | null; flight?: string | null }) {
  return [s.contact, s.shape, s.flight && s.flight !== "Normal" ? s.flight : null].filter(Boolean).map((x) => x!.toLowerCase()).join(", ");
}
