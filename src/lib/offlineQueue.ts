"use client";

/** Scores saved on the course go into a local queue first, then send when
 *  there's signal. Survives page reloads. Later saves of the same hole
 *  replace earlier unsent ones. */

export interface QueuedHole {
  roundId: string;
  hole: number;
  payload: Record<string, unknown>;
  at: number;
}

const KEY = "os_score_queue_v1";

function read(): QueuedHole[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(q: QueuedHole[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage blocked: we still try to send directly */
  }
  window.dispatchEvent(new Event("os-queue"));
}

export function queued(): QueuedHole[] {
  return read();
}

export function enqueue(item: QueuedHole) {
  const q = read().filter((x) => !(x.roundId === item.roundId && x.hole === item.hole));
  q.push(item);
  write(q);
}

let flushing = false;

/** Try to send everything. Returns number still waiting. */
export async function flush(): Promise<{ left: number; error?: string }> {
  if (flushing) return { left: read().length };
  flushing = true;
  let error: string | undefined;
  try {
    for (const item of read()) {
      try {
        const r = await fetch("/api/score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roundId: item.roundId, hole: item.hole, ...item.payload }),
        });
        if (r.ok) {
          write(read().filter((x) => !(x.roundId === item.roundId && x.hole === item.hole && x.at === item.at)));
        } else if (r.status >= 400 && r.status < 500) {
          // Rejected (e.g. not the scorer) — don't retry forever
          const j = await r.json().catch(() => ({}));
          error = j.error ?? `Hole ${item.hole} was rejected`;
          write(read().filter((x) => x !== item && !(x.roundId === item.roundId && x.hole === item.hole && x.at === item.at)));
        } else {
          break; // server trouble: try later
        }
      } catch {
        break; // offline: try later
      }
    }
  } finally {
    flushing = false;
  }
  return { left: read().length, error };
}
