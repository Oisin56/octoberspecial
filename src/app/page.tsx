import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { isOwner } from "@/lib/auth";
import { demoSlug } from "@/lib/site";
import { RecentTournaments } from "@/components/front/Recent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: live scores, match reports and a film of your golf` },
  description:
    "Scores go in hole by hole on the course, everyone at home follows the leaderboard live, match reports are written for you, and a highlights film comes at the end.",
};

/** The story, with real screens from a tournament (taken automatically, see the screenshot script). */
const STEPS = [
  {
    id: "setup",
    name: "Set up",
    title: "Answer a few questions",
    body: "Who's playing, where, and how it's scored. The course card, the tees and the handicaps fill themselves in. Ten minutes, on your phone.",
    img: { src: "/home/setup.jpg", w: 1170, h: 1992 },
  },
  {
    id: "play",
    name: "Play",
    title: "Score with one thumb",
    body: "Big buttons, one hole at a time, and it keeps working with no signal. Distances to the green are a tap away, and anyone in the group can film a shot.",
    img: { src: "/home/gps.jpg", w: 1170, h: 1992 },
    link: { href: "/try", label: "Try it: score three holes" },
  },
  {
    id: "follow",
    name: "Follow",
    title: "Everyone at home follows along",
    body: "A live leaderboard, the clips and photos as they happen, and a match report in everyone's inbox after each round.",
    img: { src: "/home/follow.jpg", w: 1170, h: 1992 },
  },
  {
    id: "relive",
    name: "Relive",
    title: "A film to keep",
    body: "When the last card is in, the best shots are cut into a film with TV-style graphics, commentary and music, ready to share the morning after.",
    img: { src: "/home/relive.jpg", w: 1280, h: 720 },
    wide: true,
  },
] as const;

const PLANS = [
  { name: "Free", price: "€0", what: "Scoring, live leaderboard, posts and photos" },
  { name: "Trip", price: "€49", what: "Previews, live updates, match reports and newsletter emails, kept for good" },
  { name: "Broadcast", price: "€99", what: "Everything in Trip, plus the highlights film and share kit" },
  { name: "Society", price: "€149 a year", what: "Broadcast for every event your group runs that year" },
] as const;

export default async function Front() {
  const [owner, demo] = await Promise.all([isOwner().catch(() => false), demoSlug().catch(() => null)]);
  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="mgs-head">
        <div className="mgs-wrap mgs-bar">
          <Link href="/" className="mgs-mark" aria-label={`${BRAND.name} home`}>
            <Flag />
            <span>
              {BRAND.mark[0]}
              <b>{BRAND.mark[1]}</b>
              {BRAND.mark[2]}
            </span>
          </Link>
          <Link href="/account" className="mgs-head-link quiet">
            My tournaments
          </Link>
        </div>
      </header>

      <main>
        <section className="mgs-hero">
          <div className="mgs-wrap mgs-hero-grid">
            <div className="mgs-hero-copy">
              <h1>{BRAND.tagline}</h1>
              <p>Scores go in hole by hole on the course. Everyone at home follows the leaderboard. Match reports and a highlights film come after.</p>
              <RecentTournaments />
              <nav className="fr-tiles" aria-label="Get started">
                <Link href="/join" className="fr-tile">
                  <strong>Join my tournament</strong>
                  <span>You&apos;ve been asked to play or follow</span>
                </Link>
                {owner ? (
                  <Link href="/new" className="fr-tile">
                    <strong>Start a tournament</strong>
                    <span>Set one up in a few minutes</span>
                  </Link>
                ) : (
                  <Link href="/invite" className="fr-tile">
                    <strong>Request an invite</strong>
                    <span>Run your own. It&apos;s invitation-only for now</span>
                  </Link>
                )}
                {demo ? (
                  <Link href={`/t/${demo}`} className="fr-tile">
                    <strong>See an example</strong>
                    <span>A real tournament, start to finish</span>
                  </Link>
                ) : (
                  <div className="fr-tile is-soon" aria-disabled="true">
                    <strong>See an example</strong>
                    <span>Coming soon</span>
                  </div>
                )}
              </nav>
            </div>
            <Phone src="/home/play.jpg" w={1170} h={1992} alt="The scorecard on a phone, one hole at a time" priority className="fr-hero-phone" />
          </div>
        </section>

        <section className="mgs-wrap fr-story" aria-label="How it works">
          {STEPS.map((s, i) => (
            <article key={s.id} className={`fr-step${"wide" in s ? " is-wide" : ""}`}>
              <div className="fr-step-copy">
                <p className="fr-step-n">
                  <span className="num">{i + 1}</span> {s.name}
                </p>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
                {"link" in s && (
                  <Link href={s.link.href} className="btn mgs-btn-dark fr-step-link">
                    {s.link.label}
                  </Link>
                )}
              </div>
              {"wide" in s ? (
                <div className="mgs-still">
                  <Image src={s.img.src} width={s.img.w} height={s.img.h} alt="A title card from a tournament's highlights film" sizes="(min-width: 860px) 480px, 92vw" />
                </div>
              ) : (
                <Phone src={s.img.src} w={s.img.w} h={s.img.h} alt="" />
              )}
            </article>
          ))}
        </section>

        <section className="mgs-wrap mgs-pricing">
          <h2>Prices</h2>
          <p className="mgs-lead">Scoring is free. Upgrade when you want the write-ups and the film.</p>
          <div className="mgs-plans">
            {PLANS.map((p) => (
              <div key={p.name} className="mgs-plan">
                <h3>{p.name}</h3>
                <div className="mgs-price">{p.price}</div>
                <p>{p.what}</p>
              </div>
            ))}
          </div>
          <p className="mgs-note">Prices to come. Nothing is charged while it&apos;s invitation-only.</p>
        </section>

        <section className="mgs-close">
          <div className="mgs-wrap">
            <h2>Running a golf event this year?</h2>
            <div className="mgs-cta">
              <Link href={owner ? "/new" : "/invite"} className="btn mgs-btn-light">
                {owner ? "Start a tournament" : "Request an invite"}
              </Link>
              {demo && (
                <Link href={`/t/${demo}`} className="btn ghost">
                  See an example
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="mgs-wrap mgs-foot">
        <span>
          {BRAND.name}
          {BRAND.domain ? ` · ${BRAND.domain}` : ""}
        </span>
        <span className="mgs-foot-links">
          <Link href="/privacy">Privacy</Link>
          <span>Made in Ireland</span>
        </span>
      </footer>
    </div>
  );
}

function Phone({ src, w, h, alt, priority, className }: { src: string; w: number; h: number; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={`mgs-phone${className ? ` ${className}` : ""}`}>
      <Image src={src} width={w} height={h} alt={alt} priority={priority} sizes="(min-width: 860px) 300px, 70vw" />
    </div>
  );
}

function Flag() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--board)" />
      <path d="M12 6v20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 7l10 4-10 4z" fill="var(--gold, #d4a83a)" />
      <ellipse cx="16" cy="25.5" rx="7" ry="1.6" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
