"use client";

import type { ClipProbe } from "./director-types";

/**
 * Watch a clip in the browser: its shape, length and a few small stills for the AI director.
 * Never throws: a clip that can't be read comes back with what we managed (or nothing).
 */
async function probeOne(id: string, src: string, maxSide = 384): Promise<ClipProbe | null> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = src;
  const once = (ev: string, ms: number) =>
    new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), ms);
      v.addEventListener(ev, () => (clearTimeout(t), res(true)), { once: true });
      v.addEventListener("error", () => (clearTimeout(t), res(false)), { once: true });
    });
  try {
    if (!(await once("loadedmetadata", 15000))) return null;
    const w = v.videoWidth,
      h = v.videoHeight;
    const duration = Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null;
    const frames: string[] = [];
    if (w && h && duration) {
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext("2d");
      for (const at of [0.15, 0.5, 0.85]) {
        v.currentTime = Math.min(duration - 0.05, Math.max(0, duration * at));
        if (!(await once("seeked", 8000))) break;
        try {
          ctx?.drawImage(v, 0, 0, c.width, c.height);
          frames.push(c.toDataURL("image/jpeg", 0.6).split(",")[1]);
        } catch {
          break; // the video's host didn't allow reading pixels: shape and length still help
        }
      }
    }
    return { id, w, h, duration, frames };
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

/** Probe clips a few at a time, reporting progress. */
export async function probeClips(clips: { id: string; src: string }[], onProgress?: (done: number, total: number) => void): Promise<ClipProbe[]> {
  const out: ClipProbe[] = [];
  let done = 0;
  const queue = [...clips];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const p = await probeOne(c.id, c.src).catch(() => null);
      if (p) out.push(p);
      onProgress?.(++done, clips.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/** The film shape most of the clips were filmed in. */
export function majorityShape(probes: ClipProbe[]): "16:9" | "9:16" | null {
  const sized = probes.filter((p) => p.w && p.h);
  if (!sized.length) return null;
  const upright = sized.filter((p) => p.h > p.w).length;
  return upright > sized.length / 2 ? "9:16" : "16:9";
}
