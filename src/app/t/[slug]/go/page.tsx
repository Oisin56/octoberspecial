"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";

/** Where the home-screen app opens: the scorecard if a round is live and you're logged in, else the tournament home. */
export default function Go() {
  const { state, session, href } = useT();
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    const live = state.rounds.some((r) => r.status === "live");
    router.replace(href(live && session ? "/score" : "/"));
  }, [state, session, href, router]);
  return <Loading />;
}
