"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Json } from "./kit";

/** The Email section's shared pieces: its tabs, its calls, the live preview and the words editor. */

export async function eapi<T = Json>(view: string, params: Record<string, string | number | undefined> = {}): Promise<{ ok: boolean; status: number; j: T & { error?: string } }> {
  const qs = new URLSearchParams({ view });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const r = await fetch(`/api/console/email?${qs}`, { cache: "no-store", headers: { "x-console": "1" } }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again." };
  return { ok: !!r?.ok, status: r?.status ?? 0, j };
}

export async function eact<T = Json>(body: Record<string, unknown>): Promise<{ ok: boolean; j: T & { error?: string } }> {
  const r = await fetch("/api/console/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "No signal. Try again." };
  return { ok: !!r?.ok, j };
}

export function useEmailView<T>(view: string, params: Record<string, string | number | undefined> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    const r = await eapi<T>(view, JSON.parse(key));
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

const TABS = [
  ["/console/email", "Every email"],
  ["/console/email/series", "Series"],
  ["/console/email/campaigns", "Campaigns"],
  ["/console/email/stopped", "Stopped addresses"],
] as const;

export function EmailTabs() {
  const path = usePathname();
  const on = (href: string) => (href === "/console/email" ? path === href || path.startsWith("/console/email/edit") : path.startsWith(href));
  return (
    <nav className="con-subtabs" aria-label="Email">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={on(href) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export const CAMPAIGN_STATUS: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", paused: "Paused", sent: "Sent", stopped: "Stopped" };

export const pct = (x: number) => (x === 0 ? "0%" : x < 0.001 ? "under 0.1%" : x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`);

export interface Stats {
  sent: number;
  clicked: number;
  bounced: number;
  complained: number;
  stopped: number;
}
export function statsLine(s: Stats | null | undefined) {
  if (!s || !s.sent) return "Not sent yet";
  const n = (x: number) => x.toLocaleString("en-IE");
  return `Sent ${n(s.sent)}, tapped ${n(s.clicked)} (${pct(s.clicked / s.sent)}), stopped emails ${n(s.stopped)}${s.bounced ? `, bounced ${n(s.bounced)}` : ""}${s.complained ? `, marked as spam ${n(s.complained)}` : ""}`;
}

/** An email as it will look: phone or computer, light or dark (the dark one is the email's own dark styles, forced on). */
export function Preview({ html, subject, err }: { html: string | null; subject?: string | null; err?: string | null }) {
  const [phone, setPhone] = useState(true);
  const [dark, setDark] = useState(false);
  const shown = html && dark ? html.replace("@media (prefers-color-scheme:dark){", "@media all{").replace("<html lang=\"en\">", "<html lang=\"en\" style=\"color-scheme:dark\">") : html;
  return (
    <div className="em-preview">
      <div className="em-modes" role="group" aria-label="How to show it">
        <button type="button" aria-pressed={phone} onClick={() => setPhone(true)}>
          Phone
        </button>
        <button type="button" aria-pressed={!phone} onClick={() => setPhone(false)}>
          Computer
        </button>
        <button type="button" aria-pressed={dark} onClick={() => setDark((v) => !v)}>
          Dark
        </button>
      </div>
      {subject && (
        <p className="em-subject">
          Subject: <strong>{subject}</strong>
        </p>
      )}
      {err && <p className="error">{err}</p>}
      <div className={`em-frame${phone ? " phone" : ""}`}>{shown ? <iframe title="Preview of the email" srcDoc={shown} sandbox="" /> : <p className="con-loading">Loading the preview…</p>}</div>
    </div>
  );
}

export interface Words {
  subject: string;
  headline: string;
  lines: string;
  button: string;
}

export interface EmailOne {
  key: string;
  name: string;
  about: string;
  group: string;
  fields: { subject: boolean; headline: boolean; lines: boolean; button: boolean };
  placeholders: string[];
  locked: string;
  words: Words & { version: number };
  versions: (Words & { version: number; saved_by: string; saved_at: string; restored_from: number | null })[];
  sent30: number;
  role: "owner" | "support";
}

const when = (d: string) => new Date(d).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

/** The words of one email on the left, the email itself on the right. Owners save; support previews and tests. */
export function WordsEditor({ data, onSaved }: { data: EmailOne; onSaved: () => void }) {
  const owner = data.role === "owner";
  const [w, setW] = useState<Words>({ subject: data.words.subject, headline: data.words.headline, lines: data.words.lines, button: data.words.button });
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [perr, setPerr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(w) !== JSON.stringify({ subject: data.words.subject, headline: data.words.headline, lines: data.words.lines, button: data.words.button });
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await eact<{ html: string; subject: string }>({ action: "preview", key: data.key, words: w });
      if (n !== seq.current) return;
      if (r.ok) {
        setPreview(r.j);
        setPerr(null);
      } else setPerr(String(r.j.error ?? "The preview didn't load"));
    }, 350);
    return () => clearTimeout(t);
  }, [w, data.key]);

  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    const r = await eact(body);
    setBusy(false);
    setMsg(r.ok ? { text: ok } : { text: String(r.j.error ?? "That didn't work"), bad: true });
    return r.ok;
  };

  const field = (k: keyof Words, label: string, area = false) =>
    data.fields[k] && (
      <div className="field">
        <label htmlFor={`w-${k}`}>{label}</label>
        {area ? (
          <textarea id={`w-${k}`} value={w[k]} readOnly={!owner} onChange={(e) => setW({ ...w, [k]: e.target.value })} />
        ) : (
          <input id={`w-${k}`} value={w[k]} readOnly={!owner} onChange={(e) => setW({ ...w, [k]: e.target.value })} maxLength={k === "button" ? 40 : 150} />
        )}
      </div>
    );

  return (
    <div className="em-edit">
      <div className="em-fields">
        {!owner && <p className="con-note" style={{ margin: 0 }}>Only the owner can change the words. You can preview it and send yourself a test.</p>}
        {field("subject", "Subject")}
        {field("headline", "Headline")}
        {field("lines", "Lines (a blank line starts a new paragraph)", true)}
        {field("button", "Button words")}
        {data.placeholders.length > 0 && (
          <p className="em-places">
            It can fill in{" "}
            {data.placeholders.map((p, i) => (
              <span key={p}>
                {i > 0 && " "}
                <code>{`{${p}}`}</code>
              </span>
            ))}
            . Typed exactly like that, braces and all.
          </p>
        )}
        <p className="em-locked">{data.locked}</p>
        <div className="em-acts">
          {owner && (
            <button className="btn" disabled={busy || !changed} onClick={async () => (await run({ action: "words.save", key: data.key, words: w }, "Saved. It's what goes out from now on.")) && onSaved()}>
              Save
            </button>
          )}
          <button className="btn secondary" disabled={busy} onClick={() => run({ action: "test", key: data.key, words: w }, "Sent to your email, marked Test.")}>
            Send me a test
          </button>
          {owner && changed && (
            <button className="btn secondary" disabled={busy} onClick={() => setW({ subject: data.words.subject, headline: data.words.headline, lines: data.words.lines, button: data.words.button })}>
              Undo my changes
            </button>
          )}
        </div>
        {msg && (
          <p className={msg.bad ? "error" : "con-ok"} role="status">
            {msg.text}
          </p>
        )}
      </div>
      <div>
        <Preview html={preview?.html ?? null} subject={preview?.subject} err={perr} />
        <section className="con-panel" style={{ marginTop: 14 }} aria-labelledby="h-versions">
          <h2 id="h-versions">Versions</h2>
          <p className="small" style={{ marginTop: 0 }}>
            {data.words.version ? `Version ${data.words.version}, changed by ${data.versions[0]?.saved_by ?? "you"} on ${when(data.versions[0]?.saved_at ?? "")}.` : "The starting words. Nothing changed yet."}
            {data.sent30 > 0 && ` Sent ${data.sent30.toLocaleString("en-IE")} times in the last 30 days.`}
          </p>
          {data.versions.length > 0 && (
            <details>
              <summary>See earlier versions and go back to one</summary>
              <ul className="em-versions">
                {data.versions.map((v, i) => (
                  <li key={v.version}>
                    <span>
                      Version {v.version}, {v.saved_by}, {when(v.saved_at)}
                      {v.restored_from !== null && v.restored_from !== undefined && ` (${v.restored_from === 0 ? "the starting words" : `went back to version ${v.restored_from}`})`}
                      {i === 0 && " (in use)"}
                    </span>
                    {owner && i > 0 && (
                      <button className="btn secondary" disabled={busy} onClick={async () => (await run({ action: "words.restore", key: data.key, version: v.version }, `Back to version ${v.version}, saved as a new version.`)) && onSaved()}>
                        Go back to this one
                      </button>
                    )}
                  </li>
                ))}
                {owner && (
                  <li>
                    <span>The starting words</span>
                    <button className="btn secondary" disabled={busy} onClick={async () => (await run({ action: "words.save", key: data.key, starting: true }, "Back to the starting words, saved as a new version.")) && onSaved()}>
                      Go back to these
                    </button>
                  </li>
                )}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

export interface EmailHealth {
  postmark?: { at: string; server: string | null; customUnsub: boolean } | null;
  settings?: { address: string; support: string | null };
  runs?: Record<string, unknown>;
  sending: string;
  month: { sent: number; all: number; bounced: number; complained: number; bounceRate: number; complaintRate: number };
  lines: { complaintsWarn: number; complaintsLimit: number; bouncesWarn: number; bouncesLimit: number };
}

export function HealthLine({ h }: { h: EmailHealth }) {
  const m = h.month;
  const c = m.complaintRate >= h.lines.complaintsLimit ? "con-warn" : m.complaintRate >= h.lines.complaintsWarn ? "con-warn" : "con-strong";
  const b = m.bounceRate >= h.lines.bouncesWarn ? "con-warn" : "con-strong";
  return (
    <p className="em-health" role="status">
      <span>
        This month: <strong>{m.all.toLocaleString("en-IE")}</strong> sent
      </span>
      <span>
        Bounced <strong className={b}>{pct(m.bounceRate)}</strong> (keep under 2%)
      </span>
      <span>
        Marked as spam <strong className={c}>{pct(m.complaintRate)}</strong> (Gmail&apos;s limit is 0.3%; keep under 0.1%)
      </span>
    </p>
  );
}

