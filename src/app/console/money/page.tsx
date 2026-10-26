"use client";

import { useState } from "react";
import Link from "next/link";
import { ExportButton, Loading, PageHead, Problem, act, dollars, n, useView } from "@/components/console/kit";
import { SERIES, StackedBars } from "@/components/console/charts";

interface Money {
  month: string;
  day: number;
  daysIn: number;
  services: { id: string; name: string; spent: number; calls: number; budget: number; projected: number }[];
  total: number;
  projected: number;
  perTournament: { tournaments: number; average: number; top: { tournament_id: string; cents: number; tournament: { id: string; slug: string; name: string } | null }[] };
  months: { month: string; service: string; cents: number }[];
  bills: Record<string, Record<string, number>>;
  filmLimits: { monthlyCents?: number; perTournament?: number };
}

export default function MoneyPage() {
  const { data, err, reload } = useView<Money>("money");
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  const monthName = new Date(`${data.month}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
  const twelve = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${data.month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 11 + i);
    return d.toISOString().slice(0, 7);
  });
  const spentIn = (m: string, svc: string) => Number(data.months.find((r) => r.month === m && r.service === svc)?.cents ?? 0);
  const budget = data.services.reduce((s, x) => s + (x.budget > 0 ? x.budget : 0), 0);
  return (
    <>
      <PageHead title="Money" lead={`${monthName}, day ${data.day} of ${data.daysIn}. Estimates from each supplier's prices, in US dollars as they bill.`}>
        <ExportButton what="costs" params={{ month: data.month }} label="Export this month's costs" />
      </PageHead>

      <section className="con-figs" aria-label="This month">
        <div className="con-fig">
          <span className="con-fig-label">Spent this month</span>
          <span className="con-fig-value">{dollars(data.total)}</span>
          {budget > 0 && (
            <span className={`con-fig-bar${data.total >= budget ? " full" : data.total >= budget * 0.8 ? " near" : ""}`} aria-hidden="true">
              <span style={{ width: `${Math.min(100, (data.total / budget) * 100)}%` }} />
            </span>
          )}
          <span className="con-fig-change">{budget > 0 ? `of ${dollars(budget)} in budgets` : "No budgets set"}</span>
        </div>
        <div className="con-fig">
          <span className="con-fig-label">At this rate, by the month end</span>
          <span className="con-fig-value">{dollars(data.projected)}</span>
          <span className="con-fig-change">{budget > 0 && data.projected > budget ? "Over budget at this rate" : "Within budget at this rate"}</span>
        </div>
        <div className="con-fig">
          <span className="con-fig-label">The average tournament this month</span>
          <span className="con-fig-value">{dollars(data.perTournament.average)}</span>
          <span className="con-fig-change">across {n(data.perTournament.tournaments)} that spent anything</span>
        </div>
      </section>

      <Budgets data={data} onSaved={reload} />

      <div className="con-two">
        <section className="con-panel" aria-labelledby="h-top">
          <h2 id="h-top">The most expensive this month</h2>
          {data.perTournament.top.length === 0 ? (
            <p className="con-calm">No tournament has cost anything this month.</p>
          ) : (
            <ol className="con-rows numbered">
              {data.perTournament.top.map((r) => (
                <li key={r.tournament_id}>
                  {r.tournament ? (
                    <Link href={`/console/tournaments/${r.tournament.id}?tab=money`}>
                      <span>{r.tournament.name}</span>
                      <span className="con-age">{dollars(r.cents)}</span>
                    </Link>
                  ) : (
                    <span className="con-quiet">A deleted tournament, {dollars(r.cents)}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        <Bills data={data} onSaved={reload} />
      </div>

      <section className="con-panel">
        <StackedBars title="Twelve months, by service" months={twelve} series={data.services.map((s) => ({ id: s.id, name: s.name }))} value={spentIn} format={(v) => dollars(v)} />
      </section>
    </>
  );
}

function Budgets({ data, onSaved }: { data: Money; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(data.services.map((s) => [s.id, String(s.budget / 100)])));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  return (
    <form
      className="con-panel con-form"
      aria-labelledby="h-budgets"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        const r = await act({ action: "money.budgets", budgets: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v || 0)])) });
        setMsg(r.ok ? { text: "Saved. They're the same each month until you change them." } : { text: String(r.j.error ?? "Didn't save"), bad: true });
        if (r.ok) onSaved();
      }}
    >
      <h2 id="h-budgets">This month, by service</h2>
      <p className="small">
        Each service has a monthly budget, the same every month. At 80% you&apos;re told in Needs you; at 100% it stops until next month or until you raise it, and you get an email. Live scoring, the feed and the leaderboard
        never stop. Leave a budget at 0 for no limit.
      </p>
      <div className="con-table-wrap">
        <table className="con-table con-budget">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col" className="num">
                Spent
              </th>
              <th scope="col">Of the budget</th>
              <th scope="col" className="num">
                By the month end
              </th>
              <th scope="col">Monthly budget ($)</th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((s, i) => {
              const pct = s.budget > 0 ? (s.spent / s.budget) * 100 : null;
              return (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="con-swatch" style={{ background: SERIES[i] }} aria-hidden="true" />
                    {s.name}
                    <small>{n(s.calls)} call{s.calls === 1 ? "" : "s"}</small>
                  </th>
                  <td className="num" data-label="Spent">{dollars(s.spent)}</td>
                  <td data-label="Of the budget">
                    {pct == null ? (
                      <span className="con-quiet">No limit</span>
                    ) : (
                      <span className={`con-meter${pct >= 100 ? " full" : pct >= 80 ? " near" : ""}`}>
                        <span style={{ width: `${Math.min(100, pct)}%` }} />
                        <em>{Math.round(pct)}%</em>
                      </span>
                    )}
                  </td>
                  <td className="num" data-label="By the month end">{dollars(s.projected)}</td>
                  <td data-label="Monthly budget ($)">
                    <label className="sr-only" htmlFor={`b-${s.id}`}>
                      {s.name} monthly budget in dollars
                    </label>
                    <input id={`b-${s.id}`} className="con-money-in" inputMode="decimal" value={vals[s.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="con-form-foot">
        <button className="btn">Save the budgets</button>
        {msg && <span className={msg.bad ? "error" : "con-ok"}>{msg.text}</span>}
      </div>
      <p className="small con-quiet">
        Per tournament: films ({data.filmLimits.perTournament ?? 0} each) are set in <Link href="/console/settings">Settings</Link>; AI writing and clips are set on each tournament&apos;s Money tab.
      </p>
    </form>
  );
}

/** The real bills, typed in once a month, beside the estimates. */
function Bills({ data, onSaved }: { data: Money; onSaved: () => void }) {
  const last = new Date(`${data.month}-15T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() - 1);
  const [month, setMonth] = useState(last.toISOString().slice(0, 7));
  const [service, setService] = useState(data.services[0]?.id ?? "writing");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const estimate = (m: string, s: string) => Number(data.months.find((r) => r.month === m && r.service === s)?.cents ?? 0);
  const rows = Object.entries(data.bills)
    .sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([m, bills]) => Object.entries(bills).map(([s, c]) => ({ m, s, c })));
  return (
    <section className="con-panel" aria-labelledby="h-bills">
      <h2 id="h-bills">The real bills</h2>
      <p className="small">Type in each supplier&apos;s bill once a month, so you can see how close the estimates are.</p>
      <form
        className="con-form-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act({ action: "money.bill", month, service, dollars: Number(amount) });
          setMsg(r.ok ? { text: "Saved." } : { text: String(r.j.error ?? "Didn't save"), bad: true });
          if (r.ok) {
            setAmount("");
            onSaved();
          }
        }}
      >
        <div className="field">
          <label htmlFor="bill-m">Month</label>
          <input id="bill-m" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bill-s">Supplier</label>
          <select id="bill-s" value={service} onChange={(e) => setService(e.target.value)}>
            {data.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bill-a">The bill ($)</label>
          <input id="bill-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <button className="btn">Save</button>
      </form>
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
      {rows.length > 0 && (
        <div className="con-table-wrap">
          <table className="con-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Supplier</th>
                <th scope="col" className="num">
                  Bill
                </th>
                <th scope="col" className="num">
                  Estimate
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.m}${r.s}`}>
                  <th scope="row">{new Date(`${r.m}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "short", year: "numeric", timeZone: "UTC" })}</th>
                  <td data-label="Supplier">{data.services.find((s) => s.id === r.s)?.name ?? r.s}</td>
                  <td className="num" data-label="Bill">{dollars(r.c)}</td>
                  <td className="num" data-label="Estimate">{dollars(estimate(r.m, r.s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
