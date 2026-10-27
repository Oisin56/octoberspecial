"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "./Providers";
import type { AdminData } from "./editors";

/** The organiser's side of finishing: the Finish tournament button, and afterwards opening scoring or the feed again. */

export interface FinishInfo {
  lastDay: string | null;
  autoDay: string | null;
  finishedBy: string | null;
  reopenUntil: string | null;
  filmRemoved: boolean;
  /** Within 30 days of finishing */
  canReopen?: boolean;
  /** Photos, videos and comments can still be posted */
  feedOpen?: boolean;
}

const dublinToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });

/** "Friday 13 June" */
export function longDay(d: string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d.length === 10 ? `${d}T12:00:00Z` : d);
  const part = (o: Intl.DateTimeFormatOptions) => x.toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
}

/** Can it be finished from the organiser's home: a group trip, not finished, from the day of its last round */
export function finishDue(data: AdminData & { finish?: FinishInfo }): boolean {
  const t = data.state.tournament;
  if (t.solo || t.finished_at || !data.state.rounds.length) return false;
  const last = data.finish?.lastDay;
  const allDone = data.state.rounds.every((r) => r.status === "complete");
  return allDone || (!!last && last <= dublinToday());
}

/** On the organiser's home (and its own page, #finish): finish it now, or what finishing did */
export function FinishCard({ data, onSaved, full = false }: { data: AdminData & { finish?: FinishInfo }; onSaved: () => void; full?: boolean }) {
  const { api, href, refresh } = useT();
  const t = data.state.tournament;
  const [step, setStep] = useState<"idle" | "ask">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (t.solo) return null;

  if (t.finished_at) {
    if (!full) return null;
    return (
      <section className="finish-card done" aria-label="Finished">
        <h2>Finished on {longDay(t.finished_at)}</h2>
        <p>Players can&apos;t change their scores now. You can still correct one from Scorecards. Photos, videos and comments stay open until {longDay(t.feed_until)}.</p>
        <Link className="btn" href={href("/")}>
          See the trip page
        </Link>
      </section>
    );
  }
  if (!full && !finishDue(data)) return null;

  const unscored = data.state.rounds.filter((r) => !data.state.entries.some((e) => e.round_id === r.id)).sort((a, b) => a.number - b.number);
  async function finish() {
    setBusy(true);
    setErr(null);
    const r = await api("/api/admin", { action: "finish" });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setStep("idle");
    onSaved();
    refresh();
  }

  return (
    <section className="finish-card" id="finish" aria-label="Finish the tournament">
      <h2>Finish the tournament</h2>
      {step === "idle" ? (
        <>
          <p>When everyone&apos;s done, finish it. Players&apos; scorecards lock, the home page becomes the trip page and the final report is written.</p>
          {data.finish?.autoDay && <p className="small">If you don&apos;t, it finishes by itself on {longDay(data.finish.autoDay)}.</p>}
          {!finishDue(data) && <p className="small">The button is here from the day of the last round.</p>}
          <button className="btn block" disabled={!finishDue(data)} onClick={() => setStep("ask")}>
            Finish tournament
          </button>
        </>
      ) : (
        <>
          <p className="finish-q">
            {unscored.length
              ? `Round ${unscored.map((r) => r.number).join(" and round ")} ${unscored.length === 1 ? "has" : "have"} no scores. Finish without ${unscored.length === 1 ? "it" : "them"}?`
              : `Finish ${t.name}? Players won't be able to change their scores.`}
          </p>
          <button className="btn block" disabled={busy} onClick={finish}>
            {busy ? "Finishing…" : unscored.length ? `Finish without ${unscored.length === 1 ? "it" : "them"}` : "Yes, finish it"}
          </button>
          <button className="btn secondary block" disabled={busy} onClick={() => setStep("idle")}>
            Not yet
          </button>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

/** In Settings, once it's finished: open scoring again (30 days), close the feed or open it again */
export function FinishSettings({ data, onSaved }: { data: AdminData & { finish?: FinishInfo }; onSaved: () => void }) {
  const { api, refresh } = useT();
  const t = data.state.tournament;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!t.finished_at) return null;
  const canReopen = !!data.finish?.canReopen;
  const feedOpen = !!data.finish?.feedOpen;
  async function run(action: string, body: Record<string, unknown>, done: string) {
    setBusy(action);
    setMsg(null);
    const r = await api("/api/admin", { action, ...body });
    setBusy(null);
    setMsg(r.ok ? done : String(r.j.error ?? "That didn't work"));
    if (r.ok) {
      onSaved();
      refresh();
    }
  }
  return (
    <>
      {!t.solo && (
        <section className="panel stack">
          <h2>Scoring</h2>
          <p className="small" style={{ margin: 0 }}>
            Finished on {longDay(t.finished_at)}. Players can&apos;t change their scores.
          </p>
          {canReopen ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                Open scoring again if a round needs finishing off. It finishes by itself 3 days later, or when you tap Finish tournament.
              </p>
              <button className="btn secondary" disabled={!!busy} onClick={() => run("reopen", {}, "Scoring is open again")}>
                Open scoring again
              </button>
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Scoring can only be opened again in the first 30 days after finishing.
            </p>
          )}
        </section>
      )}
      <section className="panel stack">
        <h2>Photos, videos and comments</h2>
        <p className="small" style={{ margin: 0 }}>
          {feedOpen ? `People can post until ${longDay(t.feed_until)}.` : "The feed is closed. Everything posted is still there to look back on."}
        </p>
        {feedOpen ? (
          <button className="btn secondary" disabled={!!busy} onClick={() => run("feed", { open: false }, "The feed is closed")}>
            Close it now
          </button>
        ) : (
          <button className="btn secondary" disabled={!!busy} onClick={() => run("feed", { open: true }, "The feed is open for another 30 days")}>
            Open it again for 30 days
          </button>
        )}
      </section>
      {msg && <p className="notice">{msg}</p>}
    </>
  );
}
