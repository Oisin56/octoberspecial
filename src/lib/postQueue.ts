"use client";

/** Notes from the course (moments after a hole) wait on the phone when there's no signal, then send. */
export interface QueuedPost {
  id: string;
  slug: string;
  body: Record<string, unknown>;
  at: number;
}

const KEY = "mgs_post_queue_v1";

function read(): QueuedPost[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(q: QueuedPost[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {}
  window.dispatchEvent(new Event("os-clip-queue"));
}

export function queuedPosts(slug: string) {
  return read().filter((p) => p.slug === slug);
}

export function queuePost(slug: string, body: Record<string, unknown>) {
  write([...read(), { id: crypto.randomUUID(), slug, body, at: Date.now() }]);
}

let busy = false;
/** Send what's waiting. Returns how many are left. */
export async function flushPosts(slug: string): Promise<number> {
  if (busy) return queuedPosts(slug).length;
  busy = true;
  try {
    for (const p of queuedPosts(slug)) {
      try {
        const r = await fetch("/api/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: slug, ...p.body }) });
        if (r.status === 401 || r.status === 403) break; // log in again; keep it
        if (r.ok || (r.status >= 400 && r.status < 500)) write(read().filter((x) => x.id !== p.id));
        else break;
      } catch {
        break; // offline
      }
    }
  } finally {
    busy = false;
  }
  return queuedPosts(slug).length;
}
