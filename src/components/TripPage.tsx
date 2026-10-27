"use client";

import Link from "next/link";
import { useT } from "./Providers";
import { Paras, Scorecard, dateLabel } from "./ui";
import { PrizesPanel } from "./WinBoards";
import { SocialFeed } from "./SocialFeed";
import { cleanTitle } from "@/lib/cleanText";
import { clipUrl, mediaUrl } from "@/lib/supabase";
import { bestMoments, filmPost, finalStandings } from "@/lib/trip";
import { soloRounds, soloTotal } from "@/lib/solo";
import { FILM_KEPT } from "@/lib/types";
import type { PostRow, TournamentState } from "@/lib/types";

/**
 * A finished tournament's home page. A group trip tells its story top to bottom: the winner, the film, the final top
 * five, the prizes, the best moments, the final report, then links to everything else. A round on your own shows the
 * film, the score and the card, the photos, the write-up and the comments. Any part with nothing in it is left out.
 */

const tripDates = (s: TournamentState) => {
  const days = s.rounds.map((r) => r.play_date).filter(Boolean).sort() as string[];
  if (!days.length) return "";
  const a = dateLabel(days[0]);
  const b = dateLabel(days[days.length - 1]);
  return a === b ? a : `${a} to ${b}`;
};

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]!.toUpperCase())
    .join("");

/** The film, big, with the 12-month line and Download. The organiser sees where it was if it was removed. */
function FilmBlock({ post, title }: { post: PostRow; title: string }) {
  const src = mediaUrl(post.media_path);
  if (!src) return null;
  const stored = !!post.media_path && !/^https?:/i.test(post.media_path);
  const poster = stored ? mediaUrl(`${post.media_path}.jpg`) : null;
  const file = `${title.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "film"}.mp4`;
  return (
    <section className="tp-film section-tight" id="film" aria-label="The film">
      <video className="tp-video" src={src} poster={poster ?? undefined} controls playsInline preload="metadata" />
      <div className="tp-film-foot">
        <p className="small">{FILM_KEPT}</p>
        <a className="btn secondary" href={`${src}${src.includes("?") ? "&" : "?"}download=${encodeURIComponent(file)}`} download={file}>
          Download
        </a>
      </div>
    </section>
  );
}

function Moments({ posts, heading, more }: { posts: PostRow[]; heading: string; more: { label: string; href: string } }) {
  const { href } = useT();
  if (!posts.length) return null;
  return (
    <section className="section" aria-label={heading}>
      <div className="section-head">
        <h2>{heading}</h2>
        <Link href={more.href} className="small display">
          {more.label}
        </Link>
      </div>
      <div className="tp-moments">
        {posts.map((p) =>
          p.kind === "video" ? (
            <Link key={p.id} className="tp-moment" href={href(`/highlights?v=${p.id}`)} aria-label={p.body ? `Clip: ${p.body}` : `Clip from ${p.author_name}`}>
              <video src={clipUrl(p) ?? undefined} poster={mediaUrl(`${p.media_path}.jpg`) ?? undefined} muted playsInline preload="metadata" />
              <span className="tp-play" aria-hidden="true" />
            </Link>
          ) : (
            <Link key={p.id} className="tp-moment" href={href("/feed")} aria-label={p.body ? `Photo: ${p.body}` : `Photo from ${p.author_name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(p.media_path) ?? ""} alt="" loading="lazy" />
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

function EndPiece({ s, label }: { s: TournamentState; label: string }) {
  const piece = s.pieces.filter((p) => p.kind === "tournament" && p.status === "published").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  if (!piece) return null;
  return (
    <article className="article section">
      <div className="byline">{label}</div>
      <h2 style={{ fontSize: 30 }}>{cleanTitle(piece.title ?? "")}</h2>
      <Paras text={piece.body} />
    </article>
  );
}

// ------------------------------------------------------------ a group trip

export function TripPage() {
  const { state, summary, cfg, href, session } = useT();
  if (!state || !summary || !cfg) return null;
  const t = state.tournament;
  const fin = finalStandings(state, summary, cfg);
  const w = fin.winner;
  const photo = w && !w.team && w.playerIds[0] ? mediaUrl(state.players.find((p) => p.id === w.playerIds[0])?.photo_path) : null;
  const film = filmPost(state);
  const moments = bestMoments(state, 6);
  const top = fin.rows.slice(0, 5);
  const organiser = session?.role === "organiser";
  return (
    <div className="trip-page">
      <header className="tp-head">
        <p className="tp-kicker">
          <span className="tp-final">Final</span> {tripDates(state)}
        </p>
        <h1>{t.name}</h1>
        {t.subtitle && <p className="tp-sub">{t.subtitle}</p>}
      </header>

      {w && (
        <section className="tp-winner" aria-label="The winner">
          <span className="tp-face" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo ? <img src={photo} alt="" /> : <span>{initials(w.name)}</span>}
          </span>
          <div>
            <p className="tp-label">Winner of {t.name}</p>
            <p className="tp-name">{w.name}</p>
            <p className="tp-score">{w.score}</p>
            {w.team && w.playerIds.length > 0 && <p className="tp-team">{w.playerIds.map((id) => state.players.find((p) => p.id === id)?.name).filter(Boolean).join(", ")}</p>}
          </div>
        </section>
      )}

      {film && <FilmBlock post={film} title={t.name} />}
      {!film && organiser && t.film_removed_at && <p className="tp-gone">The film was removed after 12 months.</p>}
      {film && (
        <p className="tp-more">
          <Link href={href("/highlights")}>Every clip in Highlights</Link>
        </p>
      )}

      {top.length > 0 && (
        <section className="section" aria-label="Final leaderboard">
          <div className="section-head">
            <h2>Final leaderboard</h2>
            <Link href={href("/leaderboard")} className="small display">
              See full leaderboard
            </Link>
          </div>
          <ol className="tp-board">
            {top.map((r) => (
              <li key={r.key} className={r.pos === "1" || r.pos === "T1" ? "first" : undefined}>
                <span className="pos">{r.pos}</span>
                <span className="nm">{r.name}</span>
                <span className="sc">{r.score}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <PrizesPanel />

      <Moments posts={moments} heading="Best moments" more={{ label: "Full feed", href: href("/feed") }} />

      <EndPiece s={state} label="Final report" />

      <nav className="tp-links section" aria-label="Everything else">
        <Link className="btn secondary" href={href("/feed")}>
          The full feed
        </Link>
        <Link className="btn secondary" href={href("/rounds")}>
          Round by round
        </Link>
        <Link className="btn secondary" href={href("/leaderboard")}>
          Scorecards and leaderboard
        </Link>
      </nav>

      {organiser && (
        <section className="tp-again section" aria-label="Next year">
          <h2>Next year</h2>
          <p>Same name, the year moved on, the same players already filled in.</p>
          <Link className="btn block" href={`/new?again=${encodeURIComponent(t.slug)}`}>
            Set up next year&apos;s trip
          </Link>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------ a round (or a trip) on your own

export function RoundPage() {
  const { state, href, session } = useT();
  if (!state) return null;
  const t = state.tournament;
  const me = state.players[0];
  const golfer = session?.role === "organiser" || (!!me && session?.playerId === me.id);
  const rounds = soloRounds(state);
  const played = rounds.filter((r) => r.played);
  const one = state.rounds.length === 1;
  const first = (me?.name ?? "").trim().split(/\s+/)[0] || "Their";
  const title = one ? `${golfer ? "My" : `${first}'s`} round at ${rounds[0]?.course ?? t.name}` : t.name;
  const film = filmPost(state);
  const moments = bestMoments(state, 9);
  const total = soloTotal(rounds);
  return (
    <div className="trip-page round-page">
      <header className="tp-head">
        <p className="tp-kicker">{tripDates(state)}</p>
        <h1>{title}</h1>
        {!one && t.subtitle && <p className="tp-sub">{t.subtitle}</p>}
      </header>

      {film ? (
        <FilmBlock post={film} title={title} />
      ) : golfer && t.film_removed_at ? (
        <p className="tp-gone">The film was removed after 12 months.</p>
      ) : (
        golfer &&
        t.video_enabled !== false && (
          <section className="tp-make section-tight">
            <p>Make a film of your round: your clips, with commentary.</p>
            <Link className="btn" href={href("/film")}>
              Make your film
            </Link>
          </section>
        )
      )}

      {one && played[0] ? (
        <section className="section" aria-label="The score">
          <p className="tp-big">
            <span className="big">{played[0].big}</span>
            <span className="small">{played[0].small}</span>
          </p>
          <Scorecard round={state.rounds[0]} gameIndex={0} badge={false} />
        </section>
      ) : (
        played.length > 0 && (
          <section className="section" aria-label="The scores">
            {total && (
              <p className="tp-big">
                <span className="big">{total.split(" ")[0]}</span>
                <span className="small">{total.split(" ").slice(1).join(" ")}</span>
              </p>
            )}
            <ol className="tp-board tp-rounds">
              {rounds.map((r) => (
                <li key={r.id}>
                  <Link href={href(`/card?round=${r.number}`)}>
                    <span className="pos">R{r.number}</span>
                    <span className="nm">
                      {r.course}
                      {r.date && <small>{dateLabel(r.date)}</small>}
                    </span>
                    <span className="sc">{r.score || "Not played"}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )
      )}

      <Moments posts={moments} heading="Photos and clips" more={{ label: "See them all", href: href("/highlights") }} />

      <EndPiece s={state} label={one ? "The round" : "The trip"} />

      {t.feed_on !== false && state.comments.some((c) => !c.hidden) && (
        <section className="section" aria-label="Comments">
          <div className="section-head">
            <h2>From the people following</h2>
            <Link href={href("/feed")} className="small display">
              Full feed
            </Link>
          </div>
          <SocialFeed limit={5} composer={false} />
        </section>
      )}

      {golfer && (
        <section className="tp-again section" aria-label="Next time">
          <Link className="btn block" href={`/new?again=${encodeURIComponent(t.slug)}`}>
            Record another round
          </Link>
          <Link className="tp-friends" href="/new">
            Bring your friends next time
          </Link>
        </section>
      )}
    </div>
  );
}
