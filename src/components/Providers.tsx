"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTournament, type LiveTournament } from "@/lib/useTournament";
import { rememberTournament } from "@/lib/recent";
import { deviceId } from "@/lib/device";
import type { CourseGeo } from "@/lib/gps";

export interface ClientSession {
  role: "organiser" | "player" | "fan";
  name: string;
  playerId?: string;
  fanId?: string;
}

/** The front page's sample round: what stands in for the course, the camera and the microphone */
export interface SampleKit {
  geo: CourseGeo;
  /** Where "you" stand on a hole when you tap GPS */
  spot: (hole: number) => [number, number] | null;
  /** What the voice note "hears" */
  note: string;
  /** Players whose scores are already in: shown, not changed */
  locked?: string[];
}

interface Ctx extends LiveTournament {
  /** Set only in the sample round */
  sample?: SampleKit;
  /** The front page's example tournament: look, don't touch */
  demo: boolean;
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

export function Providers({ slug, demo = false, children }: { slug: string; demo?: boolean; children: React.ReactNode }) {
  const live = useTournament(slug);
  // Remembered on this phone, for the front page (not the example tournament)
  const tname = live.state?.tournament.name;
  useEffect(() => {
    if (tname && !demo) rememberTournament(slug, tname);
  }, [slug, tname, demo]);
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

  // A private tournament: who's signed in decides what can be seen, so it's loaded again when that changes
  const { isPrivate, refresh } = live;
  const who = session ? `${session.role}:${session.playerId ?? session.fanId ?? ""}` : "";
  useEffect(() => {
    if (isPrivate && sessionReady) refresh();
  }, [who, isPrivate, sessionReady, refresh]);

  // Watching without a name: counted once a day for "and 23 others watching"
  const watching = sessionReady && !session && !!tname && !demo;
  useEffect(() => {
    if (!watching) return;
    try {
      const key = `mgs_viewed_${slug}`;
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
      fetch("/api/viewed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: slug, device: deviceId() }) }).catch(() => {});
    } catch {
      /* private browsing: not counted */
    }
  }, [watching, slug]);

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
    <TournamentContext.Provider value={{ ...live, demo, session, sessionReady, crew: !!session && session.role !== "fan", reloadSession, href, api }}>{children}</TournamentContext.Provider>
  );
}

/** The sample round: the same screens, given their tournament directly (see SamplePage) */
export function SampleProviders({ value, children }: { value: Ctx; children: React.ReactNode }) {
  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}
export type TournamentCtx = Ctx;

export function useT() {
  const c = useContext(TournamentContext);
  if (!c) throw new Error("useT outside provider");
  return c;
}
