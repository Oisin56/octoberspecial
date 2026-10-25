"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { EmailSignIn } from "@/components/EmailSignIn";

interface Tile {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
  end_date: string | null;
  as?: string | null;
}

interface Offer {
  id: string;
  role: "organiser" | "player";
  tournament: string;
  slug: string;
  player: string | null;
  added_by: string | null;
}

interface Here {
  tournament_id: string;
  slug: string;
  name: string;
  role: "organiser" | "player";
  as: string | null;
}

interface Golf {
  account: { email: string } | null;
  here?: Here[];
  owner?: boolean;
  running?: Tile[];
  playing?: Tile[];
  following?: Tile[];
  offers?: Offer[];
}

const day = (d: string, year = true) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

/** "12 to 14 Oct 2026", or the subtitle when there are no dates yet */
function when(t: Tile) {
  if (t.start_date && t.end_date && t.end_date !== t.start_date) return `${day(t.start_date, t.start_date.slice(0, 4) !== t.end_date.slice(0, 4))} to ${day(t.end_date)}`;
  if (t.start_date) return day(t.start_date);
  return t.subtitle ?? "";
}

/** My golf: sign in with your email, and every tournament you run, play in or follow is here, on any device. */
function AccountInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [g, setG] = useState<Golf | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/account", { cache: "no-store" })
        .then((r) => r.json())
        .then(setG)
        .catch(() => setG({ account: null })),
    [],
  );
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function call(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setErr(null);
    const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) setErr(j.error ?? "That didn't work. Try again.");
    return r?.ok ? j : null;
  }

  const next = sp.get("next");
  const lists: [string, Tile[], (t: Tile) => string][] = g?.account
    ? [
        ["Running", g.running ?? [], (t) => `/t/${t.slug}/admin`],
        ["Playing in", g.playing ?? [], (t) => `/t/${t.slug}`],
        ["Following", g.following ?? [], (t) => `/t/${t.slug}`],
      ]
    : [];
  const empty = lists.every(([, xs]) => !xs.length) && !g?.offers?.length && !g?.here?.length;

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
        {!g ? (
          <p>Loading…</p>
        ) : !g.account ? (
          <EmailSignIn
            title="Sign in"
            lead="Sign in with your email to see every tournament you run, play in or follow, on any phone or computer. No password: we email you a link and a code."
            next={next ?? undefined}
            onSignedIn={(n) => (n && n !== "/account" ? router.push(n) : load())}
          >
            <p className="small muted" style={{ margin: 0 }}>
              Playing in a tournament? Just tap the link your organiser sent you.
            </p>
          </EmailSignIn>
        ) : (
          <section className="stack golf">
            <h1>My golf</h1>
            <p className="lead">Signed in as {g.account.email}</p>
            {err && <p className="error">{err}</p>}

            {(g.offers ?? []).map((o) => (
              <div key={o.id} className="panel stack golf-offer" role="group" aria-label="Is this you?">
                <p>
                  {o.role === "organiser" ? (
                    <>
                      {o.added_by && o.added_by !== "Organiser" ? `${o.added_by} has added you` : "You've been added"} as an organiser of <strong>{o.tournament}</strong>.
                    </>
                  ) : (
                    <>
                      You&apos;ve been added to <strong>{o.tournament}</strong> as <strong>{o.player}</strong>.
                    </>
                  )}{" "}
                  Is this you?
                </p>
                <div className="row">
                  <button
                    className="btn big"
                    style={{ flex: 1 }}
                    disabled={!!busy}
                    onClick={async () => {
                      const j = await call({ action: "answer", offer: o.id, yes: true }, o.id);
                      if (j) setG((x) => (x ? { ...x, ...j } : x));
                    }}
                  >
                    Yes, that&apos;s me
                  </button>
                  <button
                    className="btn secondary big"
                    style={{ flex: 1 }}
                    disabled={!!busy}
                    onClick={async () => {
                      const j = await call({ action: "answer", offer: o.id, yes: false }, o.id);
                      if (j) setG((x) => (x ? { ...x, ...j } : x));
                    }}
                  >
                    No
                  </button>
                </div>
              </div>
            ))}

            {(g.here ?? []).map((h) => (
              <div key={h.tournament_id} className="panel stack golf-offer" role="group" aria-label="On this phone">
                <p>
                  On this phone you {h.role === "organiser" ? "run" : "play in"} <strong>{h.name}</strong>
                  {h.as ? ` as ${h.as}` : ""}. Add it to My golf, so you can get to it on any phone?
                </p>
                <button
                  className="btn big"
                  disabled={!!busy}
                  onClick={async () => {
                    const j = await call({ action: "claim", tournament: h.tournament_id }, h.tournament_id);
                    if (j) setG((x) => (x ? { ...x, ...j } : x));
                  }}
                >
                  Add to My golf
                </button>
              </div>
            ))}

            {g.owner && (
              <Link className="acct-t golf-site" href="/owner">
                <strong>The site</strong>
                <span>Every tournament, invites, films and the course library</span>
              </Link>
            )}

            {lists.map(([title, xs, to]) =>
              xs.length ? (
                <section key={title} className="golf-list" aria-label={title}>
                  <h2>{title}</h2>
                  <div className="acct-list">
                    {xs.map((t) => (
                      <Link key={t.id} className="acct-t" href={to(t)}>
                        <strong>{t.name}</strong>
                        <span>{[t.as ? `As ${t.as}` : null, when(t)].filter(Boolean).join(", ")}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null,
            )}

            {empty && <p>Nothing here yet. Tap the link you were sent for a tournament, or start your own.</p>}

            <div className="stack golf-acts">
              <Link className="btn secondary block big" href="/new">
                Start a new tournament
              </Link>
              <button
                className="btn secondary block"
                disabled={!!busy}
                onClick={async () => {
                  await call({ action: "signout" }, "out");
                  load();
                }}
              >
                Sign out
              </button>
            </div>
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
