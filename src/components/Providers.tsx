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
}

const TournamentContext = createContext<Ctx | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const live = useTournament();
  const [session, setSession] = useState<ClientSession | null>(null);

  const reloadSession = useCallback(async () => {
    try {
      const r = await fetch("/api/login", { cache: "no-store" });
      const j = await r.json();
      setSession(j.session ?? null);
    } catch {
      /* offline: keep whatever we had */
    }
  }, []);

  useEffect(() => {
    reloadSession();
  }, [reloadSession]);

  return (
    <TournamentContext.Provider value={{ ...live, session, reloadSession }}>
      {children}
    </TournamentContext.Provider>
  );
}

export function useT() {
  const c = useContext(TournamentContext);
  if (!c) throw new Error("useT outside provider");
  return c;
}
