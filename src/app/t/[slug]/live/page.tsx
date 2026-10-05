"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/Providers";
import { Board, Comments, Feed, GameStatus, Loading, Scorecard, gameLine } from "@/components/ui";
import { formatLabel, sideLabel, toRoundCfg } from "@/lib/types";

export default function Live() {
  const { state, summary, session, href } = useT();
  const [gi, setGi] = useState(0);
  if (!state || !summary) return <Loading />;
  if (!state.rounds.length) return <p>No rounds yet.</p>;
  const round =
    state.rounds.find((r) => r.status === "live") ??
    [...state.rounds].reverse().find((r) => r.status === "complete") ??
    state.rounds[0];
  const ri = state.rounds.indexOf(round);
  const rs = summary.rounds[ri];
  const cfg = toRoundCfg(round, state.players);
  const isLive = round.status === "live";
  const game = cfg.games[Math.min(gi, cfg.games.length - 1)];
  const canScoreAny = session && (session.role === "organiser" || cfg.games.some((g) => g.scorerId === session.playerId));

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1>
            {isLive ? "Live" : round.status === "complete" ? "Last round" : "Next round"}: R{round.number} {round.course_name}
          </h1>
          <p className="muted display" style={{ margin: "4px 0 0" }}>
            {formatLabel(round)} · {cfg.games.length > 1 ? `${cfg.games.length} matches` : rs.holesPlayed ? `thru ${rs.games[0].holesPlayed}` : "not started"}
          </p>
        </div>
        {session && (
          <div className="row">
            {canScoreAny && (
              <Link className="btn" href={href(`/score?round=${round.number}`)}>
                Enter scores
              </Link>
            )}
            <Link className="btn secondary" href={href(`/post?round=${round.number}`)}>
              Add a post
            </Link>
          </div>
        )}
      </div>

      {cfg.games.length > 1 && (
        <div className="round-list" style={{ marginBottom: 14 }}>
          {cfg.games.map((g, i) => (
            <button
              key={g.id}
              className="round-item"
              style={{ gridTemplateColumns: "1fr auto", textAlign: "left", cursor: "pointer", borderColor: i === gi ? "var(--board)" : undefined, font: "inherit" }}
              onClick={() => setGi(i)}
              aria-pressed={i === gi}
            >
              <span>
                <span className="display" style={{ fontWeight: 700, fontSize: 18, display: "block" }}>
                  {g.name ?? `Match ${i + 1}`}
                </span>
                <span className="meta">{g.sides.map((s) => sideLabel(s.id, g, state.players)).join(" v ")}</span>
              </span>
              <span className="res">{gameLine(round, g, rs.games[i], state.players)}</span>
            </button>
          ))}
        </div>
      )}

      <GameStatus round={round} gameIndex={cfg.games.indexOf(game)} compact={cfg.games.length === 1} />

      <div className="grid2 section">
        <div className="stack">
          <h2>Scorecard{cfg.games.length > 1 ? `: ${game.name ?? `Match ${gi + 1}`}` : ""}</h2>
          <div className="panel">
            <Scorecard round={round} gameIndex={cfg.games.indexOf(game)} />
          </div>
          <h2 style={{ marginTop: 24 }}>Overall</h2>
          <Board />
        </div>
        <div className="stack">
          <h2>Bulletins and posts</h2>
          <Feed roundId={round.id} />
          <h2 style={{ marginTop: 24 }}>Say something</h2>
          <Comments roundId={round.id} />
        </div>
      </div>
    </>
  );
}
