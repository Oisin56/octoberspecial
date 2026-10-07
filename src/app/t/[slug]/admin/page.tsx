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
  ResetTestData,
  RoundsEditor,
  SideGamesEditor,
  useAdmin,
  type AdminData,
} from "@/components/editors";
import { ReelBuilder } from "@/components/ReelBuilder";
import { DirectorPanel } from "@/components/DirectorPanel";
import { EmailTab, useSubscribers } from "@/components/EmailAdmin";
import type { AiPieceRow } from "@/lib/types";

const TABS = [
  ["rounds", "Rounds"],
  ["players", "Players and teams"],
  ["writing", "AI writing"],
  ["email", "Email list"],
  ["moderate", "Moderate"],
  ["reel", "Highlights film"],
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
      {tab === "email" && <EmailTab />}
      {tab === "moderate" && <Moderate data={data} onSaved={reload} />}
      {tab === "reel" && (
        <>
          <DirectorPanel />
          <ReelBuilder />
        </>
      )}
      {tab === "sides" && <SideGamesEditor data={data} onSaved={reload} />}
      {tab === "look" && <BasicsEditor data={data} onSaved={reload} />}
      {tab === "content" && <ContentEditor data={data} onSaved={reload} />}
      {tab === "invite" && (
        <>
          <InviteEditor data={data} onSaved={reload} />
          <ResetTestData onSaved={reload} />
        </>
      )}
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

  async function gen(kind: AiPieceRow["kind"], whole = false) {
    setBusy(whole ? `${kind}-whole` : kind);
    setMsg(null);
    const r = await api("/api/admin", { action: "aiGenerate", kind, roundId: kind === "tournament" || whole ? null : roundId, extra });
    setBusy(null);
    setMsg(r.ok ? "Draft ready below. Read it, edit if needed, then publish." : String(r.j.error ?? "Failed"));
    if (r.ok) onSaved();
  }

  const subs = useSubscribers();
  const pieces = data.state.pieces.filter((p) => p.status !== "hidden" || p.body !== "(writing…)").filter((p) => p.round_id === roundId || !p.round_id);

  return (
    <div className="stack">
      <section className="panel stack">
        <label className="field">
          <span className="lbl">Round</span>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
            {data.state.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                R{r.number} {r.course_name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="lbl">Steer for the writer (optional)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. mention Neil's new driver" />
        </label>
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
          <button className="btn secondary" disabled={!!busy} onClick={() => gen("preview", true)}>
            {busy === "preview-whole" ? "Writing (up to a minute)…" : "Write tournament preview"}
          </button>
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
        <PieceEditor key={p.id} piece={p} onSaved={onSaved} subscribers={subs.active} mail={subs.configured} />
      ))}
    </div>
  );
}

function PieceEditor({ piece, onSaved, subscribers, mail }: { piece: AiPieceRow; onSaved: () => void; subscribers: number; mail: boolean }) {
  const { api } = useT();
  const [title, setTitle] = useState(piece.title ?? "");
  const [body, setBody] = useState(piece.body);
  const [msg, setMsg] = useState<string | null>(null);
  const emailable = piece.kind !== "bulletin" && mail;
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  async function upd(status?: AiPieceRow["status"]) {
    setBusy(true);
    const r = await api("/api/admin", { action: "aiUpdate", id: piece.id, title, body, status, email: emailable && email && subscribers > 0 });
    setBusy(false);
    const sent = r.j.emailed != null ? ` and emailed to ${r.j.emailed}${r.j.failed ? ` (${r.j.failed} failed)` : ""}` : r.j.emailError ? `, but the email failed: ${r.j.emailError}` : "";
    setMsg(r.ok ? (status === "published" ? `Published${sent}` : status === "hidden" ? "Hidden" : "Saved") : String(r.j.error ?? "Failed"));
    if (r.ok) onSaved();
  }
  async function mailNow(test: boolean) {
    if (!test && !confirm(`Email this to ${subscribers} subscriber${subscribers === 1 ? "" : "s"}?`)) return;
    setBusy(true);
    await api("/api/admin", { action: "aiUpdate", id: piece.id, title, body }); // send the text on screen
    const r = await api("/api/admin", { action: "emailPiece", id: piece.id, test });
    setBusy(false);
    setMsg(r.ok ? (test ? "Test sent to you" : `Emailed to ${r.j.sent}`) : String(r.j.error ?? "Failed"));
    if (r.ok && !test) onSaved();
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
          <button className="btn" disabled={busy} onClick={() => upd("published")}>
            {busy ? "Publishing…" : emailable && email && subscribers > 0 ? "Publish and email" : "Publish"}
          </button>
        )}
        {emailable && piece.status !== "published" && (
          <label className="row small">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} style={{ width: 18, height: 18 }} />
            Email it to {subscribers} subscriber{subscribers === 1 ? "" : "s"}
          </label>
        )}
        {emailable && (
          <button className="btn secondary" disabled={busy} onClick={() => mailNow(true)}>
            Send me a test
          </button>
        )}
        {emailable && piece.status === "published" && !piece.emailed_at && subscribers > 0 && (
          <button className="btn secondary" disabled={busy} onClick={() => mailNow(false)}>
            Email it now
          </button>
        )}
        {piece.emailed_at && <span className="small muted">Emailed to {piece.emailed_count ?? 0} {timeAgo(piece.emailed_at)}</span>}
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
