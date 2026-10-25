import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { adminClient } from "./admin";
import { allSessions, getAccount, ownerPinPhone, hashCode, safeEqual, setAccount, type Account, type Session } from "./auth";
import { BRAND } from "./brand";
import { EMAIL_RE, mailConfigured, sendOne, signInEmail } from "./email";

/**
 * One sign-in per person: their email, a one-tap link or a 6-digit code (no password). What they can do depends on
 * their role in each tournament: organiser (co-organisers too), player, or follower. A tournament joins a person when
 * they make it, when an organiser adds them and they say "that's me", when they tap their player link while signed
 * in and say so, or (followers) when they joined its conversation with the same email.
 */
export const LINK_MINUTES = 30;
const CODE_TRIES = 5;

export const tokenHash = (token: string) => createHash("sha256").update(`mgs-account:${token}`).digest("hex");

export function newToken() {
  return randomBytes(24).toString("base64url");
}

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const cleanEmail = (e: unknown) => String(e ?? "").trim().toLowerCase().slice(0, 200);

export class SignInError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** A player's link sent by email carries proof of the address it went to, so tapping it confirms the email. */
export function emailProof(code: string, email: string) {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`player-email:${code}:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 24);
}

/** Where a link may take you afterwards: a path on this site only. */
export function safeNext(n: unknown): string | null {
  return typeof n === "string" && /^\/[\w/?=&%.-]*$/.test(n) && !n.startsWith("//") ? n : null;
}

/** Email a sign-in link and code. purpose "owner" is the site owner's second check. */
export async function sendSignIn(origin: string, email: string, opts: { next?: string | null; purpose?: "signin" | "owner"; intro?: string } = {}) {
  if (!EMAIL_RE.test(email)) throw new SignInError("That email address doesn't look right");
  if (!mailConfigured()) throw new SignInError("Email isn't set up on this site yet, so sign-in by email isn't available.", 503);
  const token = newToken();
  const code = newCode();
  const purpose = opts.purpose ?? "signin";
  const { error } = await adminClient()
    .from("account_tokens")
    .insert({ token_hash: tokenHash(token), code_hash: hashCode(email, code), email, purpose, next: safeNext(opts.next), expires_at: new Date(Date.now() + LINK_MINUTES * 60e3).toISOString() });
  if (error) throw new SignInError(/column|account_tokens/.test(error.message) ? "Sign-in needs the latest database update (schema.sql)" : "Couldn't send just now. Try again.", 500);
  const link = purpose === "owner" ? `${origin}/owner?check=${token}` : `${origin}/account/in?token=${token}`;
  try {
    await sendOne({ name: BRAND.name }, email, signInEmail(link, code, opts.intro));
  } catch {
    throw new SignInError("Couldn't send the email just now. Check the address and try again.", 502);
  }
}

/** The emailed link: works once, for 30 minutes. */
export async function redeemToken(token: string, purpose: "signin" | "owner" = "signin"): Promise<{ email: string; next: string | null }> {
  if (!/^[\w-]{20,64}$/.test(token)) throw new SignInError("That link isn't complete. Open it from the email again.");
  const db = adminClient();
  const { data: row } = await db.from("account_tokens").select("email,expires_at,used_at,purpose,next").eq("token_hash", tokenHash(token)).maybeSingle();
  if (!row || row.used_at || (row.purpose ?? "signin") !== purpose || new Date(row.expires_at).getTime() < Date.now())
    throw new SignInError("That link has expired or been used. Ask for a new one.", 410);
  const { data: used } = await db.from("account_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", tokenHash(token)).is("used_at", null).select("email");
  if (!used?.length) throw new SignInError("That link has expired or been used. Ask for a new one.", 410);
  return { email: cleanEmail(row.email), next: safeNext(row.next) };
}

/** The 6-digit code from the same email: five tries, then ask for a new one. */
export async function redeemCode(email: string, code: string, purpose: "signin" | "owner" = "signin"): Promise<{ email: string; next: string | null }> {
  const c = code.replace(/\D/g, "");
  if (c.length !== 6) throw new SignInError("The code is the 6 numbers in the email");
  const db = adminClient();
  const { data: rows } = await db
    .from("account_tokens")
    .select("token_hash,code_hash,tries,next,purpose")
    .eq("email", String(email).toLowerCase())
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(3);
  const live = (rows ?? []).filter((r) => (r.purpose ?? "signin") === purpose && r.code_hash && r.tries < CODE_TRIES);
  if (!live.length) throw new SignInError("That code has expired. Ask for a new email.", 410);
  const want = hashCode(email, c);
  const hit = live.find((r) => safeEqual(r.code_hash, want));
  if (!hit) {
    await db.from("account_tokens").update({ tries: live[0].tries + 1 }).eq("token_hash", live[0].token_hash);
    throw new SignInError(live[0].tries + 1 >= CODE_TRIES ? "That code isn't right, and that was the last try. Ask for a new email." : "That code isn't right. Check the email and try again.", 401);
  }
  const { data: used } = await db.from("account_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", hit.token_hash).is("used_at", null).select("email");
  if (!used?.length) throw new SignInError("That code has been used. Ask for a new email.", 410);
  return { email: cleanEmail(email), next: safeNext(hit.next) };
}

export async function findOrCreateAccount(email: string): Promise<Account> {
  const db = adminClient();
  const e = cleanEmail(email);
  let { data: acct } = await db.from("accounts").select("id,email").eq("email", String(e).toLowerCase()).maybeSingle();
  if (!acct) ({ data: acct } = await db.from("accounts").insert({ email: e }).select("id,email").single());
  if (!acct) {
    // Two taps at once: the other one made it
    ({ data: acct } = await db.from("accounts").select("id,email").eq("email", String(e).toLowerCase()).maybeSingle());
  }
  if (!acct) throw new SignInError("Couldn't sign you in just now. Try again.", 500);
  return { id: acct.id, email: acct.email };
}

// ------------------------------------------------------------ roles

interface RoleRow {
  tournament_id: string;
  role: "organiser" | "player";
  player_id: string | null;
}

async function roleRows(accountId: string): Promise<RoleRow[]> {
  const { data, error } = await adminClient().from("account_tournaments").select("tournament_id,role,player_id").eq("account_id", accountId);
  if (error) {
    // Before the database update: every row was an organiser
    const { data: old } = await adminClient().from("account_tournaments").select("tournament_id").eq("account_id", accountId);
    return (old ?? []).map((r) => ({ tournament_id: r.tournament_id, role: "organiser", player_id: null }));
  }
  return (data ?? []) as RoleRow[];
}

/** Join a person to a tournament. Organiser outranks player; an organiser who plays keeps their player spot too. */
export async function linkRole(accountId: string, tournamentId: string, role: "organiser" | "player", playerId?: string | null) {
  const db = adminClient();
  const { data: now } = await db.from("account_tournaments").select("role,player_id").eq("account_id", accountId).eq("tournament_id", tournamentId).maybeSingle();
  const next = {
    account_id: accountId,
    tournament_id: tournamentId,
    role: now?.role === "organiser" || role === "organiser" ? "organiser" : "player",
    player_id: playerId ?? now?.player_id ?? null,
  };
  const { error } = await db.from("account_tournaments").upsert(next, { onConflict: "account_id,tournament_id" });
  if (error) throw new SignInError(/column/.test(error.message) ? "This needs the latest database update (schema.sql)" : "Couldn't save that just now. Try again.", 500);
}

/** Kept for the wizard and the owner page: make this account an organiser of the tournament. */
export async function linkTournament(accountId: string, tournamentId: string) {
  await linkRole(accountId, tournamentId, "organiser");
}

export async function isAccountOrganiser(accountId: string, tournamentId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("account_tournaments").select("role").eq("account_id", accountId).eq("tournament_id", tournamentId).maybeSingle();
  if (error) return false;
  return (data?.role ?? null) === "organiser";
}

/**
 * The organiser session for one tournament, named after their own player if they play. Signed in by email, that's the
 * player spot on their account (a co-organiser isn't the organiser who made it); the older ways in were always the
 * organiser who made it.
 */
export async function organiserSession(tournamentId: string, via: Session["via"] | null = "account", playerId?: string | null): Promise<Session> {
  const db = adminClient();
  const { data: t } = await db.from("tournaments").select("organiser_player_id").eq("id", tournamentId).maybeSingle();
  const pid = via === "account" ? (playerId ?? null) : (playerId ?? t?.organiser_player_id ?? null);
  if (pid) {
    const { data: p } = await db.from("players").select("id,name").eq("id", pid).eq("tournament_id", tournamentId).maybeSingle();
    if (p) return { role: "organiser", name: p.name, playerId: p.id, ...(via ? { via } : {}) };
  }
  return { role: "organiser", name: "Organiser", ...(via ? { via } : {}) };
}

/** A player's session, tied to their link generation (Send again signs it out). */
export async function playerSession(tournamentId: string, playerId: string, via: Session["via"]): Promise<Session | null> {
  const { data: p } = await adminClient().from("players").select("id,name,link_gen").eq("id", playerId).eq("tournament_id", tournamentId).maybeSingle();
  if (!p) return null;
  return { role: "player", name: p.name, playerId: p.id, via, gen: p.link_gen ?? 0 };
}

/** Every role this person has, as sessions for this phone. */
export async function sessionsFor(a: Account): Promise<Record<string, Session>> {
  const out: Record<string, Session> = {};
  for (const r of await roleRows(a.id)) {
    const s = r.role === "organiser" ? await organiserSession(r.tournament_id, "account", r.player_id) : r.player_id ? await playerSession(r.tournament_id, r.player_id, "account") : null;
    if (s) out[r.tournament_id] = s;
  }
  // Followers who joined a tournament's conversation with this email
  const { data: fans } = await adminClient().from("fans").select("id,name,tournament_id,blocked,verified_at").eq("email", String(a.email).toLowerCase());
  for (const f of fans ?? []) if (!out[f.tournament_id] && f.verified_at && !f.blocked) out[f.tournament_id] = { role: "fan", name: f.name, fanId: f.id };
  return out;
}

/** Sign a person in on this phone. Anything waiting for "Is this you?" on a tournament this phone made is theirs. */
export async function signIn(email: string): Promise<Account> {
  const a = await findOrCreateAccount(email);
  const db = adminClient();
  // Tournaments this phone runs without an email yet (made here, or signed in with the old organiser PIN): they
  // join this person, and the old PIN stops working
  const ownerPhone = await ownerPinPhone();
  for (const [tid, s] of Object.entries(await allSessions())) {
    if (s.role !== "organiser" || (s.via && s.via !== "create") || (!s.via && ownerPhone)) continue;
    const { data: t } = await db.from("tournaments").select("id,organiser_pin_hash").eq("id", tid).maybeSingle();
    if (!t || (!s.via && !t.organiser_pin_hash)) continue;
    await linkRole(a.id, tid, "organiser", s.playerId ?? null).catch(() => {});
    if (t.organiser_pin_hash) await db.from("tournaments").update({ organiser_pin_hash: null }).eq("id", tid);
    await db.from("account_offers").update({ answered_at: new Date().toISOString(), accepted: true }).eq("tournament_id", tid).eq("role", "organiser").eq("email", String(a.email).toLowerCase()).is("answered_at", null);
  }
  // Players signed in on this phone with their own link: their spot joins this person too
  for (const [tid, s] of Object.entries(await allSessions())) {
    if (s.role !== "player" || !s.playerId || (s.via !== "link" && s.via !== "pin")) continue;
    const { data: p } = await db.from("players").select("link_gen").eq("id", s.playerId).eq("tournament_id", tid).maybeSingle();
    if (p && (p.link_gen ?? 0) === (s.gen ?? 0)) await linkRole(a.id, tid, "player", s.playerId).catch(() => {});
  }
  await setAccount(a, await sessionsFor(a));
  await db.from("accounts").update({ last_seen_at: new Date().toISOString() }).eq("id", a.id).then(() => null, () => null);
  return a;
}

// ------------------------------------------------------------ "Is this you?"

export interface Offer {
  id: string;
  tournament_id: string;
  role: "organiser" | "player";
  player_id: string | null;
  added_by: string | null;
  tournament: string;
  slug: string;
  player: string | null;
}

export async function offersFor(email: string): Promise<Offer[]> {
  const db = adminClient();
  const { data, error } = await db.from("account_offers").select("id,tournament_id,role,player_id,added_by").eq("email", String(email).toLowerCase()).is("answered_at", null).order("created_at");
  if (error || !data?.length) return [];
  const tids = [...new Set(data.map((o) => o.tournament_id))];
  const { data: ts } = await db.from("tournaments").select("id,name,slug").in("id", tids);
  const pids = data.map((o) => o.player_id).filter(Boolean) as string[];
  const { data: ps } = pids.length ? await db.from("players").select("id,name,tournament_id").in("id", pids) : { data: [] };
  return data
    .map((o) => {
      const t = (ts ?? []).find((x) => x.id === o.tournament_id);
      const p = (ps ?? []).find((x) => x.id === o.player_id && x.tournament_id === o.tournament_id);
      return t ? { ...o, tournament: t.name, slug: t.slug, player: p?.name ?? null } : null;
    })
    .filter((o): o is Offer => !!o && (o.role === "organiser" || !!o.player));
}

/** Add an email to a tournament, waiting for them to say it's them. Replaces an earlier one for the same spot. */
export async function makeOffer(tournamentId: string, email: string, role: "organiser" | "player", playerId: string | null, addedBy: string | null) {
  const db = adminClient();
  let q = db.from("account_offers").delete().eq("tournament_id", tournamentId).eq("role", role).is("answered_at", null);
  q = role === "player" ? q.eq("player_id", playerId ?? "") : q.eq("email", String(email).toLowerCase());
  await q;
  const { error } = await db.from("account_offers").insert({ tournament_id: tournamentId, email: cleanEmail(email), role, player_id: playerId, added_by: addedBy });
  if (error) throw new SignInError(/account_offers/.test(error.message) ? "This needs the latest database update (schema.sql)" : "Couldn't save that just now. Try again.", 500);
}

export async function answerOffer(a: Account, offerId: string, yes: boolean) {
  const db = adminClient();
  const { data: o } = await db.from("account_offers").select("id,tournament_id,role,player_id,email,answered_at").eq("id", offerId).maybeSingle();
  if (!o || o.answered_at || cleanEmail(o.email) !== cleanEmail(a.email)) throw new SignInError("That's already been answered", 410);
  await db.from("account_offers").update({ answered_at: new Date().toISOString(), accepted: yes }).eq("id", o.id);
  if (!yes) return null;
  await linkRole(a.id, o.tournament_id, o.role, o.player_id);
  return o.tournament_id as string;
}

// ------------------------------------------------------------ My golf

export interface GolfTile {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Players: who they're playing as */
  as?: string | null;
}

export interface MyGolf {
  running: GolfTile[];
  playing: GolfTile[];
  following: GolfTile[];
  offers: Offer[];
}

export async function myGolf(a: Account): Promise<MyGolf> {
  const db = adminClient();
  const rows = await roleRows(a.id);
  const { data: fans } = await db.from("fans").select("tournament_id,verified_at,blocked").eq("email", String(a.email).toLowerCase());
  const followIds = (fans ?? []).filter((f) => f.verified_at && !f.blocked).map((f) => f.tournament_id);
  const ids = [...new Set([...rows.map((r) => r.tournament_id), ...followIds])];
  const { data: ts } = ids.length ? await db.from("public_tournaments").select("id,slug,name,subtitle,start_date,end_date,created_at").in("id", ids) : { data: [] };
  const pids = rows.map((r) => r.player_id).filter(Boolean) as string[];
  const { data: ps } = pids.length ? await db.from("players").select("id,name,tournament_id").in("id", pids) : { data: [] };
  const tile = (id: string, as?: string | null): GolfTile | null => {
    const t = (ts ?? []).find((x) => x.id === id);
    return t ? { id: t.id, slug: t.slug, name: t.name, subtitle: t.subtitle, start_date: t.start_date, end_date: t.end_date, as: as ?? null } : null;
  };
  // Newest first: by the trip's start date, then when it was made
  const order = (xs: (GolfTile | null)[]) =>
    (xs.filter(Boolean) as GolfTile[]).sort((x, y) => (y.start_date ?? "9999").localeCompare(x.start_date ?? "9999") || 0);
  const nameOf = (r: RoleRow) => (ps ?? []).find((p) => p.id === r.player_id && p.tournament_id === r.tournament_id)?.name ?? null;
  const running = order(rows.filter((r) => r.role === "organiser").map((r) => tile(r.tournament_id)));
  const playing = order(rows.filter((r) => r.role === "player" && r.player_id).map((r) => tile(r.tournament_id, nameOf(r))));
  const mine = new Set(rows.map((r) => r.tournament_id));
  const following = order(followIds.filter((id) => !mine.has(id)).map((id) => tile(id)));
  return { running, playing, following, offers: await offersFor(a.email) };
}

/** The signed-in person, if any, refreshed. */
export async function currentAccount(): Promise<Account | null> {
  return getAccount();
}
