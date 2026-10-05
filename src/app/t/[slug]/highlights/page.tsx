"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/Providers";
import { Loading } from "@/components/ui";
import { mediaUrl } from "@/lib/supabase";
import { AWARDS, type PostRow } from "@/lib/types";

function voterId() {
  try {
    let v = localStorage.getItem("os_voter");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("os_voter", v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

function Reel() {
  const { state, api, refresh } = useT();
  const sp = useSearchParams();
  const roundFilter = sp.get("round");
  const [i, setI] = useState(0);
  const [myVotes, setMyVotes] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("os_my_votes") ?? "{}");
    } catch {
      return {};
    }
  });
  const ref = useRef<HTMLVideoElement>(null);

  const clips = useMemo(() => {
    if (!state) return [];
    const num = (id: string | null) => state.rounds.find((r) => r.id === id)?.number ?? 99;
    return state.posts
      .filter((p) => p.kind === "video" && p.media_path)
      .filter((p) => !roundFilter || String(num(p.round_id)) === roundFilter)
      .sort((a, b) => num(a.round_id) - num(b.round_id) || (a.hole ?? 0) - (b.hole ?? 0) || a.created_at.localeCompare(b.created_at));
  }, [state, roundFilter]);

  useEffect(() => {
    ref.current?.load();
  }, [i]);

  if (!state) return <Loading />;

  const media = state.posts.filter((p) => (p.kind === "video" || p.kind === "photo") && p.media_path);
  const tally = (award: string) => {
    const counts: Record<string, number> = {};
    for (const v of state.votes.filter((x) => x.award === award)) counts[v.post_id] = (counts[v.post_id] ?? 0) + 1;
    return counts;
  };

  async function vote(award: string, post: PostRow) {
    const r = await api("/api/votes", { award, postId: post.id, voter: voterId() });
    if (r.ok) {
      const next = { ...myVotes, [award]: post.id };
      setMyVotes(next);
      try {
        localStorage.setItem("os_my_votes", JSON.stringify(next));
      } catch {}
      refresh();
    }
  }

  const cur = clips[Math.min(i, clips.length - 1)];
  const round = cur && state.rounds.find((r) => r.id === cur.round_id);

  return (
    <>
      <h1 style={{ marginBottom: 8 }}>Highlights{roundFilter ? `: Round ${roundFilter}` : ""}</h1>
      {!cur ? (
        <p className="muted">No clips yet. Videos posted from the course appear here in round and hole order.</p>
      ) : (
        <div className="board" style={{ padding: 10 }}>
          <div className="board-title" style={{ marginBottom: 6 }}>
            {round ? `R${round.number} ${round.course_name}` : ""} {cur.hole ? `· Hole ${cur.hole}` : ""} · {cur.author_name} · {i + 1} of {clips.length}
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
      )}

      {media.length > 0 && (
        <section className="section">
          <h2 style={{ marginBottom: 6 }}>Awards</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            One vote per award on each phone. You can change your vote.
          </p>
          <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {AWARDS.map((a) => {
              const counts = tally(a.id);
              const ranked = [...media].sort((x, y) => (counts[y.id] ?? 0) - (counts[x.id] ?? 0));
              const leader = ranked[0] && counts[ranked[0].id] ? ranked[0] : null;
              return (
                <div key={a.id} className="panel stack">
                  <h3>{a.label}</h3>
                  <p className="display small muted" style={{ margin: 0 }}>
                    {leader ? `Leading: ${leader.author_name}'s ${leader.kind} from hole ${leader.hole ?? "–"} (${counts[leader.id]} vote${counts[leader.id] > 1 ? "s" : ""})` : "No votes yet"}
                  </p>
                  {ranked.slice(0, 12).map((p) => {
                    const r = state.rounds.find((x) => x.id === p.round_id);
                    const mine = myVotes[a.id] === p.id;
                    return (
                      <div key={p.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                        <span className="small">
                          <span className="where display">
                            {r ? `R${r.number}` : ""} {p.hole ? `H${p.hole}` : ""}
                          </span>{" "}
                          {p.body?.slice(0, 50) ?? p.kind} <span className="muted">· {counts[p.id] ?? 0}</span>
                        </span>
                        <button className="chip" aria-pressed={mine} onClick={() => vote(a.id, p)}>
                          {mine ? "Your vote" : "Vote"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {clips.length > 0 && (
        <>
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
                    style={{ width: "100%", textAlign: "left", cursor: "pointer", borderColor: k === i ? "var(--board)" : undefined, font: "inherit" }}
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
      )}
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
