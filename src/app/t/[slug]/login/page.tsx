"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { landingPath } from "@/lib/landing";

type Mode = "player" | "organiser" | "follow" | null;

/** Three big choices: playing, organising, or following. Players with a link from the organiser don't need this. */
function LoginInner() {
  const { state, session, reloadSession, api, href, slug } = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const [mode, setMode] = useState<Mode>(sp.get("as") === "organiser" ? "organiser" : null);
  const [playerId, setPlayerId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await api("/api/login", { mode, pin, playerId });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't log in. Check the PIN and try again."));
    await reloadSession();
    const who = mode === "organiser" ? { role: "organiser" as const, playerId: state?.tournament.organiser_player_id ?? undefined } : { role: "player" as const, playerId };
    router.push(next?.startsWith("/") ? next : href(landingPath(state, who)));
  }

  async function logout() {
    await fetch(`/api/login?t=${encodeURIComponent(slug)}`, { method: "DELETE" });
    await reloadSession();
  }

  if (session && session.role !== "fan")
    return (
      <div className="panel stack login" style={{ maxWidth: 460 }}>
        <h1>Logged in</h1>
        <p>
          You&apos;re logged in as <strong>{session.name}</strong> ({session.role === "organiser" ? "organiser" : "player"}).
        </p>
        <Link className="btn block big" href={href(landingPath(state, session))}>
          Continue
        </Link>
        <button className="btn secondary block" onClick={logout}>
          Log out
        </button>
      </div>
    );

  const player = state?.players.find((p) => p.id === playerId);
  return (
    <div className="stack login" style={{ maxWidth: 520 }}>
      {session?.role === "fan" && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>
            You&apos;re following as <strong>{session.name}</strong>.
          </span>
          <button type="button" className="chip" onClick={logout}>
            Sign out
          </button>
        </div>
      )}

      {!mode && (
        <>
          <h1>Log in</h1>
          <div className="login-tiles">
            <button className="login-tile" onClick={() => setMode("player")}>
              <span className="lt-h">I&apos;m playing</span>
              <span className="lt-s">Score, film and sign your card</span>
            </button>
            <button className="login-tile" onClick={() => setMode("organiser")}>
              <span className="lt-h">I&apos;m the organiser</span>
              <span className="lt-s">Run the tournament</span>
            </button>
            <button className="login-tile" onClick={() => setMode("follow")}>
              <span className="lt-h">I&apos;m following</span>
              <span className="lt-s">Caddies, friends and family: watch, share photos, comment</span>
            </button>
          </div>
          <p className="small muted">Got a link from the organiser? Just tap it: it logs you in.</p>
        </>
      )}

      {mode === "player" && (
        <form className="panel stack" onSubmit={submit}>
          <button type="button" className="back-home" onClick={() => (setMode(null), setPlayerId(""), setErr(null))}>
            <span aria-hidden>←</span> Back
          </button>
          {!player ? (
            <>
              <h1>Who are you?</h1>
              <div className="name-tiles">
                {state?.players.map((p) => (
                  <button type="button" key={p.id} className="name-tile" onClick={() => setPlayerId(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1>{player.name}</h1>
              <div className="field">
                <label htmlFor="pin">Your PIN</label>
                <input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
              </div>
              {err && <p className="error">{err}</p>}
              <button className="btn block big" disabled={busy}>
                Log in
              </button>
              <button type="button" className="chip" onClick={() => (setPlayerId(""), setPin(""), setErr(null))}>
                Not {player.name}?
              </button>
            </>
          )}
        </form>
      )}

      {mode === "organiser" && (
        <form className="panel stack" onSubmit={submit}>
          <button type="button" className="back-home" onClick={() => (setMode(null), setErr(null))}>
            <span aria-hidden>←</span> Back
          </button>
          <h1>Organiser</h1>
          <div className="field">
            <label htmlFor="opin">Organiser PIN</label>
            <input id="opin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn block big" disabled={busy}>
            Log in
          </button>
          <Link className="btn secondary block" href="/account">
            Sign in with email: all my tournaments
          </Link>
        </form>
      )}

      {mode === "follow" && (
        <div className="panel stack">
          <button type="button" className="back-home" onClick={() => setMode(null)}>
            <span aria-hidden>←</span> Back
          </button>
          <h1>Following</h1>
          <p className="lead">You don&apos;t need to log in to follow: the scores, the feed and the highlights are open to everyone.</p>
          <p>To share photos and comment, join the conversation with your name and email. We&apos;ll email you a link: no password.</p>
          <Link className="btn block big" href={href("/feed?join=1")}>
            Join the conversation
          </Link>
          <Link className="btn secondary block" href={href(landingPath(state, null))}>
            Just follow
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Login() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
