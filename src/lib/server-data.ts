import { isDemo } from "./site";
import "server-only";
import { adminClient } from "./admin";
import { normalizeRound, type TournamentRow, type TournamentState, type RoundRow } from "./types";
import { getAccount, getSession, isOwner, type Session } from "./auth";
import { isAccountOrganiser } from "./accounts";

export interface TournamentPrivate extends TournamentRow {
  organiser_pin_hash: string | null;
  contributor_pin_hash: string | null;
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

/** Resolve the tournament named in a request (body.t or ?t=) + the caller's session for it. */
export async function context(req: Request, body?: Record<string, unknown>) {
  const url = new URL(req.url);
  const slug = String(body?.t ?? url.searchParams.get("t") ?? "");
  const t = await tournamentBySlug(slug);
  const session: Session | null = t ? await stillGood(t, await getSession(t.id)) : null;
  // The example tournament on the front page can be looked at, never changed (except by the site owner)
  const demo = !!t && req.method !== "GET" && (await isDemo(t.slug)) && !(await isOwner());
  return { t, session: demo ? null : session, demo };
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
    return (s.gen ?? 0) === (p.link_gen ?? 0) ? s : null;
  }
  if (s.role === "organiser") {
    switch (s.via) {
      case "account": {
        const a = await getAccount();
        return a && (await isAccountOrganiser(a.id, t.id)) ? s : null;
      }
      case "owner":
        return (await isOwner()) ? s : null;
      case "create":
        return s;
      default:
        // Signed in before emails, with the tournament's organiser PIN: good until it moves to email sign-in
        return t.organiser_pin_hash ? s : null;
    }
  }
  return s;
}

export const DEMO_READONLY = "This is an example tournament, so nothing can be changed here. Start your own to try it for real.";

/** Full state including hidden/report-only posts and drafts. Server only. */
export async function loadServerState(tournamentId: string): Promise<TournamentState> {
  const db = adminClient();
  const { data: tournament, error } = await db.from("public_tournaments").select("*").eq("id", tournamentId).single();
  if (error || !tournament) throw new Error("Tournament not found");
  const tid = tournament.id;
  const [players, rounds, posts, comments, pieces, votes] = await Promise.all([
    db.from("public_players").select("*").eq("tournament_id", tid).order("sort"),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("votes").select("*").eq("tournament_id", tid),
  ]);
  const roundIds = (rounds.data ?? []).map((r: RoundRow) => r.id);
  const likes = await db.from("likes").select("*").eq("tournament_id", tid);
  const [entries, attestations, shots, cards, signatures, gps] = roundIds.length
    ? await Promise.all([
        db.from("hole_entries").select("*").in("round_id", roundIds),
        db.from("attestations").select("*").in("round_id", roundIds),
        // shots, cards: empty if the database doesn't have the table yet
        db.from("shots").select("*").eq("tournament_id", tid).order("logged_at"),
        db.from("cards").select("*").in("round_id", roundIds),
        db.from("card_signatures").select("*").in("round_id", roundIds),
        db.from("public_gps").select("*").eq("tournament_id", tid).order("taken_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
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
  };
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function bad(message: string, status = 400) {
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

/** The site's public address, for links in emails. */
export function siteOrigin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
