"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { EmailSignIn } from "@/components/EmailSignIn";
import { landingPath } from "@/lib/landing";

type Mode = "player" | "playerPin" | "organiser" | "organiserPin" | "addEmail" | "follow" | null;

/** Three big choices: playing, organising, or following. Players with a link from the organiser don't need this. */
function LoginInner() {
  const { state, session, reloadSession, api, href, slug, demo } = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const [mode, setMode] = useState<Mode>(sp.get("as") === "organiser" ? "organiser" : null);
  const [pins, setPins] = useState<{ organiser: boolean; players: boolean }>({ organiser: false, players: false });
  const [playerId, setPlayerId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/login?t=${encodeURIComponent(slug)}&pins=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.pins && setPins(j.pins))
      .catch(() => {});
  }, [slug]);

  const adminPath = `/t/${slug}/admin`;
  const go = (who: Parameters<typeof landingPath>[1]) => router.push(next?.startsWith("/") ? next : href(landingPath(state, who)));

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await api("/api/login", { mode: mode === "organiserPin" ? "organiser" : "player", pin, playerId });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "Couldn't sign in. Check the PIN and try again."));
    await reloadSession();
    // An organiser's old PIN works once more: then their email from now on
    if (r.j.needEmail) return setMode("addEmail");
    go(mode === "organiserPin" ? { role: "organiser", playerId: state?.tournament.organiser_player_id ?? undefined } : { role: "player", playerId });
  }

  async function logout() {
    await fetch(`/api/login?t=${encodeURIComponent(slug)}`, { method: "DELETE" });
    await reloadSession();
  }

  if (mode === "addEmail")
    return (
      <div className="stack login" style={{ maxWidth: 520 }}>
        <EmailSignIn
          title="Add your email to keep this tournament safe"
          lead="From now on you'll sign in with your email instead of the PIN, on any phone or computer. We'll send you a link and a code. No password."
          next={adminPath}
          button="Email me a link"
          onSignedIn={async () => {
            await reloadSession();
            router.push(adminPath);
          }}
        />
      </div>
    );

  if (session && session.role !== "fan")
    return (
      <div className="panel stack login" style={{ maxWidth: 460 }}>
        <h1>You&apos;re signed in</h1>
        <p>
          {session.role === "organiser" ? "You're the organiser" : "You're playing"} as <strong>{session.name}</strong>.
        </p>
        <Link className="btn block big" href={href(landingPath(state, session))}>
          Continue
        </Link>
        <button className="btn secondary block" onClick={logout}>
          Not {session.name}? Sign out
        </button>
      </div>
    );

  if (demo)
    return (
      <div className="panel stack login" style={{ maxWidth: 460 }}>
        <h1>This is an example</h1>
        <p>It shows what a tournament looks like, so nobody can sign in or join here. Have a look around, or start your own.</p>
        <Link className="btn block big" href="/invite">
          Start your own
        </Link>
        <Link className="btn secondary block" href={href("/")}>
          Keep looking
        </Link>
      </div>
    );

  const player = state?.players.find((p) => p.id === playerId);
  const back = (to: Mode = null) => (
    <button type="button" className="back-home" onClick={() => (setMode(to), setPlayerId(""), setPin(""), setErr(null))}>
      <span aria-hidden>←</span> Back
    </button>
  );

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
          <h1>Sign in</h1>
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
        </>
      )}

      {mode === "player" && (
        <div className="panel stack">
          {back()}
          <h1>Use your link</h1>
          <p className="lead">Tap the link the organiser sent you, by WhatsApp, text or email. It signs you in on this phone.</p>
          <p>Lost it, or on a new phone? Ask the organiser to send it again. It&apos;s one tap for them.</p>
          <Link className="btn secondary block big" href={`/account?next=${encodeURIComponent(`/t/${slug}`)}`}>
            I&apos;ve added my email: sign in
          </Link>
          {pins.players && (
            <button type="button" className="linklike" onClick={() => setMode("playerPin")}>
              Have a PIN from the organiser?
            </button>
          )}
        </div>
      )}

      {mode === "playerPin" && (
        <form className="panel stack" onSubmit={submitPin}>
          {back("player")}
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
                Sign in
              </button>
              <button type="button" className="chip" onClick={() => (setPlayerId(""), setPin(""), setErr(null))}>
                Not {player.name}?
              </button>
            </>
          )}
        </form>
      )}

      {mode === "organiser" && (
        <>
          {back()}
          <EmailSignIn
            title="Organiser"
            lead="Sign in with your email to run the tournament. We'll send you a link and a code. No password."
            next={adminPath}
            onSignedIn={async () => {
              await reloadSession();
              router.push(adminPath);
            }}
          >
            {pins.organiser && (
              <button type="button" className="linklike" onClick={() => setMode("organiserPin")}>
                Still using an organiser PIN?
              </button>
            )}
          </EmailSignIn>
        </>
      )}

      {mode === "organiserPin" && (
        <form className="panel stack" onSubmit={submitPin}>
          {back("organiser")}
          <h1>Organiser PIN</h1>
          <p>One last time: next you&apos;ll add your email, and sign in with that from now on.</p>
          <div className="field">
            <label htmlFor="opin">Organiser PIN</label>
            <input id="opin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn block big" disabled={busy}>
            Continue
          </button>
        </form>
      )}

      {mode === "follow" && (
        <div className="panel stack">
          {back()}
          <h1>Following</h1>
          <p className="lead">You don&apos;t need to sign in to follow: the scores, the feed and the highlights are open to everyone with the link.</p>
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
