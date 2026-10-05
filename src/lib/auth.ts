import "server-only";
import { cookies } from "next/headers";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type Role = "organiser" | "player" | "contributor";

export interface Session {
  role: Role;
  name: string;
  playerId?: string;
}

/** One cookie holds a session per tournament (keyed by tournament id),
 *  plus an optional site-owner flag (can create tournaments). */
interface Jar {
  t: Record<string, Session>;
  owner?: boolean;
  iat: number;
}

const COOKIE = "os_session";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days

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

async function readJar(): Promise<Jar> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  const empty: Jar = { t: {}, iat: Date.now() };
  if (!raw) return empty;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return empty;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString());
    return { t: j.t ?? {}, owner: !!j.owner, iat: j.iat ?? Date.now() };
  } catch {
    return empty;
  }
}

async function writeJar(j: Jar) {
  const payload = Buffer.from(JSON.stringify({ ...j, iat: Date.now() })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function getSession(tournamentId: string): Promise<Session | null> {
  const j = await readJar();
  return j.t[tournamentId] ?? null;
}

export async function setSession(tournamentId: string, s: Session) {
  const j = await readJar();
  j.t[tournamentId] = s;
  await writeJar(j);
}

export async function clearSession(tournamentId: string) {
  const j = await readJar();
  delete j.t[tournamentId];
  await writeJar(j);
}

export async function isOwner(): Promise<boolean> {
  return (await readJar()).owner === true;
}

export async function setOwner() {
  const j = await readJar();
  j.owner = true;
  await writeJar(j);
}

/** The site owner's PIN (env) lets you create tournaments and run any of them. */
export function checkOwnerPin(pin: string) {
  const expected = process.env.ORGANISER_PIN ?? "";
  return !!expected && safeEqual(pin.trim(), expected);
}

export function isOrganiser(s: Session | null) {
  return s?.role === "organiser";
}
