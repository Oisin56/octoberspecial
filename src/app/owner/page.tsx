"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Row {
  id: string;
  slug: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  published: boolean;
  created_at: string;
  players: number;
  rounds: number;
  posts: number;
}

const day = (d: string) => new Date(d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

/** The site owner's page: every tournament, open any as organiser, keep a copy, delete. */
export default function OwnerPage() {
  const router = useRouter();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/owner").then((r) => r.json()).catch(() => ({ owner: false }));
    setOwner(!!j.owner);
    setRows(j.tournaments ?? []);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const post = (body: Record<string, unknown>) =>
    fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));

  async function signin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await post({ action: "signin", pin });
    if (!r.ok) return setErr(r.j.error ?? "That didn't work");
    load();
  }

  async function open(t: Row) {
    setBusy(`open-${t.id}`);
    const r = await post({ action: "open", id: t.id });
    setBusy(null);
    if (r.ok) router.push(`/t/${r.j.slug}/admin`);
  }

  async function exportCopy(t: Row) {
    setBusy(`export-${t.id}`);
    const r = await post({ action: "export", id: t.id });
    setBusy(null);
    if (!r.ok) return setErr(r.j.error ?? "Couldn't make the copy");
    const blob = new Blob([JSON.stringify(r.j, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t.slug}-copy-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function remove() {
    if (!del) return;
    setBusy(`delete-${del.id}`);
    setErr(null);
    const r = await post({ action: "delete", id: del.id, name: typed });
    setBusy(null);
    if (!r.ok) return setErr(r.j.error ?? "Couldn't delete it");
    setDone(`${del.name} is deleted${r.j.files ? `, with its ${r.j.files} files` : ""}.`);
    setDel(null);
    setTyped("");
    load();
  }

  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="site-head">
        <div className="wrap" style={{ padding: "18px 16px" }}>
          <Link href="/" className="site-title">
            MyGolfSpecial
          </Link>
        </div>
      </header>
      <main className="wrap owner">
        <h1>Site owner</h1>
        {owner === false && (
          <form className="panel stack" style={{ maxWidth: 460 }} onSubmit={signin}>
            <p className="lead">Every tournament on the site, for the site owner only.</p>
            <div className="field">
              <label htmlFor="opin">Site owner PIN</label>
              <input id="opin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" autoComplete="off" autoFocus />
            </div>
            {err && <p className="error">{err}</p>}
            <button className="btn block big">Sign in</button>
          </form>
        )}
        {owner && (
          <>
            <p className="lead">
              {rows.length} tournament{rows.length === 1 ? "" : "s"}.{" "}
              <Link href="/new">Start a new one</Link>
            </p>
            {done && <p className="notice">{done}</p>}
            {err && !del && <p className="error">{err}</p>}
            <div className="owner-list">
              {rows.map((t) => (
                <article className="owner-t" key={t.id}>
                  <div className="owner-h">
                    <Link href={`/t/${t.slug}`}>
                      <strong>{t.name}</strong>
                    </Link>
                    <span className={`owner-pub${t.published ? " on" : ""}`}>{t.published ? "Public" : "Not public yet"}</span>
                  </div>
                  <p className="owner-meta">
                    {t.start_date ? (t.end_date && t.end_date !== t.start_date ? `${day(t.start_date)} to ${day(t.end_date)}` : day(t.start_date)) : "No dates yet"} · {t.players} player{t.players === 1 ? "" : "s"} · {t.rounds} round
                    {t.rounds === 1 ? "" : "s"} · {t.posts} post{t.posts === 1 ? "" : "s"} · made {day(t.created_at)}
                  </p>
                  <div className="owner-acts">
                    <button className="btn" onClick={() => open(t)} disabled={!!busy}>
                      {busy === `open-${t.id}` ? "Opening…" : "Open as organiser"}
                    </button>
                    <button className="btn secondary" onClick={() => exportCopy(t)} disabled={!!busy}>
                      {busy === `export-${t.id}` ? "Making the copy…" : "Download a copy"}
                    </button>
                    <button
                      className="btn secondary owner-del"
                      onClick={() => {
                        setDel(t);
                        setTyped("");
                        setErr(null);
                        setDone(null);
                      }}
                      disabled={!!busy}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

      {del && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-labelledby="del-h" onClick={(e) => e.target === e.currentTarget && setDel(null)}>
          <div className="sheet-card stack">
            <h2 id="del-h">Delete {del.name}?</h2>
            <p>
              This deletes the tournament and everything in it: {del.players} players, {del.rounds} rounds, every score, post, photo, clip, film and report. Everyone&apos;s links stop working.{" "}
              <strong>It can&apos;t be undone.</strong>
            </p>
            <p className="small">
              Want to keep a record?{" "}
              <button type="button" className="linklike" onClick={() => exportCopy(del)}>
                Download a copy first
              </button>
              .
            </p>
            <div className="field">
              <label htmlFor="del-name">Type its name to confirm: {del.name}</label>
              <input id="del-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
            {err && <p className="error">{err}</p>}
            <button className="btn danger block big" disabled={typed.trim().toLowerCase() !== del.name.trim().toLowerCase() || !!busy} onClick={remove}>
              {busy ? "Deleting…" : "Delete it for good"}
            </button>
            <button className="btn secondary block" onClick={() => setDel(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
