"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/** The emailed sign-in link lands here. It says who it's for first, so nobody is signed in to someone else's account by
 *  tapping a link they were sent. */
function InInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const post = (body: Record<string, unknown>) =>
    fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    post({ action: "peek", token })
      .then((r) => (r.ok ? setEmail(String(r.j.email)) : setErr(r.j.error ?? "That link didn't work.")))
      .catch(() => setErr("No signal. Open the link again when you're back online."));
  }, [token]);
  async function go() {
    setBusy(true);
    const r = await post({ action: "verify", token }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(r?.j.error ?? "That link didn't work.");
    const next = typeof r.j.next === "string" && r.j.next.startsWith("/") && !r.j.next.startsWith("//") ? r.j.next : "/account";
    router.replace(next);
  }
  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <main className="acct">
        {err ? (
          <section className="panel stack sign-in">
            <h1>Sign-in link</h1>
            <p className="lead">{err}</p>
            <Link className="btn big" href="/account">
              Get a new link
            </Link>
          </section>
        ) : email ? (
          <section className="panel stack sign-in">
            <h1>Sign in</h1>
            <p className="lead">
              This link signs you in as <strong>{email}</strong>.
            </p>
            <button className="btn block big" disabled={busy} onClick={go}>
              {busy ? "Signing in…" : `Sign in as ${email}`}
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              Not your email? Close this page: someone else asked for it.
            </p>
          </section>
        ) : (
          <p className="lead">Checking the link…</p>
        )}
      </main>
    </div>
  );
}

export default function AccountIn() {
  return (
    <Suspense>
      <InInner />
    </Suspense>
  );
}
