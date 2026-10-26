"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { ExportButton, Loading, PageHead, Pager, Problem, SearchBox, Select, Table, day, months, n, personKey, useFilters, useView, when, type Col } from "@/components/console/kit";

interface Row {
  email: string;
  name: string | null;
  roles: string[];
  first_at: string;
  last_at: string | null;
  marketing_at: string | null;
  marketing_stopped_at: string | null;
}

const ROLE: Record<string, string> = { organiser: "Organiser", player: "Player", follower: "Follower", subscriber: "Report emails" };

export default function PeoplePage() {
  const { user } = useConsole();
  const { values, set } = useFilters(["q", "role", "marketing", "active", "month", "sort", "dir", "page"]);
  const page = Number(values.page || 0);
  const { data, err } = useView<{ rows: Row[]; total: number; size: number }>("people", { ...values, page });
  const sort = values.sort || "first_at";
  const dir = values.dir || "desc";
  const onSort = (k: string) => set({ sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" });
  const cols: Col<Row>[] = [
    {
      key: "name",
      label: "Name",
      sort: true,
      render: (r) => (
        <Link href={`/console/people/${personKey(r.email)}`} className="con-strong">
          {r.name ?? <span className="con-quiet">No name</span>}
        </Link>
      ),
    },
    { key: "email", label: "Email", sort: true, render: (r) => r.email },
    { key: "roles", label: "Roles", render: (r) => r.roles.map((x) => ROLE[x] ?? x).join(", ") || <span className="con-quiet">Signed in</span> },
    { key: "marketing_at", label: "Marketing", sort: true, render: (r) => (r.marketing_stopped_at ? "Stopped" : r.marketing_at ? `Yes, ${day(r.marketing_at)}` : "No") },
    { key: "first_at", label: "First came", sort: true, render: (r) => day(r.first_at) },
    { key: "last_at", label: "Last there", sort: true, render: (r) => when(r.last_at) },
  ];
  return (
    <>
      <PageHead title="People" lead={data ? `${n(data.total)} ${Object.entries(values).some(([k, v]) => v && !["sort", "dir", "page"].includes(k)) ? "match" : "with an email"}` : undefined}>
        {user.role === "owner" && (
          <>
            <ExportButton what="marketing" params={{}} label="Export the marketing list" />
            <ExportButton what="people" params={values} />
          </>
        )}
      </PageHead>
      <p className="con-note">Everyone with an email, however they came in. Followers who never gave an email are counted on each tournament instead.</p>
      <div className="con-filters">
        <SearchBox label="Search by name or email" value={values.q} onChange={(v) => set({ q: v })} />
        <Select
          label="Role"
          value={values.role}
          onChange={(v) => set({ role: v })}
          options={[
            ["", "Any"],
            ["organiser", "Organisers"],
            ["player", "Players"],
            ["follower", "Followers"],
            ["subscriber", "Report emails"],
          ]}
        />
        <Select
          label="Marketing"
          value={values.marketing}
          onChange={(v) => set({ marketing: v })}
          options={[
            ["", "Either"],
            ["yes", "Ticked the box"],
            ["no", "Didn't, or stopped"],
          ]}
        />
        <Select
          label="Active"
          value={values.active}
          onChange={(v) => set({ active: v })}
          options={[
            ["", "Any time"],
            ["30", "In the last 30 days"],
          ]}
        />
        <Select label="First came in" value={values.month} onChange={(v) => set({ month: v })} options={months()} />
      </div>
      <Problem err={err} />
      {!data && !err && <Loading />}
      {data && (
        <>
          <Table caption="People" cols={cols} rows={data.rows} rowKey={(r) => r.email} sort={sort} dir={dir} onSort={onSort} empty="Nobody matches. Try fewer filters." />
          <Pager page={page} size={data.size} total={data.total} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
