"use client";

/** This phone's own id (kept in the browser): one like per post per phone. Shared with the highlights votes. */
export function deviceId() {
  try {
    let v = localStorage.getItem("os_voter");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("os_voter", v);
    }
    return v;
  } catch {
    return "anon-device";
  }
}

/** The same key the server stores for this phone's likes (sha-256 of the id), so the feed knows what you liked. */
export async function myLikerKey(): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mgs-like:${deviceId()}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  } catch {
    return null;
  }
}

const listKey = (slug: string, what: string) => `mgs_${what}_${slug}`;
export function readIds(slug: string, what: "liked" | "reported"): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(listKey(slug, what)) ?? "[]"));
  } catch {
    return new Set();
  }
}
export function writeIds(slug: string, what: "liked" | "reported", ids: Set<string>) {
  try {
    localStorage.setItem(listKey(slug, what), JSON.stringify([...ids].slice(-500)));
  } catch {}
}
