import "server-only";
import { cookies } from "next/headers";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Three roles: the organiser, the players, and fans (everyone else: caddies, friends, people at home) */
export type Role = "organiser" | "player" | "fan";

export interface Session {
  role: Role;
  name: string;
  playerId?: string;
  /** Fans: followers signed up by email (photos, comments and likes) */
  fanId?: string;
}

/** An organiser's account (signed in by email): the tournaments it runs */
export interface Account {
  id: string;
  email: string;
}

/** One cookie holds a session per tournament (keyed by tournament id),
 *  plus an optional site-owner flag (can create tournaments). */
interface Jar {
  t: Record<string, Session>;
  owner?: boolean;
  account?: Account;
  iat: number;
}

const COOKIE = "os_session";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

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
    return { t: j.t ?? {}, owner: !!j.owner, account: j.account?.id ? j.account : undefined, iat: j.iat ?? Date.now() };
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
  const s = j.t[tournamentId] ?? null;
  // The old caddie-and-friends login is gone: those phones follow as fans now (join with an email to post)
  if (s && (s.role as string) === "contributor") return null;
  return s;
}

export async function getAccount(): Promise<Account | null> {
  return (await readJar()).account ?? null;
}

/** Sign an organiser's account in on this device, with an organiser session for each of its tournaments. */
export async function setAccount(a: Account, sessions: Record<string, Session>) {
  const j = await readJar();
  j.account = a;
  for (const [tid, s] of Object.entries(sessions)) j.t[tid] = s;
  await writeJar(j);
}

export async function clearAccount() {
  const j = await readJar();
  delete j.account;
  await writeJar(j);
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

/** Players and organisers: everyone who can score, film and log what happened (not fans). */
export function isCrew(s: Session | null): s is Session {
  return !!s && (s.role === "player" || s.role === "organiser");
}

export function isOrganiser(s: Session | null) {
  return s?.role === "organiser";
}
