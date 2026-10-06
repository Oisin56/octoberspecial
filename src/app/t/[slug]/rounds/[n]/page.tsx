"use client";

import { use } from "react";
import Link from "next/link";
import { useT } from "@/components/Providers";
import { Article, Comments, Feed, GameStatus, Loading, Scorecard, dateLabel, pts } from "@/components/ui";
import { PLAY_LABEL, SCORING_LABEL, ballName, toRoundCfg } from "@/lib/types";
import { courseBySlug } from "@/data/courses";
import { GUIDES } from "@/data/course-guides";
import { mediaUrl } from "@/lib/supabase";
import { gameShots } from "@/lib/engine";

export default function RoundPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = use(params);
  const { state, summary, cfg: tcfg, href } = useT();
  if (!state || !summary || !tcfg) return <Loading />;
  const round = state.rounds.find((r) => r.number === Number(n));
  if (!round) return <p>No round {n}.</p>;
  const cfg = toRoundCfg(round, state.players);
  const local = courseBySlug(round.course_slug.replace(/^local:/, ""));
  const blurb = round.course_blurb ?? local?.blurb;
  const location = round.course_location ?? local?.location;
  const guide = round.course_guide ?? (local ? GUIDES[local.slug] : null);
  const pieces = state.pieces.filter((p) => p.round_id === round.id && p.status === "published");
  const preview = pieces.find((p) => p.kind === "preview");
  const report = pieces.find((p) => p.kind === "report");
  const clips = state.posts
    .filter((p) => p.round_id === round.id && p.kind === "video" && p.media_path)
    .sort((a, b) => (a.hole ?? 0) - (b.hole ?? 0) || a.created_at.localeCompare(b.created_at));
  const par = round.holes.reduce((a, h) => a + h.par, 0);
  const yards = round.holes.reduce((a, h) => a + (h.yards ?? 0), 0);
  const hcp =
    cfg.handicap.mode === "allowance"
      ? `${cfg.handicap.pct}% handicap allowance${cfg.handicap.relative ? ", off the lowest" : ""}`
      : null;
  const pointsLine =
    cfg.scoring === "skins"
      ? `Skins: ${pts(cfg.points.skin ?? 1)} pt each, ties carry over`
      : `${[cfg.points.front > 0 && `${pts(cfg.points.front)} front 9`, cfg.points.back > 0 && `${pts(cfg.points.back)} back 9`, `${pts(cfg.points.full)} for the 18`]
          .filter(Boolean)
          .join(" + ")}${cfg.games.length > 1 ? " per match" : ""}`;

  return (
    <>
      <p className="display muted" style={{ margin: 0 }}>
        Round {round.number} of {state.rounds.length} · {dateLabel(round.play_date)}
        {round.tee_time ? ` · ${round.tee_time}` : ""}
      </p>
      <h1>{round.course_name}</h1>
      <p className="display" style={{ fontSize: 18, margin: "4px 0 12px" }}>
        {cfg.play === "singles" ? SCORING_LABEL[cfg.scoring] : `${PLAY_LABEL[cfg.play]}, ${SCORING_LABEL[cfg.scoring].toLowerCase()}`} · {pointsLine} · Par {par}
        {yards ? ` · ${yards.toLocaleString()} yds (${round.tee})` : ""}
        {hcp ? ` · ${hcp}` : ""}
      </p>

      <div className="stack">
        {cfg.games.map((g, i) => {
          const shots = gameShots(cfg, g, tcfg.players);
          const given = Object.entries(shots).filter(([, v]) => v > 0);
          return (
            <div key={g.id}>
              <GameStatus round={round} gameIndex={i} />
              {cfg.games.length === 1 && (
                <p className="small muted display" style={{ margin: "6px 0 0" }}>
                  {given.length ? given.map(([b, v]) => `${ballName(b, g, state.players)} gets ${v}`).join(", ") : "Off scratch (no shots)"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid2 section">
        <div className="stack">
          {report && <Article piece={report} label="Report" />}
          {preview && <Article piece={preview} label="Preview" />}
          {!report && !preview && (
            <div className="article">
              <h2>About the course</h2>
              {location && <div className="byline">{location}</div>}
              {blurb && <p>{blurb}</p>}
              <p className="muted small">The preview appears here before the round.</p>
            </div>
          )}

          {cfg.games.map((g, i) => (
            <div key={g.id} className="stack">
              <h2 style={{ marginTop: 16 }}>
                Scorecard{cfg.games.length > 1 ? `: ${g.name ?? `Match ${i + 1}`}` : ""}
              </h2>
              <div className="panel">
                <Scorecard round={round} gameIndex={i} />
              </div>
            </div>
          ))}

          {guide && (guide.overview || Object.keys(guide.holes).length > 0) && (
            <details className="article course-guide">
              <summary>
                <h2 style={{ display: "inline" }}>Course guide</h2>
              </summary>
              {location && <div className="byline">{location}</div>}
              {guide.overview && <p>{guide.overview}</p>}
              {guide.signature && <p>{guide.signature}</p>}
              <ol className="hole-guide">
                {round.holes.map((h) => (
                  <li key={h.number}>
                    <span className="display">
                      {h.number} · Par {h.par}
                      {h.yards ? ` · ${h.yards} yds` : ""} · SI {h.si}
                    </span>
                    {guide.holes[String(h.number)] && <span> {guide.holes[String(h.number)]}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}

          {clips.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Highlights</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {clips.length} clip{clips.length > 1 ? "s" : ""} in hole order.{" "}
                <Link href={href(`/highlights?round=${round.number}`)}>Play them all</Link>
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
