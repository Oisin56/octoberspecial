"use client";

import Link from "next/link";
import { useT } from "@/components/Providers";
import { Board, Feed, GameStatus, Loading, RoundItem, Paras, dateLabel, pts } from "@/components/ui";
import { formatLabel, toRoundCfg } from "@/lib/types";
import { courseBySlug } from "@/data/courses";
import { mediaUrl } from "@/lib/supabase";
import { roundPointsAvailable } from "@/lib/engine";

export default function Home() {
  const { state, summary, href, session } = useT();
  if (!state || !summary) return <Loading />;

  if (!state.rounds.length) {
    return (
      <div className="article">
        <h2>{state.tournament.name}</h2>
        <p>This tournament is still being set up.</p>
        {session?.role === "organiser" ? (
          <Link className="btn" href={href("/setup")}>
            Continue setup
          </Link>
        ) : (
          <p className="muted">Check back soon.</p>
        )}
      </div>
    );
  }

  const live = state.rounds.find((r) => r.status === "live");
  const next = live ?? state.rounds.find((r) => r.status === "upcoming");
  const lastDone = [...state.rounds].reverse().find((r) => r.status === "complete");
  const published = state.pieces.filter((p) => p.status === "published");
  const preview = next && published.find((p) => p.kind === "preview" && p.round_id === next.id);
  const report = lastDone && published.find((p) => p.kind === "report" && p.round_id === lastDone.id);
  const review = published.find((p) => p.kind === "tournament");
  const lead = review ?? (live ? null : report ?? preview);
  const leadRound = lead && state.rounds.find((r) => r.id === lead.round_id);
  const hero = mediaUrl(state.tournament.hero_path);

  return (
    <>
      {hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hero} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "cover", borderRadius: 10, marginBottom: 14, display: "block" }} />
      )}
      <Board />

      {live && (
        <section className="section">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2>
              Live: Round {live.number}, {live.course_name}
            </h2>
            <Link href={href("/live")} className="btn">
              Follow live
            </Link>
          </div>
          <div className="stack">
            {toRoundCfg(live, state.players)
              .games.slice(0, 4)
              .map((g, i) => (
                <GameStatus key={g.id} round={live} gameIndex={i} />
              ))}
          </div>
        </section>
      )}

      <div className="grid2 section">
        <div className="stack">
          {lead ? (
            <article className="article">
              <div className="byline">
                {lead.kind === "preview" ? "Preview" : lead.kind === "report" ? "Report" : "Tournament review"}
                {leadRound ? ` · Round ${leadRound.number}` : ""}
              </div>
              <h2 style={{ fontSize: 30 }}>{lead.title}</h2>
              <Paras text={lead.body.split(/\n\s*\n/).slice(0, 2).join("\n\n")} />
              {leadRound && (
                <p style={{ marginTop: 12 }}>
                  <Link className="btn secondary" href={href(`/rounds/${leadRound.number}`)}>
                    Read the full {lead.kind === "preview" ? "preview" : "report"}
                  </Link>
                </p>
              )}
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
                  {formatLabel(next)}, worth {pts(roundPointsAvailable(toRoundCfg(next, state.players)))} points.{" "}
                  {next.course_blurb ?? courseBySlug(next.course_slug.replace(/^local:/, ""))?.blurb}
                </p>
              </article>
            )
          )}

          <h2 style={{ marginTop: 24 }}>The rounds</h2>
          <div className="round-list">
            {state.rounds.map((r, i) => (
              <RoundItem key={r.id} round={r} index={i} />
            ))}
          </div>
        </div>

        <aside>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2>Latest</h2>
            <Link href={href("/feed")} className="small display">
              Full feed
            </Link>
          </div>
          <Feed limit={6} />
        </aside>
      </div>
    </>
  );
}
