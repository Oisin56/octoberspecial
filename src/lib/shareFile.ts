"use client";

import { mediaUrl } from "./supabase";
import type { PostRow } from "./types";

/**
 * Sharing a clip to Instagram, WhatsApp and the rest should be instant: the video file is fetched quietly while
 * the clip is on screen, so tapping Share opens the phone's share sheet straight away with the file attached.
 * The finished broadcast version when it's ready; otherwise the clip itself (if it's small enough to fetch).
 */
const cache = new Map<string, File | "loading" | "none">();
const MAX_PLAIN = 15 * 1024 * 1024;

const ext = (type: string) => (/mp4/.test(type) ? "mp4" : /quicktime/.test(type) ? "mov" : /webm/.test(type) ? "webm" : "mp4");

/** The file to share for a clip: the broadcast version, or the clip itself. */
function source(p: PostRow) {
  if (p.broadcast_status === "done" && p.broadcast_path) return { key: `${p.id}:bc`, url: mediaUrl(p.broadcast_path)!, plain: false };
  if (!p.media_path || p.media_path.startsWith("http")) return null;
  return { key: `${p.id}:plain`, url: mediaUrl(p.media_path)!, plain: true };
}

export function canShareFiles() {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [new File([""], "x.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

/** Fetch the clip's file in the background (phones that can share files only). */
export async function prefetchClip(p: PostRow, name: string) {
  const src = source(p);
  if (!src || cache.has(src.key) || !canShareFiles()) return;
  cache.set(src.key, "loading");
  try {
    if (src.plain) {
      const head = await fetch(src.url, { method: "HEAD" });
      const size = Number(head.headers.get("content-length") ?? 0);
      if (!head.ok || !size || size > MAX_PLAIN) return void cache.set(src.key, "none");
    }
    const r = await fetch(src.url);
    if (!r.ok) return void cache.set(src.key, "none");
    const blob = await r.blob();
    const type = blob.type || "video/mp4";
    const safe = name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").toLowerCase();
    cache.set(src.key, new File([blob], `${safe}.${ext(type)}`, { type }));
  } catch {
    cache.delete(src.key);
  }
}

/** The fetched file for a clip, if it's ready. */
export function clipFile(p: PostRow): File | null {
  const src = source(p);
  const f = src ? cache.get(src.key) : null;
  return f instanceof File ? f : null;
}
