"use client";

import Link from "next/link";
import { useT } from "@/components/Providers";
import { Board, Feed, Loading, RoundItem, SegmentBoxes, Paras, dateLabel } from "@/components/ui";
import { FORMAT_LABEL } from "@/lib/types";
import { courseBySlug } from "@/data/courses";

export default function Home() {
  const { state, summary } = useT();
  if (!state || !summary) return <Loading />;

  const live = state.rounds.find((r) => r.status === "live");
  const next = live ?? state.rounds.find((r) => r.status === "upcoming");
  const nextIdx = next ? state.rounds.indexOf(next) : -1;
  const lastDone = [...state.rounds].reverse().find((r) => r.status === "complete");

  const published = state.pieces.filter((p) => p.status === "published");
  const preview = next && published.find((p) => p.kind === "preview" && p.round_id === next.id);
  const report = lastDone && published.find((p) => p.kind === "report" && p.round_id === lastDone.id);
  const lead = live ? null : report ?? preview;

  return (
    <>
      <Board />

      {live && nextIdx >= 0 && (
        <section className="section">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2>
              Live: Round {live.number}, {live.course_name}
            </h2>
            <Link href="/live" className="btn">
              Follow live
            </Link>
          </div>
          <SegmentBoxes rs={summary.rounds[nextIdx]} round={live} />
        </section>
      )}

      <div className="grid2 section">
        <div className="stack">
          {lead ? (
            <article className="article">
              <div className="byline">
                {lead.kind === "preview" ? "Preview" : "Match report"} · Round{" "}
                {state.rounds.find((r) => r.id === lead.round_id)?.number}
              </div>
              <h2 style={{ fontSize: 30 }}>{lead.title}</h2>
              <Paras text={lead.body.split(/\n\s*\n/).slice(0, 2).join("\n\n")} />
              <p style={{ marginTop: 12 }}>
                <Link
                  className="btn secondary"
                  href={`/rounds/${state.rounds.find((r) => r.id === lead.round_id)?.number}`}
                >
                  Read the full {lead.kind === "preview" ? "preview" : "report"}
                </Link>
              </p>
            </article>
          ) : (
            next &&
            !live && (
              <article className="article">
                <div className="byline">Next up · {dateLabel(next.play_date)}</div>
                <h2 style={{ fontSize: 30 }}>
                  Round {next.number}: {next.course_name}
                </h2>
                <p>
                  {FORMAT_LABEL[next.format]}, worth {next.nine_points * 2 + next.full_points} points.{" "}
                  {courseBySlug(next.course_slug)?.blurb}
                </p>
              </article>
            )
          )}

          <h2 style={{ marginTop: 24 }}>The rounds</h2>
          <div className="round-list">
            {state.rounds.map((r, i) => (
              <RoundItem key={r.id} round={r} rs={summary.rounds[i]} />
            ))}
          </div>
        </div>

        <aside>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2>Latest</h2>
            <Link href="/feed" className="small display">
              Full feed
            </Link>
          </div>
          <Feed limit={6} />
        </aside>
      </div>
    </>
  );
}
