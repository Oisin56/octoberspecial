"use client";

import Link from "next/link";
import { useT } from "@/components/Providers";
import { Board, Comments, Feed, Loading, Scorecard, SegmentBoxes } from "@/components/ui";
import { FORMAT_LABEL } from "@/lib/types";

export default function Live() {
  const { state, summary, session } = useT();
  if (!state || !summary) return <Loading />;
  const round =
    state.rounds.find((r) => r.status === "live") ??
    [...state.rounds].reverse().find((r) => r.status === "complete") ??
    state.rounds[0];
  const idx = state.rounds.indexOf(round);
  const rs = summary.rounds[idx];
  const isLive = round.status === "live";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1>
            {isLive ? "Live" : round.status === "complete" ? "Last round" : "Next round"}: R{round.number} {round.course_name}
          </h1>
          <p className="muted display" style={{ margin: "4px 0 0" }}>
            {FORMAT_LABEL[round.format]} · {isLive ? `thru ${rs.holesPlayed}` : `${rs.holesPlayed} holes played`}
          </p>
        </div>
        {session && (
          <div className="row">
            {(session.role === "organiser" || session.playerId === round.scorer_id) && (
              <Link className="btn" href={`/score?round=${round.number}`}>
                Enter scores
              </Link>
            )}
            <Link className="btn secondary" href={`/post?round=${round.number}`}>
              Add a post
            </Link>
          </div>
        )}
      </div>

      <SegmentBoxes rs={rs} round={round} />

      <div className="grid2 section">
        <div className="stack">
          <h2>Scorecard</h2>
          <div className="panel">
            <Scorecard round={round} />
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
