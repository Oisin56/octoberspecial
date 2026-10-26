"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConsole } from "@/components/console/Shell";
import { Loading, Problem, Status, Table, act, day, dollars, n, personKey, useFilters, useView, when, type Col } from "@/components/console/kit";
import { ACTION_WORDS } from "@/lib/activity-words";

interface Person {
  kind: string;
  name: string | null;
  email: string | null;
  joined: string | null;
  lastSeen: string | null;
  how?: string | null;
}
interface Detail {
  tournament: { id: string; slug: string; name: string; privacy: string; created_at: string; ai_on: boolean; video_enabled: boolean; broadcast_cap_cents: number; ai_cap_cents: number; paused: boolean };
  stats: { status: string; first_day: string | null; last_day: string | null; players: number; signed_in: number; followers: number; posts: number; comments: number; clips: number; films: number; cost_cents: number; organiser: string | null } | null;
  rounds: { number: number; course_name: string; play_date: string | null; status: string; format: string }[];
  people: Person[];
  timeline: { at: string; what: string; by: string | null; console: boolean; role?: string }[];
  money: { all: { service: string; cents: number; calls: number; fails: number }[]; month: { service: string; cents: number; calls: number }[]; filmsPerTournament: number | null } | null;
  problems: { errors: { key: string; place: string; message: string; count: number; last_at: string }[]; films: { id: string; error: string | null; updated_at: string }[]; emails: { email: string; kind: string; error: string; at: string }[] };
}

const TABS = [
  ["summary", "Summary"],
  ["people", "People"],
  ["activity", "Activity"],
  ["money", "Money"],
  ["problems", "Problems"],
] as const;
const SERVICE: Record<string, string> = { writing: "Writing", voices: "Voices", films: "Films and clips", video: "Video reading", courses: "Course data", email: "Email" };

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useConsole();
  const { values, set } = useFilters(["tab"]);
  const { data, err, reload } = useView<Detail>("tournament", { id });
  const tabs = TABS.filter(([k]) => k !== "money" || user.role === "owner");
  const tab = tabs.some(([k]) => k === values.tab) ? values.tab : "summary";
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState("");

  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  const t = data.tournament;
  const s = data.stats;

  async function run(body: Record<string, unknown>, done: string, path = "/api/console") {
    setBusy(String(body.action));
    setMsg(null);
    const r = await act({ ...body, id: t.id }, path);
    setBusy(null);
    if (!r.ok) {
      setMsg({ text: String(r.j.error ?? "That didn't work."), bad: true });
      return null;
    }
    setMsg({ text: done });
    return r.j;
  }

  async function exportCopy() {
    const j = await run({ action: "export" }, "Downloaded.", "/api/owner");
    if (!j) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
    a.download = `${t.slug}-copy-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  const peopleCols: Col<Person>[] = [
    { key: "name", label: "Name", render: (p) => p.name ?? <span className="con-quiet">No name</span> },
    { key: "kind", label: "Role", render: (p) => p.kind },
    { key: "email", label: "Email", render: (p) => (p.email ? <Link href={`/console/people/${personKey(p.email)}`}>{p.email}</Link> : <span className="con-quiet">None given</span>) },
    { key: "how", label: "How they know the group", render: (p) => p.how ?? "" },
    { key: "joined", label: "Joined", render: (p) => day(p.joined) },
    { key: "seen", label: "Last there", render: (p) => when(p.lastSeen) },
  ];

  return (
    <>
      <header className="con-head">
        <div>
          <p className="con-crumb">
            <Link href="/console/tournaments">Tournaments</Link>
          </p>
          <h1>{t.name}</h1>
          <p className="con-lead">
            {s && <Status s={s.status} />} {t.privacy === "private" ? "Private" : "Friends and family"}, set up {day(t.created_at)}
            {t.paused && <span className="con-tag warn">AI and films paused</span>}
          </p>
        </div>
        <div className="con-head-acts">
          <a className="btn secondary" href={`/t/${t.slug}`} target="_blank" rel="noreferrer">
            See the site
          </a>
          <button
            className="btn"
            disabled={!!busy}
            onClick={async () => {
              const j = await run({ action: "tournament.open" }, "Opening…");
              if (j) router.push(`/t/${j.slug}/admin`);
            }}
          >
            Open as organiser
          </button>
        </div>
      </header>

      <nav className="con-subtabs" aria-label="This tournament">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => set({ tab: k === "summary" ? null : k })}>
            {l}
            {k === "problems" && data.problems.errors.length + data.problems.films.length + data.problems.emails.length > 0 && <span className="con-badge">{data.problems.errors.length + data.problems.films.length + data.problems.emails.length}</span>}
          </button>
        ))}
      </nav>
      {msg && (
        <p className={msg.bad ? "error" : "con-ok"} role="status">
          {msg.text}
        </p>
      )}

      {tab === "summary" && (
        <>
          <dl className="con-facts">
            <div>
              <dt>Dates</dt>
              <dd>{s?.first_day ? (s.last_day && s.last_day !== s.first_day ? `${day(s.first_day, false)} to ${day(s.last_day)}` : day(s.first_day)) : "None yet"}</dd>
            </div>
            <div>
              <dt>Organiser</dt>
              <dd>{s?.organiser ? <Link href={`/console/people/${personKey(s.organiser)}`}>{s.organiser}</Link> : "None with an email"}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>
                {data.rounds.length
                  ? data.rounds.map((r) => (
                      <span key={r.number} className="con-round">
                        Round {r.number}: {r.course_name}
                        {r.play_date ? `, ${day(r.play_date, false)}` : ""}
                      </span>
                    ))
                  : "None yet"}
              </dd>
            </div>
          </dl>
          <section className="con-figs small" aria-label="Its figures">
            {[
              ["Players", s?.players],
              ["Signed in with email", s?.signed_in],
              ["Followers", s?.followers],
              ["Posts", s?.posts],
              ["Comments", s?.comments],
              ["Clips", s?.clips],
              ["Films", s?.films],
            ].map(([l, v]) => (
              <div key={String(l)} className="con-fig">
                <span className="con-fig-label">{l}</span>
                <span className="con-fig-value">{n(Number(v ?? 0))}</span>
              </div>
            ))}
          </section>
          <section className="con-panel" aria-labelledby="h-acts">
            <h2 id="h-acts">Help with it</h2>
            <div className="con-need-acts">
              <button className="btn secondary" disabled={!!busy} onClick={() => run({ action: "tournament.link" }, "A new sign-in link is on its way to the organisers.")}>
                Send the organiser a new sign-in link
              </button>
              <button
                className="btn secondary"
                disabled={!!busy}
                onClick={async () => {
                  if (await run({ action: t.paused ? "tournament.resume" : "tournament.pause" }, t.paused ? "AI writing and films are back on." : "AI writing and films are paused. Scoring and the feed carry on.")) reload();
                }}
              >
                {t.paused ? "Restart AI writing and films" : "Pause AI writing and films"}
              </button>
              {user.role === "owner" && (
                <>
                  <button className="btn secondary" disabled={!!busy} onClick={exportCopy}>
                    Export it
                  </button>
                  <button className="btn secondary con-danger" disabled={!!busy} onClick={() => (setDel(true), setTyped(""))}>
                    Delete it
                  </button>
                </>
              )}
            </div>
          </section>
        </>
      )}

      {tab === "people" && <Table caption="Its people" cols={peopleCols} rows={data.people} rowKey={(p) => `${p.kind}${p.email ?? ""}${p.name ?? ""}${p.joined ?? ""}`} empty="Nobody yet." />}

      {tab === "activity" && (
        <ol className="con-timeline">
          {data.timeline.map((e, i) => (
            <li key={i} className={e.console ? "by-console" : undefined}>
              <time dateTime={e.at}>{day(e.at)}</time>
              <span>
                {e.console ? (ACTION_WORDS[e.what] ?? e.what) : e.what}
                {e.by && <small>{e.console ? `${e.role === "support" ? "Support" : e.role === "owner" ? "Owner" : ""}: ${e.by}` : e.by}</small>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {tab === "money" && data.money && <TournamentMoney t={t} money={data.money} onSaved={reload} />}

      {tab === "problems" && (
        <div className="con-stack">
          {data.problems.films.length + data.problems.errors.length + data.problems.emails.length === 0 && <p className="con-calm">No problems.</p>}
          {data.problems.films.length > 0 && (
            <section className="con-panel">
              <h2>Films that failed</h2>
              <ul className="con-rows plain">
                {data.problems.films.map((f) => (
                  <li key={f.id}>
                    <span>{f.error ?? "No reason given"}</span>
                    <span className="con-age">{when(f.updated_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.problems.emails.length > 0 && (
            <section className="con-panel">
              <h2>Emails that didn&apos;t go</h2>
              <ul className="con-rows plain">
                {data.problems.emails.map((e, i) => (
                  <li key={i}>
                    <span>
                      {e.email}, {e.kind}
                      <small>{e.error}</small>
                    </span>
                    <span className="con-age">{when(e.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.problems.errors.length > 0 && (
            <section className="con-panel">
              <h2>Errors on its pages</h2>
              <ul className="con-rows plain">
                {data.problems.errors.map((e) => (
                  <li key={e.key}>
                    <span>
                      {e.message}
                      <small>{e.place}</small>
                    </span>
                    <span className="con-age">
                      {n(e.count)} times, last {when(e.last_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {del && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="del-h" onClick={(e) => e.target === e.currentTarget && setDel(false)}>
          <div className="sheet-card stack">
            <h2 id="del-h">Delete {t.name}?</h2>
            <p>
              This deletes the tournament and everything in it: every player, round, score, post, photo, clip, film and report. Everyone&apos;s links stop working. <strong>It can&apos;t be undone.</strong>
            </p>
            <p className="small">
              Want to keep a record?{" "}
              <button type="button" className="linklike" onClick={exportCopy}>
                Export it first
              </button>
              .
            </p>
            <div className="field">
              <label htmlFor="del-name">Type its name to confirm: {t.name}</label>
              <input id="del-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
            {msg?.bad && <p className="error">{msg.text}</p>}
            <button
              className="btn danger block big"
              disabled={typed.trim().toLowerCase() !== t.name.trim().toLowerCase() || !!busy}
              onClick={async () => {
                if (await run({ action: "delete", name: typed }, "Deleted.", "/api/owner")) router.push("/console/tournaments");
              }}
            >
              {busy ? "Deleting…" : "Delete it for good"}
            </button>
            <button className="btn secondary block" onClick={() => setDel(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function TournamentMoney({ t, money, onSaved }: { t: Detail["tournament"]; money: NonNullable<Detail["money"]>; onSaved: () => void }) {
  const [ai, setAi] = useState(String(t.ai_cap_cents / 100));
  const [clips, setClips] = useState(String(t.broadcast_cap_cents / 100));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const total = money.all.reduce((s, r) => s + Number(r.cents), 0);
  const month = (svc: string) => Number(money.month.find((m) => m.service === svc)?.cents ?? 0);
  const rows = money.all.filter((r) => r.service !== "email");
  return (
    <div className="con-stack">
      <section className="con-panel">
        <h2>What it has cost: {dollars(total)}</h2>
        {rows.length === 0 ? (
          <p className="con-calm">Nothing spent on it yet.</p>
        ) : (
          <div className="con-table-wrap">
            <table className="con-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col" className="num">
                    This month
                  </th>
                  <th scope="col" className="num">
                    In all
                  </th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.service}>
                    <th scope="row">{SERVICE[r.service] ?? r.service}</th>
                    <td className="num" data-label="This month">{dollars(month(r.service))}</td>
                    <td className="num" data-label="In all">{dollars(r.cents)}</td>
                    <td className="num" data-label="Calls">{n(r.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small con-quiet">Estimates from each supplier&apos;s prices, in US dollars as they bill.</p>
      </section>
      <form
        className="con-panel con-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          const r = await act({ action: "tournament.limits", id: t.id, aiDollars: Number(ai), clipDollars: Number(clips) });
          setMsg(r.ok ? { text: "Saved." } : { text: String(r.j.error ?? "Didn't save"), bad: true });
          if (r.ok) onSaved();
        }}
      >
        <h2>Its limits</h2>
        <p className="small">
          Each a month. At a limit, that stops for this tournament (the organiser is told it&apos;s paused for now); scoring and the feed never stop.
          {money.filmsPerTournament != null && ` Films: ${money.filmsPerTournament} a tournament, set for the whole site in Settings.`}
        </p>
        <div className="con-form-row">
          <div className="field">
            <label htmlFor="cap-ai">AI writing ($ a month)</label>
            <input id="cap-ai" inputMode="decimal" value={ai} onChange={(e) => setAi(e.target.value)} />
            <small>This month: {dollars(month("writing"))}</small>
          </div>
          <div className="field">
            <label htmlFor="cap-clips">Broadcast clips ($ a month)</label>
            <input id="cap-clips" inputMode="decimal" value={clips} onChange={(e) => setClips(e.target.value)} />
          </div>
        </div>
        <button className="btn">Save the limits</button>
        {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
      </form>
    </div>
  );
}
