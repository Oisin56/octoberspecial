import "server-only";
import { adminClient } from "./admin";
import type { TournamentRow, TournamentState, RoundRow } from "./types";
import { getSession, type Session } from "./auth";

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
  const session: Session | null = t ? await getSession(t.id) : null;
  return { t, session };
}

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
  const [entries, attestations] = roundIds.length
    ? await Promise.all([
        db.from("hole_entries").select("*").in("round_id", roundIds),
        db.from("attestations").select("*").in("round_id", roundIds),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    tournament,
    players: players.data ?? [],
    rounds: rounds.data ?? [],
    entries: entries.data ?? [],
    attestations: attestations.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    pieces: pieces.data ?? [],
    votes: votes.data ?? [],
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
