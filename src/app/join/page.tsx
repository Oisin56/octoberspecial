import type { Metadata } from "next";
import Link from "next/link";
import { BrandShell } from "@/components/front/BrandShell";
import { RecentTournaments } from "@/components/front/Recent";

export const metadata: Metadata = { title: "Getting into your tournament" };

/**
 * There's no search: a tournament is seen only by people given its link. This page says how to get back in, and lists
 * the tournaments this phone has opened before.
 */
export default function Join() {
  return (
    <BrandShell>
      <h1>Getting into your tournament</h1>
      <p className="fr-lead">Tap the link your organiser sent you. It takes you straight in, and this phone remembers you.</p>
      <RecentTournaments />
      <p>
        Lost the link, or on a new phone? Ask your organiser to send it again. It&apos;s one tap for them, from their list of players.
      </p>
      <p className="fr-quiet">
        Running a tournament? <Link href="/account">Sign in</Link> to get back to it.
      </p>
    </BrandShell>
  );
}
