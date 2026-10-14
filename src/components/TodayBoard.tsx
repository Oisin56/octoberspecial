"use client";

import Link from "next/link";
import { useT } from "./Providers";
import { pts } from "./ui";
import { fmtPts, standings, type MatchState, type RoundBoard } from "@/lib/live";
import { cardLabel, cardInfo } from "@/lib/scorecards";

const STAGE: Record<string, string> = { finished: "Provisional", submitted: "Awaiting signatures", final: "Final" };

/** Today's round, leading the live page: the match (big), every match, or a leaderboard across every group. */
export function TodayBoard({ board, selected, onSelect }: { board: RoundBoard; selected?: string; onSelect?: (gameId: string) => void }) {
  if (board.kind === "match" && board.matches.length === 1) return <MatchBoard board={board} m={board.matches[0]} />;
  if (board.kind === "match") return <MatchList board={board} selected={selected} onSelect={onSelect} />;
  return <FieldBoard board={board} />;
}

function stageChip(stage: string, live: boolean) {
  if (stage === "open") return live ? <span className="live-badge">Live</span> : null;
  return <span className={`tb-stage ${stage}`}>{STAGE[stage] ?? stage}</span>;
}

function MatchBoard({ board, m }: { board: RoundBoard; m: MatchState }) {
  const { state, names } = useT();
  const [a, b] = m.sides;
  const info = state ? cardInfo(state, board.round.id, m.gameId) : null;
  return (
    <section className="board tb-match" aria-label={`${a.name} v ${b.name}: ${m.leader ? `${m.sides.find((x) => x.id === m.leader)!.name} ${m.big}` : m.big} ${m.small}`}>
      <div className="board-top">
        <div className="board-title">Round {board.round.number} · {board.round.course_name}</div>
        {stageChip(m.stage, board.round.status === "live")}
      </div>
      <div className="tb-duel">
        <Side s={a} lead={m.leader === a.id} />
        <div className={`tb-state${m.leader ? " up" : ""}`}>
          <span className="tile">{m.big}</span>
          <span className="tb-small">{m.small}</span>
        </div>
        <Side s={b} lead={m.leader === b.id} right />
      </div>
      {info && info.stage !== "open" && info.stage !== "finished" && <p className="tb-card">{cardLabel(info, names)}</p>}
    </section>
  );
}

function Side({ s, lead, right }: { s: MatchState["sides"][number]; lead: boolean; right?: boolean }) {
  return (
    <div className={`tb-side${lead ? " lead" : ""}${right ? " right" : ""}${s.color ? " has-team" : ""}`} style={s.color ? ({ "--team": s.color } as React.CSSProperties) : undefined}>
      <span className="tb-name">{s.name}</span>
      {s.color && <span className="tb-team" style={{ background: s.color }} aria-hidden="true" />}
    </div>
  );
}

function MatchList({ board, selected, onSelect }: { board: RoundBoard; selected?: string; onSelect?: (gameId: string) => void }) {
  return (
    <section className="board tb-list" aria-label={`Round ${board.round.number} matches`}>
      <div className="board-top">
        <div className="board-title">Round {board.round.number} · {board.matches.length} matches</div>
        {stageChip(board.stage, board.round.status === "live")}
      </div>
      {board.session && (
        <div className="tb-session" aria-label="This session, as it stands">
          {board.session.map((t, i) => (
            <div key={t.teamId} className={`tb-sess-team${i ? " right" : ""}`} style={{ "--team": t.color } as React.CSSProperties}>
              <span className="tb-team" style={{ background: t.color }} aria-hidden="true" />
              <span className="tb-name">{t.name}</span>
              <span className="tile">{fmtPts(t.pts)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="tb-rows">
        {board.matches.map((m) => {
          const lead = m.sides.find((x) => x.id === m.leader);
          const color = lead?.color ?? null;
          return (
            <button key={m.gameId} className="tb-row" aria-pressed={selected === m.gameId} onClick={() => onSelect?.(m.gameId)}>
              <span className={`tb-rname${m.leader === m.sides[0].id ? " lead" : ""}`}>{m.sides[0].name}</span>
              <span className={`tb-chip${m.leader ? " up" : ""}`} style={color ? { background: color } : undefined}>
                <b>{m.started ? m.big : "–"}</b>
                <small>{m.started ? (m.over ? (m.leader ? "Won" : "Halved") : m.small.replace("Dormie, ", "Dormie ")) : "Not started"}</small>
              </span>
              <span className={`tb-rname right${m.leader === m.sides[1].id ? " lead" : ""}`}>{m.sides[1].name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FieldBoard({ board }: { board: RoundBoard }) {
  const { session } = useT();
  const me = session?.playerId;
  const unit = board.cfg.scoring === "stroke" ? "To par" : board.cfg.scoring === "skins" ? "Skins" : "Points";
  return (
    <section className="board tb-field" aria-label={`Round ${board.round.number} leaderboard`}>
      <div className="board-top">
        <div className="board-title">Round {board.round.number} leaderboard</div>
        {stageChip(board.stage, board.round.status === "live")}
      </div>
      <table className="tb-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th className="l">Player</th>
            <th>{unit}</th>
            <th>Thru</th>
          </tr>
        </thead>
        <tbody>
          {board.field.map((r) => (
            <tr key={r.sideId} className={me && r.playerIds.includes(me) ? "me" : r.pos === "1" || r.pos === "T1" ? "lead" : ""}>
              <td className="pos">{r.pos || "–"}</td>
              <td className="l name">{r.name}</td>
              <td className="score">{r.score}</td>
              <td className="thru">{r.thru ? (r.thru === board.cfg.holes.length ? "F" : r.thru) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The tournament in one line (the live page leads with today; this keeps the overall picture in view). */
export function OverallLine() {
  const { state, summary, cfg, href } = useT();
  if (!state || !summary || !cfg) return null;
  const team = cfg.teams.length >= 2;
  const st = standings(state, summary, team);
  const ids = team ? cfg.teams.map((t) => t.id) : cfg.players.map((p) => p.id);
  const name = (id: string) => (team ? cfg.teams.find((t) => t.id === id)?.name : cfg.players.find((p) => p.id === id)?.name) ?? id;
  const sorted = [...ids].sort((a, b) => (st.banked[b] ?? 0) - (st.banked[a] ?? 0)).slice(0, 4);
  return (
    <section className="overall-line">
      <span className="ol-k">Overall</span>
      <span className="ol-v">{sorted.map((id) => `${name(id)} ${pts(st.banked[id] ?? 0)}`).join(" · ")}</span>
      {st.moving && (
        <span className="ol-proj">
          Projected {[...ids].sort((a, b) => (st.projected[b] ?? 0) - (st.projected[a] ?? 0)).slice(0, 4).map((id) => `${name(id)} ${pts(st.projected[id] ?? 0)}`).join(" · ")}
        </span>
      )}
      <Link href={href("/leaderboard")} className="ol-link">
        Full leaderboard
      </Link>
    </section>
  );
}
