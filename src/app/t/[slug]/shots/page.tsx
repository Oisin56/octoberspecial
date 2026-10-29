"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { AddDetail } from "@/components/AddDetail";
import { groupPlayers } from "@/lib/courseCards";
import { readScorePos, writeScorePos } from "@/lib/scorePos";

/** Add detail for anyone in the group, on the group's latest hole (the Detail button on the bar). */
function ShotsInner() {
  const { state, session, slug, href } = useT();
  const sp = useSearchParams();
  const round = useMemo(() => {
    if (!state) return null;
    const n = sp.get("round");
    return (n && state.rounds.find((r) => r.number === Number(n))) || state.rounds.find((r) => r.status === "live") || null;
  }, [state, sp]);
  const pos = round ? readScorePos(slug, round.id) : null;
  const posGame = pos?.game ?? null;
  const posHole = pos?.hole ?? null;
  const players = useMemo(() => (state && round ? groupPlayers(state, round.id, posGame, session?.playerId) : []), [state, round, posGame, session?.playerId]);
  const startHole = useMemo(() => {
    const q = Number(sp.get("hole"));
    const nums = round?.holes.map((x) => x.number) ?? [];
    if (nums.includes(q)) return q;
    if (posHole && nums.includes(posHole)) return posHole;
    // the latest hole the group has scores for
    const ids = new Set(players.map((p) => p.id));
    const done = (state?.entries ?? []).filter((e) => e.round_id === round?.id && Object.keys(e.scores).some((b) => ids.has(b))).map((e) => e.hole);
    return done.length ? Math.max(...done) : (nums[0] ?? 1);
  }, [sp, posHole, players, state, round]);
  const [hole, setHole] = useState<number | null>(null);
  const router = useRouter();
  const h = hole ?? startHole;

  if (!state) return <Loading />;
  const toCard = () => router.push(href("/score"));
  if (!session || session.role === "fan")
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/shots"))}`)}>Sign in</Link> to log shots.
      </p>
    );
  if (!round) return <p>No round is being played.</p>;
  // The round's own holes (1 to 18, or a nine)
  const nums = round.holes.map((x) => x.number).sort((a, b) => a - b);
  const nextNo = nums.find((n) => n > h) ?? null;

  return (
    <AddDetail
      key={h}
      roundId={round.id}
      roundNumber={round.number}
      hole={h}
      gameId={posGame}
      players={players}
      nextLabel={nextNo != null ? `On to hole ${nextNo}` : "Done"}
      onNext={() => (nextNo != null ? setHole(nextNo) : toCard())}
      onBack={toCard}
      onLeave={() => pos?.game && writeScorePos(slug, round.id, { game: pos.game, hole: pos.hole })}
    />
  );
}

export default function ShotsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShotsInner />
    </Suspense>
  );
}
