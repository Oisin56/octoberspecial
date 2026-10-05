"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicClient } from "./supabase";
import { toEntries, toTournamentCfg, type HoleEntryRow, type TournamentState } from "./types";
import { tournamentSummary, type TournamentCfg, type TournamentSummary } from "./engine";
import { queued } from "./offlineQueue";

async function loadAll(slug: string): Promise<TournamentState | null> {
  const db = publicClient();
  const { data: tournament } = await db.from("public_tournaments").select("*").eq("slug", slug).maybeSingle();
  if (!tournament) return null;
  const tid = tournament.id;
  const [players, rounds, posts, comments, pieces, votes] = await Promise.all([
    db.from("public_players").select("*").eq("tournament_id", tid).order("sort"),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(500),
    db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(300),
    db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("votes").select("*").eq("tournament_id", tid),
  ]);
  const roundIds = (rounds.data ?? []).map((r) => r.id);
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

export interface LiveTournament {
  slug: string;
  state: TournamentState | null;
  cfg: TournamentCfg | null;
  summary: TournamentSummary | null;
  names: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  patch: (fn: (s: TournamentState) => TournamentState) => void;
}

export function useTournament(slug: string): LiveTournament {
  const [state, setState] = useState<TournamentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await loadAll(slug);
      if (!s) setError("We couldn't find this tournament. Check the link.");
      if (s) {
        // Keep scores still waiting for signal visible on this phone
        for (const q of queued().filter((x) => x.slug === slug)) {
          s.entries = s.entries.filter((e) => !(e.round_id === q.roundId && e.game === q.game && e.hole === q.hole));
          s.entries.push({
            id: `queued-${q.roundId}-${q.game}-${q.hole}`,
            round_id: q.roundId,
            game: q.game,
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
  }, [slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const db = publicClient();
    const tables = ["rounds", "hole_entries", "attestations", "posts", "comments", "ai_pieces", "votes"];
    const channel = db.channel(`t-${slug}`);
    for (const t of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(refresh, 400);
      });
    }
    channel.subscribe();
    const poll = setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      db.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, slug]);

  const names = useMemo(() => Object.fromEntries((state?.players ?? []).map((p) => [p.id, p.name])), [state?.players]);
  const cfg = useMemo(() => (state ? toTournamentCfg(state) : null), [state]);
  const summary = useMemo(() => (state && cfg ? tournamentSummary(cfg, toEntries(state.entries)) : null), [state, cfg]);

  const patch = useCallback((fn: (s: TournamentState) => TournamentState) => {
    setState((s) => (s ? fn(s) : s));
  }, []);

  return { slug, state, cfg, summary, names, loading, error, refresh, patch };
}
