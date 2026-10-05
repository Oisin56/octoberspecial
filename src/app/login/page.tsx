"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";

type Mode = "player" | "contributor" | "organiser";

function LoginInner() {
  const { state, session, reloadSession } = useT();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [mode, setMode] = useState<Mode>("player");
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, pin, playerId, name }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Couldn't log in. Check the PIN and try again.");
    await reloadSession();
    router.push(next);
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    await reloadSession();
  }

  if (session)
    return (
      <div className="panel" style={{ maxWidth: 460 }}>
        <h1>Logged in</h1>
        <p>
          You&apos;re logged in as <strong>{session.name}</strong> ({session.role}).
        </p>
        <button className="btn secondary" onClick={logout}>
          Log out
        </button>
      </div>
    );

  return (
    <form className="panel stack" style={{ maxWidth: 460 }} onSubmit={submit}>
      <h1>Log in</h1>
      <p className="muted small" style={{ margin: 0 }}>
        Following from home? You don&apos;t need to log in. This is for players and anyone walking the course with
        them.
      </p>
      <div className="row" role="group" aria-label="I am">
        {(
          [
            ["player", "Player"],
            ["contributor", "Caddie or friend"],
            ["organiser", "Organiser"],
          ] as const
        ).map(([m, label]) => (
          <button type="button" key={m} className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {mode === "player" && (
        <div className="field">
          <label htmlFor="pl">Who are you?</label>
          <select id="pl" value={playerId} onChange={(e) => setPlayerId(e.target.value)} required>
            <option value="">Choose…</option>
            {state?.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === "contributor" && (
        <div className="field">
          <label htmlFor="nm">Your name</label>
          <input id="nm" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </div>
      )}
      <div className="field">
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn" disabled={busy}>
        Log in
      </button>
    </form>
  );
}

export default function Login() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
