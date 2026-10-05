import "server-only";
import { adminClient } from "./admin";
import { TOURNAMENT_SLUG, type TournamentState, type RoundRow } from "./types";

/** Full state including hidden/report-only posts and drafts. Server only. */
export async function loadServerState(): Promise<TournamentState> {
  const db = adminClient();
  const { data: tournament, error } = await db
    .from("tournaments")
    .select("*")
    .eq("slug", TOURNAMENT_SLUG)
    .single();
  if (error || !tournament) throw new Error("Tournament not found");
  const tid = tournament.id;
  const [players, rounds, posts, comments, pieces] = await Promise.all([
    db
      .from("players")
      .select("id,tournament_id,name,nickname,handicap,home_club,bio,best_club,worst_club,weakness,quote,photo_path,sort")
      .eq("tournament_id", tid)
      .order("sort"),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
  ]);
  const roundIds = (rounds.data ?? []).map((r: RoundRow) => r.id);
  const [entries, attestations] = await Promise.all([
    db.from("hole_entries").select("*").in("round_id", roundIds),
    db.from("attestations").select("*").in("round_id", roundIds),
  ]);
  return {
    tournament,
    players: players.data ?? [],
    rounds: rounds.data ?? [],
    entries: entries.data ?? [],
    attestations: attestations.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    pieces: pieces.data ?? [],
  };
}

export async function getTournamentId(): Promise<string> {
  const { data } = await adminClient()
    .from("tournaments")
    .select("id")
    .eq("slug", TOURNAMENT_SLUG)
    .single();
  if (!data) throw new Error("Tournament not found");
  return data.id;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
