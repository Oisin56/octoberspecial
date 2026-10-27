"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { Loading, Problem, act, day, useView, when } from "@/components/console/kit";
import { ACTION_WORDS } from "@/lib/activity-words";

interface Person {
  email: string;
  names: string[];
  firstAt: string;
  lastAt: string | null;
  signedIn: boolean;
  tournaments: { role: string; at: string | null; how?: string | null; tournament: { id: string; slug: string; name: string } | null }[];
  consent: { at: string | null; wording: string | null; tournament: string | null; stoppedAt: string | null } | null;
  blocked: { at: string; reason: string | null } | null;
  emailFailures: { kind: string; error: string; at: string }[];
  activity: { at: string; actor: string; actor_role: string; action: string }[];
  requests: { kind: string; created_at: string; done_at: string | null }[];
}

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useConsole();
  const { data, err, reload } = useView<Person>("person", { id });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [fix, setFix] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const owner = user.role === "owner";

  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(String(body.action));
    setMsg(null);
    const r = await act({ ...body, email: data!.email });
    setBusy(null);
    if (!r.ok) return setMsg({ text: String(r.j.error ?? "That didn't work."), bad: true });
    setMsg({ text: done });
    reload();
  }

  return (
    <>
      <header className="con-head">
        <div>
          <p className="con-crumb">
            <Link href="/console/people">People</Link>
          </p>
          <h1>{data.names[0] ?? data.email}</h1>
          <p className="con-lead">
            {data.email}
            {data.names.length > 1 && `, also known as ${data.names.slice(1).join(", ")}`}
          </p>
        </div>
      </header>
      {msg && (
        <p className={msg.bad ? "error" : "con-ok"} role="status">
          {msg.text}
        </p>
      )}

      <dl className="con-facts">
        <div>
          <dt>First came</dt>
          <dd>{day(data.firstAt)}</dd>
        </div>
        <div>
          <dt>Last there</dt>
          <dd>{data.lastAt ? when(data.lastAt) : "Not known"}</dd>
        </div>
        <div>
          <dt>Signed in with their email</dt>
          <dd>{data.signedIn ? "Yes" : "Not yet"}</dd>
        </div>
        {data.blocked && (
          <div>
            <dt>Email</dt>
            <dd className="con-warn">The site stopped emailing this address on {day(data.blocked.at)}</dd>
          </div>
        )}
      </dl>

      <section className="con-panel" aria-labelledby="h-t">
        <h2 id="h-t">Tournaments</h2>
        {data.tournaments.length === 0 ? (
          <p className="con-calm">None.</p>
        ) : (
          <ul className="con-rows">
            {data.tournaments.map((t, i) => (
              <li key={i}>
                {t.tournament ? (
                  <Link href={`/console/tournaments/${t.tournament.id}`}>
                    <span>
                      <strong>{t.tournament.name}</strong>
                      <small>
                        {t.role}
                        {t.how ? `, ${t.how}` : ""}
                      </small>
                    </span>
                    <span className="con-age">{day(t.at)}</span>
                  </Link>
                ) : (
                  <span className="con-quiet">A deleted tournament ({t.role})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="con-panel" aria-labelledby="h-c">
        <h2 id="h-c">Consent record</h2>
        {!data.consent ? (
          <p>They haven&apos;t agreed to marketing emails.</p>
        ) : (
          <dl className="con-facts tight">
            {data.consent.at && (
              <>
                <div>
                  <dt>Ticked the marketing box</dt>
                  <dd>{new Date(data.consent.at).toLocaleString("en-IE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Dublin" })}</dd>
                </div>
                <div>
                  <dt>On</dt>
                  <dd>{data.consent.tournament ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>The exact words they saw</dt>
                  <dd>
                    <q>{data.consent.wording ?? "Not recorded"}</q>
                  </dd>
                </div>
              </>
            )}
            {data.consent.stoppedAt && (
              <div>
                <dt>Marketing stopped</dt>
                <dd>{day(data.consent.stoppedAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {data.requests.length > 0 && (
        <section className="con-panel">
          <h2>Their requests</h2>
          <ul className="con-rows plain">
            {data.requests.map((r, i) => (
              <li key={i}>
                <span>{r.kind === "copy" ? "A copy of their data" : "Delete their account"}</span>
                <span className="con-age">{r.done_at ? `Done ${day(r.done_at)}` : `Asked ${day(r.created_at)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="con-panel" aria-labelledby="h-a">
        <h2 id="h-a">Do something</h2>
        <div className="con-need-acts">
          {owner && (
            <button className="btn secondary" disabled={!!busy} onClick={() => run({ action: "person.copy" }, `A copy of their data is on its way to ${data.email}.`)}>
              Send them a copy of their data
            </button>
          )}
          {owner && (
            <button className="btn secondary" disabled={!!busy} onClick={() => setFix(data.email)}>
              Correct their email
            </button>
          )}
          {data.signedIn && (
            <button className="btn secondary" disabled={!!busy} onClick={() => run({ action: "person.signout" }, "Signed out on every phone. They sign in again with their email.")}>
              Sign them out on every phone
            </button>
          )}
          {data.consent?.at && !data.consent.stoppedAt && (
            <button className="btn secondary" disabled={!!busy} onClick={() => run({ action: "person.nomarketing" }, "No more marketing emails to them.")}>
              Stop marketing to them
            </button>
          )}
          {owner && data.blocked && (
            <button className="btn secondary" disabled={!!busy} onClick={() => run({ action: "person.unblock" }, "The site will email this address again.")}>
              Start emailing them again
            </button>
          )}
          {owner && (
            <button className="btn secondary con-danger" disabled={!!busy} onClick={() => setSure(true)}>
              Delete them
            </button>
          )}
        </div>
        {fix !== null && (
          <form
            className="con-form-row"
            onSubmit={(e) => {
              e.preventDefault();
              run({ action: "person.email", to: fix }, "Email corrected everywhere it's kept.");
              setFix(null);
            }}
          >
            <div className="field">
              <label htmlFor="fix-email">Their correct email</label>
              <input id="fix-email" type="email" value={fix} onChange={(e) => setFix(e.target.value)} autoFocus />
            </div>
            <button className="btn">Save</button>
            <button type="button" className="btn secondary" onClick={() => setFix(null)}>
              Cancel
            </button>
          </form>
        )}
        {sure && (
          <div className="con-confirm" role="group" aria-label="Delete them">
            <p>
              The two ways of deleting someone (removing their posts too, or keeping the posts and removing the account) arrive with stage 4. For now this records the request in Needs you, with the
              month the law allows.
            </p>
            <div className="con-need-acts">
              <button
                className="btn danger"
                disabled={!!busy}
                onClick={async () => {
                  await run({ action: "person.delete" }, "Recorded in Needs you.");
                  setSure(false);
                }}
              >
                Record the request
              </button>
              <button className="btn secondary" onClick={() => setSure(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {data.emailFailures.length > 0 && (
        <section className="con-panel">
          <h2>Emails that didn&apos;t go</h2>
          <ul className="con-rows plain">
            {data.emailFailures.map((f, i) => (
              <li key={i}>
                <span>
                  {f.kind}
                  <small>{f.error}</small>
                </span>
                <span className="con-age">{when(f.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="con-panel" aria-labelledby="h-r">
        <h2 id="h-r">Looked at and changed in the console</h2>
        <ul className="con-rows plain">
          {data.activity.map((a, i) => (
            <li key={i}>
              <span>
                {ACTION_WORDS[a.action] ?? a.action}
                <small>
                  {a.actor_role === "support" ? "Support" : a.actor_role === "owner" ? "Owner" : a.actor_role === "person" ? "Them" : "The site"}: {a.actor}
                </small>
              </span>
              <span className="con-age">{when(a.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
