"use client";

/**
 * Where a clip was filmed: taken quietly when filming starts, but only if the phone already allows location for
 * the site (no extra question while you're filming). Used for the shot's distance when nobody measured it.
 */
let fix: { lat: number; lon: number; accuracy: number; at: number } | null = null;

export async function grabClipFix() {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (p?.state !== "granted") return;
    navigator.geolocation.getCurrentPosition(
      (pos) => (fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() }),
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  } catch {
    /* not supported: no distance for the clip */
  }
}

/** The fix from filming, if it's recent (it's handed over once). */
export function takeClipFix() {
  const f = fix && Date.now() - fix.at < 10 * 60e3 ? fix : null;
  fix = null;
  return f;
}
