"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { recentTournaments, type Recent } from "@/lib/recent";

/** "Your tournaments on this phone": for the golfer who's lost the link. Nothing shows on a phone that has none. */
export function RecentTournaments() {
  const [list, setList] = useState<Recent[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setList(recentTournaments()), 0);
    return () => clearTimeout(t);
  }, []);
  if (!list.length) return null;
  return (
    <section className="fr-recent" aria-label="Your tournaments on this phone">
      <h2>Your tournaments on this phone</h2>
      <div className="fr-recent-list">
        {list.map((r) => (
          <Link key={r.slug} href={`/t/${r.slug}`} className="fr-recent-item">
            <span className="fr-recent-name">{r.name}</span>
            <span className="fr-recent-go">Open</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
