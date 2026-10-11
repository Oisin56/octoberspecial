"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";

/** The link in a fan's email lands here: one tap and they're signed in, then on to the feed. */
function JoinInner() {
  const { api, reloadSession, href } = useT();
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    (async () => {
      const r = await api("/api/fans", { action: "verify", token });
      if (!r.ok) return setErr(String(r.j.error ?? "That link didn't work. Ask for a new one from the feed."));
      await reloadSession();
      try {
        sessionStorage.setItem("mgs_flash", r.j.crew ? "You're already logged in on this phone" : `You're in, ${String(r.j.name ?? "").split(" ")[0]}. Say hello.`);
      } catch {}
      router.replace(href("/feed"));
    })();
  }, [api, token, reloadSession, router, href]);

  if (!err) return <Loading />;
  return (
    <div className="panel stack" style={{ maxWidth: 480 }}>
      <h1>That link didn&apos;t work</h1>
      <p>{err}</p>
      <Link className="btn block" href={href("/feed")}>
        Go to the feed
      </Link>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<Loading />}>
      <JoinInner />
    </Suspense>
  );
}
