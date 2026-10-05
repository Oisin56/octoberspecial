"use client";

import { useT } from "@/components/Providers";
import { Board, Loading, pts } from "@/components/ui";
import { FORMAT_LABEL, toTournamentConfig } from "@/lib/types";
import { totalPointsAvailable } from "@/lib/scoring";

export default function Leaderboard() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;
  const players = state.players;
  const total = totalPointsAvailable(toTournamentConfig(state));

  // Running totals after each round, for the chart
  const series = players.map((p) => {
    let run = 0;
    return [0, ...summary.rounds.map((r) => (run += r.points[p.id]))];
  });
  const played = summary.rounds.filter((r) => r.holesPlayed > 0).length;

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
                <th>Round</th>
                <th>Front</th>
                <th>Back</th>
                <th>18</th>
                {players.map((p) => (
                  <th key={p.id}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rounds.map((r, i) => {
                const rs = summary.rounds[i];
                const seg = (s: typeof rs.front) =>
                  !s.complete ? (s.holesPlayed ? "…" : "") : s.leaders.length > 1 ? "Halved" : state.players.find((p) => p.id === s.leaders[0])?.name;
                return (
                  <tr key={r.id}>
                    <td>
                      R{r.number} {r.course_name}
                      <div className="small muted">
                        {FORMAT_LABEL[r.format]} · {r.nine_points * 2 + r.full_points}
                      </div>
                    </td>
                    <td>{seg(rs.front)}</td>
                    <td>{seg(rs.back)}</td>
                    <td>{seg(rs.full)}</td>
                    {players.map((p) => (
                      <td key={p.id} className="num">
                        {rs.holesPlayed ? pts(rs.points[p.id]) : ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {(
                [
                  ["Closest to pin", summary.ctp, state.tournament.ctp_points],
                  ["Long drive", summary.ld, state.tournament.ld_points],
                  ["Greens in regulation", summary.gir, state.tournament.gir_points],
                ] as const
              ).map(([label, a, pot]) => (
                <tr key={label}>
                  <td>
                    {label}
                    <div className="small muted">
                      {pot} pts · {summary.complete ? "final" : "awarded at the end"} · count{" "}
                      {players.map((p) => a.counts[p.id]).join("–")}
                    </div>
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                  {players.map((p) => (
                    <td key={p.id} className="num">
                      {summary.complete ? pts(a.points[p.id]) : <span className="muted">({pts(a.projectedPoints[p.id])})</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  Total <span className="small muted">of {total}</span>
                </td>
                {players.map((p) => (
                  <td key={p.id} className="num">
                    {pts(summary.complete ? summary.totalPoints[p.id] : summary.projectedTotal[p.id])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted">Bracketed side-game points show who would win them if the trip ended now.</p>
      </section>

      <section className="section grid2">
        <div className="panel">
          <h2 style={{ marginBottom: 8 }}>Race chart</h2>
          <RaceChart series={series} names={players.map((p) => p.name)} rounds={state.rounds.length} played={played} />
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 8 }}>Birdie and eagle tally</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Gross. Settled separately, no points.</p>
          <table className="stats">
            <thead>
              <tr>
                <th></th>
                <th>Birdies</th>
                <th>Eagles</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{summary.birdies[p.id]}</td>
                  <td className="num">{summary.eagles[p.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>By round</h3>
          <table className="stats">
            <thead>
              <tr>
                <th></th>
                {players.map((p) => (
                  <th key={p.id}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rounds.map((r, i) =>
                summary.rounds[i].holesPlayed ? (
                  <tr key={r.id}>
                    <td>R{r.number}</td>
                    {players.map((p) => (
                      <td key={p.id} className="num">
                        {summary.rounds[i].birdies[p.id]}
                        {summary.rounds[i].eagles[p.id] ? ` + ${summary.rounds[i].eagles[p.id]} eagle` : ""}
                      </td>
                    ))}
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RaceChart({ series, names, rounds, played }: { series: number[][]; names: string[]; rounds: number; played: number }) {
  const W = 480;
  const H = 220;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const max = Math.max(40, ...series.flat());
  const x = (i: number) => pad.l + (i / rounds) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const colors = ["var(--board)", "var(--red)"];
  const ticks = [0, Math.round(max / 2), max];
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
      {series.map((s, si) => (
        <g key={si}>
          <polyline
            fill="none"
            stroke={colors[si % 2]}
            strokeWidth="3"
            strokeLinejoin="round"
            points={s.slice(0, played + 1).map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
          {played > 0 && (
            <text
              x={x(played) + 6}
              y={y(s[played]) + 4}
              fontSize="14"
              fontWeight="700"
              fill={colors[si % 2]}
              fontFamily="var(--font-display)"
            >
              {names[si]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
