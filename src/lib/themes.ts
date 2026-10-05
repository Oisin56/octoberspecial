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
}

export const PALETTES: Record<Exclude<ThemeId, "custom">, Palette> = {
  clubhouse: { board: "#1f3d2b", boardDeep: "#142a1d", tile: "#f7f7f2", mist: "#e4e9e5", red: "#c8102e", bracken: "#a8741f", ink: "#18231d" },
  links: { board: "#1d3150", boardDeep: "#142339", tile: "#f4ecd6", mist: "#ebe7dc", red: "#b3261e", bracken: "#9a6b1c", ink: "#18231d" },
  championship: { board: "#10264a", boardDeep: "#0a1a33", tile: "#ffffff", mist: "#eef1f6", red: "#d0021b", bracken: "#8a6d1e", ink: "#121a29" },
  teamcup: { board: "#262a33", boardDeep: "#1a1d24", tile: "#ffffff", mist: "#ecedf0", red: "#c8102e", bracken: "#8f6a20", ink: "#18231d" },
};

export function paletteFor(theme: ThemeId, custom?: { primary?: string; accent?: string; background?: string } | null): Palette {
  if (theme === "custom") {
    const base = PALETTES.clubhouse;
    return {
      ...base,
      board: custom?.primary ?? base.board,
      boardDeep: custom?.primary ?? base.boardDeep,
      red: custom?.accent ?? base.red,
      mist: custom?.background ?? base.mist,
    };
  }
  return PALETTES[theme] ?? PALETTES.clubhouse;
}
