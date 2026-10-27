"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loading, PageHead, Problem, day } from "@/components/console/kit";
import { EmailTabs, eact, statsLine, useEmailView, type Stats, type Words } from "@/components/console/email";

type From = "setup" | "round1" | "lastRound" | "idle";
interface Step {
  id: string;
  from: From;
  days: number;
  on: boolean;
  when: string;
  builtIn: boolean;
  key: string;
  words: Words & { version: number };
  stats: Stats;
  condition?: string | null;
}
interface One {
  key: string;
  name: string;
  about: string;
  enabled: boolean;
  froms: From[];
  stream: string;
  updated_at: string | null;
  updated_by: string | null;
  steps: Step[];
  role: "owner" | "support";
}

const FROM_WORDS: Record<From, string> = { setup: "days after setup", round1: "days before round 1", lastRound: "days after the last round", idle: "days after their last tournament" };

export default function SeriesOne({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const { data, err, reload } = useEmailView<One>("seriesOne", { key });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [add, setAdd] = useState<{ from: From | ""; days: string }>({ from: "", days: "7" });

  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    const r = await eact<{ step?: string }>(body);
    setBusy(false);
    setMsg(r.ok ? { text: ok } : { text: String(r.j.error ?? "That didn't work"), bad: true });
    if (r.ok) reload();
    return r;
  };
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  const owner = data.role === "owner";
  return (
    <>
      <p className="con-crumb">
        <Link href="/console/email/series">Series</Link>
      </p>
      <PageHead title={data.name} lead={data.about} />
      <EmailTabs />

      <section className="con-panel" aria-labelledby="h-switch">
        <div className="con-panel-head">
          <h2 id="h-switch">{data.enabled ? "This series is on" : "This series is off"}</h2>
          <span className={`em-state${data.enabled ? " on" : ""}`}>{data.enabled ? "On" : "Off"}</span>
        </div>
        <p className="small" style={{ marginTop: 0 }}>
          {data.enabled
            ? "Its steps go at 10am Irish time on their day (the first welcome straight after setup). Switching it off stops anything not yet sent."
            : "Nothing goes until you switch it on. Read each step first: open it to see the email and change the words."}
          {data.updated_at && ` Last changed ${day(data.updated_at)} by ${data.updated_by}.`}
        </p>
        {owner &&
          (data.enabled ? (
            <button className="btn secondary" disabled={busy} onClick={() => run({ action: "series.switch", key, on: false }, "Switched off. Nothing more goes from it.")}>
              Switch it off
            </button>
          ) : sure ? (
            <div className="con-confirm">
              <p>Switch it on? From the next 10am run, each step goes to everyone it&apos;s for, once. People who are partway through when it&apos;s switched on don&apos;t get half a run.</p>
              <div className="em-acts" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    await run({ action: "series.switch", key, on: true }, "Switched on.");
                    setSure(false);
                  }}
                >
                  Yes, switch it on
                </button>
                <button className="btn secondary" onClick={() => setSure(false)}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" disabled={busy} onClick={() => setSure(true)}>
              Switch it on
            </button>
          ))}
        {msg && (
          <p className={msg.bad ? "error" : "con-ok"} role="status">
            {msg.text}
          </p>
        )}
      </section>

      <section className="con-panel" aria-labelledby="h-steps">
        <h2 id="h-steps">The steps</h2>
        <ul className="em-steps">
          {data.steps.map((s) => (
            <StepCard key={`${s.id}:${s.from}:${s.days}:${s.on}`} s={s} froms={data.froms} owner={owner} busy={busy} run={run} seriesKey={key} />
          ))}
        </ul>
        {owner && data.steps.length < 8 && (
          <form
            className="em-timing"
            style={{ marginTop: 16 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run({ action: "series.add", key, from: add.from || data.froms[0], days: Number(add.days) }, "Added, switched off. Write its words next.");
              if (r.ok && r.j.step) router.push(`/console/email/edit?key=${encodeURIComponent(`series:${key}:${r.j.step}`)}`);
            }}
          >
            <div className="field">
              <label htmlFor="add-days">Add a step</label>
              <input id="add-days" type="number" min={0} max={730} value={add.days} onChange={(e) => setAdd({ ...add, days: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="add-from" className="sr-only">
                When
              </label>
              <select id="add-from" value={add.from || data.froms[0]} onChange={(e) => setAdd({ ...add, from: e.target.value as From })}>
                {data.froms.map((f) => (
                  <option key={f} value={f}>
                    {FROM_WORDS[f]}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn secondary" disabled={busy}>
              Add it
            </button>
          </form>
        )}
      </section>
    </>
  );
}

function StepCard({ s, froms, owner, busy, run, seriesKey }: { s: Step; froms: From[]; owner: boolean; busy: boolean; run: (b: Record<string, unknown>, ok: string) => Promise<unknown>; seriesKey: string }) {
  const [days, setDays] = useState(String(s.days));
  const [from, setFrom] = useState<From>(s.from);
  const changed = Number(days) !== s.days || from !== s.from;
  return (
    <li className="em-step">
      <div className="em-step-head">
        <strong>{s.when}</strong>
        <span className={`em-state${s.on ? " on" : ""}`}>{s.on ? "On" : "Switched off"}</span>
      </div>
      <p style={{ margin: 0 }}>
        {s.words.subject ? (
          <>
            Subject: <strong>{s.words.subject}</strong>
          </>
        ) : (
          <span className="con-warn">No words yet</span>
        )}
        {s.condition === "noLinks" && <span className="small con-quiet"> Only if no player links have gone.</span>}
      </p>
      <p className="em-figs">{statsLine(s.stats)}</p>
      <div className="em-acts">
        <Link className="btn secondary" href={`/console/email/edit?key=${encodeURIComponent(s.key)}`}>
          {owner ? "Read and change the words" : "Read the words"}
        </Link>
        {owner && (
          <button className="btn secondary" disabled={busy} onClick={() => run({ action: "series.step", key: seriesKey, step: s.id, on: !s.on }, s.on ? "That step is switched off." : "That step is switched on.")}>
            {s.on ? "Switch this step off" : "Switch this step on"}
          </button>
        )}
        {owner && !s.builtIn && (
          <button className="btn secondary con-danger" disabled={busy} onClick={() => run({ action: "series.remove", key: seriesKey, step: s.id }, "Removed.")}>
            Remove it
          </button>
        )}
      </div>
      {owner && (
        <div className="em-timing">
          <div className="field">
            <label htmlFor={`d-${s.id}`}>When it goes</label>
            <input id={`d-${s.id}`} type="number" min={0} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`f-${s.id}`} className="sr-only">
              Counted from
            </label>
            <select id={`f-${s.id}`} value={from} onChange={(e) => setFrom(e.target.value as From)}>
              {froms.map((f) => (
                <option key={f} value={f}>
                  {FROM_WORDS[f]}
                </option>
              ))}
            </select>
          </div>
          {changed && (
            <button className="btn secondary" disabled={busy} onClick={() => run({ action: "series.step", key: seriesKey, step: s.id, days: Number(days), from }, "Timing saved.")}>
              Save the timing
            </button>
          )}
        </div>
      )}
    </li>
  );
}
