"use client";

import { use } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Article, Comments, Feed, Loading, Scorecard, SegmentBoxes, dateLabel } from "@/components/ui";
import { FORMAT_LABEL } from "@/lib/types";
import { courseBySlug } from "@/data/courses";
import { mediaUrl } from "@/lib/supabase";

export default function RoundPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = use(params);
  const { state, summary, names } = useT();
  if (!state || !summary) return <Loading />;
  const round = state.rounds.find((r) => r.number === Number(n));
  if (!round) return <p>No round {n}.</p>;
  const idx = state.rounds.indexOf(round);
  const rs = summary.rounds[idx];
  const course = courseBySlug(round.course_slug);
  const pieces = state.pieces.filter((p) => p.round_id === round.id && p.status === "published");
  const preview = pieces.find((p) => p.kind === "preview");
  const report = pieces.find((p) => p.kind === "report");
  const clips = state.posts
    .filter((p) => p.round_id === round.id && p.kind === "video" && p.media_path)
    .sort((a, b) => (a.hole ?? 0) - (b.hole ?? 0) || a.created_at.localeCompare(b.created_at));
  const par = round.holes.reduce((a, h) => a + h.par, 0);
  const yards = round.holes.reduce((a, h) => a + (h.yards ?? 0), 0);
  const shots = Object.entries(round.shots ?? {}).filter(([, v]) => v > 0);

  return (
    <>
      <p className="display muted" style={{ margin: 0 }}>
        Round {round.number} of {state.rounds.length} · {dateLabel(round.play_date)}
        {round.tee_time ? ` · ${round.tee_time}` : ""}
      </p>
      <h1>{round.course_name}</h1>
      <p className="display" style={{ fontSize: 18, margin: "4px 0 12px" }}>
        {FORMAT_LABEL[round.format]} · {round.nine_points} + {round.nine_points} + {round.full_points} ={" "}
        {round.nine_points * 2 + round.full_points} points · Par {par}
        {yards ? ` · ${yards.toLocaleString()} yds (${round.tee})` : ""} ·{" "}
        {shots.length ? shots.map(([p, v]) => `${names[p]} gets ${v}`).join(", ") : "Off scratch (flat)"}
      </p>

      {rs.holesPlayed > 0 && <SegmentBoxes rs={rs} round={round} />}

      <div className="grid2 section">
        <div className="stack">
          {report && <Article piece={report} label="Match report" />}
          {preview && <Article piece={preview} label="Preview" />}
          {!report && !preview && course && (
            <div className="article">
              <h2>About the course</h2>
              <div className="byline">{course.location}</div>
              <p>{course.blurb}</p>
              <p className="muted small">The preview appears here before the round.</p>
            </div>
          )}

          <h2 style={{ marginTop: 16 }}>Scorecard</h2>
          <div className="panel">
            <Scorecard round={round} />
          </div>

          {clips.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Highlights</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {clips.length} clip{clips.length > 1 ? "s" : ""} in hole order.{" "}
                <Link href={`/highlights?round=${round.number}`}>Play them all</Link>
              </p>
              <div className="feed">
                {clips.slice(0, 4).map((c) => (
                  <div className="post" key={c.id}>
                    <div className="who display">
                      <span className="where">Hole {c.hole ?? "–"}</span> · {c.author_name}
                    </div>
                    {c.body && <p style={{ margin: "4px 0 0" }}>{c.body}</p>}
                    <video src={mediaUrl(c.media_path)!} controls playsInline preload="metadata" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="stack">
          <h2>From the course</h2>
          <Feed roundId={round.id} />
          <h2 style={{ marginTop: 24 }}>Comments</h2>
          <Comments roundId={round.id} />
        </div>
      </div>
    </>
  );
}
