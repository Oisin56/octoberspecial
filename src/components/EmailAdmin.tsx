"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "./Providers";
import { timeAgo } from "./ui";

export interface Subscriber {
  id: string;
  name: string | null;
  email: string;
  added_by: string;
  created_at: string;
  unsubscribed_at: string | null;
}

export function useSubscribers() {
  const { api } = useT();
  const [list, setList] = useState<Subscriber[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const load = useCallback(async () => {
    const r = await api("/api/admin", { action: "subscribers" });
    if (r.ok) {
      setList(r.j.subscribers as Subscriber[]);
      setConfigured(!!r.j.configured);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  return { list, configured, load, active: (list ?? []).filter((s) => !s.unsubscribed_at).length };
}

/** Admin → Email: who gets the previews and reports. */
export function EmailTab() {
  const { api, href } = useT();
  const { list, configured, load, active } = useSubscribers();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    const r = await api("/api/admin", { action: "addSubscribers", text });
    if (!r.ok) return setMsg(String(r.j.error ?? "Didn't save"));
    const invalid = (r.j.invalid as string[]) ?? [];
    setMsg(`Added ${r.j.added}.${invalid.length ? ` Couldn't read: ${invalid.join(", ")}` : ""}`);
    setText(invalid.join("\n"));
    load();
  }
  async function remove(id: string) {
    await api("/api/admin", { action: "removeSubscriber", id });
    load();
  }

  return (
    <div className="stack">
      {!configured && (
        <p className="notice">
          Email isn&apos;t switched on yet. Add <code>SMTP_USER</code> (your iCloud address) and <code>SMTP_PASS</code> (an app-specific password) in Vercel, then
          redeploy. SETUP.md has the steps. People can still sign up meanwhile.
        </p>
      )}
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Email list · {active} subscribed</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Previews, reports and the tournament review go to everyone here when you publish them with <strong>Email it</strong> ticked. Live bulletins are never
          emailed. Followers can sign up on the <a href={href("/")}>home page</a>, and every email has an unsubscribe link.
        </p>
        <label className="field">
          <span className="lbl">Add people (one per line: email, or Name &lt;email&gt;)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 90 }} placeholder={"Clodagh <clodagh@example.com>\nfionn@example.com"} />
        </label>
        <div className="row">
          <button className="btn" disabled={!text.trim()} onClick={add}>
            Add to the list
          </button>
          {msg && <span className="display">{msg}</span>}
        </div>
      </section>
      <section className="stack">
        {list === null && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="muted">Nobody yet.</p>}
        {list?.map((s) => (
          <div key={s.id} className="post row" style={{ justifyContent: "space-between" }}>
            <span style={{ overflowWrap: "anywhere" }}>
              <strong>{s.name ?? s.email}</strong>
              {s.name ? ` · ${s.email}` : ""}
              <span className="small muted">
                {" "}
                · {s.added_by === "organiser" ? "added by you" : "signed up"} {timeAgo(s.created_at)}
                {s.unsubscribed_at ? " · unsubscribed" : ""}
              </span>
            </span>
            <button className="chip" onClick={() => remove(s.id)}>
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Home page: follower signs up for the previews and reports. */
export function EmailSignup() {
  const { api } = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const r = await api("/api/subscribe", { name, email, website });
    setState(r.ok ? "done" : String(r.j.error ?? "That didn't work"));
  }
  if (state === "done")
    return (
      <section className="panel">
        <p className="display" style={{ margin: 0, fontSize: 18 }}>
          You&apos;re on the list. The previews and reports will land in your inbox.
        </p>
      </section>
    );
  return (
    <form className="panel stack email-signup" onSubmit={go}>
      <h2 style={{ margin: 0 }}>Get the previews and reports by email</h2>
      <div className="row">
        <label className="field" style={{ flex: "1 1 140px" }}>
          <span className="lbl">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field" style={{ flex: "2 1 220px" }}>
          <span className="lbl">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
      </div>
      <input value={website} onChange={(e) => setWebsite(e.target.value)} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
      <div className="row">
        <button className="btn" disabled={state === "busy"}>
          {state === "busy" ? "Signing up…" : "Sign me up"}
        </button>
        <span className="small muted">About two emails a round day. Unsubscribe any time.</span>
      </div>
      {state !== "idle" && state !== "busy" && <p className="error" style={{ margin: 0 }}>{state}</p>}
    </form>
  );
}
