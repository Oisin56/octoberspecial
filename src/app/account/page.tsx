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

interface RoundTile extends Tile {
  course: string | null;
  score: string;
  film: boolean;
  now: boolean;
}

interface PastTile extends Tile {
  was: "Organised" | "Played" | "Followed";
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
  console?: boolean;
  requests?: { kind: "copy" | "delete"; created_at: string }[];
  running?: Tile[];
  playing?: Tile[];
  following?: Tile[];
  rounds?: RoundTile[];
  past?: PastTile[];
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
  const [sure, setSure] = useState<null | "choose" | "all" | "keep">(null);
  const [gone, setGone] = useState(false);
  const [allRounds, setAllRounds] = useState(false);

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
  const empty = lists.every(([, xs]) => !xs.length) && !g?.rounds?.length && !g?.past?.length && !g?.offers?.length && !g?.here?.length;
  const rounds = g?.rounds ?? [];

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
        {gone ? (
          <section className="stack golf">
            <h1>Your account has been deleted</h1>
            <p className="lead">We&apos;ve sent a short email to say so. Thanks for playing.</p>
            <Link className="btn secondary block big" href="/">
              Back to the home page
            </Link>
          </section>
        ) : !g ? (
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

            {(g.owner || g.console) && (
              <Link className="acct-t golf-site" href="/console">
                <strong>The console</strong>
                <span>Everything on the site: what&apos;s live, what needs you, people and costs</span>
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

            {rounds.length > 0 && (
              <section className="golf-list" aria-label="My rounds">
                <h2>My rounds</h2>
                <div className="acct-list">
                  {(allRounds ? rounds : rounds.slice(0, 10)).map((t) => (
                    <Link key={t.id} className="acct-t golf-round" href={`/t/${t.slug}`}>
                      <strong>
                        {t.course ?? t.name}
                        {t.now && <em className="golf-tag now">Playing now</em>}
                        {t.film && <em className="golf-tag">Film</em>}
                      </strong>
                      <span>{[when(t), t.score].filter(Boolean).join(", ")}</span>
                    </Link>
                  ))}
                </div>
                {!allRounds && rounds.length > 10 && (
                  <button className="btn secondary block" onClick={() => setAllRounds(true)}>
                    Show all {rounds.length}
                  </button>
                )}
                <Link className="btn block big golf-record" href={`/new?again=${encodeURIComponent(rounds[0].slug)}`}>
                  Record a round
                </Link>
              </section>
            )}

            {(g.past ?? []).length > 0 && (
              <section className="golf-list" aria-label="Past trips">
                <h2>Past trips</h2>
                <div className="acct-list">
                  {(g.past ?? []).map((t) => (
                    <Link key={t.id} className="acct-t" href={`/t/${t.slug}`}>
                      <strong>
                        {t.name}
                        <em className="golf-tag">{t.was}</em>
                      </strong>
                      <span>{[t.as ? `As ${t.as}` : null, when(t)].filter(Boolean).join(", ")}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {empty && <p>Nothing here yet. Tap the link you were sent for a tournament, or start your own.</p>}

            <section className="golf-list golf-data" aria-labelledby="your-emails">
              <h2 id="your-emails">Emails</h2>
              <p style={{ margin: 0 }}>Choose what we email you: tournament updates, trip news, tips.</p>
              <button
                className="btn secondary block"
                disabled={!!busy}
                onClick={async () => {
                  setBusy("emails");
                  const r = await fetch("/api/email/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mine" }) }).catch(() => null);
                  const j = r ? await r.json().catch(() => ({})) : {};
                  setBusy(null);
                  if (r?.ok && j.k) router.push(`/email?k=${encodeURIComponent(j.k)}`);
                  else setErr(j.error ?? "That didn't work. Try again.");
                }}
              >
                Choose what we email you
              </button>
            </section>

            <section className="golf-list golf-data" aria-labelledby="your-data">
              <h2 id="your-data">Your data</h2>
              <p style={{ margin: 0 }}>Get a copy of everything we hold about you, or delete your account.</p>
              {(g.requests ?? []).map((r) => (
                <p key={r.kind} className="golf-asked">
                  {r.kind === "copy" ? "You've asked for a copy of your data." : "You've asked for your account to be deleted."} We&apos;ll email you when it&apos;s done.
                </p>
              ))}
              {!(g.requests ?? []).some((r) => r.kind === "copy") && (
                <button
                  className="btn secondary block"
                  disabled={!!busy}
                  onClick={async () => {
                    const j = await call({ action: "data", kind: "copy" }, "copy");
                    if (j) setG((x) => (x ? { ...x, requests: j.requests } : x));
                  }}
                >
                  Email me a copy of my data
                </button>
              )}
              {sure === null ? (
                <button className="btn secondary block" disabled={!!busy} onClick={() => setSure("choose")}>
                  Delete my account
                </button>
              ) : sure === "choose" ? (
                <div className="panel stack golf-offer" role="group" aria-label="Delete my account">
                  <h3 style={{ margin: 0 }}>Delete my account</h3>
                  <p style={{ margin: 0 }}>
                    Your account, email, bio and photo are deleted either way. Scores, results, reports and films stay, as the privacy policy says.
                  </p>
                  <button className="btn big block" onClick={() => setSure("all")}>
                    Delete my account and everything I posted
                  </button>
                  <button className="btn big block" onClick={() => setSure("keep")}>
                    Delete my account, keep my posts
                  </button>
                  <button className="btn secondary block" onClick={() => setSure(null)}>
                    Keep my account
                  </button>
                </div>
              ) : (
                <div className="panel stack golf-offer" role="group" aria-label="Are you sure?">
                  <h3 style={{ margin: 0 }}>This can&apos;t be undone</h3>
                  <p style={{ margin: 0 }}>
                    {sure === "all"
                      ? "Your account goes, and every comment, photo and video you posted. A clip already in a film stays in the film."
                      : "Your account goes. Your comments, photos and videos stay up under your name."}
                  </p>
                  <div className="golf-yes-no">
                    <button
                      className="btn big danger"
                      disabled={!!busy}
                      onClick={async () => {
                        const j = await call({ action: "delete", keepPosts: sure === "keep", confirm: true }, "delete");
                        if (j) {
                          setSure(null);
                          setGone(true);
                        }
                      }}
                    >
                      Yes, delete my account
                    </button>
                    <button className="btn secondary big" disabled={!!busy} onClick={() => setSure(null)}>
                      Keep my account
                    </button>
                  </div>
                </div>
              )}
            </section>

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
