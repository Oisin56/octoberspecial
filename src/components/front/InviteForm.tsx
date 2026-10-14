"use client";

import Link from "next/link";
import { useState } from "react";

export function InviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "request", name, email, about }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setErr(j.error ?? "Couldn't send that just now. Check the signal and try again.");
    setSent(true);
  }

  if (sent)
    return (
      <div className="fr-done" role="status">
        <h2>Thanks, {name.split(" ")[0]}</h2>
        <p>We&apos;ll email {email} when your invite is ready.</p>
        <Link href="/" className="btn mgs-btn-dark">
          Back to the front page
        </Link>
      </div>
    );

  return (
    <form className="fr-form" onSubmit={send}>
      <div className="fr-field">
        <label htmlFor="iv-name" className="fr-label">
          Your name
        </label>
        <input id="iv-name" className="fr-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </div>
      <div className="fr-field">
        <label htmlFor="iv-email" className="fr-label">
          Your email
        </label>
        <input id="iv-email" className="fr-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div className="fr-field">
        <label htmlFor="iv-about" className="fr-label">
          About your event <span className="fr-quiet">(if you like)</span>
        </label>
        <textarea id="iv-about" className="fr-input" rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. 8 of us, three rounds in Kerry next May" maxLength={600} />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn mgs-btn-dark block" disabled={busy}>
        {busy ? "Sending…" : "Request my invite"}
      </button>
      <p className="fr-quiet">
        We only use your email to send your invite. See <Link href="/privacy">privacy</Link>.
      </p>
    </form>
  );
}
