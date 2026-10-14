"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Hit {
  slug: string;
  name: string;
  subtitle: string | null;
  start_date: string | null;
}

const when = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Type part of the name, tap it: on to that tournament's "playing, organising or following" page. */
export function FindTournament() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      const t = setTimeout(() => setHits(null), 0);
      return () => clearTimeout(t);
    }
    let stop = false;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch(`/api/tournaments?q=${encodeURIComponent(term)}`)
        .then((x) => x.json())
        .catch(() => null);
      if (stop) return;
      setBusy(false);
      setHits(r?.tournaments ?? []);
    }, 300);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="fr-find">
      <label htmlFor="fr-q" className="fr-label">
        The tournament&apos;s name
      </label>
      <input id="fr-q" className="fr-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. October Special" autoComplete="off" enterKeyHint="search" />
      {busy && !hits && <p className="fr-quiet">Looking…</p>}
      {hits && hits.length === 0 && (
        <p className="fr-quiet">
          Nothing by that name. Check the spelling, or ask your organiser to send you the link. A tournament shows here once its organiser has made it public.
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="fr-hits">
          {hits.map((h) => (
            <li key={h.slug}>
              <Link href={`/t/${h.slug}/login`} className="fr-hit">
                <strong>{h.name}</strong>
                <span>{[h.subtitle, when(h.start_date)].filter(Boolean).join(". ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
