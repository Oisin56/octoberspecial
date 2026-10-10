"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { ReelFeed, feedItems } from "@/components/ReelFeed";

/** Highlights: every film and clip as a phone-style video feed. */
function Feed() {
  const { state, api, refresh, href } = useT();
  const sp = useSearchParams();
  const round = sp.get("round");
  const start = sp.get("v");
  const items = useMemo(() => (state ? feedItems(state, round) : []), [state, round]);
  if (!state) return <Loading />;
  return <ReelFeed items={items} state={state} tournamentName={state.tournament.name} backHref={href("/")} api={api} refresh={refresh} startId={start} />;
}

export default function Highlights() {
  return (
    <Suspense fallback={<Loading />}>
      <Feed />
    </Suspense>
  );
}
