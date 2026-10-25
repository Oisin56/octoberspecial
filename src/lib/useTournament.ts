"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicClient, rememberSigned } from "./supabase";
import { normalizeRound, toEntries, toTournamentCfg, type HoleEntryRow, type TournamentState } from "./types";
import { tournamentSummary, type TournamentCfg, type TournamentSummary } from "./engine";
import { queued } from "./offlineQueue";

/** Where this phone stands with a private tournament it can't see yet */
export type Gate = { status: "none" | "asking" | "declined" | "removed" | "confirm" };

type Loaded = { state: TournamentState; private: boolean } | { gate: Gate } | null;

/** A private tournament comes from the site's server, for the people let in (with links to its files). */
async function loadPrivate(slug: string): Promise<Loaded> {
  const r = await fetch(`/api/state?t=${encodeURIComponent(slug)}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && j.private) return { gate: { status: j.status ?? "none" } };
  if (!r.ok || !j.state) return null;
  rememberSigned(j.media);
  return { state: j.state as TournamentState, private: true };
}

async function loadAll(slug: string, wasPrivate: boolean): Promise<Loaded> {
  if (wasPrivate) return loadPrivate(slug);
  const db = publicClient();
  const { data: tournament } = await db.from("open_tournaments").select("*").eq("slug", slug).maybeSingle();
  if (!tournament) return loadPrivate(slug);
  const tid = tournament.id;
  const [players, rounds, posts, comments, pieces, votes] = await Promise.all([
    db.from("open_players").select("*").eq("tournament_id", tid).order("sort"),
    db.from("rounds").select("*").eq("tournament_id", tid).order("number"),
    db.from("posts").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(500),
    db.from("comments").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }).limit(300),
    db.from("ai_pieces").select("*").eq("tournament_id", tid).order("created_at", { ascending: false }),
    db.from("votes").select("*").eq("tournament_id", tid),
  ]);
  const roundIds = (rounds.data ?? []).map((r) => r.id);
  const likes = await db.from("likes").select("*").eq("tournament_id", tid);
  const [entries, attestations, shots, cards, signatures, gps] = roundIds.length
    ? await Promise.all([
        db.from("hole_entries").select("*").in("round_id", roundIds),
        db.from("attestations").select("*").in("round_id", roundIds),
        // shots, cards: empty if the database doesn't have the table yet
        db.from("shots").select("*").eq("tournament_id", tid).order("logged_at"),
        db.from("cards").select("*").in("round_id", roundIds),
        db.from("card_signatures").select("*").in("round_id", roundIds),
        db.from("open_gps").select("*").eq("tournament_id", tid).order("taken_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  return { private: false, state: {
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
  } };
}

export interface LiveTournament {
  slug: string;
  state: TournamentState | null;
  cfg: TournamentCfg | null;
  summary: TournamentSummary | null;
  names: Record<string, string>;
  loading: boolean;
  error: string | null;
  /** A private tournament this phone isn't let into (yet) */
  gate: Gate | null;
  /** Private: it comes from the site's server, every few seconds, instead of live from the database */
  isPrivate: boolean;
  refresh: () => Promise<void>;
  patch: (fn: (s: TournamentState) => TournamentState) => void;
}

export function useTournament(slug: string): LiveTournament {
  const [state, setState] = useState<TournamentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [isPrivate, setPrivate] = useState(false);
  const priv = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const got = await loadAll(slug, priv.current);
      if (got && "gate" in got) {
        setGate(got.gate);
        setState(null);
        priv.current = true;
        setPrivate(true);
        return;
      }
      setGate(null);
      if (got) {
        priv.current = got.private;
        setPrivate(got.private);
      }
      const s = got ? got.state : null;
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

  // Private: from the site's server every few seconds (the database's live updates don't carry private tournaments)
  useEffect(() => {
    if (!isPrivate) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 6000);
    return () => clearInterval(poll);
  }, [isPrivate, refresh]);

  useEffect(() => {
    if (isPrivate) return;
    const db = publicClient();
    const tables = ["rounds", "hole_entries", "attestations", "posts", "comments", "ai_pieces", "votes", "shots", "likes", "cards", "card_signatures"];
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
  }, [refresh, slug, isPrivate]);

  const names = useMemo(() => Object.fromEntries((state?.players ?? []).map((p) => [p.id, p.name])), [state?.players]);
  const cfg = useMemo(() => (state ? toTournamentCfg(state) : null), [state]);
  const summary = useMemo(() => (state && cfg ? tournamentSummary(cfg, toEntries(state.entries)) : null), [state, cfg]);

  const patch = useCallback((fn: (s: TournamentState) => TournamentState) => {
    setState((s) => (s ? fn(s) : s));
  }, []);

  return { slug, state, cfg, summary, names, loading, error, gate, isPrivate, refresh, patch };
}
