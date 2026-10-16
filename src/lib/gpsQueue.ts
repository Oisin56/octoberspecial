"use client";
import { isSample } from "./sampleFlag";

/**
 * GPS readings are kept on the phone the moment they're taken, then sent when there's signal; moving a distance to
 * another stroke (or taking it off) works the same way. The card shows them straight away either way.
 */
import type { GpsRow } from "./types";

interface GpsOp {
  op: "save" | "place";
  slug: string;
  clientId: string;
  reading?: GpsRow & { lat: number; lon: number };
  place?: { seq: number | null; ignored: boolean };
  at: number;
}

const KEY = "mgs_gps_queue_v1";
/** Sent, but the page may not have heard back from the server yet: still shown for a few minutes */
const SENT = "mgs_gps_sent_v1";
const SENT_FOR = 3 * 60e3;
const read = (): GpsOp[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
const write = (q: GpsOp[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-200)));
  } catch {}
  window.dispatchEvent(new Event("mgs-gps"));
};

const readSent = (): (GpsOp & { sentAt: number })[] => {
  try {
    return (JSON.parse(localStorage.getItem(SENT) ?? "[]") as (GpsOp & { sentAt: number })[]).filter((o) => Date.now() - o.sentAt < SENT_FOR);
  } catch {
    return [];
  }
};
const markSent = (o: GpsOp) => {
  try {
    const keep = readSent().filter((x) => !(x.op === o.op && x.clientId === o.clientId));
    localStorage.setItem(SENT, JSON.stringify([...keep, { ...o, sentAt: Date.now() }].slice(-100)));
  } catch {}
};

export function saveReading(slug: string, r: GpsRow & { lat: number; lon: number }) {
  write([...read(), { op: "save", slug, clientId: r.client_id, reading: r, at: Date.now() }]);
}

export function placeReading(slug: string, clientId: string, place: { seq: number | null; ignored: boolean }) {
  write([...read().filter((o) => !(o.op === "place" && o.clientId === clientId)), { op: "place", slug, clientId, place, at: Date.now() }]);
}

let busy = false;
export async function flushGps(slug: string) {
  if (isSample(slug)) return; // the sample round: kept on the phone
  if (busy) return;
  busy = true;
  try {
    for (const o of read().filter((x) => x.slug === slug)) {
      const body =
        o.op === "save"
          ? { t: slug, clientId: o.clientId, roundId: o.reading!.round_id, hole: o.reading!.hole, playerId: o.reading!.player_id, lat: o.reading!.lat, lon: o.reading!.lon, accuracy: o.reading!.accuracy, takenAt: o.reading!.taken_at, source: o.reading!.source }
          : { t: slug, op: "place", clientId: o.clientId, ...o.place };
      try {
        const r = await fetch("/api/gps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (r.status >= 500 || r.status === 401) break;
        // A move waits until its reading has arrived on the server
        if (o.op === "place" && r.status === 404 && read().some((x) => x.op === "save" && x.clientId === o.clientId)) continue;
        if (r.ok) markSent(o);
        write(read().filter((x) => !(x.clientId === o.clientId && x.at === o.at)));
      } catch {
        break; // offline
      }
    }
  } finally {
    busy = false;
  }
}

/** The server's readings with this phone's unsent (and just-sent) ones and moves laid over them. */
export function mergeGps(server: GpsRow[] | undefined, slug: string): GpsRow[] {
  const ops = typeof window === "undefined" ? [] : [...readSent(), ...read()].filter((o) => o.slug === slug).sort((a, b) => a.at - b.at);
  const out = new Map((server ?? []).map((r) => [r.client_id, r] as const));
  for (const o of ops) if (o.op === "save" && o.reading && !out.has(o.clientId)) out.set(o.clientId, o.reading);
  for (const o of ops) if (o.op === "place" && out.has(o.clientId)) out.set(o.clientId, { ...out.get(o.clientId)!, ...o.place });
  return [...out.values()].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
}
