"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "./Providers";
import { CountUp, CourseImage, Icon } from "./visual";
import { mediaUrl } from "@/lib/supabase";
import { ballsOfGame, gameHole, type Game, type GameSummary, type SegmentResult } from "@/lib/engine";
import { shotsOnHole } from "@/lib/scoring";
import {
  SIDE_GAME_LABEL,
  ballName,
  formatLabel,
  sideLabel,
  toRoundCfg,
  type AiPieceRow,
  type PostRow,
  type RoundRow,
} from "@/lib/types";

export function pts(n: number) {
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  if (Math.abs(n - whole - 0.5) < 1e-9) return `${whole || ""}½`;
  return n.toFixed(1);
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

function Tiles({ value, red, small }: { value: number; red?: boolean; small?: boolean }) {
  const s = pts(value);
  return (
    <span className="tiles" aria-label={`${s} points`}>
      <span className={`tile${red ? " red" : ""}${small ? " small" : ""}`}>
        <CountUp value={value} format={pts} />
      </span>
    </span>
  );
}

export function Board() {
  const { state, summary, cfg } = useT();
  if (!state || !summary || !cfg) return null;
  const teamMode = cfg.teams.length >= 2;
  const useProjected = !summary.complete;

  const rows = teamMode
    ? cfg.teams.map((tm, i) => ({
        id: tm.id,
        name: tm.name,
        value: useProjected ? summary.teamProjected[tm.id] : summary.teamTotal[tm.id],
        color: `var(--team-${i})`,
      }))
    : cfg.players
        .map((p) => ({ id: p.id, name: p.name, value: useProjected ? summary.playerProjected[p.id] : summary.playerTotal[p.id], color: "" }))
        .sort((a, b) => b.value - a.value);
  const best = Math.max(0, ...rows.map((r) => r.value));
  const leaders = rows.filter((r) => r.value === best);
  const second = Math.max(0, ...rows.filter((r) => r.value < best).map((r) => r.value));
  const shown = rows.slice(0, 8);
  const small = shown.length > 3;

  const live = state.rounds.find((r) => r.status === "live");
  const liveIdx = live ? state.rounds.indexOf(live) : -1;
  const liveRs = liveIdx >= 0 ? summary.rounds[liveIdx] : null;
  const liveLabel =
    liveRs && live
      ? liveRs.games.length === 1
        ? liveRs.games[0].full.matchLabel ?? `thru ${liveRs.games[0].holesPlayed}`
        : `${liveRs.games.filter((g) => g.complete).length} of ${liveRs.games.length} matches finished`
      : null;
  const hasSidePoints = cfg.sideGames.some((g) => g.enabled && g.points > 0);

  // Head-to-head: a tug-of-war bar over the whole pot
  // Fixed sides (first player/team on the left) so the bar doesn't flip when the lead changes
  const duel = rows.length === 2 ? (teamMode ? rows : cfg.players.map((p) => rows.find((r) => r.id === p.id)!)) : null;
  const total = summary.pointsAvailable || 1;
  const toWin = total / 2;

  return (
    <section className="board" aria-label="Overall standings">
      <div className="board-top">
        <div className="board-title">{summary.complete ? "Final standings" : teamMode ? "Team points" : "Overall points"}</div>
        {live && <span className="live-badge">Live</span>}
      </div>
      <div className="board-rows">
        {shown.map((r) => {
          const lead = leaders.length === 1 && leaders[0].id === r.id && best > 0;
          return (
            <div className={`board-row${lead ? " lead" : ""}`} key={r.id}>
              <span className={`board-name${lead ? " leader" : ""}`} style={{ fontSize: small ? 24 : undefined }}>
                {r.color && <span aria-hidden className="team-swatch" style={{ background: r.color }} />}
                {r.name}
                {lead && <span className="lead-tag">{second < best && rows.length > 1 ? `leads by ${pts(best - second)}` : "leads"}</span>}
              </span>
              <Tiles value={r.value} red={lead} small={small} />
            </div>
          );
        })}
        {rows.length > shown.length && <div className="small" style={{ color: "var(--board-soft)" }}>+{rows.length - shown.length} more on the leaderboard</div>}
        {leaders.length > 1 && best > 0 && <div className="lead-tag tie">All square at the top</div>}
      </div>

      {duel && (
        <div className="tug" aria-label={`${pts(toWin + 0.5)} points wins it`}>
          <div className="tug-bar">
            <span className="tug-a" style={{ width: `${(duel[0].value / total) * 100}%`, background: duel[0].color || undefined }} />
            <span className="tug-b" style={{ width: `${(duel[1].value / total) * 100}%`, background: duel[1].color || undefined }} />
            <span className="tug-mid" />
          </div>
          <div className="tug-labels">
            <span>{duel[0].name}</span>
            <span className="muted-on-dark">{pts(toWin + 0.5)} wins it</span>
            <span>{duel[1].name}</span>
          </div>
        </div>
      )}

      <div className="board-foot">
        <span>
          <b className="num">{pts(summary.pointsRemaining)}</b> points still to play for
        </span>
        {live && liveLabel && (
          <span>
            Live: <b>R{live.number} {live.course_name}</b> · {liveLabel}
          </span>
        )}
        {!summary.complete && hasSidePoints && <span className="small">Totals include side games as they stand</span>}
      </div>
      {summary.awards.length > 0 && (
        <div className="board-split" style={{ gridTemplateColumns: `repeat(${Math.min(3, summary.awards.length)}, 1fr)` }}>
          {summary.awards.slice(0, 3).map((a) => (
            <AwardCell key={a.kind} kind={a.kind} counts={a.counts} />
          ))}
        </div>
      )}
    </section>
  );
}

function AwardCell({ kind, counts }: { kind: keyof typeof SIDE_GAME_LABEL; counts: Record<string, number> }) {
  const { cfg } = useT();
  const nameOf = (id: string) => cfg?.teams.find((t) => t.id === id)?.name ?? cfg?.players.find((p) => p.id === id)?.name ?? id;
  const ids = Object.keys(counts);
  let v: string;
  const best = Math.max(0, ...ids.map((id) => counts[id]));
  const top = ids.filter((id) => counts[id] === best);
  if (ids.length <= 2) v = ids.map((id) => counts[id]).join(" – ");
  else v = best === 0 ? "None yet" : `${top.length > 1 ? `${top.length} tied` : nameOf(top[0])} ${best}`;
  const leader = best > 0 && top.length === 1 ? nameOf(top[0]) : null;
  return (
    <div className="award">
      <span className="award-icon">
        <Icon kind={kind} />
      </span>
      <div>
        <div className="k">{SIDE_GAME_LABEL[kind]}</div>
        <div className="v num">{v}</div>
        {ids.length <= 2 && <div className="w">{leader ? `${leader} ahead` : best > 0 ? "level" : "none yet"}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ match / group status

export function GameStatus({ round, gameIndex, compact }: { round: RoundRow; gameIndex: number; compact?: boolean }) {
  const { state, summary } = useT();
  if (!state || !summary) return null;
  const ri = state.rounds.indexOf(round);
  const cfg = toRoundCfg(round, state.players);
  const game = cfg.games[gameIndex];
  const gs = summary.rounds[ri]?.games[gameIndex];
  if (!game || !gs) return null;
  const name = (id: string) => sideLabel(id, game, state.players);

  if (cfg.scoring === "skins" || game.sides.length > 2) {
    const unit = cfg.scoring === "skins" ? "skins" : cfg.scoring === "stableford" ? "pts" : "net";
    return (
      <div className="panel" style={{ padding: 10 }}>
        {game.name && <h3 style={{ marginBottom: 6 }}>{game.name}</h3>}
        <table className="stats">
          <thead>
            <tr>
              <th>Pos</th>
              <th>{game.sides.some((s) => s.playerIds.length > 1) ? "Side" : "Player"}</th>
              <th>{unit}</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {(gs.full.ranking.length ? gs.full.ranking : game.sides.map((s) => ({ sideId: s.id, pos: 0, value: 0 }))).map((r) => (
              <tr key={r.sideId}>
                <td>{r.pos || "–"}</td>
                <td>{name(r.sideId)}</td>
                <td className="num">{gs.full.holesPlayed ? pts(r.value) : ""}</td>
                <td className="num">{pts(gs.points[r.sideId] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted display" style={{ margin: "6px 0 0" }}>
          {gs.holesPlayed ? `Thru ${gs.holesPlayed}` : "Not started"}
          {cfg.scoring === "skins" ? " · ties carry over" : gs.complete ? "" : " · points awarded at the finish"}
        </p>
      </div>
    );
  }

  const box = (label: string, s: SegmentResult, pot: number) => {
    let v = "—";
    if (s.holesPlayed > 0) {
      if (s.matchLabel) v = s.matchLabel;
      else if (s.complete) v = s.leaders.length > 1 ? "Halved" : `${name(s.leaders[0])} wins`;
      else v = s.leaders.length > 1 ? "Level" : `${name(s.leaders[0])} leads`;
    }
    const unit = cfg.scoring === "stableford" ? "pts" : cfg.scoring === "stroke" ? "net" : "holes";
    return (
      <div className="seg" key={label}>
        <div className="k">
          {label} · {pts(pot)} pt{pot === 1 ? "" : "s"}
        </div>
        <div className="v">{v}</div>
        <div className="s num">
          {s.holesPlayed > 0 ? game.sides.map((sd) => `${name(sd.id)} ${pts(s.value[sd.id])}`).join(" · ") + ` ${unit}` : "Not started"}
        </div>
      </div>
    );
  };
  const segs = [
    cfg.points.front > 0 && box("Front 9", gs.front, cfg.points.front),
    cfg.points.back > 0 && box("Back 9", gs.back, cfg.points.back),
    box("18", gs.full, cfg.points.full),
  ].filter(Boolean);

  return (
    <div>
      {(game.name || cfg.games.length > 1) && !compact && (
        <h3 style={{ marginBottom: 6 }}>
          {game.name ?? `Match ${gameIndex + 1}`}: {game.sides.map((s) => name(s.id)).join(" v ")}
        </h3>
      )}
      <div className="segs" style={{ gridTemplateColumns: `repeat(${segs.length}, 1fr)` }}>
        {segs}
      </div>
    </div>
  );
}

/** One-line status for a game (for lists). */
export function gameLine(round: RoundRow, game: Game, gs: GameSummary, players: { id: string; name: string }[]) {
  const name = (id: string) => sideLabel(id, game, players as never);
  if (gs.holesPlayed === 0) return "Not started";
  if (gs.full.matchLabel) return gs.full.matchLabel;
  const top = gs.full.ranking[0];
  return `${name(top.sideId)} ${gs.complete ? "won" : "leads"}${gs.complete ? "" : ` thru ${gs.holesPlayed}`}`;
}

// ------------------------------------------------------------ scorecard

function ScoreMark({ gross, par, pickedUp }: { gross: number | null; par: number; pickedUp?: boolean }) {
  if (pickedUp) return <span className="sc">P</span>;
  if (gross == null) return <span className="sc"> </span>;
  const d = gross - par;
  const cls = d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 1 ? "bogey" : d >= 2 ? "double" : "";
  return <span className={`sc ${cls}`}>{gross}</span>;
}

export function Scorecard({ round, gameIndex = 0 }: { round: RoundRow; gameIndex?: number }) {
  const { state, summary } = useT();
  if (!state || !summary) return null;
  const cfg = toRoundCfg(round, state.players);
  const game = cfg.games[gameIndex];
  const ri = state.rounds.indexOf(round);
  const gs = summary.rounds[ri]?.games[gameIndex];
  if (!game || !gs) return null;
  const balls = ballsOfGame(game, cfg.play);
  const entries = state.entries.filter((e) => e.round_id === round.id && (e.game ?? "main") === game.id);
  const halves = [round.holes.slice(0, 9), round.holes.slice(9, 18)];
  const sideOf = (ball: string) => game.sides.find((s) => s.id === ball || s.playerIds.includes(ball))?.id;
  const short = (b: string) => {
    const n = ballName(b, game, state.players);
    return n.length > 12 ? n.split(" & ").map((x) => x.slice(0, 3)).join("/") : n;
  };

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
                  <td key={h.number} className="muted">
                    {h.si}
                  </td>
                ))}
                <td className="sum"></td>
              </tr>
              {balls.map((b) => {
                let tot = 0;
                return (
                  <tr key={b}>
                    <td className="label">
                      {short(b)}
                      {(gs.shots[b] ?? 0) > 0 && <span className="muted small"> +{gs.shots[b]}</span>}
                    </td>
                    {holes.map((h) => {
                      const e = entries.find((x) => x.hole === h.number);
                      const sc = e?.scores[b];
                      if (sc?.gross && !sc.pickedUp) tot += sc.gross;
                      const gh = e && cfg.scoring === "match" ? gameHole(cfg, game, gs.shots, { ...e, game: game.id, ctpWinner: e.ctp_winner, ldWinner: e.ld_winner }) : null;
                      const won = gh?.winner && gh.winner === sideOf(b);
                      const dots = shotsOnHole(gs.shots[b] ?? 0, h.si);
                      return (
                        <td key={h.number} className={won ? "won" : ""} title={dots ? `${dots} shot${dots > 1 ? "s" : ""}` : undefined}>
                          <ScoreMark gross={sc?.gross ?? null} par={h.par} pickedUp={sc?.pickedUp} />
                          {dots > 0 && <span className="shotdot" aria-hidden>{"•".repeat(dots)}</span>}
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
                  const n = balls.filter((b) => e?.scores[b]?.gir).length;
                  return (
                    <td key={h.number} className="small" title={balls.filter((b) => e?.scores[b]?.gir).map((b) => ballName(b, game, state.players)).join(", ")}>
                      {n ? (balls.length <= 2 ? balls.filter((b) => e?.scores[b]?.gir).map((b) => short(b).slice(0, 2)).join(" ") : n) : ""}
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
                      {h.par === 3 || h.par === 5 ? (w ? short(w).slice(0, 3) : e ? "–" : "") : ""}
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
        Circle = birdie, double circle = eagle, square = bogey, dots = shots received. Shaded = hole won (match play). P = picked up.
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
    ...state.posts.filter((p) => !roundId || p.round_id === roundId).map((post) => ({ t: "post" as const, at: post.created_at, post })),
    ...state.pieces
      .filter((p) => p.kind === "bulletin" && p.status === "published" && (!roundId || p.round_id === roundId))
      .map((piece) => ({ t: "piece" as const, at: piece.published_at ?? piece.created_at, piece })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <p className="muted">Nothing yet. Notes, photos and live bulletins appear here as the rounds are played.</p>;
  return (
    <div className="feed">
      {shown.map((i) => (i.t === "post" ? <PostCard key={i.post.id} post={i.post} /> : <BulletinCard key={i.piece.id} piece={i.piece} />))}
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
        <span className="where">Live bulletin{round ? ` · R${round.number}` : ""}</span> · {timeAgo(piece.published_at ?? piece.created_at)}
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
        .flatMap((p, i) => {
          // A short line with no full stop is a subheading (the writer may put it directly above its paragraph)
          const isHead = (l: string) => l.length < 60 && !/[.!?:,"”']$/.test(l.trim());
          const [first, ...rest] = p.split("\n");
          if (isHead(first) && first.trim())
            return [
              <h3 key={`${i}h`} className="display" style={{ margin: "14px 0 0", fontSize: 20 }}>
                {first.trim()}
              </h3>,
              ...(rest.join(" ").trim()
                ? [
                    <p key={i} style={{ margin: "6px 0 0" }}>
                      {rest.join(" ").trim()}
                    </p>,
                  ]
                : []),
            ];
          return [
            <p key={i} style={{ margin: "6px 0 0" }}>
              {p}
            </p>,
          ];
        })}
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
  const { state, refresh, api } = useT();
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
    const r = await api("/api/comments", { name, body, roundId });
    setBusy(false);
    if (!r.ok) return setErr(String(r.j.error ?? "Comment didn't send. Try again."));
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

export function RoundItem({ round, index }: { round: RoundRow; index: number }) {
  const { state, summary, cfg, href } = useT();
  if (!state || !summary || !cfg) return null;
  const rs = summary.rounds[index];
  const played = rs?.games.some((g) => g.holesPlayed > 0);
  const rcfg = toRoundCfg(round, state.players);
  let result = "";
  if (played && rs) {
    if (cfg.teams.length >= 2) result = cfg.teams.map((t) => `${t.name} ${pts(rs.teamPoints[t.id] ?? 0)}`).join(" · ");
    else
      result = cfg.players
        .map((p) => ({ n: p.name, v: rs.playerPoints[p.id] ?? 0 }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
        .map((x) => `${x.n} ${pts(x.v)}`)
        .join(" · ");
  }
  const total =
    rcfg.scoring === "skins"
      ? null
      : rcfg.games.reduce((t, g) => t + (g.sides.length > 2 && rcfg.points.positions?.length ? rcfg.points.front + rcfg.points.back + rcfg.points.positions.reduce((a, b) => a + b, 0) : rcfg.points.front + rcfg.points.back + rcfg.points.full), 0);
  const status = round.status === "live" ? "live" : round.status === "complete" ? "final" : played ? "in progress" : "upcoming";
  return (
    <Link href={href(`/rounds/${round.number}`)} className={`round-card ${round.status}`}>
      <span className="round-img">
        <CourseImage round={round} sizes="(min-width: 820px) 300px, 100vw" />
        <span className="round-badge" aria-label={`Round ${round.number}`}>
          R{round.number}
        </span>
        <span className={`round-status ${status === "live" ? "live" : status === "final" ? "final" : ""}`}>{status === "live" ? "Live" : status === "final" ? "Final" : status === "in progress" ? "In progress" : dateLabel(round.play_date)}</span>
        {total != null && <span className="round-stake">{pts(total)} pts</span>}
      </span>
      <span className="round-body">
        <span className="round-name">{round.course_name}</span>
        <span className="meta">
          {formatLabel(round)}
          {rcfg.games.length > 1 ? ` · ${rcfg.games.length} matches` : ""}
          {status !== "upcoming" ? ` · ${dateLabel(round.play_date)}` : ""}
        </span>
        {result && <span className="round-result num">{result}</span>}
      </span>
    </Link>
  );
}
