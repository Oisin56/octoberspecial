import type { ThemeId } from "./types";

/** Server-side copy of the theme colours (for rendered cards). Keep in step with globals.css. */
export interface Palette {
  board: string;
  boardDeep: string;
  tile: string;
  mist: string;
  red: string;
  bracken: string;
  ink: string;
  /** The bright accent (scoreboard trim, status bars) and the text that sits on it */
  gold?: string;
  onGold?: string;
}

export const PALETTES: Record<Exclude<ThemeId, "custom">, Palette> = {
  clubhouse: { board: "#1f3d2b", boardDeep: "#142a1d", tile: "#f7f7f2", mist: "#e4e9e5", red: "#c8102e", bracken: "#a8741f", ink: "#18231d" },
  links: { board: "#0e2244", boardDeep: "#08162e", tile: "#ffffff", mist: "#edf0f4", red: "#c8102e", bracken: "#8f7200", ink: "#0e1a2c", gold: "#f5c400", onGold: "#0e1a2c" },
  championship: { board: "#00407a", boardDeep: "#002b55", tile: "#ffffff", mist: "#f1f4f8", red: "#e4173e", bracken: "#b3122f", ink: "#0d1b2e", gold: "#e4173e", onGold: "#ffffff" },
  spring: { board: "#0d5134", boardDeep: "#083b25", tile: "#ffffff", mist: "#f2f0e6", red: "#c8102e", bracken: "#7a6a12", ink: "#13241a", gold: "#f2cf3c", onGold: "#13241a" },
  teamcup: { board: "#0c1a3a", boardDeep: "#07102a", tile: "#ffffff", mist: "#eef0f5", red: "#e01f2d", bracken: "#8a6f2a", ink: "#0f1830", gold: "#dcc06c", onGold: "#0c1a3a" },
};

export function paletteFor(theme: ThemeId, custom?: { primary?: string; accent?: string; background?: string } | null): Palette {
  if (theme === "custom") {
    const base = PALETTES.clubhouse;
    // Colours only: anything else typed in is ignored (they go into emails and styles)
    const hex = (c: unknown, d: string) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : d);
    return {
      ...base,
      board: hex(custom?.primary, base.board),
      boardDeep: hex(custom?.primary, base.boardDeep),
      red: hex(custom?.accent, base.red),
      mist: hex(custom?.background, base.mist),
    };
  }
  // Clubhouse is retired as a choice: those tournaments are shown in Spring Classic
  return PALETTES[theme === "clubhouse" ? "spring" : theme] ?? PALETTES.spring;
}
