"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading, timeAgo } from "@/components/ui";
import {
  BasicsEditor,
  ContentEditor,
  InviteEditor,
  PlayersEditor,
  RoundsEditor,
  SideGamesEditor,
  useAdmin,
  type AdminData,
} from "@/components/editors";
import { ReelBuilder } from "@/components/ReelBuilder";
import type { AiPieceRow } from "@/lib/types";

const TABS = [
  ["rounds", "Rounds"],
  ["players", "Players and teams"],
  ["writing", "AI writing"],
  ["moderate", "Moderate"],
  ["reel", "Highlights reel"],
  ["sides", "Side games"],
  ["look", "Look"],
  ["content", "Writing style"],
  ["invite", "PINs and sharing"],
] as const;

export default function Admin() {
  const { session, href } = useT();
  const { data, err, reload } = useAdmin();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("rounds");

  if (!session)
    return (
      <p>
        <Link href={href(`/login?next=${encodeURIComponent(href("/admin"))}`)}>Log in</Link> as organiser.
      </p>
    );
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data) return <Loading />;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Organiser</h1>
        <Link className="btn secondary" href={href("/setup")}>
          Step-by-step setup
        </Link>
      </div>
      {!data.env.ai && <p className="notice">ANTHROPIC_API_KEY isn&apos;t set in Vercel, so the AI writing is switched off.</p>}
      <div className="row" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" className="chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "rounds" && <RoundsEditor data={data} onSaved={reload} />}
      {tab === "players" && <PlayersEditor data={data} onSaved={reload} />}
      {tab === "writing" && <Writing data={data} onSaved={reload} />}
      {tab === "moderate" && <Moderate data={data} onSaved={reload} />}
      {tab === "reel" && <ReelBuilder />}
      {tab === "sides" && <SideGamesEditor data={data} onSaved={reload} />}
      {tab === "look" && <BasicsEditor data={data} onSaved={reload} />}
      {tab === "content" && <ContentEditor data={data} onSaved={reload} />}
      {tab === "invite" && <InviteEditor data={data} onSaved={reload} />}
    </div>
  );
}

// ------------------------------------------------------------ writing

function Writing({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { api } = useT();
  const [roundId, setRoundId] = useState(
    data.state.rounds.find((r) => r.status === "live")?.id ?? data.state.rounds.find((r) => r.status === "upcoming")?.id ?? data.state.rounds[0]?.id,
  );
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function gen(kind: AiPieceRow["kind"]) {
    setBusy(kind);
    setMsg(null);
    const r = await api("/api/admin", { action: "aiGenerate", kind, roundId: kind === "tournament" ? null : roundId, extra });
    setBusy(null);
    setMsg(r.ok ? "Draft ready below. Read it, edit if needed, then publish." : String(r.j.error ?? "Failed"));
    if (r.ok) onSaved();
  }

  const pieces = data.state.pieces.filter((p) => p.status !== "hidden" || p.body !== "(writing…)").filter((p) => p.round_id === roundId || (p.kind === "tournament" && !p.round_id));

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="field">
          <label>Round</label>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {data.state.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.number} {r.course_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Steer for the writer (optional)</label>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. mention Neil's new driver" />
        </div>
        <div className="row">
          {(
            [
              ["preview", "Write preview"],
              ["bulletin", "Write bulletin"],
              ["report", "Write report"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className="btn" disabled={!!busy || !roundId} onClick={() => gen(k)}>
              {busy === k ? "Writing…" : label}
            </button>
          ))}
          <button className="btn secondary" disabled={!!busy} onClick={() => gen("tournament")}>
            {busy === "tournament" ? "Writing…" : "Write tournament review"}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Live bulletins publish themselves at key moments (birdies, the turn, swings in a match). A report draft is written when a round finishes. Writing takes 10–30 seconds.
        </p>
        {msg && <p className="display">{msg}</p>}
      </section>
      {pieces.map((p) => (
        <PieceEditor key={p.id} piece={p} onSaved={onSaved} />
      ))}
    </div>
  );
}

function PieceEditor({ piece, onSaved }: { piece: AiPieceRow; onSaved: () => void }) {
  const { api } = useT();
  const [title, setTitle] = useState(piece.title ?? "");
  const [body, setBody] = useState(piece.body);
  const [msg, setMsg] = useState<string | null>(null);
  async function upd(status?: AiPieceRow["status"]) {
    const r = await api("/api/admin", { action: "aiUpdate", id: piece.id, title, body, status });
    setMsg(r.ok ? (status === "published" ? "Published" : status === "hidden" ? "Hidden" : "Saved") : String(r.j.error ?? "Failed"));
    if (r.ok) onSaved();
  }
  return (
    <section className="panel stack">
      <div className="display">
        <span className={`pill ${piece.status === "published" ? "done" : ""}`}>{piece.status}</span> {piece.kind} · {timeAgo(piece.created_at)}
        {piece.trigger ? ` · ${piece.trigger}` : ""}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 220 }} aria-label="Text" />
      <div className="row">
        {piece.status !== "published" && (
          <button className="btn" onClick={() => upd("published")}>
            Publish
          </button>
        )}
        <button className="btn secondary" onClick={() => upd()}>
          Save edits
        </button>
        {piece.status !== "hidden" && (
          <button className="btn secondary" onClick={() => upd("hidden")}>
            Hide
          </button>
        )}
        {msg && <span className="display">{msg}</span>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ moderate

function Moderate({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const { api } = useT();
  async function hide(table: "posts" | "comments", id: string, hidden: boolean) {
    await api("/api/admin", { action: "hide", table, id, hidden });
    onSaved();
  }
  return (
    <div className="grid2">
      <section className="stack">
        <h2>Posts</h2>
        {data.state.posts.length === 0 && <p className="muted">No posts yet.</p>}
        {data.state.posts.map((p) => (
          <div key={p.id} className="post">
            <div className="who display">
              {p.author_name} · {p.hole ? `H${p.hole} · ` : ""}
              {timeAgo(p.created_at)} · {p.kind}
              {p.visibility === "report" && <span className="report-only"> · report only</span>}
              {p.hidden && <span className="error"> · hidden</span>}
            </div>
            {p.body && <p style={{ margin: "4px 0" }}>{p.body}</p>}
            <button className="chip" onClick={() => hide("posts", p.id, !p.hidden)}>
              {p.hidden ? "Show" : "Hide"}
            </button>
          </div>
        ))}
      </section>
      <section className="stack">
        <h2>Comments</h2>
        {data.state.comments.length === 0 && <p className="muted">No comments yet.</p>}
        {data.state.comments.map((c) => (
          <div key={c.id} className="post">
            <div className="who display">
              {c.author_name} · {timeAgo(c.created_at)}
              {c.hidden && <span className="error"> · hidden</span>}
            </div>
            <p style={{ margin: "4px 0" }}>{c.body}</p>
            <button className="chip" onClick={() => hide("comments", c.id, !c.hidden)}>
              {c.hidden ? "Show" : "Hide"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
