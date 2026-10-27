"use client";

import Link from "next/link";
import { Loading, PageHead, Problem } from "@/components/console/kit";
import { EmailTabs, statsLine, useEmailView, type Stats } from "@/components/console/email";

interface SeriesRow {
  key: string;
  name: string;
  about: string;
  enabled: boolean;
  steps: { id: string; on: boolean; when: string; stats: Stats }[];
}

/** The series: short runs of emails that send themselves. */
export default function SeriesPage() {
  const { data, err } = useEmailView<{ series: SeriesRow[] }>("series");
  return (
    <>
      <PageHead title="Email" lead="The series send themselves when something happens, such as a trip finishing. Each starts switched off until you've read it." />
      <EmailTabs />
      <Problem err={err} />
      {!data ? (
        !err && <Loading />
      ) : (
        data.series.map((s) => (
          <section key={s.key} className="con-panel" aria-labelledby={`h-${s.key}`}>
            <div className="con-panel-head">
              <h2 id={`h-${s.key}`}>
                <Link href={`/console/email/series/${s.key}`}>{s.name}</Link>
              </h2>
              <span className={`em-state${s.enabled ? " on" : ""}`}>{s.enabled ? "On" : "Off"}</span>
            </div>
            <p className="small" style={{ marginTop: 0 }}>
              {s.about}
            </p>
            <ul className="em-list">
              {s.steps.map((st) => (
                <li key={st.id}>
                  <strong>{st.when}</strong>
                  <span className="em-meta">{st.on ? "" : "Switched off"}</span>
                  <p className="em-about">{statsLine(st.stats)}</p>
                </li>
              ))}
            </ul>
            <p style={{ margin: "10px 0 0" }}>
              <Link className="btn secondary" href={`/console/email/series/${s.key}`}>
                Open it
              </Link>
            </p>
          </section>
        ))
      )}
    </>
  );
}
