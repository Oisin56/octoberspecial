import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: live scores, reports and a film of your golf trip` },
  description:
    "Hole-by-hole scoring on the course, a live leaderboard for everyone at home, previews and match reports written for you, and a highlights film at the end.",
};

const demo = `/t/${BRAND.demoSlug}`;

const FEATURES = [
  {
    id: "score",
    title: "Scoring anyone can do with one thumb",
    body: "Big buttons, one hole at a time. Stableford, strokeplay, matchplay, skins, handicaps or flat, team or singles, set round by round.",
    img: { src: "/home/score.jpg", w: 780, h: 1290 },
  },
  {
    id: "report",
    title: "Previews and match reports, written for you",
    body: "Before each round, a preview that knows the course and its signature holes. After it, a match report in the tone you pick, sent to everyone's inbox as a proper newsletter.",
    img: { src: "/home/report.jpg", w: 780, h: 1720 },
  },
  {
    id: "film",
    title: "A highlights film to keep",
    body: "Clips from the course are cut into a film with a TV-style score panel, captions and commentary. Ready to share the morning after.",
    img: { src: "/home/film.jpg", w: 680, h: 456 },
    wide: true,
  },
  {
    id: "organiser",
    title: "Simple for whoever organises it",
    body: "One home screen tells you what needs doing next. Add the courses and players in an evening, send each player their link, and the site does the rest.",
    img: { src: "/home/organiser.jpg", w: 780, h: 1840 },
  },
] as const;

const PLANS = [
  { name: "Free", price: "€0", what: "Scoring, live leaderboard, posts and photos" },
  { name: "Trip", price: "€49", what: "Previews, live updates, match reports and newsletter emails, kept for good" },
  { name: "Broadcast", price: "€99", what: "Everything in Trip, plus the highlights film and share kit" },
  { name: "Society", price: "€149 a year", what: "Broadcast for every trip your group runs that year" },
] as const;

export default function Front() {
  return (
    <div className="theme-root mgs" data-theme="clubhouse">
      <header className="mgs-head">
        <div className="mgs-wrap mgs-bar">
          <Link href="/" className="mgs-mark" aria-label={`${BRAND.name} home`}>
            <Flag />
            <span>
              My<b>Golf</b>Special
            </span>
          </Link>
          <Link href="/new" className="mgs-head-link">
            Start your trip
          </Link>
        </div>
      </header>

      <main>
        <section className="mgs-hero">
          <div className="mgs-wrap mgs-hero-grid">
            <div className="mgs-hero-copy">
              <h1>{BRAND.tagline}</h1>
              <p>
                Scores go in hole by hole on the course, and everyone at home follows the leaderboard live. Match reports and a highlights film come after. Set up in an evening.
              </p>
              <div className="mgs-cta">
                <Link href="/new" className="btn mgs-btn-light">
                  Start your trip
                </Link>
                <Link href={demo} className="btn ghost">
                  See an example trip
                </Link>
              </div>
              <p className="mgs-free">Free to score. Pay only for the extras.</p>
            </div>
            <Phone src="/home/live.jpg" w={390} h={940} alt="A trip's home page with a live leaderboard" priority />
          </div>
        </section>

        <section className="mgs-wrap mgs-features" aria-label="What your group gets">
          {FEATURES.map((f) => (
            <article key={f.id} className={`mgs-feature${"wide" in f ? " is-wide" : ""}`}>
              <div className="mgs-feature-copy">
                <h2>{f.title}</h2>
                <p>{f.body}</p>
              </div>
              {"wide" in f ? (
                <div className="mgs-still">
                  <Image src={f.img.src} width={f.img.w} height={f.img.h} alt="A score panel from a highlights film" sizes="(min-width: 860px) 420px, 92vw" />
                </div>
              ) : (
                <Phone src={f.img.src} w={f.img.w} h={f.img.h} alt="" />
              )}
            </article>
          ))}
        </section>

        <section className="mgs-steps">
          <div className="mgs-wrap">
            <h2>How it works</h2>
            <ol>
              <li>
                <strong>Add your courses and players.</strong> Pick the courses, the format for each round and the handicaps. Course details and guides are
                filled in for you where we have them.
              </li>
              <li>
                <strong>Send each player their link.</strong> They join on their own phone and choose what&apos;s shared about them.
              </li>
              <li>
                <strong>Play golf.</strong> Scores go in as you go. The leaderboard, the write-ups and the emails take care of themselves.
              </li>
            </ol>
          </div>
        </section>

        <section className="mgs-wrap mgs-pricing">
          <h2>Prices</h2>
          <p className="mgs-lead">Scoring is free for every trip. Upgrade when you want the write-ups and the film.</p>
          <div className="mgs-plans">
            {PLANS.map((p) => (
              <div key={p.name} className="mgs-plan">
                <h3>{p.name}</h3>
                <div className="mgs-price">{p.price}</div>
                <p>{p.what}</p>
              </div>
            ))}
          </div>
          <p className="mgs-note">Per trip unless stated. Sign-ups open soon; for now, trips are by invitation.</p>
        </section>

        <section className="mgs-close">
          <div className="mgs-wrap">
            <h2>Organising the trip this year?</h2>
            <div className="mgs-cta">
              <Link href="/new" className="btn mgs-btn-light">
                Start your trip
              </Link>
              <Link href={demo} className="btn ghost">
                See an example trip
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mgs-wrap mgs-foot">
        <span>
          {BRAND.name} · {BRAND.domain}
        </span>
        <span>Made in Ireland</span>
      </footer>
    </div>
  );
}

function Phone({ src, w, h, alt, priority }: { src: string; w: number; h: number; alt: string; priority?: boolean }) {
  return (
    <div className="mgs-phone">
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
