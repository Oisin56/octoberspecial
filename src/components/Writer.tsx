"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./Providers";
import { timeAgo } from "./ui";
import { useSubscribers } from "./EmailAdmin";
import type { AdminData } from "./editors";
import { TONE_LABEL, type AiPieceRow, type RoundRow, type Tone } from "@/lib/types";
import { cleanBody, cleanTitle } from "@/lib/cleanText";

type Kind = AiPieceRow["kind"];
type Length = "short" | "standard" | "long";

/** What the organiser picks from. "tpreview" is a preview with no round. */
export const WRITE_TYPES = [
  { id: "preview", name: "Round preview", note: "Before a round" },
  { id: "bulletin", name: "Live update", note: "The state of play" },
  { id: "report", name: "Round report", note: "After a round" },
  { id: "tpreview", name: "Tournament preview", note: "Before the trip" },
  { id: "tournament", name: "Tournament review", note: "When it's all over" },
] as const;
export type WriteType = (typeof WRITE_TYPES)[number]["id"];

const TONES = Object.keys(TONE_LABEL) as Tone[];
const toneName = (t: Tone) => TONE_LABEL[t].split(":")[0];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });

export function pieceLabel(p: AiPieceRow, rounds: RoundRow[]) {
  const r = rounds.find((x) => x.id === p.round_id);
  if (p.kind === "tournament") return "Tournament review";
  if (p.kind === "preview" && !r) return "Tournament preview";
  const k = p.kind === "preview" ? "preview" : p.kind === "report" ? "report" : "live update";
  return r ? `Round ${r.number} ${k}` : k;
}

export function Writer({ data, onSaved, start }: { data: AdminData; onSaved: () => void; start?: { type?: WriteType; roundId?: string } }) {
  const rounds = data.state.rounds;
  const subs = useSubscribers();
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");
  const [roundFilter, setRoundFilter] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const pieces = data.state.pieces
    .filter((p) => !(p.status === "hidden" && p.body === "(writing…)"))
    .filter((p) => (filter === "all" ? true : filter === "draft" ? p.status !== "published" : p.status === "published"))
    .filter((p) => !roundFilter || p.round_id === roundFilter);

  return (
    <div className="stack writer">
      {!data.env.ai && <p className="notice">The writer is switched off until ANTHROPIC_API_KEY is added in Vercel.</p>}
      <NewPiece
        data={data}
        start={start}
        onDone={(id) => {
          setFresh(id);
          setFilter("all");
          setRoundFilter("");
          onSaved();
        }}
      />

      <div className="writer-bar">
        <h2>Your pieces</h2>
        <div className="row">
          <div className="seg-group" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["draft", "Drafts"],
                ["published", "Published"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <select value={roundFilter} onChange={(e) => setRoundFilter(e.target.value)} aria-label="Round" className="compact-select">
            <option value="">All rounds</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                Round {r.number}
              </option>
            ))}
          </select>
        </div>
      </div>
      {pieces.length === 0 && <p className="muted">Nothing here yet. Pick something to write above.</p>}
      {pieces.map((p) => (
        <PieceCard key={p.id} piece={p} rounds={rounds} defaultTone={data.state.tournament.tone} subscribers={subs.active} mail={!!subs.configured} fresh={p.id === fresh} onSaved={onSaved} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ write something new

function NewPiece({ data, start, onDone }: { data: AdminData; start?: { type?: WriteType; roundId?: string }; onDone: (id: string) => void }) {
  const { api } = useT();
  const rounds = data.state.rounds;
  const guessRound = rounds.find((r) => r.status === "live")?.id ?? rounds.find((r) => r.status === "upcoming")?.id ?? rounds[0]?.id ?? "";
  const [type, setType] = useState<WriteType | null>(start?.type ?? null);
  const [roundId, setRoundId] = useState(start?.roundId ?? guessRound);
  const [tone, setTone] = useState<Tone>(data.state.tournament.tone);
  const [length, setLength] = useState<Length>("standard");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsRound = type === "preview" || type === "bulletin" || type === "report";

  async function write() {
    if (!type) return;
    setBusy(true);
    setErr(null);
    const kind: Kind = type === "tpreview" ? "preview" : type;
    const r = await api("/api/admin", { action: "aiGenerate", kind, roundId: needsRound ? roundId : null, tone, length, extra });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "That didn't work. Try again."));
    setType(null);
    setExtra("");
    onDone(String((r.j.piece as { id?: string })?.id ?? ""));
  }

  return (
    <section className="panel stack new-piece">
      <h2>Write something new</h2>
      <div className="type-grid" role="radiogroup" aria-label="What to write">
        {WRITE_TYPES.map((w) => (
          <button key={w.id} role="radio" aria-checked={type === w.id} className="type-card" onClick={() => setType(type === w.id ? null : w.id)}>
            <strong>{w.name}</strong>
            <span>{w.note}</span>
          </button>
        ))}
      </div>
      {type && (
        <div className="stack">
          {needsRound && (
            <label className="field">
              <span className="lbl">Round</span>
              <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    Round {r.number}, {r.course_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row two-up">
            <label className="field">
              <span className="lbl">Tone</span>
              <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {toneName(t)}
                    {t === data.state.tournament.tone ? " (usual)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="lbl">Length</span>
              <div className="seg-group wide" role="group" aria-label="Length">
                {(["short", "standard", "long"] as const).map((l) => (
                  <button key={l} aria-pressed={length === l} onClick={() => setLength(l)}>
                    {l[0].toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="field">
            <span className="lbl">Anything to mention? (optional)</span>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="A new driver, the forecast, last year's result" />
          </label>
          <div className="row">
            <button className="btn" disabled={busy || (needsRound && !roundId) || !data.env.ai} onClick={write}>
              {busy ? "Writing, about 20 seconds…" : "Write it"}
            </button>
            {err && <span className="error">{err}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ one piece

function PieceCard({
  piece,
  rounds,
  defaultTone,
  subscribers,
  mail,
  fresh,
  onSaved,
}: {
  piece: AiPieceRow;
  rounds: RoundRow[];
  defaultTone: Tone;
  subscribers: number;
  mail: boolean;
  fresh: boolean;
  onSaved: () => void;
}) {
  const { api } = useT();
  const [mode, setMode] = useState<"read" | "edit" | "rewrite">("read");
  const [open, setOpen] = useState(fresh);
  const [title, setTitle] = useState(cleanTitle(piece.title ?? ""));
  const [body, setBody] = useState(cleanBody(piece.body));
  const [tone, setTone] = useState<Tone>(piece.tone ?? defaultTone);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; undo?: boolean; error?: boolean } | null>(fresh ? { text: "Written. Have a read, then publish it." } : null);
  const ref = useRef<HTMLElement>(null);

  // keep the card in step with the server copy after rewrites and undo
  useEffect(() => {
    setTitle(cleanTitle(piece.title ?? ""));
    setBody(cleanBody(piece.body));
  }, [piece.title, piece.body]);
  useEffect(() => {
    if (fresh) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [fresh]);

  const emailable = piece.kind !== "bulletin" && mail;
  const canEmail = emailable && subscribers > 0;
  const people = `${subscribers} ${subscribers === 1 ? "person" : "people"}`;

  async function call(label: string, payload: Record<string, unknown>, done: string, undo = false) {
    setBusy(label);
    setMsg(null);
    const r = await api("/api/admin", { id: piece.id, ...payload });
    setBusy(null);
    if (!r.ok) {
      setMsg({ text: String(r.j.error ?? "That didn't work"), error: true });
      return null;
    }
    setMsg({ text: done, undo });
    onSaved();
    return r;
  }

  async function publish(withEmail: boolean) {
    const r = await call("publish", { action: "aiUpdate", title, body, status: "published", email: withEmail }, "Published");
    if (r && withEmail) {
      const n = r.j.emailed as number | undefined;
      const failed = n === 0 || !!r.j.emailError;
      const text =
        n === 0
          ? "Published, but the email didn't send. Check the email settings in Vercel, then use Email it."
          : n != null
            ? `Published and emailed to ${n}${r.j.failed ? ` (${r.j.failed} didn't send)` : ""}`
            : r.j.emailError
              ? `Published, but the email didn't send: ${r.j.emailError}`
              : "Published";
      setMsg({ text, error: failed });
    }
    setMode("read");
  }
  async function emailNow(again: boolean) {
    const q = again
      ? `This went to ${piece.emailed_count ?? 0} people on ${fmtDate(piece.emailed_at!)}. Send it to all ${people} again?`
      : `Email this to ${people}?`;
    if (!confirm(q)) return;
    if (mode === "edit") await api("/api/admin", { action: "aiUpdate", id: piece.id, title, body });
    const r = await call("email", { action: "emailPiece" }, "Sent");
    if (r) setMsg(r.j.sent ? { text: `Emailed to ${r.j.sent}` } : { text: "The email didn't send. Check the email settings in Vercel.", error: true });
  }
  async function rewrite(change?: "shorter" | "longer") {
    const r = await call(
      change ?? "rewrite",
      { action: "aiRewrite", tone, instruction: change ? undefined : instruction, change, title, body },
      change === "shorter" ? "Made shorter." : change === "longer" ? "Made longer." : "Rewritten.",
      true,
    );
    if (r) {
      setInstruction("");
      setMode("read");
      setOpen(true);
    }
  }

  const status =
    piece.status === "published"
      ? `Published ${piece.published_at ? timeAgo(piece.published_at) : ""}`.trim()
      : piece.status === "hidden"
        ? "Hidden from the site"
        : "Draft, not on the site yet";
  const emailed = piece.emailed_at ? `Emailed to ${piece.emailed_count ?? 0} on ${fmtDate(piece.emailed_at)}` : null;

  return (
    <article ref={ref} className={`panel piece${piece.status === "draft" ? " is-draft" : ""}`}>
      <div className="piece-head">
        <span className="piece-kind">{pieceLabel(piece, rounds)}</span>
        <span className="piece-status">
          {status}
          {emailed && <>. {emailed}</>}
        </span>
      </div>

      {mode === "edit" ? (
        <div className="stack">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Headline" className="headline-input" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Text" style={{ minHeight: 320 }} />
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={async () => (await call("save", { action: "aiUpdate", title, body }, "Saved")) && setMode("read")}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setTitle(cleanTitle(piece.title ?? ""));
                setBody(cleanBody(piece.body));
                setMode("read");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="piece-title">{title || "Untitled"}</h3>
          <div className={`piece-body${open ? " open" : ""}`}>
            {body
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
          <button className="text-btn" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Read it all"}
          </button>
        </>
      )}

      {mode === "rewrite" && (
        <div className="rewrite stack">
          <label className="field">
            <span className="lbl">What should change?</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              style={{ minHeight: 80 }}
              placeholder="Less about the weather, more about the putting. Mention the 7th."
            />
          </label>
          <label className="field">
            <span className="lbl">Tone</span>
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {toneName(t)}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => rewrite()}>
              {busy === "rewrite" ? "Rewriting, about 20 seconds…" : "Rewrite it"}
            </button>
            <button className="btn secondary" disabled={!!busy} onClick={() => rewrite("shorter")}>
              {busy === "shorter" ? "Shortening…" : "Shorter"}
            </button>
            <button className="btn secondary" disabled={!!busy} onClick={() => rewrite("longer")}>
              {busy === "longer" ? "Lengthening…" : "Longer"}
            </button>
            <button className="text-btn" onClick={() => setMode("read")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "read" && (
        <div className="piece-actions">
          {piece.status !== "published" && (
            <button className="btn" disabled={!!busy} onClick={() => publish(canEmail)}>
              {busy === "publish" ? "Publishing…" : canEmail ? "Publish and email" : "Publish"}
            </button>
          )}
          {piece.status === "published" && canEmail && !piece.emailed_at && (
            <button className="btn" disabled={!!busy} onClick={() => emailNow(false)}>
              {busy === "email" ? "Sending…" : `Email to ${people}`}
            </button>
          )}
          <button className="btn secondary" onClick={() => setMode("edit")}>
            Edit
          </button>
          <button className="btn secondary" onClick={() => setMode("rewrite")} disabled={!!busy}>
            Rewrite
          </button>
          <More>
            {piece.status !== "published" && canEmail && <button onClick={() => publish(false)}>Publish without emailing</button>}
            {emailable && <button onClick={() => call("test", { action: "emailPiece", test: true }, "Test sent to your inbox")}>Send me a test email</button>}
            {piece.status === "published" && canEmail && piece.emailed_at && <button onClick={() => emailNow(true)}>Email it again</button>}
            {piece.prev_body && <button onClick={() => call("undo", { action: "aiUndo" }, "Back to the earlier version")}>Undo last rewrite</button>}
            {piece.status === "hidden" ? (
              <button onClick={() => call("show", { action: "aiUpdate", status: "draft" }, "Back as a draft")}>Bring it back</button>
            ) : (
              <button onClick={() => call("hide", { action: "aiUpdate", status: "hidden" }, "Hidden from the site")}>Hide from the site</button>
            )}
            <button
              className="danger"
              onClick={() => {
                if (confirm("Delete this for good?")) call("delete", { action: "aiDelete" }, "Deleted");
              }}
            >
              Delete
            </button>
          </More>
        </div>
      )}

      {msg && (
        <p className={`piece-msg${msg.error ? " error" : ""}`} role="status">
          {msg.text}
          {msg.undo && piece.prev_body && (
            <>
              {" "}
              <button className="text-btn" onClick={() => call("undo", { action: "aiUndo" }, "Back to the earlier version")}>
                Undo
              </button>
            </>
          )}
        </p>
      )}
    </article>
  );
}

/** A quiet "More" menu that closes on outside click, Escape, or choosing something. */
function More({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="more" ref={ref}>
      <summary className="btn secondary">More</summary>
      <div
        className="more-menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) ref.current!.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
