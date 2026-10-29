import { isDemo } from "./site";
import "server-only";
import { adminClient } from "./admin";
import { normalizeRound, type TournamentRow, type TournamentState, type RoundRow } from "./types";
import { getAccount, getSession, isOwner, type Session } from "./auth";
import { isAccountOrganiser } from "./accounts";
import { inTournament } from "./usage";
import { recordError } from "./incidents";

export interface TournamentPrivate extends TournamentRow {
  organiser_pin_hash: string | null;
  contributor_pin_hash: string | null;
  /** Who finished it (a name, or "Finished by itself…") */
  finished_by?: string | null;
  /** Scoring opened again after finishing (it finishes by itself again 3 days later) */
  reopened_at?: string | null;
}

export async function tournamentBySlug(slug: string): Promise<TournamentPrivate | null> {
  if (!slug) return null;
  const { data } = await adminClient().from("tournaments").select("*").eq("slug", slug).maybeSingle();
  return data;
}

export async function tournamentById(id: string): Promise<TournamentPrivate | null> {
  const { data } = await adminClient().from("tournaments").select("*").eq("id", id).maybeSingle();
  return data;
}

/**
 * Resolve the tournament named in a request (body.t or ?t=) + the caller's session for it. A private tournament is
 * "not found" for anyone not let in, except on the routes that let people in (open: signing in, asking to follow).
 */
export async function context(req: Request, body?: Record<string, unknown>, opts: { open?: boolean } = {}) {
  const url = new URL(req.url);
  const slug = String(body?.t ?? url.searchParams.get("t") ?? "");
  let t = await tournamentBySlug(slug);
  let session: Session | null = t ? await stillGood(t, await getSession(t.id)) : null;
  // Support staff looking in to help: they can see everything, and only hide posts or stop a follower posting
  if (session?.via === "staff" && req.method !== "GET" && !staffMay(url.pathname, body)) session = null;
  if (t && t.privacy === "private" && !opts.open && !(await canSee(t, session))) {
    t = null;
    session = null;
  }
  // What's paid for while answering this request is this tournament's (the console's costs)
  if (t) inTournament(t.id);
  // The example tournament on the front page can be looked at, never changed (except by the site owner)
  const demo = !!t && req.method !== "GET" && (await isDemo(t.slug)) && !(await isOwner());
  return { t, session: demo ? null : session, demo };
}

const STAFF_MAY: Record<string, string[]> = {
  "/api/admin": ["state", "scoreChanges", "subscribers", "hide", "blockFan"],
  "/api/fans": ["list"],
};
function staffMay(path: string, body?: Record<string, unknown>) {
  return (STAFF_MAY[path] ?? []).includes(String(body?.action ?? ""));
}

/** This phone's role in a tournament, checked (for pages and files outside the API). */
export async function checkedSession(t: TournamentPrivate): Promise<Session | null> {
  return stillGood(t, await getSession(t.id));
}

/** Who can look at a tournament: anyone in Friends and family; in a private one, its players and organisers, approved
 *  followers, and the site owner. */
export async function canSee(t: Pick<TournamentRow, "id" | "privacy">, s: Session | null): Promise<boolean> {
  if (t.privacy !== "private") return true;
  if (s?.role === "organiser" || s?.role === "player") return true;
  if (s?.role === "fan" && s.fanId && (await fanStatus(t.id, s.fanId)) === "approved") return true;
  return isOwner();
}

export async function fanStatus(tournamentId: string, fanId: string): Promise<"approved" | "asking" | "declined" | "removed" | null> {
  const { data, error } = await adminClient().from("fans").select("status").eq("id", fanId).eq("tournament_id", tournamentId).maybeSingle();
  if (error) return data ? "approved" : null;
  return (data?.status as "approved") ?? null;
}

/**
 * A phone's role is checked against the tournament on every request: a player signed out by Send again (or
 * removed), a co-organiser removed, or an old organiser sign-in after the tournament moved to email sign-in, is
 * just a follower now.
 */
async function stillGood(t: TournamentPrivate, s: Session | null): Promise<Session | null> {
  if (!s) return null;
  const db = adminClient();
  if (s.role === "player") {
    if (!s.playerId) return null;
    const { data: p, error } = await db.from("players").select("id,link_gen").eq("id", s.playerId).eq("tournament_id", t.id).maybeSingle();
    if (error) return s; // before the database update
    if (!p) return null;
    if ((s.gen ?? 0) !== (p.link_gen ?? 0)) return null;
    // Private, with players signing in by email: their spot has to be joined to the email signed in here
    if (t.players_need_email && t.privacy === "private") {
      const a = await getAccount();
      if (!a) return null;
      const { data: j } = await db.from("account_tournaments").select("player_id").eq("account_id", a.id).eq("tournament_id", t.id).maybeSingle();
      if (j?.player_id !== s.playerId) return null;
    }
    return s;
  }
  if (s.role === "fan") {
    // A follower the organiser removed (or turned down) is just someone with the link now
    if (!s.fanId) return null;
    const st = await fanStatus(t.id, s.fanId);
    // (turned down: still shown "waiting", but can't see or say anything)
    return st === "approved" || st === "asking" || st === "declined" ? s : null;
  }
  if (s.role === "organiser") {
    switch (s.via) {
      case "account": {
        const a = await getAccount();
        return a && (await isAccountOrganiser(a.id, t.id)) ? s : null;
      }
      case "owner":
        return (await isOwner()) ? s : null;
      case "staff": {
        // Support staff helping: only while they're still staff, signed in to the console
        const { consoleUser } = await import("./console-auth");
        return (await consoleUser()) ? s : null;
      }
      case "create":
        // The phone that made it, until its email is confirmed (asked on every visit), for 30 days at most
        return s.at && Date.now() - s.at < 30 * 864e5 ? s : null;
      default:
        // Signed in before emails, with the tournament's organiser PIN: good until it moves to email sign-in
        return t.organiser_pin_hash ? s : null;
    }
  }
  return s;
}

export const DEMO_READONLY = "This is an example tournament, so nothing can be changed here. Start your own to try it for real.";

/** Full state including hidden/report-only posts and drafts (asPublic: only what followers see). Server only. */
export async function loadServerState(tournamentId: string, opts: { asPublic?: boolean } = {}): Promise<TournamentState> {
  const db = adminClient();
  const { data: tournament, error } = await db.from("public_tournaments").select("*").eq("id", tournamentId).single();
  if (error || !tournament) throw new Error("Tournament not found");
  const tid = tournament.id;
  const [players, rounds, posts, comments, pieces, votes] = await Promise.all([
    db.from("public_players").select("*").eq("tournament_id", tid).order("sort"),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    opts.asPublic
      ? db.from("posts").select("*").eq("tournament_id", tid).eq("hidden", false).eq("visibility", "public").order("created_at", { ascending: false }).limit(500)
      : db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    opts.asPublic
      ? db.from("comments").select("*").eq("tournament_id", tid).eq("hidden", false).order("created_at", { ascending: false }).limit(300)
      : db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    opts.asPublic
      ? db.from("ai_pieces").select("*").eq("tournament_id", tid).eq("status", "published").order("created_at", { ascending: false })
      : db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("votes").select("*").eq("tournament_id", tid),
  ]);
  const roundIds = (rounds.data ?? []).map((r: RoundRow) => r.id);
  const likes = await db.from("likes").select("*").eq("tournament_id", tid);
  const [entries, attestations, shots, cards, signatures, gps, notes] = roundIds.length
    ? await Promise.all([
        db.from("hole_entries").select("*").in("round_id", roundIds),
        db.from("attestations").select("*").in("round_id", roundIds),
        // shots, cards: empty if the database doesn't have the table yet
        db.from("shots").select("*").eq("tournament_id", tid).order("logged_at"),
        db.from("cards").select("*").in("round_id", roundIds),
        db.from("card_signatures").select("*").in("round_id", roundIds),
        db.from("public_gps").select("*").eq("tournament_id", tid).order("taken_at"),
        db.from("hole_notes").select("*").in("round_id", roundIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  return {
    tournament,
    players: players.data ?? [],
    rounds: (rounds.data ?? []).map(normalizeRound),
    entries: entries.data ?? [],
    attestations: attestations.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    pieces: pieces.data ?? [],
    votes: votes.data ?? [],
    shots: shots.error ? [] : (shots.data ?? []),
    gps: "error" in gps && gps.error ? [] : (gps.data ?? []),
    likes: likes.error ? [] : (likes.data ?? []),
    cards: "error" in cards && cards.error ? [] : (cards.data ?? []),
    signatures: "error" in signatures && signatures.error ? [] : (signatures.data ?? []),
    holeNotes: "error" in notes && notes.error ? [] : (notes.data ?? []),
  };
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function bad(message: string, status = 400) {
  // Something broke on our side: it goes in the console's error list
  if (status >= 500) void recordError(`answer ${status}`, message);
  return Response.json({ error: message }, { status });
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * A request that didn't come from this site's own pages: another site's form posting to us (to sign someone in to the
 * wrong account, say). Our pages always send JSON from the same address.
 */
export function crossSite(req: Request): boolean {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return true;
  }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host"), process.env.SITE_URL ? new URL(process.env.SITE_URL).host : null].filter(Boolean);
  return !hosts.includes(from);
}

export const CROSS_SITE = "That came from somewhere other than this site, so it was ignored.";

/** The site's public address, for links in emails. */
export function siteOrigin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
