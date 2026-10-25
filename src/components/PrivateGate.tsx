"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";

/**
 * A private tournament this phone isn't let into: nothing of it shows, only a way to ask to follow (or to get in as a
 * player with a personal link, or as someone already let in with their email). The pages that let people in still
 * open: a player's link, signing in, a follower's emailed link.
 */
export function PrivateGate({ children }: { children: React.ReactNode }) {
  const { gate, slug } = useT();
  const path = usePathname();
  const rest = path.slice(`/t/${slug}`.length);
  if (!gate || /^\/(in|login|join)(\/|$)/.test(rest)) return <>{children}</>;
  return <Gate status={gate.status} />;
}

function Gate({ status }: { status: "none" | "asking" | "declined" | "removed" | "confirm" }) {
  const { api, slug, refresh, reloadSession } = useT();
  const [step, setStep] = useState<"ask" | "code">(status === "confirm" ? "code" : "ask");
  const [name, setName] = useState("");
  const [how, setHow] = useState("");
  const [email, setEmail] = useState("");
  const [over16, setOver16] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (status === "asking" || status === "declined")
    return (
      <div className="panel stack gate">
        <h1>Waiting for approval</h1>
        <p className="lead">You&apos;ve asked to follow. A player or organiser will let you in, and we&apos;ll email you as soon as they do.</p>
        <p className="small muted" style={{ margin: 0 }}>
          This page opens by itself when you&apos;re in.
        </p>
      </div>
    );

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!over16) return setErr("Tick the box to say you're 16 or over");
    setBusy(true);
    setErr(null);
    const r = await api("/api/fans", { action: "ask", name, how, email, over16 });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setStep("code");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "code", email, code }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(String(j.error ?? "That code didn't work."));
    await reloadSession();
    await refresh();
  }

  if (step === "code")
    return (
      <form className="panel stack gate sign-in" onSubmit={confirm}>
        <h1>Check your email</h1>
        <p className="lead">
          {email ? (
            <>
              We&apos;ve sent a code to <strong>{email}</strong>. Type it here, or tap the button in the email, and your request goes to the players.
            </>
          ) : (
            <>Type the code from the email we sent you, or tap the button in it, and your request goes to the players.</>
          )}
        </p>
        {!email && (
          <div className="field">
            <label htmlFor="g-email2">Your email</label>
            <input id="g-email2" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
        )}
        <div className="field">
          <label htmlFor="g-code">The code from the email</label>
          <input id="g-code" className="si-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Send my request"}
        </button>
        <button type="button" className="linklike" onClick={() => (setStep("ask"), setErr(null))}>
          Start again
        </button>
      </form>
    );

  return (
    <div className="stack gate">
      <section className="panel stack">
        <h1>This tournament is private</h1>
        <p className="lead">Only the players and the people they let in can see it.</p>
        <p style={{ margin: 0 }}>
          <strong>Playing?</strong> Tap the personal link your organiser sent you.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Already let in?</strong> <Link href={`/account?next=${encodeURIComponent(`/t/${slug}`)}`}>Sign in with your email</Link>.
        </p>
      </section>
      <form className="panel stack" onSubmit={ask}>
        <h2>Ask to follow</h2>
        <div className="field">
          <label htmlFor="g-name">Your name</label>
          <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required />
        </div>
        <div className="field">
          <label htmlFor="g-how">How do you know the group?</label>
          <input id="g-how" value={how} onChange={(e) => setHow(e.target.value)} maxLength={60} placeholder="For example, Neil's brother" required />
        </div>
        <div className="field">
          <label htmlFor="g-email">Your email</label>
          <input id="g-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <button type="button" className="cd-film-only" role="switch" aria-checked={over16} onClick={() => setOver16((v) => !v)}>
          <span className="box" aria-hidden="true">
            {over16 ? "✓" : ""}
          </span>
          <span>
            <strong>I&apos;m 16 or over</strong>
          </span>
        </button>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy}>
          {busy ? "Sending…" : "Ask to follow"}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          We&apos;ll email you a code to confirm it&apos;s you. The players will see your name and how you know them. By continuing you agree to the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </form>
    </div>
  );
}
