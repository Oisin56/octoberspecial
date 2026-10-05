import "server-only";
import { cookies } from "next/headers";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type Role = "organiser" | "player" | "contributor";

export interface Session {
  role: Role;
  name: string;
  playerId?: string; // organiser + players
  iat: number;
}

const COOKIE = "os_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET env var missing or too short");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(`${secret()}:${pin.trim()}`).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function setSession(s: Omit<Session, "iat">) {
  const payload = Buffer.from(JSON.stringify({ ...s, iat: Date.now() })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

export function canPost(s: Session | null) {
  return !!s;
}
export function isOrganiser(s: Session | null) {
  return s?.role === "organiser";
}
