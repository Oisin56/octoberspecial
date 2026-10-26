"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/Shell";
import { ExportButton, Loading, PageHead, Pager, Problem, SearchBox, Select, Status, Table, dollars, day, months, n, useFilters, useView, type Col } from "@/components/console/kit";

interface Row {
  id: string;
  slug: string;
  name: string;
  privacy: string;
  status: string;
  organiser: string | null;
  first_day: string | null;
  last_day: string | null;
  players: number;
  followers: number;
  posts: number;
  films: number;
  cost_cents: number;
  created_at: string;
}

export default function TournamentsPage() {
  const { user } = useConsole();
  const { values, set } = useFilters(["q", "status", "privacy", "month", "sort", "dir", "page"]);
  const page = Number(values.page || 0);
  const { data, err } = useView<{ rows: Row[]; total: number; size: number }>("tournaments", { ...values, page });
  const sort = values.sort || "created_at";
  const dir = values.dir || "desc";
  const onSort = (k: string) => set({ sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" });
  const dates = (r: Row) => (r.first_day ? (r.last_day && r.last_day !== r.first_day ? `${day(r.first_day, false)} to ${day(r.last_day)}` : day(r.first_day)) : "No dates");

  const cols: Col<Row>[] = [
    {
      key: "name",
      label: "Tournament",
      sort: true,
      render: (r) => (
        <Link href={`/console/tournaments/${r.id}`} className="con-strong">
          {r.name}
          {r.privacy === "private" && <span className="con-tag">Private</span>}
        </Link>
      ),
    },
    { key: "organiser", label: "Organiser", sort: true, render: (r) => r.organiser ?? <span className="con-quiet">None with an email</span> },
    { key: "status", label: "Status", sort: true, render: (r) => <Status s={r.status} /> },
    { key: "first_day", label: "Dates", sort: true, render: dates },
    { key: "players", label: "Players", sort: true, num: true, render: (r) => n(r.players) },
    { key: "followers", label: "Followers", sort: true, num: true, render: (r) => n(r.followers) },
    { key: "posts", label: "Posts", sort: true, num: true, render: (r) => n(r.posts) },
    { key: "films", label: "Films", sort: true, num: true, render: (r) => n(r.films) },
    ...(user.role === "owner" ? [{ key: "cost_cents", label: "Cost so far", sort: true, num: true, render: (r: Row) => dollars(r.cost_cents) }] : []),
    { key: "created_at", label: "Set up", sort: true, render: (r) => day(r.created_at) },
  ];

  return (
    <>
      <PageHead title="Tournaments" lead={data ? `${n(data.total)} ${values.q || values.status || values.privacy || values.month ? "match" : "in all"}` : undefined}>
        {user.role === "owner" && <ExportButton what="tournaments" params={values} />}
      </PageHead>
      <div className="con-filters">
        <SearchBox label="Search by name, organiser email or address" value={values.q} onChange={(v) => set({ q: v })} />
        <Select
          label="Status"
          value={values.status}
          onChange={(v) => set({ status: v })}
          options={[
            ["", "Any"],
            ["setting up", "Setting up"],
            ["coming up", "Coming up"],
            ["live", "Live"],
            ["finished", "Finished"],
          ]}
        />
        <Select
          label="Who can watch"
          value={values.privacy}
          onChange={(v) => set({ privacy: v })}
          options={[
            ["", "Either"],
            ["friends", "Friends and family"],
            ["private", "Private"],
          ]}
        />
        <Select label="Starts in" value={values.month} onChange={(v) => set({ month: v })} options={months()} />
      </div>
      <Problem err={err} />
      {!data && !err && <Loading />}
      {data && (
        <>
          <Table caption="Tournaments" cols={cols} rows={data.rows} rowKey={(r) => r.id} sort={sort} dir={dir} onSort={onSort} empty="No tournaments match. Try fewer filters." />
          <Pager page={page} size={data.size} total={data.total} onPage={(p) => set({ page: p })} />
        </>
      )}
    </>
  );
}
