"use client";

import { useEffect, useState } from "react";
import { useT } from "./Providers";
import { flushClips, pendingClips } from "@/lib/trimmer";
import { flushPosts, queuedPosts } from "@/lib/postQueue";

/** Sends clips saved on this phone whenever there's signal, and shows how many are waiting. */
export function ClipQueue() {
  const { slug, refresh } = useT();
  const [waiting, setWaiting] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const count = async () => alive && setWaiting((await pendingClips(slug)).length + queuedPosts(slug).length);
    const flush = async () => {
      if (queuedPosts(slug).length) await flushPosts(slug);
      if (!(await pendingClips(slug)).length) return count();
      const r = await flushClips(slug);
      if (!alive) return;
      setWaiting(r.left + queuedPosts(slug).length);
      setErr(r.error ?? null);
      refresh();
    };
    flush();
    const t = setInterval(flush, 20000);
    window.addEventListener("online", flush);
    window.addEventListener("os-clip-queue", count);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("online", flush);
      window.removeEventListener("os-clip-queue", count);
    };
  }, [slug, refresh]);

  if (!waiting && !err) return null;
  return (
    <div className="queue-banner" role="status">
      {waiting > 0 && `${waiting === 1 ? "1 clip or note is" : `${waiting} clips and notes are`} waiting to send from this phone. Keep the site open; they go when there's signal.`}
      {err && <span> {err}</span>}
    </div>
  );
}
