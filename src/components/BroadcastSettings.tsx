"use client";

import { useEffect, useState } from "react";
import { useT } from "./Providers";

interface Spend {
  cents: number;
  clips: number;
  capCents: number;
  on: boolean;
  configured: boolean;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The organiser's switch and monthly limit for broadcast clips, with what they've cost this month. */
export function BroadcastSettings() {
  const { api } = useT();
  const [s, setS] = useState<Spend | null>(null);
  const [cap, setCap] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api("/api/broadcast", { action: "spend" }).then((r) => {
      if (!r.ok) return setMsg(String(r.j.error ?? "Couldn't load"));
      setS(r.j as unknown as Spend);
      setCap(String(Math.round(Number(r.j.capCents) / 100)));
    });
  }, [api]);

  async function save(patch: { on?: boolean; capCents?: number }) {
    const r = await api("/api/broadcast", { action: "settings", ...patch });
    if (!r.ok) return setMsg(String(r.j.error ?? "Didn't save"));
    setS(r.j as unknown as Spend);
    setMsg("Saved");
  }

  if (!s) return <section className="panel">{msg ?? "Loading…"}</section>;
  const pct = s.capCents ? Math.min(100, (s.cents / s.capCents) * 100) : 100;
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Broadcast clips</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Every clip from the course is turned into a TV-style video once its hole is finished: upright for phones, the player and hole, a caption, the
        score, a slow-motion replay of the big moments and a one-second end card. The feed plays it and Share sends it. About 5 to 7 cents a clip.
      </p>
      {!s.configured && <p className="notice small">Switched off until SHOTSTACK_API_KEY is set in Vercel.</p>}
      <button type="button" className="cd-film-only" role="switch" aria-checked={s.on} onClick={() => save({ on: !s.on })}>
        <span className="box" aria-hidden="true">
          {s.on ? "✓" : ""}
        </span>
        <span>
          <strong>Make broadcast clips</strong>
          <small>{s.on ? "On: each clip is made once its hole is finished" : "Off: the feed shows the clips as filmed"}</small>
        </span>
      </button>
      <div className="bc-spend">
        <div className="bc-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p style={{ margin: 0 }}>
          This month: <strong>{dollars(s.cents)}</strong> of {dollars(s.capCents)}, {s.clips} clip{s.clips === 1 ? "" : "s"}.
          {s.cents >= s.capCents && " The limit is reached: new clips show as filmed until next month, or raise the limit."}
        </p>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="sf-field" style={{ maxWidth: 200 }}>
          <span>Monthly limit ($)</span>
          <input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <button className="btn" onClick={() => save({ capCents: Number(cap || 0) * 100 })}>
          Save the limit
        </button>
      </div>
      {msg && <p className="small muted" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}
