"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "./Providers";
import { mediaUrl } from "@/lib/supabase";
import {
  holeResult,
  type RoundSummary,
  type SegmentResult,
} from "@/lib/scoring";
import {
  FORMAT_LABEL,
  toRoundConfig,
  type AiPieceRow,
  type PostRow,
  type RoundRow,
} from "@/lib/types";

export function pts(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function Loading() {
  const { loading, error } = useT();
  if (error) return <p className="error">{error}</p>;
  if (loading) return <p className="muted display">Loading the board…</p>;
  return null;
}

export function dateLabel(d: string | null) {
  if (!d) return "Date to be set";
  return new Date(d + "T12:00:00").toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

// ------------------------------------------------------------ the board

function Tiles({ value, red }: { value: number; red?: boolean }) {
  const s = pts(value);
  return (
    <span className="tiles" aria-label={`${s} points`}>
      {s.split("").map((ch, i) => (
        <span key={i} className={`tile${red ? " red" : ""}${ch === "." ? " small" : ""}`}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export function Board() {
  const { state, summary } = useT();
  if (!state || !summary) return null;
  const players = state.players;
  const totals = summary.complete ? summary.totalPoints : summary.projectedTotal;
  const best = Math.max(...players.map((p) => totals[p.id]));
  const leaders = players.filter((p) => totals[p.id] === best);
  const live = state.rounds.find((r) => r.status === "live");
  const liveIdx = live ? state.rounds.indexOf(live) : -1;
  const liveSummary = liveIdx >= 0 ? summary.rounds[liveIdx] : null;

  return (
    <section className="board" aria-label="Overall standings">
      <div className="board-title">
        {summary.complete ? "Final standings" : "Overall points"}
      </div>
      <div className="board-rows">
        {players.map((p) => (
          <div className="board-row" key={p.id}>
            <span className={`board-name${leaders.length === 1 && leaders[0].id === p.id && best > 0 ? " leader" : ""}`}>
              {p.name}
            </span>
            <Tiles value={totals[p.id]} red={leaders.length === 1 && leaders[0].id === p.id && best > 0} />
          </div>
        ))}
      </div>
      <div className="board-foot">
        <span>
          <b className="num">{summary.pointsRemaining}</b> points still to play for
        </span>
        {live && liveSummary && (
          <span>
            Live: <b>R{live.number} {live.course_name}</b>
            {" — "}
            {liveSummary.full.matchLabel ?? `thru ${liveSummary.holesPlayed}`}
          </span>
        )}
        {!summary.complete && (summary.ctp.leaders.length > 0 || summary.gir.leaders.length > 0) && (
          <span className="small">Includes side games as they stand</span>
        )}
      </div>
      <div className="board-split">
        <SideCell label="Closest to pin" counts={summary.ctp.counts} />
        <SideCell label="Long drive" counts={summary.ld.counts} />
        <SideCell label="Greens in reg" counts={summary.gir.counts} />
      </div>
    </section>
  );
}

function SideCell({ label, counts }: { label: string; counts: Record<string, number> }) {
  const { state } = useT();
  return (
    <div>
      <div className="k">{label}</div>
      <div className="v num">
        {state?.players.map((p) => counts[p.id] ?? 0).join(" – ")}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ round status

export function SegmentBoxes({ rs, round }: { rs: RoundSummary; round: RoundRow }) {
  const { names } = useT();
  const unit = round.format === "stableford" ? "pts" : round.format === "stroke" ? "net" : "holes";
  const box = (label: string, s: SegmentResult, pot: number) => {
    let v = "—";
    if (s.holesPlayed > 0) {
      if (s.matchLabel && round.format === "match") v = s.matchLabel;
      else if (s.complete) v = s.leaders.length > 1 ? "Halved" : `${names[s.leaders[0]]} wins`;
      else v = s.leaders.length > 1 ? "Level" : `${names[s.leaders[0]]} leads`;
    }
    return (
      <div className="seg">
        <div className="k">
          {label} · {pot} pts
        </div>
        <div className="v">{v}</div>
        <div className="s num">
          {s.holesPlayed > 0
            ? Object.entries(s.value).map(([p, x]) => `${names[p]} ${pts(x)}`).join(" · ") + ` ${unit}`
            : "Not started"}
        </div>
      </div>
    );
  };
  return (
    <div className="segs">
      {box("Front 9", rs.front, round.nine_points)}
      {box("Back 9", rs.back, round.nine_points)}
      {box("18", rs.full, round.full_points)}
    </div>
  );
}

// ------------------------------------------------------------ scorecard

function ScoreMark({ gross, par, pickedUp }: { gross: number | null; par: number; pickedUp?: boolean }) {
  if (pickedUp) return <span className="sc">P</span>;
  if (gross == null) return <span className="sc"> </span>;
  const d = gross - par;
  const cls = d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 1 ? "bogey" : d >= 2 ? "double" : "";
  return <span className={`sc ${cls}`}>{gross}</span>;
}

export function Scorecard({ round }: { round: RoundRow }) {
  const { state, names } = useT();
  if (!state) return null;
  const cfg = toRoundConfig(round);
  const players = state.players.map((p) => p.id);
  const entries = state.entries.filter((e) => e.round_id === round.id);
  const halves = [round.holes.slice(0, 9), round.holes.slice(9, 18)];

  return (
    <div className="stack">
      {halves.map((holes, hi) => (
        <div className="card-scroll" key={hi}>
          <table className="card">
            <thead>
              <tr>
                <th>{hi === 0 ? "Out" : "In"}</th>
                {holes.map((h) => (
                  <th key={h.number}>{h.number}</th>
                ))}
                <th>Tot</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="label">Par</td>
                {holes.map((h) => (
                  <td key={h.number}>{h.par}</td>
                ))}
                <td className="sum">{holes.reduce((a, h) => a + h.par, 0)}</td>
              </tr>
              <tr>
                <td className="label">SI</td>
                {holes.map((h) => (
                  <td key={h.number} className="muted">{h.si}</td>
                ))}
                <td className="sum"></td>
              </tr>
              {players.map((p) => {
                let tot = 0;
                return (
                  <tr key={p}>
                    <td className="label">
                      {names[p]}
                      {(round.shots?.[p] ?? 0) > 0 && <span className="muted small"> +{round.shots[p]}</span>}
                    </td>
                    {holes.map((h) => {
                      const e = entries.find((x) => x.hole === h.number);
                      const ph = e?.scores[p];
                      if (ph?.gross && !ph.pickedUp) tot += ph.gross;
                      const hr = e ? holeResult(cfg, players, { hole: e.hole, scores: e.scores }) : null;
                      const won = hr?.matchWinner === p;
                      return (
                        <td key={h.number} className={won ? "won" : ""}>
                          <ScoreMark gross={ph?.gross ?? null} par={h.par} pickedUp={ph?.pickedUp} />
                        </td>
                      );
                    })}
                    <td className="sum">{tot || ""}</td>
                  </tr>
                );
              })}
              {round.format === "stableford" &&
                players.map((p) => {
                  let tot = 0;
                  return (
                    <tr key={p + "-pts"}>
                      <td className="label muted">{names[p]} pts</td>
                      {holes.map((h) => {
                        const e = entries.find((x) => x.hole === h.number);
                        if (!e?.scores[p]) return <td key={h.number}></td>;
                        const v = holeResult(cfg, players, { hole: e.hole, scores: e.scores }).stableford[p];
                        tot += v;
                        return (
                          <td key={h.number} className="muted">
                            {v}
                          </td>
                        );
                      })}
                      <td className="sum">{tot || ""}</td>
                    </tr>
                  );
                })}
              <tr>
                <td className="label muted">GIR</td>
                {holes.map((h) => {
                  const e = entries.find((x) => x.hole === h.number);
                  const who = players.filter((p) => e?.scores[p]?.gir).map((p) => names[p].slice(0, 2));
                  return (
                    <td key={h.number} className="small">
                      {who.join(" ")}
                    </td>
                  );
                })}
                <td className="sum"></td>
              </tr>
              <tr>
                <td className="label muted">CTP / LD</td>
                {holes.map((h) => {
                  const e = entries.find((x) => x.hole === h.number);
                  const w = h.par === 3 ? e?.ctp_winner : h.par === 5 ? e?.ld_winner : null;
                  return (
                    <td key={h.number} className="small">
                      {h.par === 3 || h.par === 5 ? (w ? names[w]?.slice(0, 2) : e ? "–" : "") : ""}
                    </td>
                  );
                })}
                <td className="sum"></td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <p className="small muted">
        Circles = birdie, double circle = eagle, square = bogey. Shaded = hole won (match play). P = picked up.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ feed

type FeedItem = { t: "post"; at: string; post: PostRow } | { t: "piece"; at: string; piece: AiPieceRow };

export function Feed({ roundId, limit }: { roundId?: string; limit?: number }) {
  const { state } = useT();
  if (!state) return null;
  const items: FeedItem[] = [
    ...state.posts
      .filter((p) => !roundId || p.round_id === roundId)
      .map((post) => ({ t: "post" as const, at: post.created_at, post })),
    ...state.pieces
      .filter((p) => p.kind === "bulletin" && p.status === "published" && (!roundId || p.round_id === roundId))
      .map((piece) => ({ t: "piece" as const, at: piece.published_at ?? piece.created_at, piece })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length)
    return <p className="muted">Nothing yet. Notes, photos and live bulletins appear here as the rounds are played.</p>;
  return (
    <div className="feed">
      {shown.map((i) =>
        i.t === "post" ? <PostCard key={i.post.id} post={i.post} /> : <BulletinCard key={i.piece.id} piece={i.piece} />,
      )}
    </div>
  );
}

export function PostCard({ post }: { post: PostRow }) {
  const { state } = useT();
  const round = state?.rounds.find((r) => r.id === post.round_id);
  const url = mediaUrl(post.media_path);
  return (
    <article className="post">
      <div className="who display">
        <span className="where">
          {round ? `R${round.number}` : ""}
          {post.hole ? ` · Hole ${post.hole}` : ""}
        </span>{" "}
        {post.author_name} · {timeAgo(post.created_at)}
      </div>
      {post.body && <p style={{ margin: "6px 0 0" }}>{post.body}</p>}
      {url && post.kind === "photo" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={post.body ?? `Photo from hole ${post.hole ?? ""}`} loading="lazy" />
      )}
      {url && post.kind === "video" && <video src={url} controls playsInline preload="metadata" />}
      {post.tags.length > 0 && (
        <div className="tags">
          {post.tags.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export function BulletinCard({ piece }: { piece: AiPieceRow }) {
  const { state } = useT();
  const round = state?.rounds.find((r) => r.id === piece.round_id);
  return (
    <article className="post bulletin">
      <div className="who display">
        <span className="where">Live bulletin{round ? ` · R${round.number}` : ""}</span> ·{" "}
        {timeAgo(piece.published_at ?? piece.created_at)}
      </div>
      {piece.title && <h3 style={{ marginTop: 4 }}>{piece.title}</h3>}
      <Paras text={piece.body} />
    </article>
  );
}

export function Paras({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} style={{ margin: "6px 0 0" }}>
            {p}
          </p>
        ))}
    </>
  );
}

export function Article({ piece, label }: { piece: AiPieceRow; label: string }) {
  return (
    <article className="article">
      <h2>{piece.title}</h2>
      <div className="byline">
        {label} · {timeAgo(piece.published_at ?? piece.created_at)}
      </div>
      {piece.body
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </article>
  );
}

// ------------------------------------------------------------ comments

export function Comments({ roundId }: { roundId?: string }) {
  const { state, refresh } = useT();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("os_name") ?? "";
    } catch {
      return "";
    }
  });
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = (state?.comments ?? []).filter((c) => !roundId || c.round_id === roundId).slice(0, 40);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      localStorage.setItem("os_name", name);
    } catch {}
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, body, roundId }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Comment didn't send. Try again.");
    setBody("");
    refresh();
  }

  return (
    <div className="stack">
      <form onSubmit={send} className="stack">
        <div className="field">
          <label htmlFor="c-name">Your name</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
        </div>
        <div className="field">
          <label htmlFor="c-body">Comment</label>
          <textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} required style={{ minHeight: 60 }} />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={busy}>
          Post comment
        </button>
      </form>
      {list.map((c) => (
        <div key={c.id} className="post">
          <div className="who display">
            {c.author_name} · {timeAgo(c.created_at)}
          </div>
          <p style={{ margin: "4px 0 0" }}>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ round row

export function RoundItem({ round, rs }: { round: RoundRow; rs: RoundSummary }) {
  const { names, state } = useT();
  const players = state?.players.map((p) => p.id) ?? [];
  return (
    <Link href={`/rounds/${round.number}`} className="round-item">
      <span className="round-no" aria-label={`Round ${round.number}`}>
        {round.number}
      </span>
      <span>
        <span className="display" style={{ fontSize: 21, fontWeight: 700, display: "block" }}>
          {round.course_name}
        </span>
        <span className="meta">
          {FORMAT_LABEL[round.format]} · {round.nine_points * 2 + round.full_points} pts · {dateLabel(round.play_date)}
        </span>
      </span>
      <span className="res">
        {round.status === "live" && <span className="pill live">Live thru {rs.holesPlayed}</span>}
        {round.status === "upcoming" && rs.holesPlayed === 0 && <span className="pill">Upcoming</span>}
        {(round.status === "complete" || rs.holesPlayed > 0) && round.status !== "live" && (
          <span className="num">{players.map((p) => `${names[p]} ${pts(rs.points[p])}`).join(" · ")}</span>
        )}
      </span>
    </Link>
  );
}
