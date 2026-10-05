"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Loading, timeAgo } from "@/components/ui";
import { COURSES } from "@/data/courses";
import type { AiPieceRow, PlayerRow, RoundRow, TournamentState } from "@/lib/types";
import { FORMAT_LABEL } from "@/lib/types";

interface AdminData {
  state: TournamentState;
  pinSet: Record<string, boolean>;
  env: { ai: boolean; contributorPin: boolean };
}

async function api(body: Record<string, unknown>) {
  const r = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Failed");
  return j;
}

export default function Admin() {
  const { session, refresh } = useT();
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"rounds" | "players" | "writing" | "moderate">("rounds");

  const load = useCallback(async () => {
    try {
      setData(await api({ action: "state" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    if (session?.role === "organiser") load();
  }, [session, load]);

  if (!session) return <p><Link href="/login?next=/admin">Log in</Link> as organiser.</p>;
  if (session.role !== "organiser") return <p>Organiser only.</p>;
  if (err) return <p className="error">{err}</p>;
  if (!data) return <Loading />;

  const reload = async () => {
    await load();
    refresh();
  };

  return (
    <div className="stack">
      <h1>Organiser</h1>
      {!data.env.ai && <p className="notice">ANTHROPIC_API_KEY isn&apos;t set in Vercel, so the AI writing is switched off.</p>}
      {!data.env.contributorPin && <p className="notice">CONTRIBUTOR_PIN isn&apos;t set, so caddies and friends can&apos;t log in to post.</p>}
      <div className="row">
        {(["rounds", "players", "writing", "moderate"] as const).map((t) => (
          <button key={t} className="chip" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === "rounds" ? "Rounds" : t === "players" ? "Players and PINs" : t === "writing" ? "AI writing" : "Moderate"}
          </button>
        ))}
      </div>
      {tab === "rounds" && data.state.rounds.map((r) => <RoundAdmin key={r.id} round={r} players={data.state.players} onSaved={reload} />)}
      {tab === "players" && data.state.players.map((p) => <PlayerAdmin key={p.id} player={p} pinSet={data.pinSet[p.id]} onSaved={reload} />)}
      {tab === "writing" && <Writing data={data} onSaved={reload} />}
      {tab === "moderate" && <Moderate data={data} onSaved={reload} />}
    </div>
  );
}

// ------------------------------------------------------------ rounds

function RoundAdmin({ round, players, onSaved }: { round: RoundRow; players: PlayerRow[]; onSaved: () => void }) {
  const course = COURSES.find((c) => c.slug === round.course_slug);
  const [f, setF] = useState({
    play_date: round.play_date ?? "",
    tee_time: round.tee_time ?? "",
    tee: round.tee ?? "",
    status: round.status,
    scorer_id: round.scorer_id ?? "",
    shots: { ...round.shots } as Record<string, number>,
  });
  const [holes, setHoles] = useState(round.holes);
  const [showCard, setShowCard] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    try {
      const siOk = [...holes.map((h) => h.si)].sort((a, b) => a - b).every((v, i) => v === i + 1);
      if (!siOk) throw new Error("Stroke indexes must be 1 to 18, each used once.");
      const patch: Record<string, unknown> = { ...f, scorer_id: f.scorer_id || null };
      if (showCard) patch.holes = holes;
      if (f.tee !== round.tee && !showCard) delete patch.holes;
      await api({ action: "updateRound", roundId: round.id, patch });
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="panel stack">
      <h2>
        R{round.number} {round.course_name}{" "}
        <span className="muted small display">
          {FORMAT_LABEL[round.format]} · {round.nine_points}/{round.nine_points}/{round.full_points}
        </span>
      </h2>
      <div className="row">
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label>Date</label>
          <input type="date" value={f.play_date} onChange={(e) => setF({ ...f, play_date: e.target.value })} />
        </div>
        <div className="field" style={{ flex: "1 1 100px" }}>
          <label>Tee time</label>
          <input value={f.tee_time} onChange={(e) => setF({ ...f, tee_time: e.target.value })} placeholder="10:30" />
        </div>
        <div className="field" style={{ flex: "1 1 120px" }}>
          <label>Tees</label>
          <select value={f.tee} onChange={(e) => setF({ ...f, tee: e.target.value })}>
            {Object.keys(course?.tees ?? {}).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 120px" }}>
          <label>Status</label>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RoundRow["status"] })}>
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="complete">Complete</option>
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 120px" }}>
          <label>Scorer</label>
          <select value={f.scorer_id} onChange={(e) => setF({ ...f, scorer_id: e.target.value })}>
            <option value="">Organiser only</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        {players.map((p) => (
          <div className="field" key={p.id} style={{ flex: "1 1 120px" }}>
            <label>{p.name} receives (shots)</label>
            <input
              type="number"
              min={0}
              max={36}
              inputMode="numeric"
              value={f.shots[p.id] ?? 0}
              onChange={(e) => setF({ ...f, shots: { ...f.shots, [p.id]: Math.max(0, Number(e.target.value) || 0) } })}
            />
          </div>
        ))}
        <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
          0 for both = flat. For a handicapped match, give the higher handicapper the difference.
        </p>
      </div>
      <button type="button" className="chip" aria-pressed={showCard} onClick={() => setShowCard(!showCard)}>
        {showCard ? "Hide card" : "Check par and stroke index"}
      </button>
      {showCard && (
        <div className="card-scroll">
          <table className="card">
            <thead>
              <tr>
                <th>Hole</th>
                {holes.map((h) => (
                  <th key={h.number}>{h.number}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["par", "si"] as const).map((k) => (
                <tr key={k}>
                  <td className="label">{k === "par" ? "Par" : "SI"}</td>
                  {holes.map((h, i) => (
                    <td key={h.number}>
                      <input
                        style={{ width: 40, padding: 4, textAlign: "center" }}
                        inputMode="numeric"
                        value={h[k]}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setHoles(holes.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button className="btn" onClick={save}>
          Save round {round.number}
        </button>
        <Link className="btn secondary" href={`/score?round=${round.number}`}>
          Score this round
        </Link>
        {msg && <span className="display">{msg}</span>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ players

function PlayerAdmin({ player, pinSet, onSaved }: { player: PlayerRow; pinSet: boolean; onSaved: () => void }) {
  const fields = [
    ["name", "Name"],
    ["nickname", "Nickname"],
    ["handicap", "Handicap"],
    ["home_club", "Home club"],
    ["best_club", "Best club in the bag"],
    ["worst_club", "Worst club in the bag"],
    ["weakness", "Known weakness"],
    ["quote", "Pre-tournament trash talk"],
  ] as const;
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries([...fields.map(([k]) => [k, String(player[k] ?? "")]), ["bio", player.bio ?? ""]]),
  );
  const [pin, setPin] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    try {
      const patch: Record<string, unknown> = { ...f, handicap: f.handicap === "" ? null : Number(f.handicap) };
      if (photo) {
        const r = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: photo.name, contentType: photo.type }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        const fd = new FormData();
        fd.append("cacheControl", "3600");
        fd.append("", photo);
        const up = await fetch(j.signedUrl, {
          method: "PUT",
          body: fd,
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "x-upsert": "false" },
        });
        if (!up.ok) throw new Error("Photo upload failed");
        patch.photo_path = j.path;
      }
      await api({ action: "updatePlayer", playerId: player.id, patch, pin: pin || undefined });
      setPin("");
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="panel stack">
      <h2>{player.name}</h2>
      <div className="row">
        {fields.map(([k, label]) => (
          <div className="field" key={k} style={{ flex: "1 1 200px" }}>
            <label>{label}</label>
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="field">
        <label>Bio (the AI uses this for previews)</label>
        <textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label>Photo</label>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label>{pinSet ? "Change login PIN" : "Set login PIN (none yet)"}</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" placeholder="4–8 digits" />
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={save}>
          Save {player.name}
        </button>
        {msg && <span className="display">{msg}</span>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ writing

function Writing({ data, onSaved }: { data: AdminData; onSaved: () => void }) {
  const [roundId, setRoundId] = useState(
    data.state.rounds.find((r) => r.status === "live")?.id ??
      data.state.rounds.find((r) => r.status === "upcoming")?.id ??
      data.state.rounds[0]?.id,
  );
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function gen(kind: AiPieceRow["kind"]) {
    setBusy(kind);
    setMsg(null);
    try {
      await api({ action: "aiGenerate", kind, roundId: kind === "tournament" ? null : roundId, extra });
      setMsg("Draft ready below. Read it, edit if needed, then publish.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const pieces = data.state.pieces.filter((p) => p.round_id === roundId || (p.kind === "tournament" && !p.round_id));

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
          <button className="btn" disabled={!!busy} onClick={() => gen("preview")}>
            {busy === "preview" ? "Writing…" : "Write preview"}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => gen("bulletin")}>
            {busy === "bulletin" ? "Writing…" : "Write bulletin"}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => gen("report")}>
            {busy === "report" ? "Writing…" : "Write match report"}
          </button>
          <button className="btn secondary" disabled={!!busy} onClick={() => gen("tournament")}>
            {busy === "tournament" ? "Writing…" : "Write tournament review"}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Live bulletins publish themselves at key moments (birdies, the turn, swings in a match). A match report draft is
          written automatically when a round finishes. Writing takes 10–30 seconds.
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
  const [title, setTitle] = useState(piece.title ?? "");
  const [body, setBody] = useState(piece.body);
  const [msg, setMsg] = useState<string | null>(null);
  async function upd(status?: AiPieceRow["status"]) {
    try {
      await api({ action: "aiUpdate", id: piece.id, title, body, status });
      setMsg(status === "published" ? "Published" : status === "hidden" ? "Hidden" : "Saved");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <section className="panel stack">
      <div className="display">
        <span className={`pill ${piece.status === "published" ? "done" : ""}`}>{piece.status}</span> {piece.kind} ·{" "}
        {timeAgo(piece.created_at)}
        {piece.trigger ? ` · ${piece.trigger}` : ""}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 220 }} />
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
  async function hide(table: "posts" | "comments", id: string, hidden: boolean) {
    await api({ action: "hide", table, id, hidden });
    onSaved();
  }
  return (
    <div className="grid2">
      <section className="stack">
        <h2>Posts</h2>
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
        {data.state.comments.map((c) => (
          <div key={c.id} className="post">
            <div className="who display">
              {c.author_name} · {timeAgo(c.created_at)}
              {(c as { hidden?: boolean }).hidden && <span className="error"> · hidden</span>}
            </div>
            <p style={{ margin: "4px 0" }}>{c.body}</p>
            <button className="chip" onClick={() => hide("comments", c.id, !(c as { hidden?: boolean }).hidden)}>
              {(c as { hidden?: boolean }).hidden ? "Show" : "Hide"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
