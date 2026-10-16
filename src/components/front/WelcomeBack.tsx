"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { recentTournaments, type Recent } from "@/lib/recent";

/**
 * The header's one link: "Sign in", or for a phone that has opened a tournament before, straight back to it.
 */
export function HeaderLink() {
  const [last, setLast] = useState<Recent | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setLast(recentTournaments()[0] ?? null), 0);
    return () => clearTimeout(t);
  }, []);
  if (last)
    return (
      <Link href={`/t/${last.slug}`} className="bx-bar-link">
        Back to {last.name}
      </Link>
    );
  return (
    <Link href="/account" className="bx-bar-link">
      Sign in
    </Link>
  );
}
