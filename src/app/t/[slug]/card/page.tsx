"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { CardPanel } from "@/components/CardPanel";
import { toRoundCfg } from "@/lib/types";

/** One match's card: players sign it here on their own phone; anyone can see where it stands. */
function CardInner() {
  const { state, href } = useT();
  const sp = useSearchParams();
  const router = useRouter();
  if (!state) return <Loading />;
  const round = state.rounds.find((r) => r.number === Number(sp.get("round")));
  if (!round) return <p>Round not found.</p>;
  const cfg = toRoundCfg(round, state.players);
  const game = cfg.games.find((g) => g.id === sp.get("game")) ?? cfg.games[0];
  if (!game) return <p>Match not found.</p>;
  return (
    <div className="scorer">
      <CardPanel roundId={round.id} gameId={game.id} onDone={() => router.push(href("/live"))} />
    </div>
  );
}

export default function CardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CardInner />
    </Suspense>
  );
}
