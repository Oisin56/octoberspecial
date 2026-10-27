"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./Providers";
import { MARKETING_WORDING } from "@/lib/consent";

/**
 * A player's own asks, on their own phone. The bio: "Give the commentators something to work with", Complete player
 * bio or Later. Their email: after their first round, and when the film is ready ("Where should we send it?"), never
 * more than twice. Each is a card on the page they're on, never a pop-up over the scorecard, and one ask a visit.
 */

export interface PlayerMe {
  bio: Record<string, string | null>;
  bioDue: "first" | "again" | null;
  emailDue: "round1" | "film" | null;
  hasEmail: boolean;
  pending: string | null;
  private: boolean;
  solo: boolean;
}

export function usePlayerMe(enabled: boolean, again?: string) {
  const { api, session } = useT();
  const [me, setMe] = useState<PlayerMe | null>(null);
  const [loaded, setLoaded] = useState(false);
  const last = useRef(0);
  const load = useCallback(async () => {
    last.current = Date.now();
    const r = await api("/api/player", { action: "me" }).catch(() => null);
    if (r?.ok) setMe(r.j as unknown as PlayerMe);
    setLoaded(true);
  }, [api]);
  useEffect(() => {
    if (!enabled || !session?.playerId || session.role === "fan") return;
    // Moving between pages: looked at again at most once a minute
    if (again !== undefined && last.current && Date.now() - last.current < 60e3) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [enabled, session?.playerId, session?.role, load, again]);
  return { me, loaded, reload: load };
}

const visitKey = (slug: string) => `mgb-asked-${slug}`;
const askedThisVisit = (slug: string) => {
  try {
    return sessionStorage.getItem(visitKey(slug)) === "1";
  } catch {
    return false;
  }
};
const markVisit = (slug: string) => {
  try {
    sessionStorage.setItem(visitKey(slug), "1");
  } catch {
    /* private browsing */
  }
};

/** The bio ask, as a card: two big buttons */
export function BioCard({ again = false, onLater }: { again?: boolean; onLater: () => void }) {
  const { href, api } = useT();
  return (
    <section className="ask-card" aria-label="Your player bio">
      <h2>{again ? "Your player bio" : "Give the commentators something to work with"}</h2>
      <p>{again ? "A few quick questions for the round reports and the film. About 30 seconds." : "A few quick questions about your game. About 30 seconds."}</p>
      <div className="ask-btns">
        <Link className="btn big" href={href("/bio")}>
          Complete player bio
        </Link>
        <button
          className="btn secondary big"
          onClick={async () => {
            await api("/api/player", { action: again ? "seen" : "later", ask: "bioAgain" });
            onLater();
          }}
        >
          Later
        </button>
      </div>
    </section>
  );
}

/** "Add your email": the box, the marketing tick, then the code from the email */
export function EmailAsk({ kind, isPrivate, onDone, onNotNow }: { kind: "round1" | "film" | "page"; isPrivate?: boolean; onDone: () => void; onNotNow?: () => void }) {
  const { api, state } = useT();
  const [email, setEmail] = useState("");
  const [news, setNews] = useState(false);
  const [stage, setStage] = useState<"ask" | "code" | "done">("ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = state?.tournament;
  const n = state?.rounds.filter((r) => r.status === "complete").length ?? 1;
  const text =
    kind === "film"
      ? "Your film's ready. Where should we send it?"
      : kind === "round1"
        ? isPrivate
          ? "This tournament is private. Add your email so you can look back at it later."
          : `Round ${Math.max(1, n)} done. Add your email to get each round's report and sign in on any phone or laptop.`
        : "Add your email to get each round's report and sign in on any phone or laptop.";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await api("/api/player", { action: "emailStart", email, marketing: news });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setStage("code");
  }
  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "code", email, code }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) {
      setBusy(false);
      return setErr(j.error ?? "That code didn't work.");
    }
    const d = await api("/api/player", { action: "emailDone" });
    setBusy(false);
    if (!d.ok) return setErr(String(d.j.error ?? "That didn't work. Try again."));
    setStage("done");
    onDone();
  }

  if (stage === "done")
    return (
      <section className="ask-card" aria-label="Your email" role="status">
        <h2>Done</h2>
        <p>{kind === "film" ? `The film is on its way to ${email}.` : `Each round's report from ${t?.name ?? "the trip"} will come to ${email}.`}</p>
      </section>
    );
  if (stage === "code")
    return (
      <form className="ask-card" aria-label="Your email" onSubmit={check}>
        <h2>Check your email</h2>
        <p>
          We&apos;ve sent an email to <strong>{email}</strong>. Tap the button in it, or type the 6-digit code here.
        </p>
        <label className="field">
          <span className="lbl">The code from the email</span>
          <input className="si-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn big block" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Confirm"}
        </button>
        <button type="button" className="linkish" onClick={() => setStage("ask")}>
          Use a different email
        </button>
      </form>
    );
  return (
    <form className="ask-card" aria-label="Your email" onSubmit={send}>
      <h2>{kind === "film" ? "Your film's ready" : "Add your email"}</h2>
      <p>{text}</p>
      <label className="field">
        <span className="lbl">Your email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
      </label>
      <label className="ask-tick">
        <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} />
        <span>{MARKETING_WORDING}</span>
      </label>
      {err && <p className="error">{err}</p>}
      <div className="ask-btns">
        <button className="btn big" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : kind === "film" ? "Send it to me" : "Add my email"}
        </button>
        {onNotNow && (
          <button type="button" className="btn secondary big" onClick={onNotNow}>
            Not now
          </button>
        )}
      </div>
    </form>
  );
}

/** On every page of the tournament (not the scorecard, the camera or the film): the one ask due now, if any. */
export function PlayerAsks() {
  const { session, slug, demo, api, sample } = useT();
  const path = usePathname();
  const quiet = /\/(score|record|film|card|bio|admin|setup|in|login|players)(\/|$)/.test(path);
  const { me } = usePlayerMe(!demo && !sample && !quiet, path);
  const [gone, setGone] = useState(false);
  const [shownAsk, setShownAsk] = useState<string | null>(null);
  const [visitUsed, setVisitUsed] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisitUsed(askedThisVisit(slug)), 0);
    return () => clearTimeout(t);
  }, [slug]);

  const ask = !me || gone || quiet ? null : me.bioDue ? (`bio-${me.bioDue}` as const) : me.emailDue ? (`email-${me.emailDue}` as const) : null;
  // One ask a visit: once one has been shown, the next waits for another visit
  const allowed = !!ask && (!visitUsed || shownAsk === ask);
  useEffect(() => {
    if (!ask || !allowed || shownAsk === ask) return;
    markVisit(slug);
    if (ask === "bio-again") api("/api/player", { action: "seen", ask: "bioAgain" });
    if (ask === "email-round1" || ask === "email-film") api("/api/player", { action: "seen", ask: ask.slice(6) });
    const t = setTimeout(() => setShownAsk(ask), 0);
    return () => clearTimeout(t);
  }, [ask, allowed, shownAsk, slug, api]);

  if (!session?.playerId || session.role === "fan" || !ask || !allowed) return null;
  if (ask.startsWith("bio")) return <BioCard again={ask === "bio-again"} onLater={() => setGone(true)} />;
  return (
    <EmailAsk
      kind={ask === "email-film" ? "film" : "round1"}
      isPrivate={me?.private}
      onDone={() => {}}
      onNotNow={async () => {
        await api("/api/player", { action: "notNow" });
        setGone(true);
      }}
    />
  );
}

/** On the players page, for the player looking: their bio, Add your email (for good, whatever they said before), and
 *  deleting their details (by email from My golf; without one, here) */
export function MyPlayerTools() {
  const { session, href, demo, api, reloadSession, refresh } = useT();
  const { me, reload } = usePlayerMe(!demo);
  const [del, setDel] = useState<null | "choose" | "all" | "keep">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!session?.playerId || session.role === "fan" || !me) return null;
  return (
    <section className="my-tools" aria-label="You">
      <Link className="btn" href={href("/bio")}>
        Your player bio
      </Link>
      {!me.hasEmail && !me.solo && <EmailAsk kind="page" onDone={reload} />}
      {me.hasEmail ? (
        <p className="small muted">
          To delete your account, go to <Link href="/account">My golf</Link>.
        </p>
      ) : del === null ? (
        <button className="linkish small" onClick={() => setDel("choose")}>
          Delete my details
        </button>
      ) : del === "choose" ? (
        <div className="panel stack" role="group" aria-label="Delete my details">
          <p style={{ margin: 0 }}>Your bio and photo are deleted either way. Your name stays on the scorecards, with the results, reports and film.</p>
          <button className="btn big block" onClick={() => setDel("all")}>
            Delete my details and everything I posted
          </button>
          <button className="btn big block" onClick={() => setDel("keep")}>
            Delete my details, keep my posts
          </button>
          <button className="btn secondary block" onClick={() => setDel(null)}>
            Keep them
          </button>
        </div>
      ) : (
        <div className="panel stack" role="group" aria-label="Are you sure?">
          <p style={{ margin: 0 }}>
            <strong>This can&apos;t be undone.</strong> This phone is signed out afterwards.
          </p>
          {err && <p className="error">{err}</p>}
          <button
            className="btn big block danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await api("/api/player", { action: "deleteDetails", keepPosts: del === "keep", confirm: true });
              setBusy(false);
              if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
              await reloadSession();
              refresh();
            }}
          >
            Yes, delete them
          </button>
          <button className="btn secondary block" onClick={() => setDel(null)}>
            Keep them
          </button>
        </div>
      )}
    </section>
  );
}
