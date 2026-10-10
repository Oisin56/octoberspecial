import "server-only";
import { createHmac } from "node:crypto";
import type { ThemeId } from "./types";
import type { ScoreBug } from "./scorebug";

export interface CardSpec {
  k: "title" | "chapter" | "result" | "standings" | "caption" | "bug" | "strap" | "replay" | "sting";
  /** Swipe layer: a = main band, b = lighter leading band, c = gold edge */
  layer?: "a" | "b" | "c";
  h: string; // heading
  s?: string; // sub line
  l?: [string, string][]; // rows: label, value
  e?: string; // small line above the heading
  b?: ScoreBug; // score panel (k = bug)
  wt?: boolean; // score panel: show the round and course too (whole-trip films)
  theme: ThemeId;
  colors?: { primary?: string; accent?: string; background?: string } | null;
  w: number;
  ht: number;
  /** Full cards: paint a background in the tournament's colours (nothing behind the card) */
  bg?: boolean;
  /** Design version: part of the address, so a new design is never served from an old cached image */
  v?: number;
}

/** Bump whenever the card design changes. */
export const CARD_DESIGN = 4;

export function signCard(d: string) {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(`card:${d}`).digest("base64url").slice(0, 24);
}

/** Public, signed URL for a rendered card image. */
export function cardUrl(origin: string, spec: CardSpec) {
  const d = Buffer.from(JSON.stringify({ ...spec, v: CARD_DESIGN })).toString("base64url");
  return `${origin}/api/director/card?d=${d}&sig=${signCard(d)}`;
}
