"use client";

import { useT } from "@/components/Providers";
import { CountUp } from "@/components/visual";
import { useMemo } from "react";
import { prizeLines, toPar, type KoMatchView, type WinBoard } from "@/lib/boards";
import { totalsFor } from "@/lib/engine";
import { toEntries } from "@/lib/types";

/**
 * The boards for team score, Texas scramble, most skins and the knockout draw (Home's big board, and the fuller
 * tables on the Leaderboard), and the prizes panel shown beneath the board.
 */

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Math.abs(n - Math.floor(n) - 0.5) < 1e-9 ? `${Math.floor(n) || ""}½` : n.toFixed(1));

// ------------------------------------------------------------ Home: the big board

export function WinBoardView({ wb }: { wb: WinBoard }) {
  const { state } = useT();
  if (!state) return null;
  const live = state.rounds.find((r) => r.status === "live");
  const done = state.rounds.filter((r) => r.status === "complete").length;
  const roundsLine = live ? `Round ${live.number} of ${state.rounds.length}` : done === state.rounds.length && done ? "All rounds played" : `${done} of ${state.rounds.length} rounds played`;

  if (wb.kind === "knockout") return <KnockoutBoard wb={wb} live={!!live} />;

  const rows =
    wb.kind === "teams"
      ? wb.rows.map((r) => ({ id: r.id, name: r.name, pos: r.pos, color: r.color, value: r.value, started: r.started, text: r.score }))
      : wb.rows.map((r) => ({ id: r.id, name: r.name, pos: r.pos, color: "", value: r.skins, started: true, text: `${fmt(r.skins)} skins` }));
  const shown = rows.slice(0, 8);
  const small = shown.length > 3;
  const top = rows[0];
  const leaders = top?.started && top.pos ? rows.filter((r) => r.started && r.value === top.value) : [];
  const single = leaders.length === 1 && (wb.kind !== "skins" || top.value > 0);
  const format = wb.kind === "teams" && wb.unit === "toPar" ? (n: number) => toPar(Math.round(n)) : fmt;
  return (
    <section className="board" aria-label="Overall standings">
      <div className="board-top">
        <div className="board-title">{wb.title}</div>
        {live && <span className="live-badge">Live</span>}
      </div>
      <div className="board-rows">
        {shown.map((r) => {
          const lead = single && leaders[0].id === r.id;
          return (
            <div className={`board-row${lead ? " lead" : ""}${r.color ? " has-team" : ""}`} key={r.id} style={r.color ? ({ "--team": r.color } as React.CSSProperties) : undefined}>
              <span className={`board-name${lead ? " leader" : ""}`} style={{ fontSize: small ? 24 : undefined }}>
                {r.pos && <span className="board-pos">{r.pos}</span>}
                {r.color && <span aria-hidden className="team-swatch" style={{ background: r.color }} />}
                {r.name}
              </span>
              <span className="tiles" aria-label={r.text}>
                <span className={`tile${lead ? " red" : ""}${small ? " small" : ""}`}>{r.started ? <CountUp value={r.value} format={format} /> : "–"}</span>
              </span>
            </div>
          );
        })}
        {rows.length > shown.length && <div className="small" style={{ color: "var(--board-soft)" }}>+{rows.length - shown.length} more on the leaderboard</div>}
      </div>
      <div className="board-foot">
        <span>{roundsLine}</span>
        {wb.kind === "skins" && wb.carrying && <b>{wb.carrying}</b>}
        <span className="small">{wb.note}</span>
      </div>
    </section>
  );
}

function KnockoutBoard({ wb, live }: { wb: Extract<WinBoard, { kind: "knockout" }>; live: boolean }) {
  const stage = wb.stages[wb.current];
  const final = wb.stages[wb.stages.length - 1]?.matches[0];
  if (wb.champion)
    return (
      <section className="board" aria-label="The knockout">
        <div className="board-top">
          <div className="board-title">Champion</div>
        </div>
        <div className="board-rows">
          <div className="board-row lead">
            <span className="board-name leader">{wb.champion}</span>
          </div>
        </div>
        {final && <div className="board-foot">The final: {final.label}</div>}
      </section>
    );
  return (
    <section className="board" aria-label="The knockout">
      <div className="board-top">
        <div className="board-title">
          {wb.title}: {stage?.name}
        </div>
        {live && <span className="live-badge">Live</span>}
      </div>
      <div className="ko-list">
        {stage?.matches.filter((m) => !(m.a.empty === "bye" || m.b.empty === "bye")).map((m, i) => <KoMatch key={i} m={m} />)}
      </div>
      {stage && stage.matches.some((m) => m.a.empty === "bye" || m.b.empty === "bye") && (
        <div className="board-foot">
          <span>
            Through with a bye:{" "}
            {stage.matches
              .filter((m) => m.a.empty === "bye" || m.b.empty === "bye")
              .map((m) => (m.a.empty ? m.b.name : m.a.name))
              .join(", ")}
          </span>
        </div>
      )}
    </section>
  );
}

function KoMatch({ m }: { m: KoMatchView }) {
  return (
    <div className={`ko-m${m.live ? " ko-live" : ""}`}>
      <span className={`ko-s${m.a.won ? " ko-won" : ""}${m.a.empty ? " ko-empty" : ""}`}>{m.a.name}</span>
      <span className={`ko-s${m.b.won ? " ko-won" : ""}${m.b.empty ? " ko-empty" : ""}`}>{m.b.name}</span>
      {m.label && <span className="ko-l">{m.label}</span>}
    </div>
  );
}

// ------------------------------------------------------------ Leaderboard: the fuller tables

export function WinBoardTables({ wb }: { wb: WinBoard }) {
  const { state, summary } = useT();
  if (!state || !summary) return null;
  const rounds = [...state.rounds].sort((a, b) => a.number - b.number);

  if (wb.kind === "knockout")
    return (
      <section className="section panel">
        <h2 style={{ marginBottom: 8 }}>The draw</h2>
        <div className="ko-draw">
          {wb.stages.map((st, si) => (
            <div className="ko-stage" key={si}>
              <h3>{st.name}</h3>
              {st.matches.map((m, k) => (
                <KoMatch key={k} m={m} />
              ))}
            </div>
          ))}
        </div>
        {wb.out.length > 0 && <p className="small muted">Knocked out and playing on for the prizes: {wb.out.map((o) => `${o.name} (${o.stage.toLowerCase()})`).join(", ")}.</p>}
      </section>
    );

  if (wb.kind === "skins") {
    const t = summary.skins;
    const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? "";
    return (
      <>
        <section className="section panel">
          <h2 style={{ marginBottom: 8 }}>Skins, round by round</h2>
          <div className="card-scroll">
            <table className="stats">
              <thead>
                <tr>
                  <th></th>
                  <th>Player</th>
                  <th>Skins</th>
                  {rounds.map((r) => (
                    <th key={r.id}>R{r.number}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wb.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num muted">{r.pos}</td>
                    <td>{r.name}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {fmt(r.skins)}
                    </td>
                    {r.perRound.map((v, i) => (
                      <td key={i} className="num">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">{wb.note} Each hole is won outright by the best net score.</p>
        </section>
        {t &&
          rounds
            .filter((r) => (t.holes[r.id] ?? []).some((h) => h.decided))
            .map((r) => (
              <section className="section panel" key={r.id}>
                <h2 style={{ marginBottom: 8 }}>
                  Round {r.number}, hole by hole
                </h2>
                <div className="skin-holes">
                  {(t.holes[r.id] ?? [])
                    .filter((h) => h.decided)
                    .map((h) => (
                      <span key={h.hole} className={`skin-h${h.winner ? "" : " carried"}`}>
                        <b className="num">{h.hole}</b>
                        {h.winner ? `${name(h.winner)}${h.worth > 1 ? `, ${fmt(h.worth)}` : ""}` : "Carried"}
                      </span>
                    ))}
                </div>
              </section>
            ))}
      </>
    );
  }

  // Team score and Texas scramble
  const teamScore = summary.win.kind === "teamscore";
  return (
    <>
      <section className="section panel">
        <h2 style={{ marginBottom: 8 }}>{teamScore ? "Team points, round by round" : "Team scores, round by round"}</h2>
        <div className="card-scroll">
          <table className="stats">
            <thead>
              <tr>
                <th></th>
                <th>Team</th>
                <th>Total</th>
                {rounds.map((r) => (
                  <th key={r.id}>R{r.number}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wb.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num muted">{r.pos}</td>
                  <td>
                    <span aria-hidden className="team-dot" style={{ background: r.color }} />
                    {r.name}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {r.score}
                  </td>
                  {r.perRound.map((v, i) => (
                    <td key={i} className="num">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{wb.note}</p>
      </section>
      {teamScore && <PlayerPoints />}
    </>
  );
}

/** Team score: each player's own Stableford points, under their team. */
function PlayerPoints() {
  const { state, cfg } = useT();
  // Each player's own Stableford points (the team adds up its best ones hole by hole)
  const totals = useMemo(() => (state && cfg ? totalsFor({ ...cfg, win: { kind: "stableford" } }, toEntries(state.entries)) : null), [state, cfg]);
  if (!state || !cfg || !totals) return null;
  return (
    <section className="section panel">
      <h2 style={{ marginBottom: 8 }}>Each player&apos;s points</h2>
      {cfg.teams.map((t) => {
        const rows = totals.rows.filter((r) => cfg.players.find((p) => p.id === r.playerId)?.teamId === t.id).sort((a, b) => b.value - a.value);
        return (
          <div key={t.id} className="team-block">
            <h3>
              <span aria-hidden className="team-dot" style={{ background: t.color }} />
              {t.name}
            </h3>
            <ul className="plain-list">
              {rows.map((r) => (
                <li key={r.playerId}>
                  <span>{state.players.find((p) => p.id === r.playerId)?.name}</span>
                  <b className="num">{r.holes ? `${fmt(r.value)} pts` : "–"}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// ------------------------------------------------------------ prizes

export function PrizesPanel() {
  const { state, summary, cfg } = useT();
  if (!state || !summary || !cfg || !summary.prizes.length) return null;
  const lines = prizeLines(state, summary, cfg);
  return (
    <section className="section panel prizes" aria-label="Prizes">
      <h2 style={{ marginBottom: 6 }}>Prizes</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Played for alongside the winner.{summary.win.kind === "points" && lines.some((l) => l.points) ? " A prize marked with points adds them to the winner's total." : ""}
      </p>
      <ul className="prize-list">
        {lines.map((l) => (
          <li key={l.key}>
            <span className="prize-t">{l.title}</span>
            <span className="prize-d">
              {l.detail || <span className="muted">Nobody yet</span>}
              {l.points && l.detail && <span className="prize-pts"> {l.points}</span>}
            </span>
            {l.detail && <span className={`prize-s${l.won ? " prize-won" : ""}`}>{l.status}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
