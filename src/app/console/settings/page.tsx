"use client";

import { useCallback, useEffect, useState } from "react";
import { useConsole } from "@/components/console/Shell";
import { FilmSettings, Library, MailCheck, type Films, type LibraryRow, type Mail } from "@/components/console/OwnerTools";
import { Loading, PageHead, Problem, act, api, day, useView } from "@/components/console/kit";

interface Settings {
  staff: { email: string; added_by: string; added_at: string; removed_at: string | null }[];
  consoleEmail: string | null;
  ownerEmail: string | null;
}
interface OwnerData {
  films?: Films;
  mail?: Mail;
  library?: LibraryRow[];
  demo?: string | null;
  demoName?: string | null;
  error?: string;
}

const post = (b: Record<string, unknown>) => act(b, "/api/owner");

export default function SettingsPage() {
  const { user } = useConsole();
  const { data, err, reload } = useView<Settings>("settings");
  const [tools, setTools] = useState<OwnerData | null>(null);
  const loadTools = useCallback(async () => {
    const r = await fetch("/api/owner", { cache: "no-store" }).then((x) => x.json()).catch(() => ({ error: "Couldn't load" }));
    setTools(r);
  }, []);
  useEffect(() => {
    const t = setTimeout(loadTools, 0);
    return () => clearTimeout(t);
  }, [loadTools]);

  if (user.role !== "owner") return <Problem err="Only the owner can change settings." />;
  if (err) return <Problem err={err} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead title="Settings" />
      <ConsoleEmail data={data} onSaved={reload} />
      <Staff data={data} onSaved={reload} />
      <Example name={tools?.demoName ?? null} slug={tools?.demo ?? null} onSaved={loadTools} />
      {tools?.mail && <MailCheck mail={tools.mail} post={post} />}
      {tools?.films && <FilmSettings films={tools.films} post={post} reload={loadTools} />}
      {tools?.library && <Library rows={tools.library} />}
    </>
  );
}

function ConsoleEmail({ data, onSaved }: { data: Settings; onSaved: () => void }) {
  const [email, setEmail] = useState(data.consoleEmail ?? "");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  return (
    <form
      className="con-panel con-form"
      aria-labelledby="h-ce"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act({ action: "settings.console-email", email });
        setMsg(r.ok ? { text: "Saved." } : { text: String(r.j.error ?? "Didn't save"), bad: true });
        if (r.ok) onSaved();
      }}
    >
      <h2 id="h-ce">The console&apos;s email</h2>
      <p className="small">The 7am summary (every day, weekends too), red alerts and invite requests go here, so they stay out of your main inbox. Until one is set, they go to {data.ownerEmail ?? "the owner's email"}.</p>
      <div className="con-form-row">
        <div className="field">
          <label htmlFor="ce">Send them to</label>
          <input id="ce" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={data.ownerEmail ?? ""} />
        </div>
        <button className="btn">Save</button>
      </div>
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
    </form>
  );
}

function Staff({ data, onSaved }: { data: Settings; onSaved: () => void }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const active = data.staff.filter((s) => !s.removed_at);
  const past = data.staff.filter((s) => s.removed_at);
  return (
    <section className="con-panel" aria-labelledby="h-staff">
      <h2 id="h-staff">Support staff</h2>
      <p className="small">
        Support see everything and work through Needs you. They can&apos;t see money, export people&apos;s details, delete anything or change settings. They sign in at mygolfbroadcast.com/console with their own email and the same
        second check as you. Someone removed is out on their next click.
      </p>
      {active.length === 0 ? (
        <p className="con-calm">Nobody yet.</p>
      ) : (
        <ul className="con-rows plain">
          {active.map((s) => (
            <li key={s.email}>
              <span>
                {s.email}
                <small>Added {day(s.added_at)}</small>
              </span>
              <button
                className="btn secondary"
                onClick={async () => {
                  const r = await act({ action: "settings.staff-remove", email: s.email });
                  setMsg(r.ok ? { text: `${s.email} is removed.` } : { text: String(r.j.error ?? "Didn't work"), bad: true });
                  onSaved();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="con-form-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act({ action: "settings.staff-add", email });
          setMsg(r.ok ? { text: `${email} can sign in to the console now.` } : { text: String(r.j.error ?? "Didn't work"), bad: true });
          if (r.ok) {
            setEmail("");
            onSaved();
          }
        }}
      >
        <div className="field">
          <label htmlFor="staff-email">Add someone by email</label>
          <input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <button className="btn">Add them</button>
      </form>
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
      {past.length > 0 && <p className="small con-quiet">Removed before: {past.map((s) => `${s.email} (${day(s.removed_at)})`).join(", ")}.</p>}
    </section>
  );
}

/** The example tournament on the front page: found by name. */
function Example({ name, slug, onSaved }: { name: string | null; slug: string | null; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ slug: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await api<{ tournaments: { slug: string; name: string }[] }>("search", { q });
      if (r.ok) setHits(r.j.tournaments);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const pick = async (s: string | null) => {
    const r = await post({ action: "setDemo", slug: s });
    setMsg(r.ok ? { text: s ? "Saved: it's the example now." : "No example now: the tile says coming soon." } : { text: String(r.j.error ?? "Didn't save"), bad: true });
    setQ("");
    setHits([]);
    onSaved();
  };
  return (
    <section className="con-panel" aria-labelledby="h-demo">
      <h2 id="h-demo">The example on the front page</h2>
      <p>
        {slug ? (
          <>
            It&apos;s <strong>{name ?? slug}</strong>. It can be looked at but not changed, except by you.{" "}
            <button type="button" className="linklike" onClick={() => pick(null)}>
              Stop using it
            </button>
          </>
        ) : (
          "None yet: the tile says coming soon."
        )}
      </p>
      <div className="field">
        <label htmlFor="demo-q">Use another: type its name</label>
        <input id="demo-q" type="search" value={q} onChange={(e) => (setQ(e.target.value), e.target.value.trim().length < 2 && setHits([]))} autoComplete="off" />
      </div>
      {hits.length > 0 && (
        <ul className="con-rows plain">
          {hits.map((h) => (
            <li key={h.slug}>
              <span>{h.name}</span>
              <button className="btn secondary" onClick={() => pick(h.slug)}>
                Use this one
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={msg.bad ? "error" : "con-ok"}>{msg.text}</p>}
    </section>
  );
}
