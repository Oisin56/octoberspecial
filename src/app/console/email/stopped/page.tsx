"use client";

import { useState } from "react";
import { Loading, PageHead, Pager, PersonLink, Problem, SearchBox, Table, day, useFilters } from "@/components/console/kit";
import { EmailTabs, HealthLine, eact, useEmailView, type EmailHealth } from "@/components/console/email";

interface Row {
  email: string;
  at: string;
  what: string;
  why: string;
  lift: boolean;
}
/** Everyone the site won't email, and why. */
export default function Stopped() {
  const { values, set } = useFilters(["q", "page"]);
  const { data, err, reload } = useEmailView<{ rows: Row[]; total: number; page: number; size: number; health: EmailHealth; role: "owner" | "support" }>("stopped", { q: values.q, page: values.page });
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [add, setAdd] = useState("");
  const owner = data?.role === "owner";
  const lift = async (email: string) => {
    const r = await eact({ action: "stopped.lift", email });
    setMsg(r.ok ? { text: `${email} gets email again.` } : { text: String(r.j.error ?? "That didn't work"), bad: true });
    if (r.ok) reload();
  };
  return (
    <>
      <PageHead title="Email" lead="Addresses the site won't email, or only partly: bounced, marked as spam, unsubscribed, or stopped by you." />
      <EmailTabs />
      {data && <HealthLine h={data.health} />}
      <div className="con-filters">
        <SearchBox label="Find an address" value={values.q} onChange={(v) => set({ q: v })} />
      </div>
      <Problem err={err} />
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
      {!data ? (
        !err && <Loading />
      ) : (
        <>
          <Table<Row>
            caption="Stopped addresses"
            empty="Nobody's stopped. Every address is getting what it asked for."
            rows={data.rows}
            rowKey={(r) => r.email}
            cols={[
              { key: "email", label: "Address", render: (r) => <PersonLink email={r.email} /> },
              { key: "what", label: "What's stopped", render: (r) => r.what },
              { key: "why", label: "Why", render: (r) => r.why },
              { key: "at", label: "Since", render: (r) => day(r.at) },
              {
                key: "lift",
                label: "",
                render: (r) =>
                  r.lift ? (
                    owner ? (
                      <button className="btn secondary" onClick={() => lift(r.email)}>
                        Email them again
                      </button>
                    ) : null
                  ) : (
                    <span className="small con-quiet">Only they can undo this</span>
                  ),
              },
            ]}
          />
          <Pager page={data.page} size={data.size} total={data.total} onPage={(p) => set({ page: p })} />
          {owner && (
            <form
              className="con-panel con-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await eact({ action: "stopped.add", email: add });
                setMsg(r.ok ? { text: `The site won't email ${add} any more.` } : { text: String(r.j.error ?? "That didn't work"), bad: true });
                if (r.ok) {
                  setAdd("");
                  reload();
                }
              }}
            >
              <h2>Stop emailing an address</h2>
              <p className="small">For someone who asks you directly. They&apos;ll get nothing at all, sign-in codes included, until you start emailing them again.</p>
              <div className="con-form-row">
                <div className="field">
                  <label htmlFor="stop-email">Address</label>
                  <input id="stop-email" type="email" value={add} onChange={(e) => setAdd(e.target.value)} required />
                </div>
                <button className="btn secondary">Stop emailing it</button>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}
