"use client";

import { useEffect, useState } from "react";
import { useT } from "./Providers";
import { flushClips, pendingClips } from "@/lib/trimmer";
import { flushPosts, queuedPosts } from "@/lib/postQueue";
import { flushShots, pendingShots } from "@/lib/shotQueue";

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
      if (pendingShots(slug).length && (await flushShots(slug)) === 0) refresh();
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

  // Broadcast clips are made when their hole is finished: while any are due or rendering, an open page nudges
  // the server now and then (no timers needed on the server)
  const { state, api } = useT();
  const posts = state?.posts;
  useEffect(() => {
    const need = () =>
      (posts ?? []).some(
        (p) => p.kind === "video" && p.visibility === "public" && (p.broadcast_status === "rendering" || (p.broadcast_status == null && Date.now() - new Date(p.created_at).getTime() < 6 * 3600e3)),
      );
    const tick = () => {
      if (document.visibilityState === "visible" && need()) api("/api/broadcast", { action: "sweep" }).catch(() => {});
    };
    const first = setTimeout(tick, 5000);
    const t = setInterval(tick, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [posts, api]);

  if (!waiting && !err) return null;
  return (
    <div className="queue-banner" role="status">
      {waiting > 0 && `${waiting === 1 ? "1 clip or note is" : `${waiting} clips and notes are`} waiting to send from this phone. Keep the site open; they go when there's signal.`}
      {err && <span> {err}</span>}
    </div>
  );
}
