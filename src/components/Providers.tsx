"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTournament, type LiveTournament } from "@/lib/useTournament";

export interface ClientSession {
  role: "organiser" | "player" | "fan";
  name: string;
  playerId?: string;
  fanId?: string;
}

interface Ctx extends LiveTournament {
  session: ClientSession | null;
  /** Logged in as a player or the organiser (not a fan) */
  crew: boolean;
  reloadSession: () => Promise<void>;
  /** The session has been checked at least once (so "not logged in" is real) */
  sessionReady: boolean;
  /** Build a link inside this tournament */
  href: (path: string) => string;
  /** POST JSON to an API route with this tournament attached */
  api: (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; j: Record<string, unknown> }>;
}

const TournamentContext = createContext<Ctx | null>(null);

export function Providers({ slug, children }: { slug: string; children: React.ReactNode }) {
  const live = useTournament(slug);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [sessionReady, setReady] = useState(false);

  const reloadSession = useCallback(async () => {
    try {
      const r = await fetch(`/api/login?t=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      setSession(j.session ?? null);
    } catch {
      /* offline: keep what we had */
    }
    setReady(true);
  }, [slug]);

  useEffect(() => {
    reloadSession();
  }, [reloadSession]);

  const href = useCallback((path: string) => `/t/${slug}${path === "/" ? "" : path}`, [slug]);
  const api = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: slug, ...body }),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, j };
    },
    [slug],
  );

  return (
    <TournamentContext.Provider value={{ ...live, session, sessionReady, crew: !!session && session.role !== "fan", reloadSession, href, api }}>{children}</TournamentContext.Provider>
  );
}

export function useT() {
  const c = useContext(TournamentContext);
  if (!c) throw new Error("useT outside provider");
  return c;
}
