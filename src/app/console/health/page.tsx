"use client";

import { useState } from "react";
import Link from "next/link";
import { Light, Loading, PageHead, Problem, n, useView, when } from "@/components/console/kit";
import { HealthLine, eact, useEmailView, type EmailHealth } from "@/components/console/email";
import { useConsole } from "@/components/console/Shell";

interface Health {
  lights: { id: string; name: string; light: "green" | "amber" | "red" | "idle"; lastOk: string | null; lastFail: string | null; failsToday: number; lastError: string | null }[];
  emails: { sent: number; failed: number; byKind: { kind: string; n: number }[] };
  signins: { codes: number; wrong: number; blocked: number; tooMany: number };
  errors: { key: string; place: string; message: string; count: number; first_at: string; last_at: string; tournaments: string[] }[];
  room: { db: number; files: number | null; fileBytes: number | null; dbLimit: number; fileLimit: number };
  cron: { at?: string; did?: string[] };
  consoleEmail: string | null;
}

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

export default function HealthPage() {
  const { data, err } = useView<Health>("health");
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  const room = (used: number | null, limit: number, label: string) => {
    if (used == null) return <p className="con-quiet">{label}: not measured here.</p>;
    const pct = (used / limit) * 100;
    return (
      <div className="con-room">
        <span>
          {label}: {gb(used)} of {gb(limit)}
        </span>
        <span className={`con-meter${pct >= 80 ? " near" : ""}`}>
          <span style={{ width: `${Math.min(100, pct)}%` }} />
          <em>{Math.round(pct)}%</em>
        </span>
      </div>
    );
  };
  return (
    <>
      <PageHead title="Health" lead="What's working, set by each service's own recent calls. Red ones email you once, straight away." />

      <section className="con-panel" aria-labelledby="h-svc">
        <h2 id="h-svc">The services</h2>
        <ul className="con-services">
          {data.lights.map((l) => (
            <li key={l.id}>
              <span className="con-svc-name">{l.name}</span>
              <Light light={l.light} />
              <span className="con-svc-when">
                {l.lastOk ? `Last worked ${when(l.lastOk)}` : l.light === "idle" ? "No calls yet" : "Hasn't worked yet"}
                {l.failsToday > 0 && `, ${n(l.failsToday)} failed today`}
              </span>
              {l.light !== "green" && l.light !== "idle" && l.lastError && <span className="con-svc-err">{l.lastError}</span>}
            </li>
          ))}
        </ul>
      </section>

      <Sending />

      <div className="con-two">
        <section className="con-panel" aria-labelledby="h-mail">
          <h2 id="h-mail">Emails today</h2>
          <p className="con-big-line">
            <strong>{n(data.emails.sent)}</strong> sent, <strong className={data.emails.failed ? "con-warn" : undefined}>{n(data.emails.failed)}</strong> failed
          </p>
          {data.emails.byKind.length > 0 && (
            <ul className="con-rows plain">
              {data.emails.byKind.map((k) => (
                <li key={k.kind}>
                  <span>{k.kind.charAt(0).toUpperCase() + k.kind.slice(1)}</span>
                  <span className="con-age">{n(k.n)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="small con-quiet">
            The console&apos;s own emails go to {data.consoleEmail ?? "nobody yet (set one in Settings)"}. Bounces and stopped addresses are in <Link href="/console/email/stopped">Email</Link>.
          </p>
        </section>
        <section className="con-panel" aria-labelledby="h-sign">
          <h2 id="h-sign">Sign-ins today</h2>
          <ul className="con-rows plain">
            <li>
              <span>Codes sent</span>
              <span className="con-age">{n(data.signins.codes)}</span>
            </li>
            <li>
              <span>Wrong codes typed</span>
              <span className="con-age">{n(data.signins.wrong)}</span>
            </li>
            <li>
              <span>Codes used up (too many wrong tries)</span>
              <span className={`con-age${data.signins.blocked ? " con-warn" : ""}`}>{n(data.signins.blocked)}</span>
            </li>
            <li>
              <span>Addresses held back (too many emails asked for)</span>
              <span className={`con-age${data.signins.tooMany ? " con-warn" : ""}`}>{n(data.signins.tooMany)}</span>
            </li>
          </ul>
          <p className="small con-quiet">A sudden rise in wrong codes or held-back addresses usually means someone is trying their luck.</p>
        </section>
      </div>

      <section className="con-panel" aria-labelledby="h-err">
        <h2 id="h-err">Errors</h2>
        {data.errors.length === 0 ? (
          <p className="con-calm">No errors recorded.</p>
        ) : (
          <ul className="con-rows plain con-errors">
            {data.errors.map((e) => (
              <li key={e.key}>
                <span>
                  {e.message}
                  <small>
                    {e.place}
                    {e.tournaments.length > 0 && `, on ${e.tournaments.length} tournament${e.tournaments.length === 1 ? "" : "s"}`}
                  </small>
                </span>
                <span className="con-age">
                  {n(e.count)} time{e.count === 1 ? "" : "s"}
                  <small>
                    first {when(e.first_at)}, last {when(e.last_at)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="con-two">
        <section className="con-panel" aria-labelledby="h-jobs">
          <h2 id="h-jobs">The daily jobs</h2>
          {data.cron.at ? (
            <>
              <p>Last ran {when(data.cron.at)}.</p>
              <ul className="con-rows plain">
                {(data.cron.did ?? []).map((d) => (
                  <li key={d}>
                    <span>{d.charAt(0).toUpperCase() + d.slice(1)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="con-warn">They haven&apos;t run yet. They need CRON_SECRET set in Vercel.</p>
          )}
        </section>
        <section className="con-panel" aria-labelledby="h-room">
          <h2 id="h-room">Room</h2>
          {room(data.room.db, data.room.dbLimit, "Database")}
          {room(data.room.fileBytes, data.room.fileLimit, `Files${data.room.files != null ? ` (${n(data.room.files)})` : ""}`)}
          <p className="small con-quiet">Against what the hosting plans include. A warning comes at 80%.</p>
        </section>
      </div>
    </>
  );
}

/** How email goes out: Postmark (set up or not), or the old mailbox; this month's bounces and spam complaints. */
function Sending() {
  const { user } = useConsole();
  const { data, reload } = useEmailView<{ health: EmailHealth }>("settings");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const h = data.health;
  const runs = (h.runs ?? {}) as Record<string, string>;
  const words: Record<string, string> = {
    postmark: `Through Postmark${h.postmark?.server ? ` (${h.postmark.server})` : ""}, each kind of email on its own stream.`,
    "postmark-not-set-up": "Postmark's key is in, but it isn't set up yet. Set it up to make the streams and hear about bounces.",
    mailbox: "Through the old mailbox, until Postmark's key (POSTMARK_TOKEN) is added in Vercel.",
    none: "Nothing is set up to send email.",
  };
  return (
    <section className="con-panel" aria-labelledby="h-send">
      <h2 id="h-send">Sending email</h2>
      <p>{words[h.sending] ?? h.sending}</p>
      {h.postmark && !h.postmark.customUnsub && <p className="small con-quiet">Postmark handles the one-tap unsubscribe on news and offers for now (until they approve our own). The site still hears about every one and stops them.</p>}
      <HealthLine h={h} />
      <p className="small con-quiet" style={{ marginTop: 0 }}>
        {runs.morningAt ? `The 10am run last went ${when(runs.morningAt)}. ` : "The 10am run hasn't gone yet. "}
        {runs.eveningAt ? `The 8pm run last went ${when(runs.eveningAt)}.` : "The 8pm run hasn't gone yet."} How Gmail rates the site is in Gmail&apos;s Postmaster Tools (postmaster.google.com), once the domain is added there.
      </p>
      {user.role === "owner" && (h.sending === "postmark-not-set-up" || h.sending === "postmark") && (
        <button
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await eact({ action: "setup.postmark" });
            setBusy(false);
            setMsg(r.ok ? { text: "Postmark is set up: three streams, and bounces and complaints come back to the site." } : { text: String(r.j.error ?? "That didn't work"), bad: true });
            if (r.ok) reload();
          }}
        >
          {h.sending === "postmark" ? "Check the Postmark set-up again" : "Set up Postmark"}
        </button>
      )}
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
    </section>
  );
}
