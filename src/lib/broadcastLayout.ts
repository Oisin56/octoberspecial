/**
 * Where each on-screen graphic sits in a film or broadcast clip. Every graphic has its own zone, so nothing
 * ever covers anything else, whatever is on screen at the same time. Zones are in pixels of the output frame.
 *
 *              widescreen (16:9)                 upright (9:16)
 *   score      bottom right                      top right
 *   strap      bottom left (name and hole)       lower third
 *   caption    bottom left (after the strap)     lower third (after the strap)
 *   replay     top left                          top left
 *   flash      upper middle (BIRDIE…)            middle
 *   upright only: the bottom 18% stays clear for Instagram and TikTok's own buttons and text
 */
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type ZoneName = "score" | "strap" | "caption" | "replay" | "flash";

/** Graphics that are never on screen together may share space (the caption follows the strap). */
export const NEVER_TOGETHER: [ZoneName, ZoneName][] = [["strap", "caption"]];

export function zones(W: number, H: number): Record<ZoneName, Zone> & { clearBottom: number; u: number } {
  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  if (portrait) {
    const lowerBottom = H - 420 * u; // the lower third's bottom edge
    return {
      u,
      clearBottom: H * 0.82,
      score: { x: W - 48 * u - 620 * u, y: 170 * u, w: 620 * u, h: 470 * u },
      replay: { x: 48 * u, y: 170 * u, w: 340 * u, h: 90 * u },
      flash: { x: 90 * u, y: H * 0.45, w: W - 180 * u, h: 120 * u },
      strap: { x: 60 * u, y: lowerBottom - 180 * u, w: W - 120 * u, h: 180 * u },
      caption: { x: 60 * u, y: lowerBottom - 240 * u, w: W - 120 * u, h: 240 * u },
    };
  }
  return {
    u,
    clearBottom: H,
    score: { x: W - 72 * u - 600 * u, y: H - 80 * u - 470 * u, w: 600 * u, h: 470 * u },
    replay: { x: 72 * u, y: 64 * u, w: 420 * u, h: 90 * u },
    flash: { x: W / 2 - 450 * u, y: H * 0.24, w: 900 * u, h: 120 * u },
    strap: { x: 80 * u, y: H - 80 * u - 180 * u, w: W * 0.52, h: 180 * u },
    caption: { x: 80 * u, y: H - 80 * u - 240 * u, w: W * 0.52, h: 240 * u },
  };
}

export function overlaps(a: Zone, b: Zone, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
