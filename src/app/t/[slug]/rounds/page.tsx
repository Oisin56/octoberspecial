"use client";

import { useT } from "@/components/Providers";
import { Loading, RoundItem } from "@/components/ui";

export default function Rounds() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;
  return (
    <>
      <h1 style={{ marginBottom: 14 }}>The rounds</h1>
      {state.rounds.length === 0 && <p className="muted">No rounds set up yet.</p>}
      <div className="round-grid">
        {state.rounds.map((r, i) => (
          <RoundItem key={r.id} round={r} index={i} />
        ))}
      </div>
    </>
  );
}
