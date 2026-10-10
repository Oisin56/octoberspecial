"use client";

/** Scores saved on the course go into a local queue first, then send when
 *  there's signal. Survives page reloads. A later save of the same hole
 *  replaces an earlier unsent one. */

export interface QueuedHole {
  slug: string;
  roundId: string;
  game: string;
  hole: number;
  payload: Record<string, unknown>;
  at: number;
}

const KEY = "os_score_queue_v2";

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
  if (typeof window !== "undefined") window.dispatchEvent(new Event("os-queue"));
}

const same = (a: QueuedHole, b: QueuedHole) =>
  a.slug === b.slug && a.roundId === b.roundId && a.game === b.game && a.hole === b.hole;

export function queued(): QueuedHole[] {
  if (typeof window === "undefined") return [];
  return read();
}

export function enqueue(input: Omit<QueuedHole, "at"> & { at?: number }) {
  const item: QueuedHole = { ...input, at: input.at ?? Date.now() };
  // An unsent "finished" save stays finished when a quick correction replaces it
  const prev = read().find((x) => same(x, item));
  const keepFinal = prev?.payload.final !== false && prev != null && item.payload.final === false;
  write([...read().filter((x) => !same(x, item)), keepFinal ? { ...item, payload: { ...item.payload, final: true } } : item]);
}

/** The newest unsent save of one hole, if any (it beats what the server last sent us). */
export function pendingHole(slug: string, roundId: string, game: string, hole: number): QueuedHole | undefined {
  return read().find((x) => x.slug === slug && x.roundId === roundId && x.game === game && x.hole === hole);
}

let flushing = false;

/** Try to send everything. Returns how many are still waiting. */
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
          body: JSON.stringify({ t: item.slug, roundId: item.roundId, game: item.game, hole: item.hole, ...item.payload }),
        });
        if (r.ok || (r.status >= 400 && r.status < 500)) {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            error = j.error ?? `Hole ${item.hole} was rejected`;
          }
          // Remove this exact save (a newer save of the same hole may have arrived meanwhile)
          write(read().filter((x) => !(same(x, item) && x.at === item.at)));
        } else break; // server trouble: try later
      } catch {
        break; // offline: try later
      }
    }
  } finally {
    flushing = false;
  }
  return { left: read().length, error };
}
