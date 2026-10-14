import type { Metadata } from "next";
import { BrandShell } from "@/components/front/BrandShell";
import { FindTournament } from "@/components/front/FindTournament";

export const metadata: Metadata = { title: "Join my tournament" };

export default function Join() {
  return (
    <BrandShell>
      <h1>Join my tournament</h1>
      <p className="fr-lead">
        Got a link from your organiser? Just tap it: it signs you straight in. Otherwise, find your tournament by its name.
      </p>
      <FindTournament />
    </BrandShell>
  );
}
