"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicClient } from "./supabase";
import {
  TOURNAMENT_SLUG,
  toEntries,
  toTournamentConfig,
  type HoleEntryRow,
  type TournamentState,
} from "./types";
import { queued } from "./offlineQueue";
import { tournamentSummary, type TournamentSummary } from "./scoring";

type Table =
  | "rounds"
  | "hole_entries"
  | "attestations"
  | "posts"
  | "comments"
  | "ai_pieces";

async function loadAll(): Promise<TournamentState | null> {
  const db = publicClient();
  const { data: tournament } = await db
    .from("tournaments")
    .select("*")
    .eq("slug", TOURNAMENT_SLUG)
    .maybeSingle();
  if (!tournament) return null;
  const tid = tournament.id;

  const [players, rounds, posts, comments, pieces] = await Promise.all([
    db.from("public_players").select("*").eq("tournament_id", tid),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(500),
    db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(300),
    db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
  ]);
  const roundIds = (rounds.data ?? []).map((r) => r.id);
  const [entries, attestations] = await Promise.all([
    roundIds.length ? db.from("hole_entries").select("*").in("round_id", roundIds) : { data: [] },
    roundIds.length ? db.from("attestations").select("*").in("round_id", roundIds) : { data: [] },
  ]);

  return {
    tournament,
    players: (players.data ?? []).sort((a, b) => a.sort - b.sort),
    rounds: rounds.data ?? [],
    entries: entries.data ?? [],
    attestations: attestations.data ?? [],
    posts: posts.data ?? [],
    comments: comments.data ?? [],
    pieces: pieces.data ?? [],
  };
}

export interface LiveTournament {
  state: TournamentState | null;
  summary: TournamentSummary | null;
  names: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Optimistically patch local state (e.g. after the scorer saves a hole). */
  patch: (fn: (s: TournamentState) => TournamentState) => void;
}

export function useTournament(): LiveTournament {
  const [state, setState] = useState<TournamentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await loadAll();
      if (!s) setError("Tournament not found. Has the seed data been loaded into Supabase?");
      // Keep scores that are still waiting for signal visible on this phone
      if (s) {
        for (const q of queued()) {
          s.entries = s.entries.filter((e) => !(e.round_id === q.roundId && e.hole === q.hole));
          s.entries.push({
            id: `queued-${q.roundId}-${q.hole}`,
            round_id: q.roundId,
            hole: q.hole,
            scores: q.payload.scores as HoleEntryRow["scores"],
            ctp_winner: (q.payload.ctpWinner as string | null) ?? null,
            ld_winner: (q.payload.ldWinner as string | null) ?? null,
            updated_by: null,
            updated_at: new Date(q.at).toISOString(),
          });
        }
      }
      setState(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: any change to a live table triggers a debounced reload.
  useEffect(() => {
    const db = publicClient();
    const tables: Table[] = ["rounds", "hole_entries", "attestations", "posts", "comments", "ai_pieces"];
    const channel = db.channel("tournament-live");
    for (const t of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(refresh, 400);
      });
    }
    channel.subscribe();
    // Fallback poll in case realtime drops on bad signal
    const poll = setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      db.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const names = useMemo(
    () => Object.fromEntries((state?.players ?? []).map((p) => [p.id, p.name])),
    [state?.players],
  );

  const summary = useMemo(() => {
    if (!state) return null;
    return tournamentSummary(toTournamentConfig(state), toEntries(state.entries), names);
  }, [state, names]);

  const patch = useCallback((fn: (s: TournamentState) => TournamentState) => {
    setState((s) => (s ? fn(s) : s));
  }, []);

  return { state, summary, names, loading, error, refresh, patch };
}
