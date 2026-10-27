"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loading, PageHead, Problem, Table, day, n } from "@/components/console/kit";
import { CAMPAIGN_STATUS, EmailTabs, eact, pct, useEmailView, type Stats } from "@/components/console/email";

interface Row {
  id: string;
  name: string;
  status: string;
  send_on: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  planned: number | null;
  stats: Stats;
}

/** Campaigns: one-off emails you write. */
export default function Campaigns() {
  const router = useRouter();
  const { data, err } = useEmailView<{ campaigns: Row[] }>("campaigns");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Email" lead="A campaign is one email to a group of people who ticked the marketing box. Support can write and test one; only the owner sends.">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await eact<{ id: string }>({ action: "campaign.create", name: "New campaign" });
            setBusy(false);
            if (r.ok) router.push(`/console/email/campaigns/${r.j.id}`);
            else setMsg(String(r.j.error ?? "Couldn't start one"));
          }}
        >
          New campaign
        </button>
      </PageHead>
      <EmailTabs />
      <Problem err={err ?? msg} />
      {!data ? (
        !err && <Loading />
      ) : (
        <Table<Row>
          caption="Campaigns"
          empty="No campaigns yet. Start one with New campaign."
          rows={data.campaigns}
          rowKey={(r) => r.id}
          cols={[
            { key: "name", label: "Campaign", render: (r) => <Link href={`/console/email/campaigns/${r.id}`}>{r.name}</Link> },
            { key: "status", label: "Status", render: (r) => <span className={`em-state${r.status === "sent" || r.status === "sending" ? " on" : r.status === "paused" ? " warn" : ""}`}>{CAMPAIGN_STATUS[r.status] ?? r.status}</span> },
            { key: "when", label: "When", render: (r) => (r.status === "scheduled" && r.send_on ? `${day(r.send_on)}, 10am` : r.started_at ? day(r.started_at) : `Started ${day(r.created_at)}`) },
            { key: "sent", label: "Sent", num: true, render: (r) => (r.stats.sent ? n(r.stats.sent) : "") },
            { key: "tapped", label: "Tapped", num: true, render: (r) => (r.stats.sent ? `${n(r.stats.clicked)} (${pct(r.stats.clicked / r.stats.sent)})` : "") },
            { key: "stopped", label: "Stopped emails", num: true, render: (r) => (r.stats.sent ? n(r.stats.stopped) : "") },
            { key: "bad", label: "Bounced or spam", num: true, render: (r) => (r.stats.sent ? n(r.stats.bounced + r.stats.complained) : "") },
          ]}
        />
      )}
    </>
  );
}
