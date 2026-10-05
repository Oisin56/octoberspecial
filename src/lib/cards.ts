import "server-only";
import { createHmac } from "node:crypto";
import type { ThemeId } from "./types";

export interface CardSpec {
  k: "title" | "chapter" | "result" | "standings" | "caption";
  h: string; // heading
  s?: string; // sub line
  l?: [string, string][]; // rows: label, value
  e?: string; // small line above the heading
  theme: ThemeId;
  colors?: { primary?: string; accent?: string; background?: string } | null;
  w: number;
  ht: number;
}

export function signCard(d: string) {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(`card:${d}`).digest("base64url").slice(0, 24);
}

/** Public, signed URL for a rendered card image. */
export function cardUrl(origin: string, spec: CardSpec) {
  const d = Buffer.from(JSON.stringify(spec)).toString("base64url");
  return `${origin}/api/director/card?d=${d}&sig=${signCard(d)}`;
}
