"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { Figure, Loading, PageHead, Problem, age, clock, day, n, useView, when } from "@/components/console/kit";
import { LineChart } from "@/components/console/charts";
import type { NeedRow } from "@/lib/console-data";

interface Overview {
  figures: { key: string; label: string; value: number; prev: number | null; money?: boolean; of?: number; note?: string }[];
  needs: { items: NeedRow[]; total: number };
  live: { id: string; slug: string; name: string; round: number; started: boolean; playing: number; watching: number; lastScore: string | null; quiet: boolean }[];
  coming: { id: string; slug: string; name: string; first_day: string; players: number }[];
  health: { light: "green" | "amber" | "red"; words: string };
  growth: { week: string; tournaments: number; active: number | null }[];
}

const FIG_HREF: Record<string, string> = {
  live: "/console/tournaments?status=live",
  tournaments: "/console/tournaments?sort=created_at",
  active: "/console/people?active=30&sort=last_at",
  followers: "/console/people?role=follower&sort=first_at",
  optins: "/console/people?marketing=yes&sort=marketing_at",
  spend: "/console/money",
};

/** The front page: is everything all right, and does anything need me? */
export default function ConsoleHome() {
  const { user } = useConsole();
  const { data, err } = useView<Overview>("overview");
  const today = new Date().toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" }).replace(",", "");
  return (
    <>
      <PageHead title="Overview" lead={today} />
      <Problem err={err} />
      {!data && !err && <Loading />}
      {data && (
        <>
          <section className="con-figs" aria-label="The last 30 days">
            {data.figures
              .filter((f) => f.key !== "spend" || user.role === "owner")
              .map((f) => (
                <Figure key={f.key} label={f.label} value={f.value} prev={f.prev} money={f.money} of={f.of} note={f.note} href={FIG_HREF[f.key]} />
              ))}
          </section>

          <div className="con-two">
            <section className="con-panel" aria-labelledby="h-needs">
              <div className="con-panel-head">
                <h2 id="h-needs">Needs you</h2>
                {data.needs.total > 0 && <Link href="/console/needs">See all {n(data.needs.total)}</Link>}
              </div>
              {data.needs.items.length === 0 ? (
                <p className="con-calm">Nothing needs you.</p>
              ) : (
                <ul className="con-rows">
                  {data.needs.items.map((i) => (
                    <li key={i.id}>
                      <Link href={`/console/needs#${i.id}`}>
                        <span>
                          {i.title}
                          {i.tournament && <small>{i.tournament.name}</small>}
                        </span>
                        <span className="con-age">{age(i.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="con-panel" aria-labelledby="h-live">
              <div className="con-panel-head">
                <h2 id="h-live">Live now</h2>
                {data.live.length > 6 && <Link href="/console/tournaments?status=live">See all {n(data.live.length)}</Link>}
              </div>
              {data.live.length === 0 ? (
                <p className="con-calm">Nobody&apos;s playing today.</p>
              ) : (
                <ul className="con-rows">
                  {data.live.slice(0, 6).map((l) => (
                    <li key={l.id}>
                      <Link href={`/console/tournaments/${l.id}`}>
                        <span>
                          <strong>
                            {l.name}, round {l.round}
                          </strong>
                          <small className={l.quiet ? "con-warn" : undefined}>
                            {l.quiet ? `No score for ${l.lastScore ? when(l.lastScore).replace(" ago", "") : "a while"}` : l.lastScore ? `Last score ${when(l.lastScore)}` : l.started ? "No scores yet" : "Starts today"}
                            {!l.quiet && `, ${n(l.watching)} watching`}
                          </small>
                        </span>
                        <span className="con-age">{n(l.playing)} playing</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="con-two">
            <section className="con-panel" aria-labelledby="h-coming">
              <div className="con-panel-head">
                <h2 id="h-coming">Coming up</h2>
                {data.coming.length > 6 ? <Link href="/console/tournaments?status=coming%20up&sort=first_day&dir=asc">See all {n(data.coming.length)}</Link> : <span className="con-quiet">The next 14 days</span>}
              </div>
              {data.coming.length === 0 ? (
                <p className="con-calm">Nothing starts in the next fortnight.</p>
              ) : (
                <ul className="con-rows">
                  {data.coming.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <Link href={`/console/tournaments/${c.id}`}>
                        <span>
                          <strong>{c.name}</strong>
                          <small>{n(c.players)} players</small>
                        </span>
                        <span className="con-age">{day(c.first_day, false)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="con-panel" aria-labelledby="h-growth">
              <div className="con-panel-head">
                <h2 id="h-growth">Growth</h2>
                <span className="con-quiet">Week by week, the last 12 weeks</span>
              </div>
              <div className="con-growth">
                <LineChart title="New tournaments" points={data.growth.map((g) => ({ label: day(g.week, false), value: g.tournaments }))} empty="No tournaments yet." />
                <LineChart title="Active people (the last 7 days)" points={data.growth.map((g) => ({ label: day(g.week, false), value: g.active }))} empty="This fills in from tonight, a week at a time." />
              </div>
            </section>
          </div>

          <Link href="/console/health" className={`con-health h-${data.health.light}`}>
            <span aria-hidden="true" />
            <strong>{data.health.words}</strong>
            <small>Checked at {clock(new Date().toISOString())}</small>
          </Link>
        </>
      )}
    </>
  );
}
