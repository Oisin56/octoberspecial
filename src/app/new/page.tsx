"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function NewTournament() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [organiserPin, setOrganiserPin] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, subtitle, organiserPin, ownerPin }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Couldn't create the tournament");
    router.push(`/t/${j.slug}/setup`);
  }

  return (
    <div className="theme-root" data-theme="clubhouse">
      <header className="site-head">
        <div className="wrap" style={{ padding: "22px 16px" }}>
          <Link href="/" className="site-title">
            MyGolfSpecial
          </Link>
        </div>
      </header>
      <main className="wrap">
        <form className="panel stack" style={{ maxWidth: 520 }} onSubmit={create}>
          <h1>Create a tournament</h1>
          <div className="field">
            <label htmlFor="n">Name</label>
            <input id="n" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. The Lads' Cup 2027" />
          </div>
          <div className="field">
            <label htmlFor="s">Strapline (optional)</label>
            <input id="s" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Three days, two teams, one trophy" />
          </div>
          <div className="field">
            <label htmlFor="o">Your organiser PIN</label>
            <input id="o" value={organiserPin} onChange={(e) => setOrganiserPin(e.target.value)} inputMode="numeric" required placeholder="4–8 digits. You'll use it to run the tournament." />
          </div>
          <div className="field">
            <label htmlFor="w">Site owner PIN</label>
            <input id="w" value={ownerPin} onChange={(e) => setOwnerPin(e.target.value)} inputMode="numeric" placeholder="Needed while new tournaments are invite-only" />
          </div>
          {err && <p className="error">{err}</p>}
          <button className="btn" disabled={busy}>
            {busy ? "Creating…" : "Create and start setup"}
          </button>
        </form>
      </main>
    </div>
  );
}
