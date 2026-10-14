"use client";

/**
 * Shots are saved on the phone the moment they're tapped, then sent when there's signal.
 * A later change to the same shot replaces an unsent one; removing an unsent shot just forgets it.
 */
import type { ShotRow } from "./types";

export interface ShotOp {
  op: "save" | "delete";
  slug: string;
  clientId: string;
  data?: { roundId: string; hole: number; playerId: string; kind: string; outcome: string; club?: string | null; distance?: string | null; seq?: number | null; loggedAt: string; author: string; authorPlayerId?: string | null };
  at: number;
}

const KEY = "mgs_shot_queue_v1";
const read = (): ShotOp[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
const write = (q: ShotOp[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {}
  window.dispatchEvent(new Event("mgs-shots"));
};

export function pendingShots(slug: string) {
  return read().filter((o) => o.slug === slug);
}

export function saveShot(slug: string, clientId: string, data: NonNullable<ShotOp["data"]>) {
  write([...read().filter((o) => !(o.clientId === clientId && o.op === "save")), { op: "save", slug, clientId, data, at: Date.now() }]);
}

export function deleteShot(slug: string, clientId: string, wasSent: boolean) {
  const rest = read().filter((o) => o.clientId !== clientId);
  write(wasSent ? [...rest, { op: "delete", slug, clientId, at: Date.now() }] : rest);
}

/** Sent this session but maybe not back from the server yet: kept so a shot never blinks off the card. */
const sent = new Map<string, ShotOp>();
const removed = new Set<string>();

let busy = false;
/** Send what's waiting, in order. Returns how many are left. */
export async function flushShots(slug: string): Promise<number> {
  if (busy) return pendingShots(slug).length;
  busy = true;
  try {
    for (const o of pendingShots(slug)) {
      try {
        const body = o.op === "delete" ? { t: slug, op: "delete", clientId: o.clientId } : { t: slug, op: "save", clientId: o.clientId, ...o.data };
        const r = await fetch("/api/shots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (r.status === 401 || r.status === 403 || r.status >= 500) break; // log in again / database not ready: keep
        // done (or refused for good): drop this exact op
        if (r.ok && o.op === "save") sent.set(o.clientId, o);
        if (r.ok && o.op === "delete") (sent.delete(o.clientId), removed.add(o.clientId));
        write(read().filter((x) => !(x.clientId === o.clientId && x.at === o.at)));
      } catch {
        break; // offline
      }
    }
  } finally {
    busy = false;
  }
  return pendingShots(slug).length;
}

/** The server's shots with this phone's unsent changes laid over them. */
export function mergeShots(server: ShotRow[] | undefined, slug: string, tournamentId: string): ShotRow[] {
  const ops = typeof window === "undefined" ? [] : pendingShots(slug);
  const gone = new Set([...removed, ...ops.filter((o) => o.op === "delete").map((o) => o.clientId)]);
  const onServer = new Set((server ?? []).map((s) => s.client_id));
  // just sent and not yet in what the server last told us: still show it
  const saves = new Map([...[...sent.values()].filter((o) => o.slug === slug && !onServer.has(o.clientId)).map((o) => [o.clientId, o] as const), ...ops.filter((o) => o.op === "save").map((o) => [o.clientId, o] as const)]);
  const out = (server ?? []).filter((s) => !gone.has(s.client_id) && !saves.has(s.client_id));
  for (const o of saves.values()) {
    const d = o.data!;
    out.push({ id: `local-${o.clientId}`, tournament_id: tournamentId, round_id: d.roundId, hole: d.hole, player_id: d.playerId, kind: d.kind, outcome: d.outcome, club: d.club ?? null, distance: d.distance ?? null, seq: d.seq ?? null, author_name: d.author, author_player_id: d.authorPlayerId ?? null, client_id: o.clientId, logged_at: d.loggedAt });
  }
  return out.sort((a, b) => a.logged_at.localeCompare(b.logged_at));
}
