"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { landingPath } from "@/lib/landing";

/** A player's personal link: one tap logs them in on this phone and takes them to their page. */
export default function PlayerLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { state, api, reloadSession, href } = useT();
  const router = useRouter();
  const [who, setWho] = useState<{ name: string; role: "organiser" | "player"; playerId?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api("/api/login", { mode: "link", code }).then(async (r) => {
      if (!r.ok) return setErr(String(r.j.error ?? "That link didn't work."));
      await reloadSession();
      setWho({ name: String(r.j.name), role: r.j.role === "organiser" ? "organiser" : "player", playerId: r.j.playerId ? String(r.j.playerId) : undefined });
    });
  }, [api, code, reloadSession]);

  // Logged in: on to their page once the tournament has loaded
  useEffect(() => {
    if (!who || !state) return;
    const t = setTimeout(() => router.replace(href(landingPath(state, who))), 900);
    return () => clearTimeout(t);
  }, [who, state, router, href]);

  return (
    <div className="panel stack link-in" style={{ maxWidth: 460, margin: "24px auto" }}>
      {err ? (
        <>
          <h1>That link didn&apos;t work</h1>
          <p>{err}</p>
          <Link className="btn block" href={href("/login")}>
            Log in with your PIN instead
          </Link>
        </>
      ) : who ? (
        <>
          <h1>Welcome, {who.name}</h1>
          <p className="lead">You&apos;re logged in on this phone. Taking you to {state?.tournament.name ?? "the tournament"}…</p>
        </>
      ) : (
        <p className="lead">Logging you in…</p>
      )}
    </div>
  );
}
