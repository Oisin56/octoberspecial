"use client";

import { useT } from "@/components/Providers";
import { Loading, RoundItem } from "@/components/ui";

export default function Rounds() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;
  return (
    <>
      <h1 style={{ marginBottom: 14 }}>The rounds</h1>
      <div className="round-list">
        {state.rounds.map((r, i) => (
          <RoundItem key={r.id} round={r} rs={summary.rounds[i]} />
        ))}
      </div>
    </>
  );
}
