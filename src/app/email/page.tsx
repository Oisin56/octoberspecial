"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface Prefs {
  email: string;
  marketing: boolean;
  tripNews: boolean;
  offers: boolean;
  tips: boolean;
  organiser: boolean;
  stoppedReason: string | null;
  updatesStopped: boolean;
  tournaments: { id: string; name: string; slug: string; on: boolean; evening: boolean }[];
}

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/email/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again." };
  return { ok: !!r?.ok, j };
}

function Tick({ on, onChange, title, note, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; note: string; disabled?: boolean }) {
  return (
    <button type="button" className="cd-film-only ep-tick" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="box" aria-hidden="true">
        {on ? "✓" : ""}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
    </button>
  );
}

/** What we email you: opened from the link at the foot of any email (no sign-in), or from My golf. */
function EmailPrefs() {
  const k = useSearchParams().get("k") ?? "";
  const [p, setP] = useState<Prefs | null>(null);
  const [stops, setStops] = useState<{ scope: string; what: string } | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sureAll, setSureAll] = useState(false);

  const load = useCallback(async () => {
    const r = await post({ action: "load", k });
    if (!r.ok) return setErr(String(r.j.error ?? "That link didn't work."));
    setP(r.j.prefs);
    setStops(r.j.stops);
  }, [k]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function save(patch: Record<string, unknown>, msg = "Saved") {
    if (p && typeof patch.tripNews === "boolean") setP({ ...p, tripNews: patch.tripNews as boolean });
    if (p && typeof patch.offers === "boolean") setP({ ...p, offers: patch.offers as boolean });
    if (p && typeof patch.tips === "boolean") setP({ ...p, tips: patch.tips as boolean });
    setBusy(true);
    setErr(null);
    const r = await post({ action: "save", k, patch });
    setBusy(false);
    if (!r.ok) {
      setErr(String(r.j.error ?? "That didn't save. Try again."));
      return load();
    }
    setP(r.j.prefs);
    setSaved(msg);
    setTimeout(() => setSaved(null), 2500);
  }

  async function stop(action: "stop" | "stopAll") {
    setBusy(true);
    const r = await post({ action, k });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setP(r.j.prefs);
    setStopped(action === "stop" ? (stops?.what ?? "those emails") : "every email except what you need to sign in");
    setSureAll(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="mgs-head">
        <div className="mgs-wrap mgs-bar">
          <Link href="/" className="mgs-mark" aria-label={`${BRAND.name} home`}>
            <span>
              {BRAND.mark[0]}
              <b>{BRAND.mark[1]}</b>
              {BRAND.mark[2]}
            </span>
          </Link>
        </div>
      </header>
      <main className="acct">
        {!k ? (
          <section className="stack">
            <h1>What we email you</h1>
            <p className="lead">Open this page from the link at the bottom of any of our emails, or from My golf when you&apos;re signed in.</p>
            <Link className="btn block big" href="/account">
              Go to My golf
            </Link>
          </section>
        ) : !p ? (
          err ? (
            <section className="stack">
              <h1>What we email you</h1>
              <p className="error">{err}</p>
            </section>
          ) : (
            <p>Loading…</p>
          )
        ) : (
          <section className="stack ep">
            <h1>What we email you</h1>
            <p className="lead">For {p.email}</p>

            {stopped ? (
              <div className="panel stack ep-done" role="status">
                <p className="ep-big">Done. You won&apos;t get {stopped} any more.</p>
                <p style={{ margin: 0 }}>Changed your mind? Turn them back on below.</p>
              </div>
            ) : (
              stops && (
                <div className="panel stack ep-ask">
                  <p className="ep-big">Stop {stops.what}?</p>
                  <button className="btn big block" disabled={busy} onClick={() => stop("stop")}>
                    Stop them
                  </button>
                  <p className="small muted" style={{ margin: 0 }}>
                    You can turn them back on here at any time.
                  </p>
                </div>
              )
            )}

            {err && <p className="error">{err}</p>}
            <p className="ep-saved" role="status" aria-live="polite">
              {saved ?? ""}
            </p>

            <section className="stack ep-group" aria-labelledby="ep-news">
              <h2 id="ep-news">From MyGolfBroadcast</h2>
              {p.stoppedReason === "spam" && !p.marketing && <p className="small muted">You marked one of our emails as spam, so these stopped. Tick either one to start them again.</p>}
              <Tick on={p.tripNews} disabled={busy} onChange={(v) => save({ tripNews: v })} title="Trip news" note="A year ago today, and ideas for your next trip." />
              <Tick on={p.offers} disabled={busy} onChange={(v) => save({ offers: v })} title="News and offers" note="New things on the site, and the odd offer." />
              <p className="small muted" style={{ margin: 0 }}>
                One email a week at most, and none while you&apos;re on a trip.
              </p>
            </section>

            {p.organiser && (
              <section className="stack ep-group" aria-labelledby="ep-org">
                <h2 id="ep-org">Running a tournament</h2>
                <Tick on={p.tips} disabled={busy} onChange={(v) => save({ tips: v })} title="Tips for my tournament" note="Help while you set one up: sending the links, the days before the first tee." />
              </section>
            )}

            {p.tournaments.length > 0 && (
              <section className="stack ep-group" aria-labelledby="ep-t">
                <h2 id="ep-t">Tournaments you follow</h2>
                {p.tournaments.map((t) => {
                  const now = !t.on ? "off" : t.evening ? "evening" : "every";
                  const pick = (v: string) => {
                    // Shown at once; the page catches up when it's saved
                    setP({ ...p, tournaments: p.tournaments.map((x) => (x.id === t.id ? { ...x, on: v !== "off", evening: v === "evening" } : x)) });
                    save({ tournaments: [{ id: t.id, on: v !== "off", evening: v === "evening" }] });
                  };
                  return (
                    <fieldset key={t.id} className="ep-t">
                      <legend>{t.name}</legend>
                      {(
                        [
                          ["every", "Every update as it's published"],
                          ["evening", "One email each evening"],
                          ["off", "Off"],
                        ] as const
                      ).map(([v, label]) => (
                        <label key={v} className={`ep-choice${now === v ? " on" : ""}`}>
                          <input type="radio" name={`t-${t.id}`} value={v} checked={now === v} disabled={busy} onChange={() => pick(v)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </section>
            )}

            <section className="stack ep-group" aria-labelledby="ep-always">
              <h2 id="ep-always">Always sent</h2>
              <p style={{ margin: 0 }}>Sign-in codes, your player link, and anything you ask for (like a copy of your data). They&apos;re how you get in, so they can&apos;t be turned off.</p>
            </section>

            {sureAll ? (
              <div className="panel stack ep-ask" role="group" aria-label="Stop everything">
                <p className="ep-big" style={{ margin: 0 }}>
                  Stop everything except what you need to sign in?
                </p>
                <div className="golf-yes-no">
                  <button className="btn big" disabled={busy} onClick={() => stop("stopAll")}>
                    Yes, stop them
                  </button>
                  <button className="btn secondary big" onClick={() => setSureAll(false)}>
                    No
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn secondary block" disabled={busy} onClick={() => setSureAll(true)}>
                Stop everything except what I need to sign in
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function EmailPrefsPage() {
  return (
    <Suspense>
      <EmailPrefs />
    </Suspense>
  );
}
