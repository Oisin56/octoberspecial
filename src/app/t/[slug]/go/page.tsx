"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { landingPath } from "@/lib/landing";

/** Where the home-screen app opens: each person's own starting page (see landingPath). */
export default function Go() {
  const { state, session, sessionReady, href } = useT();
  const router = useRouter();
  useEffect(() => {
    if (!state || !sessionReady) return;
    router.replace(href(landingPath(state, session)));
  }, [state, session, sessionReady, href, router]);
  return <Loading />;
}
