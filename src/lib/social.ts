import "server-only";
import { createHash } from "node:crypto";
import { adminClient } from "./admin";
import { ipHash } from "./email";
import type { Session } from "./auth";

/** Likes are keyed by a hash of the phone's own id (the phone can work out which posts it liked). */
export const likerKey = (deviceId: string) => createHash("sha256").update(`mgs-like:${deviceId}`).digest("hex").slice(0, 32);

export const DEVICE = /^[\w-]{8,64}$/;

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Who is reporting: the fan or crew member if signed in, else the connection. */
export function reporterKey(req: Request, s: Session | null) {
  if (s?.fanId) return `fan:${s.fanId}`;
  if (s) return `crew:${s.playerId ?? s.name}`;
  return `ip:${ipHash(clientIp(req))}`;
}

// Light spam guard, per server instance: at most `n` actions per `ms` for one key
const hits = new Map<string, number[]>();
export function tooFast(key: string, n: number, ms: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= n) return true;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** A fan who has been blocked by the organiser (or removed) can't post. */
export async function fanAllowed(tournamentId: string, fanId: string) {
  const { data } = await adminClient().from("fans").select("id,blocked").eq("id", fanId).eq("tournament_id", tournamentId).maybeSingle();
  return !!data && !data.blocked;
}

/** Three reports from different people hide a post or comment until the organiser looks. */
export const REPORTS_TO_HIDE = 3;
