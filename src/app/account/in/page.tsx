"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/** The emailed sign-in link lands here: one tap and you're in. */
function InInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", token: sp.get("token") }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return setErr(j.error ?? "That link didn't work.");
        const next = sp.get("next");
        router.replace(next && next.startsWith("/account") ? next : "/account");
      })
      .catch(() => setErr("No signal. Open the link again when you're back online."));
  }, [sp, router]);
  return (
    <div className="theme-root" data-theme="clubhouse">
      <main className="acct">
        {err ? (
          <section className="panel stack">
            <h1>Sign-in link</h1>
            <p className="lead">{err}</p>
            <Link className="btn big" href="/account">
              Get a new link
            </Link>
          </section>
        ) : (
          <p className="lead">Signing you in…</p>
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
