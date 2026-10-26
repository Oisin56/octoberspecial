import "server-only";
import { cookies } from "next/headers";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Three roles in each tournament: the organiser (co-organisers too), the players, and followers ("fan"). */
export type Role = "organiser" | "player" | "fan";

/**
 * How this phone came to have its role in a tournament, so it can be checked on every request:
 *   account  signed in with an email that's an organiser (or player) of it
 *   link     a player's personal link (good until the organiser taps Send again)
 *   create   this phone made the tournament
 *   owner    the site owner opened it from their page
 *   pin      an old player PIN
 *   (none)   an old organiser sign-in from before emails (good until the tournament moves to email sign-in)
 */
export type Via = "account" | "link" | "create" | "owner" | "pin" | "staff";

export interface Session {
  role: Role;
  name: string;
  playerId?: string;
  /** Followers signed up by email (photos, comments and likes) */
  fanId?: string;
  via?: Via;
  /** Players: the player's link generation when this phone signed in (Send again raises it) */
  gen?: number;
  /** When this phone made the tournament ("create"): good for 30 days, or until it's added to an email */
  at?: number;
}

/** A person signed in with their email */
export interface Account {
  id: string;
  email: string;
  /** When they signed in on this phone (the console can sign someone out everywhere after that) */
  at?: number;
}

/** One cookie holds a session per tournament (keyed by tournament id), the signed-in account, and the owner's
 *  second check (when it was passed). */
interface Jar {
  t: Record<string, Session>;
  /** The old owner PIN (only until the owner signs in with their email) */
  owner?: boolean;
  /** When the site owner last passed the second check on this device */
  ownerOk?: number;
  /** A passkey challenge waiting to be answered */
  chal?: string;
  account?: Account;
  iat: number;
}

const COOKIE = "os_session";
/** Signed in for a year from the last visit */
const MAX_AGE = 60 * 60 * 24 * 365;
/** The owner's second check lasts this long on a device */
export const OWNER_CHECK_HOURS = 12;

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

/** The 6-digit code in a sign-in email: only its hash is kept. */
export function hashCode(email: string, code: string): string {
  return createHmac("sha256", secret()).update(`code:${email.trim().toLowerCase()}:${code.trim()}`).digest("hex");
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
    return {
      t: j.t ?? {},
      owner: !!j.owner,
      ownerOk: typeof j.ownerOk === "number" ? j.ownerOk : undefined,
      chal: typeof j.chal === "string" ? j.chal : undefined,
      account: j.account?.id ? j.account : undefined,
      iat: j.iat ?? Date.now(),
    };
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

/** Keeps this phone signed in for another year (at most once a day, on any visit). Returns the account, if any. */
export async function touch(): Promise<Account | null> {
  const j = await readJar();
  const signedIn = j.account || Object.keys(j.t).length;
  if (signedIn && Date.now() - j.iat > 24 * 3600e3) {
    await writeJar(j).catch(() => {});
    // Seen today (the console's "active people")
    if (j.account) {
      const { adminClient } = await import("./admin");
      await adminClient().from("accounts").update({ last_seen_at: new Date().toISOString() }).eq("id", j.account.id).then(() => null, () => null);
    }
  }
  return j.account ?? null;
}

/** This phone's session for a tournament, as stored. Use context() in server-data, which also checks it's still good. */
export async function getSession(tournamentId: string): Promise<Session | null> {
  const j = await readJar();
  const s = j.t[tournamentId] ?? null;
  // Given by an email sign-in that's since been signed out everywhere
  if (s?.via === "account" && j.account && !(await getAccount())) return null;
  // The old caddie-and-friends login is gone: those phones follow as fans now (join with an email to post)
  if (s && (s.role as string) === "contributor") return null;
  return s;
}

/** This phone signed in with the old owner PIN (its old organiser sign-ins may be other people's tournaments). */
export async function ownerPinPhone(): Promise<boolean> {
  return (await readJar()).owner === true;
}

/** Every tournament role this phone holds, as stored. */
export async function allSessions(): Promise<Record<string, Session>> {
  return (await readJar()).t;
}

export async function getAccount(): Promise<Account | null> {
  const a = (await readJar()).account ?? null;
  if (a && (await signedOutSince(a.id)) > (a.at ?? 0)) return null;
  return a;
}

const signouts = new Map<string, { at: number; v: number }>();
/** When the console signed this account out everywhere (0: never). Remembered for a minute. */
async function signedOutSince(accountId: string): Promise<number> {
  const c = signouts.get(accountId);
  if (c && Date.now() - c.at < 60e3) return c.v;
  const { adminClient } = await import("./admin");
  const { data, error } = await adminClient().from("accounts").select("signout_at").eq("id", accountId).maybeSingle();
  const v = !error && data?.signout_at ? Date.parse(data.signout_at) : 0;
  signouts.set(accountId, { at: Date.now(), v });
  if (signouts.size > 20000) signouts.clear();
  return v;
}

export function forgetSignout(accountId: string) {
  signouts.delete(accountId);
}

/** Sign a person in on this device, with their role in each of their tournaments (kept where this phone already
 *  has an organiser session, which can do more). */
export async function setAccount(a: Account, sessions: Record<string, Session>) {
  const j = await readJar();
  if (j.account && j.account.id !== a.id) {
    // Someone else on this phone: their account sessions go
    for (const [tid, s] of Object.entries(j.t)) if (s.via === "account") delete j.t[tid];
    delete j.ownerOk;
  }
  j.account = { id: a.id, email: a.email, at: Date.now() };
  const rank = { organiser: 3, player: 2, fan: 1 } as const;
  for (const [tid, s] of Object.entries(sessions)) {
    const now = j.t[tid];
    // Never a step down on this phone (an organiser stays organiser; a player doesn't become a follower)
    if (now && rank[now.role] > rank[s.role]) continue;
    j.t[tid] = s;
  }
  await writeJar(j);
}

/** Sign out: the account, and every role it gave this phone. */
export async function clearAccount() {
  const j = await readJar();
  delete j.account;
  delete j.ownerOk;
  delete j.owner;
  for (const [tid, s] of Object.entries(j.t)) if (s.via === "account" || s.via === "owner") delete j.t[tid];
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

// ------------------------------------------------------------ the site owner

/** The site owner's email (OWNER_EMAIL in Vercel). */
export function ownerEmail(): string {
  return (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
}

export function isOwnerEmail(email: string | null | undefined) {
  const o = ownerEmail();
  return !!o && !!email && email.trim().toLowerCase() === o;
}

/** The site owner: signed in with the owner's email and passed the second check on this device in the last 12
 *  hours. Until the owner has signed in that way once, the old owner PIN still works. */
export async function isOwner(): Promise<boolean> {
  const j = await readJar();
  if (j.account && isOwnerEmail(j.account.email) && j.ownerOk && Date.now() - j.ownerOk < OWNER_CHECK_HOURS * 3600e3) return (await signedOutSince(j.account.id)) <= (j.account.at ?? 0);
  return j.owner === true && !(await ownerClaimed());
}

/** Signed in with the owner's email, but the second check is still to do on this device. */
export async function ownerNeedsCheck(): Promise<boolean> {
  const j = await readJar();
  return !!j.account && isOwnerEmail(j.account.email) && !(j.ownerOk && Date.now() - j.ownerOk < OWNER_CHECK_HOURS * 3600e3);
}

/** This device passed the console's second check (Face ID or an emailed code) in the last 12 hours. */
export async function consoleCheckFresh(): Promise<boolean> {
  const j = await readJar();
  if (!j.account || !j.ownerOk || Date.now() - j.ownerOk >= OWNER_CHECK_HOURS * 3600e3) return false;
  return (await signedOutSince(j.account.id)) <= (j.account.at ?? 0);
}

export async function setOwnerChecked() {
  const j = await readJar();
  j.ownerOk = Date.now();
  delete j.owner;
  delete j.chal;
  await writeJar(j);
}

/** The old way in: the owner PIN, until the owner has signed in with their email. */
export async function setOwner() {
  const j = await readJar();
  j.owner = true;
  await writeJar(j);
}

export async function setChallenge(c: string | null) {
  const j = await readJar();
  if (c) j.chal = c;
  else delete j.chal;
  await writeJar(j);
}

export async function getChallenge(): Promise<string | null> {
  return (await readJar()).chal ?? null;
}

let claimed: { at: number; v: boolean } | null = null;
/** The owner has signed in with their email and passed the second check at least once: the PIN is retired. */
export async function ownerClaimed(): Promise<boolean> {
  if (claimed && (claimed.v || Date.now() - claimed.at < 30e3)) return claimed.v;
  const { adminClient } = await import("./admin");
  const { data } = await adminClient().from("site_settings").select("value").eq("key", "owner").maybeSingle();
  const v = !!(data?.value as { claimedAt?: string } | null)?.claimedAt;
  claimed = { at: Date.now(), v };
  return v;
}

export async function markOwnerClaimed() {
  const { adminClient } = await import("./admin");
  await adminClient().from("site_settings").upsert({ key: "owner", value: { claimedAt: new Date().toISOString() }, updated_at: new Date().toISOString() });
  claimed = { at: Date.now(), v: true };
}

/** The site owner's PIN (env), only until the owner has signed in with their email. */
export async function checkOwnerPin(pin: string) {
  const expected = process.env.ORGANISER_PIN ?? "";
  if (!expected || !safeEqual(pin.trim(), expected)) return false;
  return !(await ownerClaimed());
}

/** Players and organisers: everyone who can score, film and log what happened (not fans). */
export function isCrew(s: Session | null): s is Session {
  return !!s && (s.role === "player" || s.role === "organiser");
}

export function isOrganiser(s: Session | null) {
  return s?.role === "organiser";
}
