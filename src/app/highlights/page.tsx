"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { mediaUrl } from "@/lib/supabase";

function Reel() {
  const { state } = useT();
  const sp = useSearchParams();
  const roundFilter = sp.get("round");
  const [i, setI] = useState(0);
  const ref = useRef<HTMLVideoElement>(null);

  const clips = useMemo(() => {
    if (!state) return [];
    const num = (id: string | null) => state.rounds.find((r) => r.id === id)?.number ?? 99;
    return state.posts
      .filter((p) => p.kind === "video" && p.media_path)
      .filter((p) => !roundFilter || String(num(p.round_id)) === roundFilter)
      .sort(
        (a, b) =>
          num(a.round_id) - num(b.round_id) ||
          (a.hole ?? 0) - (b.hole ?? 0) ||
          a.created_at.localeCompare(b.created_at),
      );
  }, [state, roundFilter]);

  useEffect(() => {
    ref.current?.load();
  }, [i]);

  if (!state) return <Loading />;
  if (!clips.length)
    return (
      <>
        <h1>Highlights</h1>
        <p className="muted">No clips yet. Videos posted from the course appear here in round and hole order.</p>
      </>
    );

  const cur = clips[Math.min(i, clips.length - 1)];
  const round = state.rounds.find((r) => r.id === cur.round_id);

  return (
    <>
      <h1 style={{ marginBottom: 8 }}>Highlights{roundFilter ? `: Round ${roundFilter}` : ""}</h1>
      <div className="board" style={{ padding: 10 }}>
        <div className="board-title" style={{ marginBottom: 6 }}>
          {round ? `R${round.number} ${round.course_name}` : ""} {cur.hole ? `· Hole ${cur.hole}` : ""} · {cur.author_name} ·{" "}
          {i + 1} of {clips.length}
        </div>
        <video
          ref={ref}
          src={mediaUrl(cur.media_path)!}
          controls
          playsInline
          autoPlay
          onEnded={() => setI((x) => (x + 1 < clips.length ? x + 1 : x))}
          style={{ width: "100%", maxHeight: "70vh", background: "#000", borderRadius: 6, display: "block" }}
        />
        {cur.body && <p style={{ color: "var(--tile)", margin: "8px 0 0" }}>{cur.body}</p>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
            Previous
          </button>
          <button className="btn secondary" onClick={() => setI((x) => Math.min(clips.length - 1, x + 1))} disabled={i >= clips.length - 1}>
            Next
          </button>
        </div>
      </div>
      <h2 className="section" style={{ marginBottom: 8 }}>
        All clips
      </h2>
      <ol className="feed" style={{ listStyle: "none", padding: 0 }}>
        {clips.map((c, k) => {
          const r = state.rounds.find((x) => x.id === c.round_id);
          return (
            <li key={c.id}>
              <button
                className="post"
                style={{ width: "100%", textAlign: "left", cursor: "pointer", borderColor: k === i ? "var(--board)" : undefined }}
                onClick={() => setI(k)}
              >
                <span className="where display">
                  {r ? `R${r.number}` : ""} {c.hole ? `· Hole ${c.hole}` : ""}
                </span>{" "}
                <span className="muted">{c.author_name}</span>
                {c.body ? ` — ${c.body}` : ""}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default function Highlights() {
  return (
    <Suspense fallback={<Loading />}>
      <Reel />
    </Suspense>
  );
}
