"use client";

import { useState } from "react";

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again when you're back online." };
  return { ok: !!r?.ok, j };
}

/**
 * Sign in with your email: we send a button and a 6-digit code. The code is typed here, for when the email opens on
 * another device (or in the mail app's own browser). No password.
 */
export function EmailSignIn({
  title,
  lead,
  next,
  button = "Email me a sign-in link",
  initialEmail = "",
  level = 1,
  onSignedIn,
  children,
}: {
  title: string;
  lead: React.ReactNode;
  next?: string;
  button?: string;
  initialEmail?: string;
  /** 2 when the page already has its own main heading */
  level?: 1 | 2;
  onSignedIn: (next: string | null) => void;
  children?: React.ReactNode;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [again, setAgain] = useState(false);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await post({ action: "send", email, next });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setSent(true);
    setCode("");
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await post({ action: "code", email, code });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That code didn't work."));
    onSignedIn((r.j.next as string | null) ?? next ?? null);
  }

  const H = level === 1 ? "h1" : "h2";
  if (sent)
    return (
      <form className="panel stack sign-in" onSubmit={check}>
        <H>Check your email</H>
        <p className="lead">
          We&apos;ve sent an email to <strong>{email}</strong>. Tap the button in it, or type the 6-digit code here.
        </p>
        <div className="field">
          <label htmlFor="si-code">The code from the email</label>
          <input
            id="si-code"
            className="si-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            autoFocus
          />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn block big" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <p className="small muted si-help">
          Nothing there? Check your junk folder.{" "}
          <button
            type="button"
            className="linklike"
            disabled={busy || again}
            onClick={async () => {
              setAgain(true);
              await send();
              setTimeout(() => setAgain(false), 20000);
            }}
          >
            {again ? "Sent again" : "Send it again"}
          </button>{" "}
          or{" "}
          <button type="button" className="linklike" onClick={() => (setSent(false), setErr(null))}>
            use a different email
          </button>
          .
        </p>
      </form>
    );

  return (
    <form className="panel stack sign-in" onSubmit={send}>
      <H>{title}</H>
      <p className="lead">{lead}</p>
      <div className="field">
        <label htmlFor="si-email">Your email</label>
        <input id="si-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn block big" disabled={busy || !email.trim()}>
        {busy ? "Sending…" : button}
      </button>
      {children}
    </form>
  );
}
