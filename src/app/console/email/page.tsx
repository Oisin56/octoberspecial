"use client";

import Link from "next/link";
import { Loading, PageHead, Problem, day } from "@/components/console/kit";
import { EmailTabs, useEmailView } from "@/components/console/email";

interface Every {
  emails: { key: string; name: string; about: string; group: "service" | "updates"; sent30: number; changed: { saved_at: string; saved_by: string } | null }[];
  internal: { name: string; about: string }[];
  role: "owner" | "support";
}

/** Every email the site sends: what each says is edited here. */
export default function EveryEmail() {
  const { data, err } = useEmailView<Every>("every");
  return (
    <>
      <PageHead title="Email" lead="What every email says, the series that send themselves, your campaigns, and the addresses the site won't email." />
      <EmailTabs />
      <Problem err={err} />
      {!data ? (
        !err && <Loading />
      ) : (
        <>
          {(
            [
              ["service", "Service emails", "They go whatever people's choices are: they're how people get in, or what they asked for."],
              ["updates", "Updates", "Only to people who asked for them, and one tap stops them."],
            ] as const
          ).map(([g, title, lead]) => (
            <section key={g} className="con-panel" aria-labelledby={`h-${g}`}>
              <h2 id={`h-${g}`}>{title}</h2>
              <p className="small" style={{ marginTop: 0 }}>
                {lead}
              </p>
              <ul className="em-list">
                {data.emails
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <li key={e.key}>
                      <Link className="em-name" href={`/console/email/edit?key=${encodeURIComponent(e.key)}`}>
                        {e.name}
                      </Link>
                      <span className="em-meta">
                        {e.sent30.toLocaleString("en-IE")} in 30 days
                        <br />
                        {e.changed ? `Changed ${day(e.changed.saved_at)}` : "Starting words"}
                      </span>
                      <p className="em-about">{e.about}</p>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <section className="con-panel" aria-labelledby="h-int">
            <h2 id="h-int">To you and support</h2>
            <p className="small" style={{ marginTop: 0 }}>
              Plain on purpose, in the same look. Nobody outside the company sees them, so they aren&apos;t edited here.
            </p>
            <ul className="em-list">
              {data.internal.map((e) => (
                <li key={e.name}>
                  <strong>{e.name}</strong>
                  <span />
                  <p className="em-about">{e.about}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
