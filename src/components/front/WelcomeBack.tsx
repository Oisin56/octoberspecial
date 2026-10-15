"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { recentTournaments, type Recent } from "@/lib/recent";

/** "Welcome back": the tournaments this phone has opened before, one tap each. Nothing shows for a first visit. */
export function WelcomeBack() {
  const [list, setList] = useState<Recent[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setList(recentTournaments().slice(0, 3)), 0);
    return () => clearTimeout(t);
  }, []);
  if (!list.length) return null;
  return (
    <nav className="bx-back" aria-label="Your tournaments on this phone">
      <span className="bx-back-hi">Welcome back</span>
      {list.map((r) => (
        <Link key={r.slug} href={`/t/${r.slug}`} className="bx-back-link">
          {r.name}
        </Link>
      ))}
    </nav>
  );
}
