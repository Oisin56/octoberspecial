"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTournament, type LiveTournament } from "@/lib/useTournament";

export interface ClientSession {
  role: "organiser" | "player" | "contributor";
  name: string;
  playerId?: string;
}

interface Ctx extends LiveTournament {
  session: ClientSession | null;
  reloadSession: () => Promise<void>;
  /** Build a link inside this tournament */
  href: (path: string) => string;
  /** POST JSON to an API route with this tournament attached */
  api: (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; j: Record<string, unknown> }>;
}

const TournamentContext = createContext<Ctx | null>(null);

export function Providers({ slug, children }: { slug: string; children: React.ReactNode }) {
  const live = useTournament(slug);
  const [session, setSession] = useState<ClientSession | null>(null);

  const reloadSession = useCallback(async () => {
    try {
      const r = await fetch(`/api/login?t=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const j = await r.json();
      setSession(j.session ?? null);
    } catch {
      /* offline: keep what we had */
    }
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
    <TournamentContext.Provider value={{ ...live, session, reloadSession, href, api }}>{children}</TournamentContext.Provider>
  );
}

export function useT() {
  const c = useContext(TournamentContext);
  if (!c) throw new Error("useT outside provider");
  return c;
}
