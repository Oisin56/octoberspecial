"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { ExportButton, Loading, PageHead, Pager, Problem, SearchBox, Select, Table, PersonLink, useFilters, useView, type Col } from "@/components/console/kit";
import { ACTION_WORDS } from "@/lib/activity-words";

interface Row {
  id: number;
  at: string;
  actor: string;
  actor_role: string;
  action: string;
  tournament_id: string | null;
  tournament_name: string | null;
  person: string | null;
}

export default function ActivityPage() {
  const { user } = useConsole();
  const { values, set } = useFilters(["q", "who", "action", "from", "to", "page"]);
  const page = Number(values.page || 0);
  const { data, err } = useView<{ rows: Row[]; total: number; size: number }>("activity", { ...values, page });
  const cols: Col<Row>[] = [
    { key: "at", label: "When", render: (r) => new Date(r.at).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }) },
    { key: "actor", label: "Who", render: (r) => (r.actor_role === "system" ? "The site" : `${r.actor} (${r.actor_role === "owner" ? "owner" : "support"})`) },
    { key: "action", label: "What", render: (r) => ACTION_WORDS[r.action] ?? r.action },
    { key: "t", label: "Tournament", render: (r) => (r.tournament_id && r.tournament_name ? <Link href={`/console/tournaments/${r.tournament_id}`}>{r.tournament_name}</Link> : (r.tournament_name ?? "")) },
    { key: "p", label: "Person", render: (r) => (r.person ? <PersonLink email={r.person} /> : "") },
  ];
  return (
    <>
      <PageHead title="Activity" lead="Everything done in the console, newest first. Nobody can change it, you included, and it's kept for two years.">
        {user.role === "owner" && <ExportButton what="activity" params={values} />}
      </PageHead>
      <div className="con-filters">
        <SearchBox label="Search by person, email or tournament" value={values.q} onChange={(v) => set({ q: v })} />
        <Select
          label="By"
          value={values.who}
          onChange={(v) => set({ who: v })}
          options={[
            ["", "Anyone"],
            ["owner", "The owner"],
            ["support", "Support"],
            ["system", "The site"],
          ]}
        />
        <Select
          label="What"
          value={values.action}
          onChange={(v) => set({ action: v })}
          options={[
            ["", "Anything"],
            ["person.view", "Looks at people's pages"],
            ["export", "Exports"],
            ["tournament.", "Tournaments"],
            ["person.", "People"],
            ["queue.", "Needs you"],
            ["money.", "Money"],
            ["settings.", "Settings"],
            ["console.signin", "Sign-ins"],
          ]}
        />
        <div className="con-filter">
          <label htmlFor="a-from">From</label>
          <input id="a-from" type="date" value={values.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="con-filter">
          <label htmlFor="a-to">To</label>
          <input id="a-to" type="date" value={values.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </div>
      <Problem err={err} />
      {!data && !err && <Loading />}
      {data && (
        <>
          <Table caption="The activity record" cols={cols} rows={data.rows} rowKey={(r) => String(r.id)} empty="Nothing recorded for these filters." />
          <Pager page={page} size={data.size} total={data.total} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
