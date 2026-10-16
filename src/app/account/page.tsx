"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface T {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
}

/** Organisers: sign in with your email, and every tournament you run is here, on any device. */
function AccountInner() {
  const sp = useSearchParams();
  const [state, setState] = useState<{ account: { email: string } | null; tournaments: T[] } | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(!!sp.get("add"));
  const [link, setLink] = useState(sp.get("add") ?? "");
  const [pin, setPin] = useState("");

  const load = () =>
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ account: null, tournaments: [] }));
  useEffect(() => {
    load();
  }, []);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setErr(j.error ?? "That didn't work. Try again.");
    return r.ok ? j : null;
  }

  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="mgs-head">
        <div className="mgs-wrap mgs-bar">
          <Link href="/" className="mgs-mark" aria-label={`${BRAND.name} home`}>
            <span>
              {BRAND.mark[0]}<b>{BRAND.mark[1]}</b>{BRAND.mark[2]}
            </span>
          </Link>
        </div>
      </header>
      <main className="acct">
        {!state ? (
          <p>Loading…</p>
        ) : !state.account ? (
          sent ? (
            <section className="panel stack">
              <h1>Check your email</h1>
              <p className="lead">We&apos;ve sent a sign-in link to {email}. Tap it on this phone or computer to see your tournaments.</p>
              <button className="btn secondary big" onClick={() => setSent(false)}>
                Use a different email
              </button>
            </section>
          ) : (
            <form
              className="panel stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await call({ action: "send", email, next: sp.get("add") ? `/account?add=${sp.get("add")}` : undefined })) setSent(true);
              }}
            >
              <h1>My tournaments</h1>
              <p className="lead">Organisers: sign in with your email to see every tournament you run, on any device. No password: we email you a link.</p>
              <div className="field">
                <label htmlFor="em">Your email</label>
                <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              {err && <p className="error">{err}</p>}
              <button className="btn block big" disabled={busy}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                Players and followers don&apos;t need this: use the link the organiser sent you. <Link href="/join">Lost it?</Link>
              </p>
            </form>
          )
        ) : (
          <section className="stack">
            <h1>My tournaments</h1>
            <p className="lead">Signed in as {state.account.email}</p>
            {state.tournaments.length === 0 && <p>None yet. Add one you run below, or start a new one.</p>}
            <div className="acct-list">
              {state.tournaments.map((t) => (
                <Link key={t.id} className="acct-t" href={`/t/${t.slug}/admin`}>
                  <strong>{t.name}</strong>
                  {t.subtitle && <span>{t.subtitle}</span>}
                </Link>
              ))}
            </div>
            {adding ? (
              <form
                className="panel stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const j = await call({ action: "link", t: link, pin });
                  if (j) {
                    setState((s) => (s ? { ...s, tournaments: j.tournaments } : s));
                    setAdding(false);
                    setLink("");
                    setPin("");
                  }
                }}
              >
                <h2 style={{ margin: 0 }}>Add a tournament you run</h2>
                <div className="field">
                  <label htmlFor="tl">Its link or name in the link</label>
                  <input id="tl" value={link} onChange={(e) => setLink(e.target.value)} placeholder="e.g. the link to your tournament" required />
                </div>
                <div className="field">
                  <label htmlFor="op">Its organiser PIN</label>
                  <input id="op" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" />
                </div>
                {err && <p className="error">{err}</p>}
                <div className="row">
                  <button className="btn big" style={{ flex: 1 }} disabled={busy}>
                    Add it
                  </button>
                  <button type="button" className="btn secondary big" style={{ flex: 1 }} onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="stack">
                <button className="btn secondary block big" onClick={() => setAdding(true)}>
                  Add a tournament you run
                </button>
                <Link className="btn block big" href="/new">
                  Start a new tournament
                </Link>
                <button
                  className="btn secondary block"
                  onClick={async () => {
                    await call({ action: "signout" });
                    load();
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense>
      <AccountInner />
    </Suspense>
  );
}
