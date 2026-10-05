"use client";

import { useT } from "@/components/Providers";
import { Board, Loading, pts } from "@/components/ui";
import { SIDE_GAME_LABEL, formatLabel } from "@/lib/types";

const SERIES = ["var(--board)", "var(--red)", "var(--bracken)", "#1d4f91", "#6b4c9a", "#2e7d4f", "#b0582b", "#4a5560"];

export default function Leaderboard() {
  const { state, summary, cfg } = useT();
  if (!state || !summary || !cfg) return <Loading />;
  const teamMode = cfg.teams.length >= 2;
  const fin = summary.complete;

  const entities = teamMode
    ? cfg.teams.map((t) => ({ id: t.id, name: t.name, perRound: summary.rounds.map((r) => r.teamPoints[t.id] ?? 0), total: fin ? summary.teamTotal[t.id] : summary.teamProjected[t.id] }))
    : cfg.players.map((p) => ({ id: p.id, name: p.name, perRound: summary.rounds.map((r) => r.playerPoints[p.id] ?? 0), total: fin ? summary.playerTotal[p.id] : summary.playerProjected[p.id] }));
  entities.sort((a, b) => b.total - a.total);
  const awardsFor = summary.awards.filter((a) => (cfg.sideGames.find((g) => g.kind === a.kind)?.points ?? 0) > 0 && (cfg.sideGamesBy === "team") === teamMode);
  const tallies = summary.awards.filter((a) => !awardsFor.includes(a));
  const played = summary.rounds.filter((r) => r.games.some((g) => g.holesPlayed > 0)).length;

  return (
    <>
      <h1 style={{ marginBottom: 14 }}>Leaderboard</h1>
      <Board />

      <section className="section panel">
        <h2 style={{ marginBottom: 8 }}>Points by round</h2>
        <div className="card-scroll">
          <table className="stats">
            <thead>
              <tr>
                <th>{teamMode ? "Team" : "Player"}</th>
                <th>Total</th>
                {state.rounds.map((r) => (
                  <th key={r.id} title={`${r.course_name}: ${formatLabel(r)}`}>
                    R{r.number}
                  </th>
                ))}
                {awardsFor.map((a) => (
                  <th key={a.kind} title={SIDE_GAME_LABEL[a.kind]}>
                    {a.kind.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {pts(e.total)}
                  </td>
                  {e.perRound.map((v, i) => (
                    <td key={i} className="num">
                      {summary.rounds[i].games.some((g) => g.holesPlayed) ? pts(v) : ""}
                    </td>
                  ))}
                  {awardsFor.map((a) => (
                    <td key={a.kind} className="num" title={`count ${a.counts[e.id] ?? 0}`}>
                      {fin ? pts(a.points[e.id] ?? 0) : <span className="muted">({pts(a.projected[e.id] ?? 0)})</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {pts(summary.pointsAvailable)} points available. {awardsFor.length > 0 && !fin && "Bracketed side-game points show who would win them if it ended now. "}
          {awardsFor.map((a) => `${a.kind.toUpperCase()} = ${SIDE_GAME_LABEL[a.kind].toLowerCase()}`).join(", ")}
        </p>
      </section>

      {teamMode && (
        <section className="section panel">
          <h2 style={{ marginBottom: 8 }}>Player contributions</h2>
          <table className="stats">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Points won</th>
              </tr>
            </thead>
            <tbody>
              {[...cfg.players]
                .sort((a, b) => summary.playerRoundPoints[b.id] - summary.playerRoundPoints[a.id])
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{cfg.teams.find((t) => t.id === p.teamId)?.name ?? ""}</td>
                    <td className="num">{pts(summary.playerRoundPoints[p.id])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section grid2">
        <div className="panel">
          <h2 style={{ marginBottom: 8 }}>Race chart</h2>
          <RaceChart
            series={entities.map((e) => {
              let run = 0;
              return [0, ...e.perRound.map((v) => (run += v))];
            })}
            names={entities.map((e) => e.name)}
            rounds={state.rounds.length}
            played={played}
          />
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 8 }}>Tallies</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Counted across the whole event. Birdies and eagles are gross.
          </p>
          <div className="card-scroll">
            <table className="stats">
              <thead>
                <tr>
                  <th></th>
                  {tallies.concat(awardsFor).map((a) => (
                    <th key={a.kind}>{SIDE_GAME_LABEL[a.kind]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cfg.players.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {tallies.concat(awardsFor).map((a) => (
                      <td key={a.kind} className="num">
                        {summary.tallies[a.kind][p.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function RaceChart({ series, names, rounds, played }: { series: number[][]; names: string[]; rounds: number; played: number }) {
  const W = 480;
  const H = 240;
  const pad = { l: 34, r: 70, t: 12, b: 26 };
  const max = Math.max(4, ...series.flat());
  const x = (i: number) => pad.l + (i / Math.max(1, rounds)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  // Spread end labels so they don't overlap
  const ends = series
    .map((s, i) => ({ i, y: y(s[played] ?? 0) }))
    .sort((a, b) => a.y - b.y)
    .map((e, k, arr) => {
      if (k > 0 && e.y - arr[k - 1].y < 14) e.y = arr[k - 1].y + 14;
      return e;
    });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Running points total after each round" style={{ width: "100%", height: "auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--ink-soft)" fontFamily="var(--font-display)">
            {t}
          </text>
        </g>
      ))}
      {Array.from({ length: rounds + 1 }, (_, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--ink-soft)" fontFamily="var(--font-display)">
          {i === 0 ? "Start" : `R${i}`}
        </text>
      ))}
      {series.slice(0, SERIES.length).map((s, si) => (
        <polyline
          key={si}
          fill="none"
          stroke={SERIES[si]}
          strokeWidth="3"
          strokeLinejoin="round"
          points={s.slice(0, played + 1).map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        />
      ))}
      {played > 0 &&
        ends
          .filter((e) => e.i < SERIES.length)
          .map((e) => (
            <text key={e.i} x={x(played) + 6} y={e.y + 4} fontSize="13" fontWeight="700" fill={SERIES[e.i]} fontFamily="var(--font-display)">
              {names[e.i]}
            </text>
          ))}
    </svg>
  );
}
