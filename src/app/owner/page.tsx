"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { useRouter } from "next/navigation";
import { BRAND_SLOTS, MAX_TRACKS, dollars, type BrandSlot, type Shape } from "@/lib/film";
import { mediaSeconds, uploadBlob } from "@/lib/upload";

interface Films {
  brand: Partial<Record<BrandSlot, Partial<Record<Shape, { path: string; sec: number; src: string } | null>>>>;
  music: { id: string; name: string; mood: string; sec: number; src: string }[];
  limits: { monthlyCents: number; perTournament: number };
  spend: { cents: number; films: number };
}

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

interface Invite {
  id: string;
  name: string;
  email: string;
  about: string | null;
  status: "new" | "approved" | "declined";
  approved_at: string | null;
  used_at: string | null;
  created_at: string;
}

const day = (d: string) => new Date(d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

/** The site owner's page: every tournament, open any as organiser, keep a copy, delete. */
export default function OwnerPage() {
  const router = useRouter();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [films, setFilms] = useState<Films | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [demo, setDemo] = useState<string | null>(null);
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
    setFilms(j.films ?? null);
    setInvites(j.invites ?? []);
    setDemo(j.demo ?? null);
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
            {BRAND.name}
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
            <Invites invites={invites} post={post} reload={load} />
            <h2>Tournaments</h2>
            <p className="small">
              The example on the front page: <strong>{demo ? rows.find((r) => r.slug === demo)?.name ?? demo : "none yet (the tile says coming soon)"}</strong>. It can be looked at but not changed, except by you.
            </p>
            <div className="owner-list">
              {rows.map((t) => (
                <article className="owner-t" key={t.id}>
                  <div className="owner-h">
                    <Link href={`/t/${t.slug}`}>
                      <strong>{t.name}</strong>
                    </Link>
                    <span className={`owner-pub${t.published ? " on" : ""}`}>{t.published ? "Public" : "Not public yet"}</span>
                    {demo === t.slug && <span className="owner-pub on">Front page example</span>}
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
                      className="btn secondary"
                      disabled={!!busy}
                      onClick={async () => {
                        const r = await post({ action: "setDemo", slug: demo === t.slug ? null : t.slug });
                        if (!r.ok) setErr(String(r.j.error ?? "Didn't save"));
                        load();
                      }}
                    >
                      {demo === t.slug ? "Stop using as the example" : "Use as the front page example"}
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
            {films && <FilmSettings films={films} post={post} reload={load} />}
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

/** Requests to run a tournament while it's invitation-only: approve (emails them a link) or decline. */
function Invites({ invites, post, reload }: { invites: Invite[]; post: Post; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const waiting = invites.filter((i) => i.status === "new");
  const rest = invites.filter((i) => i.status !== "new").slice(0, 20);
  async function act(i: Invite, action: "approveInvite" | "declineInvite") {
    setBusy(i.id);
    setMsg(null);
    const r = await post({ action, inviteId: i.id });
    setBusy(null);
    setMsg(r.ok ? (action === "approveInvite" ? `Invite emailed to ${i.email}` : "Declined") : String(r.j.error ?? "Didn't work"));
    reload();
  }
  return (
    <section className="owner-invites" aria-label="Invite requests">
      <h2>Invite requests {waiting.length ? <span className="owner-count">{waiting.length} waiting</span> : null}</h2>
      {msg && <p className="notice">{msg}</p>}
      {!invites.length && <p className="small">None yet. People ask from the front page.</p>}
      {waiting.map((i) => (
        <article className="owner-t" key={i.id}>
          <div className="owner-h">
            <strong>{i.name}</strong>
            <span className="owner-meta">{i.email}</span>
          </div>
          {i.about && <p className="owner-about">{i.about}</p>}
          <p className="owner-meta">Asked {day(i.created_at)}</p>
          <div className="owner-acts">
            <button className="btn" disabled={!!busy} onClick={() => act(i, "approveInvite")}>
              {busy === i.id ? "Sending…" : "Approve and email the link"}
            </button>
            <button className="btn secondary" disabled={!!busy} onClick={() => act(i, "declineInvite")}>
              Decline
            </button>
          </div>
        </article>
      ))}
      {rest.length > 0 && (
        <details className="owner-earlier">
          <summary>Earlier requests</summary>
          <ul>
            {rest.map((i) => (
              <li key={i.id}>
                <strong>{i.name}</strong> ({i.email}): {i.used_at ? "set up a tournament" : i.status === "approved" ? `invited ${day(i.approved_at ?? i.created_at)}` : "declined"}
                {i.status === "approved" && !i.used_at && (
                  <>
                    {" "}
                    <button className="linklike" disabled={!!busy} onClick={() => act(i, "approveInvite")}>
                      Send the link again
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

type Post = (body: Record<string, unknown>) => Promise<{ ok: boolean; j: Record<string, unknown> & { error?: string } }>;

/** Films across the site: what they cost, the brand pack every film opens and closes with, the music. */
function FilmSettings({ films, post, reload }: { films: Films; post: Post; reload: () => void }) {
  const [monthly, setMonthly] = useState(String(films.limits.monthlyCents / 100));
  const [per, setPer] = useState(String(films.limits.perTournament));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mood, setMood] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const say = (r: { ok: boolean; j: { error?: string } }, ok: string) => {
    setMsg(r.ok ? ok : String(r.j.error ?? "That didn't work"));
    if (r.ok) reload();
  };
  async function brand(slot: BrandSlot, shape: Shape, f: File | null) {
    setBusy(`${slot}-${shape}`);
    setMsg(null);
    try {
      if (!f) return say(await post({ action: "setBrand", slot, shape, path: null }), "Removed");
      const sec = await mediaSeconds(f, "video");
      const path = await uploadBlob(f, { contentType: f.type || "video/mp4", filename: f.name });
      say(await post({ action: "setBrand", slot, shape, path, sec }), "Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }
  async function addTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy("track");
    setMsg(null);
    try {
      const sec = await mediaSeconds(file, "audio");
      const path = await uploadBlob(file, { contentType: file.type || "audio/mpeg", filename: file.name });
      const r = await post({ action: "addTrack", path, sec, name, mood });
      say(r, "Track added");
      if (r.ok) {
        setName("");
        setMood("");
        setFile(null);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }
  const used = films.limits.monthlyCents ? Math.min(100, Math.round((films.spend.cents / films.limits.monthlyCents) * 100)) : 100;

  return (
    <section className="owner-films stack">
      <h2>Films</h2>
      {msg && <p className={/saved|added|removed/i.test(msg) ? "notice" : "error"}>{msg}</p>}

      <div className="panel stack">
        <h3>Spending</h3>
        <p>
          This month: <strong>{dollars(films.spend.cents)}</strong> of {dollars(films.limits.monthlyCents)} across the whole site, {films.spend.films} film{films.spend.films === 1 ? "" : "s"}. These are estimates from the services&apos; prices.
        </p>
        <div className="owner-meter" role="img" aria-label={`${used}% of this month's film budget used`}>
          <span style={{ width: `${used}%` }} />
        </div>
        <div className="row owner-limits">
          <label className="field">
            <span>Monthly limit, all tournaments ($)</span>
            <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </label>
          <label className="field">
            <span>Films each tournament can make</span>
            <input inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} />
          </label>
        </div>
        <button className="btn" disabled={!!busy} onClick={async () => say(await post({ action: "setLimits", monthlyDollars: Number(monthly), perTournament: Number(per) }), "Saved")}>
          Save the limits
        </button>
      </div>

      <div className="panel stack">
        <h3>Brand pack</h3>
        <p className="small">Short MP4 clips with their own sound. Upload both shapes: upright for films made for phones, wide for YouTube and TV.</p>
        <div className="owner-brand">
          {BRAND_SLOTS.map((slot) => (
            <div key={slot.id} className="owner-slot">
              <strong>{slot.name}</strong>
              <small>{slot.note}</small>
              {(["portrait", "landscape"] as Shape[]).map((shape) => {
                const c = films.brand[slot.id]?.[shape];
                return (
                  <div key={shape} className="owner-clip">
                    <span>{shape === "portrait" ? "Upright" : "Wide"}</span>
                    {c ? (
                      <>
                        <a href={c.src} target="_blank" rel="noreferrer">
                          Watch ({c.sec.toFixed(1)}s)
                        </a>
                        <button className="linklike" disabled={!!busy} onClick={() => brand(slot.id, shape, null)}>
                          Remove
                        </button>
                      </>
                    ) : null}
                    <label className={`btn secondary small-btn${busy === `${slot.id}-${shape}` ? " busy" : ""}`}>
                      {busy === `${slot.id}-${shape}` ? "Uploading…" : c ? "Replace" : "Upload"}
                      <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden disabled={!!busy} onChange={(e) => e.target.files?.[0] && brand(slot.id, shape, e.target.files[0])} />
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <h3>Music</h3>
        <p className="small">Up to {MAX_TRACKS} tracks for organisers to choose from. Use music licensed for people to post on YouTube, Instagram and Facebook (not registered with YouTube&apos;s Content ID), at least 4 minutes long if you can.</p>
        {films.music.length ? (
          <ul className="owner-tracks">
            {films.music.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.mood ? `${m.mood} · ` : ""}
                    {Math.floor(m.sec / 60)}:{String(Math.round(m.sec % 60)).padStart(2, "0")}
                  </small>
                </div>
                <audio src={m.src} controls preload="none" />
                <button className="linklike" disabled={!!busy} onClick={async () => say(await post({ action: "removeTrack", trackId: m.id }), "Removed")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No tracks yet. Until there are, films are made without music.</p>
        )}
        {films.music.length < MAX_TRACKS && (
          <form className="stack" onSubmit={addTrack}>
            <div className="row owner-limits">
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunday charge" />
              </label>
              <label className="field">
                <span>Mood (optional)</span>
                <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Epic, building" />
              </label>
            </div>
            <input type="file" accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button className="btn" disabled={!file || !name.trim() || !!busy}>
              {busy === "track" ? "Uploading…" : "Add the track"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
