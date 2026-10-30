"use client";

import { useState } from "react";
import { useConsole } from "@/components/console/Shell";
import { Loading, PageHead, Problem, act, day, n, when, useView } from "@/components/console/kit";

type Kind = "report" | "bulletin" | "tournament" | "film";
interface Side {
  title: string;
  body: string;
}
interface Found {
  mistakes: number;
  problems: { text: string; why: string }[];
  fixed: number | null;
  dropped: { text: string; why: string }[] | null;
}
interface Test {
  id: string;
  at: string;
  label: string;
  kind: Kind;
  told: string | null;
  a: Side;
  b: Side;
  pick: "a" | "b" | "same" | null;
  note: string | null;
  reveal: { newIs: "a" | "b"; a: Found; b: Found } | null;
}
interface View {
  on: boolean;
  since: string | null;
  available: boolean;
  sources: { id: string; label: string; film: boolean }[];
  summary: { kind: Kind; label: string; tests: number; picked: number; newBetter: number; oldBetter: number; same: number; oldMistakes: number; newMistakes: number; newDropped: number }[];
  tests: Test[];
}

const KINDS: [Kind, string][] = [
  ["report", "Round report"],
  ["bulletin", "Live bulletin"],
  ["tournament", "Tournament review"],
  ["film", "Film script"],
];

const post = (b: Record<string, unknown>) => act(b);

export default function WritingPage() {
  const { user } = useConsole();
  const { data, err, reload } = useView<View>("writing");
  const [openId, setOpenId] = useState<string | null>(null);
  if (user.role !== "owner") return <Problem err="Only the owner can use the writing test." />;
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  const open = data.tests.find((t) => t.id === openId) ?? data.tests.find((t) => !t.pick) ?? null;
  return (
    <>
      <PageHead title="Writing" lead="The new writer, read side by side against today's before it goes live for everyone." />
      {!data.available && <p className="con-warn con-note">The writing test needs the latest database update (run supabase/schema.sql).</p>}
      <Switch on={data.on} since={data.since} reload={reload} />
      <Try
        sources={data.sources}
        onDone={async (id) => {
          await reload();
          setOpenId(id);
        }}
        disabled={!data.available}
      />
      {open && <Compare key={open.id} t={open} reload={reload} />}
      {data.summary.length > 0 && <Summary rows={data.summary} />}
      {data.tests.length > 1 && (
        <section className="con-panel" aria-labelledby="w-all">
          <h2 id="w-all">Every test</h2>
          <ul className="con-rows">
            {data.tests.map((t) => (
              <li key={t.id}>
                <a
                  href={`#w-${t.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpenId(t.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  aria-current={open?.id === t.id ? "true" : undefined}
                >
                  <span>
                    {t.label}
                    <small>{t.pick ? (t.pick === "same" ? "About the same" : t.reveal && t.pick === t.reveal.newIs ? "The new writer read better" : "Today's read better") : "Not read yet"}</small>
                  </span>
                  <span className="con-age">{when(t.at)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Switch({ on, since, reload }: { on: boolean; since: string | null; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function flip() {
    setBusy(true);
    setMsg(null);
    const r = await post({ action: "writing.switch", on: !on });
    setBusy(false);
    if (!r.ok) return setMsg(String(r.j.error ?? "That didn't work. Try again."));
    reload();
  }
  return (
    <section className="con-panel" aria-labelledby="w-switch">
      <h2 id="w-switch">The new writer</h2>
      <p className="con-big-line">{on ? <>On{since ? ` since ${day(since)}` : ""}.</> : "Off."}</p>
      <p>
        {on
          ? "Every preview, bulletin, report, review and film script is written from the grid and fact-checked before it goes out."
          : "Every piece is written today's way. Switched on, every preview, bulletin, report, review and film script is written from the grid and fact-checked before it goes out."}
      </p>
      <button className={`btn${on ? " secondary" : ""}`} disabled={busy} onClick={flip}>
        {busy ? "Saving…" : on ? "Switch it off" : "Switch the new writer on"}
      </button>
      {msg && <p className="con-warn">{msg}</p>}
    </section>
  );
}

function Try({ sources, onDone, disabled }: { sources: View["sources"]; onDone: (id: string) => Promise<void>; disabled: boolean }) {
  const [source, setSource] = useState(sources[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("report");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const src = sources.find((s) => s.id === source);
  const filmOk = !!src?.film;
  const kinds = KINDS.filter(([k]) => k !== "film" || filmOk);
  const k = kind === "film" && !filmOk ? "report" : kind;
  async function run(times: number) {
    setMsg(null);
    let last: string | null = null;
    for (let i = 0; i < times; i++) {
      setBusy(times > 1 ? `Writing ${i + 1} of ${times}…` : "Writing both… this takes about a minute.");
      const r = await post({ action: "writing.run", source, kind: k });
      if (!r.ok) {
        setBusy(null);
        return setMsg(String(r.j.error ?? "The writer didn't come back. Try again."));
      }
      last = String(r.j.id ?? "");
    }
    if (last) await onDone(last);
    setBusy(null);
  }
  const made = sources.filter((s) => s.id.startsWith("made-up:"));
  const real = sources.filter((s) => !s.id.startsWith("made-up:"));
  return (
    <section className="con-panel" aria-labelledby="w-try">
      <h2 id="w-try">Write one both ways</h2>
      <p className="small con-quiet">They&apos;re labelled A and B, so you won&apos;t know which writer is which until you&apos;ve picked. Nothing is published, and nobody else sees them.</p>
      <div className="con-filters">
        <div className="con-filter con-wide">
          <label htmlFor="w-src">The round</label>
          <select id="w-src" value={source} onChange={(e) => setSource(e.target.value)}>
            <optgroup label="Made up for the test">
              {made.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
            {real.length > 0 && (
              <optgroup label="Rounds on the site">
                {real.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="con-filter">
          <label htmlFor="w-kind">What to write</label>
          <select id="w-kind" value={k} onChange={(e) => setKind(e.target.value as Kind)}>
            {kinds.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="con-acts">
        <button className="btn" disabled={!!busy || disabled || !source} onClick={() => run(1)}>
          Write both
        </button>
        <button className="btn secondary" disabled={!!busy || disabled || !source} onClick={() => run(5)}>
          Write 5 more, to count mistakes
        </button>
      </div>
      {busy && <p className="con-quiet" role="status">{busy}</p>}
      {msg && <p className="con-warn">{msg}</p>}
      <p className="small con-quiet">Each one costs a few cents of AI writing, about double for the new writer, as it checks its work.</p>
    </section>
  );
}

function Body({ text }: { text: string }) {
  return (
    <div className="con-ab-body">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i}>
          {p.split("\n").map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function Compare({ t, reload }: { t: Test; reload: () => void }) {
  const [pick, setPick] = useState<"a" | "b" | "same" | null>(t.pick);
  const [note, setNote] = useState(t.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    if (!pick) return setMsg("Pick one first.");
    setBusy(true);
    const r = await post({ action: "writing.pick", id: t.id, pick, note });
    setBusy(false);
    if (!r.ok) return setMsg(String(r.j.error ?? "That didn't save. Try again."));
    reload();
  }
  const who = (side: "a" | "b") => (t.reveal ? (t.reveal.newIs === side ? "The new writer" : "Today's writer") : null);
  const found = (side: "a" | "b") => {
    const f = t.reveal?.[side];
    if (!f) return null;
    const isNew = t.reveal!.newIs === side;
    return (
      <div className="con-ab-found">
        <p>
          The check found {f.mistakes === 0 ? "nothing wrong" : `${n(f.mistakes)} mistake${f.mistakes === 1 ? "" : "s"}`} in the first draft.
          {isNew && f.mistakes > 0 && ` ${n(f.fixed ?? 0)} put right, ${n(f.dropped?.length ?? 0)} left out before it would go out.`}
        </p>
        {(isNew ? (f.dropped ?? []) : f.problems).length > 0 && (
          <ul>
            {(isNew ? (f.dropped ?? []) : f.problems).map((p, i) => (
              <li key={i}>
                <q>{p.text}</q> <small>{p.why.charAt(0).toUpperCase() + p.why.slice(1)}.</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <section className="con-panel" aria-labelledby="w-ab" id={`w-${t.id}`}>
      <h2 id="w-ab">{t.label}</h2>
      <p className="small con-quiet">
        Written {when(t.at)}
        {t.told ? `. Told on the course: ${t.told === "most" ? "most holes in detail" : t.told === "some" ? "some shots" : "scores only"}` : ""}.
      </p>
      <div className="con-ab">
        {(["a", "b"] as const).map((side) => (
          <article key={side} className="con-ab-side" aria-label={`Version ${side.toUpperCase()}`}>
            <h3>
              {side.toUpperCase()}
              {who(side) && <span>{who(side)}</span>}
            </h3>
            <p className="con-ab-title">{t[side].title}</p>
            <Body text={t[side].body} />
            {found(side)}
          </article>
        ))}
      </div>
      {!t.pick ? (
        <div className="con-ab-pick">
          <p className="con-strong">Which reads more like a real report on that round?</p>
          <div className="con-acts" role="group" aria-label="Your pick">
            {(
              [
                ["a", "A reads better"],
                ["b", "B reads better"],
                ["same", "About the same"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={`btn${pick === v ? "" : " secondary"}`} aria-pressed={pick === v} onClick={() => setPick(v)}>
                {l}
              </button>
            ))}
          </div>
          <label htmlFor="w-note" className="con-strong">
            Anything either got wrong? <span className="con-quiet">(optional)</span>
          </label>
          <textarea id="w-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn" disabled={busy || !pick} onClick={save}>
            {busy ? "Saving…" : "Save my pick"}
          </button>
          {msg && <p className="con-warn">{msg}</p>}
        </div>
      ) : (
        <p className="con-ab-picked">
          You picked {t.pick === "same" ? "about the same" : `${t.pick.toUpperCase()} (${who(t.pick)?.toLowerCase()})`}.{t.note ? ` Your note: “${t.note}”` : ""}
        </p>
      )}
    </section>
  );
}

function Summary({ rows }: { rows: View["summary"] }) {
  const per = (x: number, of: number) => (of ? (Math.round((x / of) * 10) / 10).toLocaleString("en-IE") : "0");
  return (
    <section className="con-panel" aria-labelledby="w-sum">
      <h2 id="w-sum">So far</h2>
      <div className="con-table-wrap">
        <table className="con-table">
          <caption className="sr-only">The writing tests so far, by kind of piece</caption>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col" className="num">Written</th>
              <th scope="col" className="num">Read</th>
              <th scope="col" className="num">New better</th>
              <th scope="col" className="num">Today&apos;s better</th>
              <th scope="col" className="num">Same</th>
              <th scope="col" className="num">Mistakes a piece, today&apos;s</th>
              <th scope="col" className="num">Mistakes a piece, new</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind}>
                <th scope="row">{r.label}</th>
                <td className="num">{n(r.tests)}</td>
                <td className="num">{n(r.picked)}</td>
                <td className="num">{n(r.newBetter)}</td>
                <td className="num">{n(r.oldBetter)}</td>
                <td className="num">{n(r.same)}</td>
                <td className="num">{per(r.oldMistakes, r.tests)}</td>
                <td className="num">{per(r.newMistakes, r.tests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small con-quiet">Mistakes are what the fact check found in each first draft, before anything was put right. The new writer then puts right or leaves out whatever its check finds before anything goes out.</p>
    </section>
  );
}
