"use client";

import Link from "next/link";
import { useT } from "@/components/Providers";
import { EmailSignup } from "@/components/EmailAdmin";
import { cleanBody, cleanTitle } from "@/lib/cleanText";
import { Board, Feed, GameStatus, Loading, RoundItem, Paras, dateLabel, pts } from "@/components/ui";
import { formatLabel, toRoundCfg } from "@/lib/types";
import { courseBySlug } from "@/data/courses";
import { mediaUrl } from "@/lib/supabase";
import { roundPointsAvailable } from "@/lib/engine";
import { CourseImage, PhotoCredit, useCountdown } from "@/components/visual";
import type { RoundRow, TournamentState } from "@/lib/types";

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
  const liveStatus = (r: RoundRow) => {
    const rs = summary.rounds[state.rounds.indexOf(r)];
    if (!rs) return null;
    return rs.games.length === 1 ? rs.games[0].full.matchLabel ?? `thru ${rs.games[0].holesPlayed}` : `${rs.games.filter((g) => g.complete).length} of ${rs.games.length} matches done`;
  };
  const next = live ?? state.rounds.find((r) => r.status === "upcoming");
  const lastDone = [...state.rounds].reverse().find((r) => r.status === "complete");
  const published = state.pieces.filter((p) => p.status === "published");
  const preview = next && published.find((p) => p.kind === "preview" && p.round_id === next.id);
  const report = lastDone && published.find((p) => p.kind === "report" && p.round_id === lastDone.id);
  const review = published.find((p) => p.kind === "tournament");
  // Whole-tournament preview leads until the first round is under way
  const tPreview = !lastDone && !live ? published.find((p) => p.kind === "preview" && !p.round_id) : undefined;
  const lead = review ?? (live ? null : report ?? preview ?? tPreview);
  const leadRound = lead && state.rounds.find((r) => r.id === lead.round_id);
  const hero = mediaUrl(state.tournament.hero_path);

  return (
    <>
      <HomeHero state={state} hero={hero} live={live ?? null} next={next ?? null} lastDone={lastDone ?? null} complete={summary.complete} liveLabel={live ? liveStatus(live) : null} />
      <div className="section-tight">
        <Board />
      </div>

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

      <section className="section">
        <div className="section-head">
          <h2>The rounds</h2>
          <Link href={href("/rounds")} className="small display">
            All rounds
          </Link>
        </div>
        <div className="round-grid">
          {state.rounds.map((r, i) => (
            <RoundItem key={r.id} round={r} index={i} />
          ))}
        </div>
      </section>

      <div className="grid2 section">
        <div className="stack">
          {lead ? (
            <article className="article">
              <div className="byline">
                {lead.kind === "preview" ? (lead.round_id ? "Preview" : "Tournament preview") : lead.kind === "report" ? "Report" : "Tournament review"}
                {leadRound ? ` · Round ${leadRound.number}` : ""}
              </div>
              <h2 style={{ fontSize: 30 }}>{cleanTitle(lead.title ?? "")}</h2>
              <Paras text={leadRound ? cleanBody(lead.body).split(/\n\s*\n/).slice(0, 2).join("\n\n") : lead.body} />
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

          <EmailSignup />
        </div>

        <aside>
          <div className="section-head">
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

function HomeHero({
  state,
  hero,
  live,
  next,
  lastDone,
  complete,
  liveLabel,
}: {
  state: TournamentState;
  hero: string | null;
  live: RoundRow | null;
  next: RoundRow | null;
  lastDone: RoundRow | null;
  complete: boolean;
  liveLabel: string | null;
}) {
  const { href } = useT();
  const countdown = useCountdown(next && !live ? next.play_date : null, next && !live ? next.tee_time : null);
  const focus = live ?? next ?? lastDone;
  const t = state.tournament;
  return (
    <section className="hero">
      <div className="hero-img">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hero} alt="" />
        ) : focus ? (
          <CourseImage round={focus} sizes="(min-width: 1040px) 1040px, 100vw" priority />
        ) : null}
      </div>
      <div className="hero-shade" />
      <div className="hero-content">
        <div className="hero-kicker">
          {live ? (
            <span className="live-badge">Live</span>
          ) : complete ? (
            <span className="hero-chip">Final</span>
          ) : next ? (
            <span className="hero-chip">Next up</span>
          ) : null}
          {focus && (
            <span>
              Round {focus.number} · {focus.course_name}
              {live && liveLabel ? ` · ${liveLabel}` : !live && next ? ` · ${dateLabel(next.play_date)}${next.tee_time ? ` ${next.tee_time.slice(0, 5)}` : ""}` : ""}
            </span>
          )}
        </div>
        <h1 className="hero-title">{t.name}</h1>
        {t.subtitle && <p className="hero-sub">{t.subtitle}</p>}
        <div className="hero-actions">
          {live ? (
            <Link className="btn glow" href={href("/live")}>
              Follow it live
            </Link>
          ) : (
            countdown && <span className="hero-count">{countdown[0].toUpperCase() + countdown.slice(1)}</span>
          )}
          <Link className="btn ghost" href={href("/leaderboard")}>
            Leaderboard
          </Link>
        </div>
      </div>
      {!hero && focus && (
        <div className="hero-credit">
          <PhotoCredit round={focus} />
        </div>
      )}
    </section>
  );
}
