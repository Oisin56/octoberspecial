"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { ShotCard } from "@/components/ShotCard";
import { groupPlayers } from "@/lib/courseCards";
import { readScorePos, writeScorePos } from "@/lib/scorePos";
import type { HoleInfo } from "@/lib/shots";

/** The shot log for anyone in the group, on any hole (the Note button on the bar). Swipe between holes. */
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
  const h = hole ?? startHole;

  if (!state) return <Loading />;
  if (!session || session.role === "fan")
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/shots"))}`)}>Log in</Link> to log shots.
      </p>
    );
  if (!round) return <p>No round is being played.</p>;
  const hh = round.holes.find((x) => x.number === h)!;
  const info: HoleInfo = { par: hh.par, yards: hh.yards, note: round.course_guide?.holes?.[String(h)] ?? "" };
  // The round's own holes (1 to 18, or a nine)
  const nums = round.holes.map((x) => x.number).sort((a, b) => a - b);
  const nextNo = nums.find((n) => n > h) ?? null;
  const prevNo = [...nums].reverse().find((n) => n < h) ?? null;
  const go = (n: number | null) => n != null && setHole(n);

  return (
    <ShotCard
      key={h}
      roundId={round.id}
      roundNumber={round.number}
      hole={h}
      holeInfo={info}
      players={players}
      nextLabel={nextNo != null ? `Hole ${nextNo}` : "Done"}
      backLabel={prevNo != null ? `back to ${prevNo}` : undefined}
      onContinue={() => (nextNo != null ? go(nextNo) : history.back())}
      onBack={() => go(prevNo)}
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
