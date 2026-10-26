"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** The console's shared pieces: fetching, figures, tables, filters, paging and the small formats. */

export type Json = Record<string, unknown> & { error?: string };

export async function api<T = Json>(view: string, params: Record<string, string | number | undefined> = {}): Promise<{ ok: boolean; status: number; j: T & { error?: string } }> {
  const qs = new URLSearchParams({ view });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const r = await fetch(`/api/console?${qs}`, { cache: "no-store", headers: { "x-console": "1" } }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again." };
  return { ok: !!r?.ok, status: r?.status ?? 0, j };
}

export async function act(body: Record<string, unknown>, path = "/api/console"): Promise<{ ok: boolean; j: Json }> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again." };
  return { ok: !!r?.ok, j };
}

/** Load a view; reloads when its params change. */
export function useView<T>(view: string, params: Record<string, string | number | undefined> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    const r = await api<T>(view, JSON.parse(key));
    if (r.ok) {
      setData(r.j);
      setErr(null);
    } else setErr(String(r.j.error ?? "Couldn't load this just now."));
  }, [view, key]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  return { data, err, reload: load };
}

/** The page's filters live in its address, so they're kept when you come back (and can be shared). */
export function useFilters(keys: string[]) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const values = Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? ""])) as Record<string, string>;
  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      try {
        localStorage.setItem(`console:${path}`, qs);
      } catch {
        // remembering is a convenience only
      }
      router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
    },
    [sp, router, path],
  );
  // Coming back with no filters in the address: the last ones used here
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (sp.toString()) return;
    try {
      const qs = localStorage.getItem(`console:${path}`);
      if (qs) router.replace(`${path}?${qs}`, { scroll: false });
    } catch {
      // nothing remembered
    }
  }, [sp, path, router]);
  return { values, set };
}

// ------------------------------------------------------------ formats

export const dollars = (cents: number | null | undefined, exact = false) => {
  const d = Number(cents ?? 0) / 100;
  return `$${d.toLocaleString("en-IE", { minimumFractionDigits: exact || d < 100 ? 2 : 0, maximumFractionDigits: exact || d < 100 ? 2 : 0 })}`;
};
export const n = (x: number | null | undefined) => Number(x ?? 0).toLocaleString("en-IE");
export const day = (d: string | null | undefined, year = true) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-IE", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Europe/Dublin" }) : "";
export const when = (d: string | null | undefined) => {
  if (!d) return "";
  const ms = Date.now() - Date.parse(d);
  if (ms < 60e3) return "just now";
  if (ms < 3600e3) return `${Math.round(ms / 60e3)} min ago`;
  if (ms < 86400e3) return `${Math.round(ms / 3600e3)} hours ago`.replace(/^1 hours/, "1 hour");
  if (ms < 7 * 86400e3) return `${Math.round(ms / 86400e3)} days ago`.replace(/^1 days/, "1 day");
  return day(d);
};
export const age = (d: string) => {
  const ms = Date.now() - Date.parse(d);
  if (ms < 3600e3) return `${Math.max(1, Math.round(ms / 60e3))} min`;
  if (ms < 86400e3) return `${Math.round(ms / 3600e3)} hour${Math.round(ms / 3600e3) === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86400e3);
  return `${days} day${days === 1 ? "" : "s"}`;
};
export const clock = (d: string | null | undefined) => (d ? new Date(d).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }) : "");

/**
 * A link to a person's page. Their page's address carries an id, never their email (addresses end up in browser
 * history and logs), so the id is looked up when the link is used.
 */
export function PersonLink({ email, children }: { email: string; children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href="/console/people"
      onClick={async (e) => {
        e.preventDefault();
        const r = await act({ action: "person.find", email });
        if (r.ok && r.j.id) router.push(`/console/people/${r.j.id}`);
      }}
    >
      {children ?? email}
    </Link>
  );
}

// ------------------------------------------------------------ pieces

export function PageHead({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="con-head">
      <div>
        <h1>{title}</h1>
        {lead && <p className="con-lead">{lead}</p>}
      </div>
      {children && <div className="con-head-acts">{children}</div>}
    </header>
  );
}

export function Loading() {
  return (
    <p className="con-loading" role="status">
      Loading…
    </p>
  );
}

export function Problem({ err }: { err: string | null }) {
  return err ? (
    <p className="error" role="alert">
      {err}
    </p>
  ) : null;
}

/** One figure: the number, what it counts, and the 30 days before it (or what it's against). */
export function Figure({ label, value, prev, money, of, note, href }: { label: string; value: number; prev?: number | null; money?: boolean; of?: number; note?: string; href?: string }) {
  let change: string | null = note ?? null;
  if (prev != null) {
    const d = value - prev;
    if (d === 0) change = "the same as the 30 days before";
    else if (prev > 0 && Math.abs(d) / prev >= 0.1 && prev >= 20) change = `${d > 0 ? "up" : "down"} ${Math.round((Math.abs(d) / prev) * 100)}% on the 30 days before`;
    else change = `${d > 0 ? "up" : "down"} ${n(Math.abs(d))} on the 30 days before`;
  }
  if (money && of) change = `of a ${dollars(of)} budget`;
  const pct = money && of ? Math.min(100, (value / of) * 100) : null;
  const body = (
    <>
      <span className="con-fig-label">{label}</span>
      <span className="con-fig-value">{money ? dollars(value) : n(value)}</span>
      {pct != null && (
        <span className={`con-fig-bar${pct >= 100 ? " full" : pct >= 80 ? " near" : ""}`} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {change && <span className="con-fig-change">{change}</span>}
    </>
  );
  return href ? (
    <Link className="con-fig" href={href}>
      {body}
    </Link>
  ) : (
    <div className="con-fig">{body}</div>
  );
}

export type Col<T> = { key: string; label: string; sort?: boolean; num?: boolean; render: (r: T) => React.ReactNode; className?: string };

/** A list as a table: sortable headings, the first column stays put when it scrolls sideways on a phone. */
export function Table<T>({ cols, rows, rowKey, sort, dir, onSort, empty, caption }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; sort?: string; dir?: string; onSort?: (key: string) => void; empty: string; caption: string }) {
  if (!rows.length) return <p className="con-empty">{empty}</p>;
  return (
    <div className="con-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="con-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {cols.map((c) => {
              const on = sort === c.key;
              return (
                <th key={c.key} scope="col" className={`${c.num ? "num" : ""} ${c.className ?? ""}`} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)}>
                      {c.label}
                      <span className="con-sort" aria-hidden="true">
                        {on ? (dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {cols.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" className={c.className} data-label={c.label}>
                    {c.render(r)}
                  </th>
                ) : (
                  <td key={c.key} className={`${c.num ? "num" : ""} ${c.className ?? ""}`} data-label={c.label}>
                    {c.render(r)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  if (total <= size) return total ? <p className="con-count">{n(total)} in all</p> : null;
  const last = Math.ceil(total / size) - 1;
  return (
    <nav className="con-pager" aria-label="Pages">
      <button className="btn secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        {n(page * size + 1)} to {n(Math.min(total, (page + 1) * size))} of {n(total)}
      </span>
      <button className="btn secondary" disabled={page >= last} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/** A search box that waits until you stop typing. */
export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onChange(v.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <div className="con-filter con-search-in">
      <label htmlFor={`s-${label}`}>{label}</label>
      <input id={`s-${label}`} type="search" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
    </div>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = `f-${label.replace(/\W+/g, "-")}`;
  return (
    <div className="con-filter">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The last 12 months, newest first, as filter choices. */
export function months(): [string, string][] {
  const out: [string, string][] = [["", "Any month"]];
  const d = new Date();
  for (let i = -2; i < 12; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push([m.toISOString().slice(0, 7), m.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" })]);
  }
  return out;
}

/** Export exactly what's on screen. Big ones are emailed. */
export function ExportButton({ what, params, label = "Export" }: { what: string; params: Record<string, string>; label?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setMsg(null);
    const qs = new URLSearchParams({ what, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) });
    const r = await fetch(`/api/console/export?${qs}`, { headers: { "x-console": "1" } }).catch(() => null);
    setBusy(false);
    if (!r) return setMsg("No signal. Try again.");
    if (r.status === 202) return setMsg("That's a big one. It's being made, and a link will be emailed to you.");
    if (!r.ok) return setMsg(String((await r.json().catch(() => ({}))).error ?? "Couldn't export that."));
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (r.headers.get("content-disposition") ?? "").match(/filename="([^"]+)"/)?.[1] ?? `${what}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return (
    <span className="con-export">
      <button className="btn secondary" onClick={go} disabled={busy}>
        {busy ? "Exporting…" : label}
      </button>
      {msg && (
        <span className="con-export-msg" role="status">
          {msg}
        </span>
      )}
    </span>
  );
}

export const STATUS_WORDS: Record<string, string> = { "setting up": "Setting up", "coming up": "Coming up", live: "Live", finished: "Finished" };
export function Status({ s }: { s: string }) {
  return <span className={`con-status s-${s.replace(/\s/g, "-")}`}>{STATUS_WORDS[s] ?? s}</span>;
}

export function Light({ light }: { light: "green" | "amber" | "red" | "idle" }) {
  const words = { green: "Working", amber: "Some failures", red: "Down", idle: "Not used yet" }[light];
  return (
    <span className={`con-light l-${light}`}>
      <span aria-hidden="true" />
      {words}
    </span>
  );
}
