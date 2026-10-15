import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { isOwner } from "@/lib/auth";
import { demoSlug } from "@/lib/site";
import { BroadcastBoard, InView, StickyCta, Ticker } from "./Broadcast";
import { WelcomeBack } from "./WelcomeBack";

/** A photo for behind the hero, when there is one (a course in evening light). Until then the mown-stripe green. */
const HERO_PHOTO: string | null = null;

const SETUP = [
  { title: "Name it and pick the course", body: "The card, the tees and the handicaps fill themselves in." },
  { title: "Add the players", body: "Just names and handicaps. Individuals or teams, one round or several." },
  { title: "Send one link", body: "Players tap it and they're in. Nothing to download." },
] as const;

const PLANS = [
  { name: "Free", price: "€0", what: "Scoring, live leaderboard, posts and photos" },
  { name: "Trip", price: "€49", what: "Previews, live updates, match reports and newsletter emails, kept for good" },
  { name: "Broadcast", price: "€99", what: "Everything in Trip, plus the highlights film and share kit" },
  { name: "Society", price: "€149 a year", what: "Broadcast for every event your group runs that year" },
] as const;

const QUESTIONS = [
  {
    q: "Do the players need to download an app?",
    a: "No. Each player gets a link. They tap it and they're in, on any phone. They can add it to their home screen if they like.",
  },
  {
    q: "What if there's no signal on the course?",
    a: "Scoring keeps working. Scores are kept on the phone and go up the moment there's signal again.",
  },
  {
    q: "Who can see our scores?",
    a: "Anyone you give the tournament's link to. It can only be found by name once you publish it.",
  },
  {
    q: "How long does it take to set up?",
    a: "About ten minutes on your phone. The course card, the tees and the handicap strokes are filled in for you.",
  },
  {
    q: "Can a society or a club use it?",
    a: "Yes. Individuals or teams, stroke play, Stableford or match play, one round or a whole weekend.",
  },
  {
    q: "What does it cost?",
    a: "Nothing while it's invitation-only. Scoring and the live leaderboard will always be free.",
  },
] as const;

export async function FrontPage() {
  const [owner, demo] = await Promise.all([isOwner().catch(() => false), demoSlug().catch(() => null)]);
  const cta = owner ? { href: "/new", label: "Start your tournament" } : { href: "/invite", label: "Request an invite" };

  return (
    <div className="theme-root bx" data-theme="clubhouse">
      {/* ---------------------------------------------------------------- the hero: golf, covered like TV */}
      <section className={`bx-hero bx-turf${HERO_PHOTO ? " has-photo" : ""}`} style={HERO_PHOTO ? { backgroundImage: `url(${HERO_PHOTO})` } : undefined}>
        <header className="bx-wrap bx-bar">
          <Link href="/" className="bx-mark" aria-label={`${BRAND.name} home`}>
            <Flag />
            <span>
              {BRAND.mark[0]}
              <b>{BRAND.mark[1]}</b>
              {BRAND.mark[2]}
            </span>
          </Link>
          <nav className="bx-bar-links" aria-label="Already involved">
            <Link href="/join">Got a link?</Link>
            <Link href="/account">My tournaments</Link>
          </nav>
        </header>

        <div className="bx-wrap bx-hero-grid">
          <div className="bx-hero-copy">
            <h1>Your golf, covered like a major.</h1>
            <p className="bx-hero-sub">A live leaderboard for everyone at home, match reports in their inbox, and a highlights film at the end.</p>
            <div className="bx-hero-actions">
              <Link href={cta.href} className="bx-btn" id="bx-top-cta">
                {cta.label}
              </Link>
              {demo && (
                <Link href={`/t/${demo}`} className="bx-link-light">
                  See an example
                </Link>
              )}
            </div>
            <p className="bx-hero-note">
              {owner ? "You run this site, so you can start one now." : "Invitation-only for now, and free while it is."}{" "}
              <Link href="/join">Been sent a link? Find your tournament</Link>
            </p>
            <WelcomeBack />
          </div>
          <BroadcastBoard />
        </div>
        <Ticker />
      </section>

      <main>
        {/* ---------------------------------------------------------------- the problem, in one line */}
        <section className="bx-problem">
          <div className="bx-wrap">
            <p className="bx-problem-line">Your trip&apos;s best moments end up as 400 messages in a WhatsApp group.</p>
            <p className="bx-problem-turn">Give them the coverage instead.</p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- set up: a slim band */}
        <section className="bx-setup" aria-labelledby="bx-setup-h">
          <div className="bx-wrap bx-setup-grid">
            <div>
              <h2 id="bx-setup-h">Ready in ten minutes, on your phone.</h2>
              <ol className="bx-setup-steps">
                {SETUP.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="bx-setup-phone">
              <Phone src="/home/setup.jpg" alt="The set-up questions on a phone: which tees at Birr Golf Club?" />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- play: dark, phones in hand */}
        <section className="bx-play bx-turf" aria-labelledby="bx-play-h">
          <div className="bx-wrap bx-play-grid">
            <div className="bx-play-copy">
              <h2 id="bx-play-h">Score with one thumb.</h2>
              <p>
                Big buttons, one hole at a time. Distances to the green are a tap away, and anyone in the group can film a shot for the highlights.
              </p>
              <ul className="bx-facts">
                <li>Keeps working with no signal</li>
                <li>Handicap strokes worked out for you</li>
                <li>One phone per group is enough</li>
              </ul>
              <Link href="/try" className="bx-btn bx-btn-ghost">
                Try it: score three holes
              </Link>
            </div>
            <div className="bx-play-phones">
              <Phone src="/home/gps.jpg" alt="Distances to the front, middle and back of the green" className="is-back" />
              <Phone src="/home/play.jpg" alt="The scorecard: one hole at a time, a big button for each score" className="is-front" />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- follow: the people at home */}
        <section className="bx-follow" aria-labelledby="bx-follow-h">
          <div className="bx-wrap bx-follow-grid">
            <div className="bx-follow-copy">
              <h2 id="bx-follow-h">Everyone at home follows along.</h2>
              <p>The leaderboard moves as the scores go in, on any screen. Clips and photos land as they happen, and a match report arrives after every round.</p>
              <div className="bx-email" aria-label="A match report email">
                <span className="bx-email-from">{BRAND.name}</span>
                <strong>Round 1: Shane holds on at Birr</strong>
                <span>A par at the last, a chip from nowhere at the 9th, and Declan one point behind going into tomorrow&hellip;</span>
              </div>
            </div>
            <div className="bx-screens">
              <div className="bx-laptop">
                <div className="bx-laptop-screen">
                  <Image src="/home/board-wide.jpg" width={1280} height={800} alt="The live leaderboard on a laptop" sizes="(min-width: 960px) 620px, 92vw" />
                </div>
                <div className="bx-laptop-base" />
              </div>
              <Phone src="/home/follow.jpg" alt="The live leaderboard on a phone" className="bx-follow-phone" />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- relive: the film, wide */}
        <section className="bx-relive" aria-labelledby="bx-relive-h">
          <div className="bx-wrap">
            <div className="bx-relive-head">
              <h2 id="bx-relive-h">A film to keep.</h2>
              <p>When the last card is in, the best shots are cut into a film with TV graphics, commentary and music. Ready to share the morning after.</p>
            </div>
            <InView className="bx-film">
              <Image src="/home/relive.jpg" width={1280} height={720} alt="The title card from a tournament's highlights film" sizes="(min-width: 1180px) 1100px, 94vw" />
              <div className="bx-film-third" aria-hidden>
                <b>Shane</b>
                <span>Champion, The Atlantic Cup</span>
              </div>
            </InView>
          </div>
        </section>

        {/* ---------------------------------------------------------------- prices: one list, no boxes */}
        <section className="bx-prices" aria-labelledby="bx-prices-h">
          <div className="bx-wrap bx-prices-grid">
            <div>
              <h2 id="bx-prices-h">Prices</h2>
              <p>Scoring is free. Upgrade when you want the write-ups and the film.</p>
              <p className="bx-quiet">Prices to come. Nothing is charged while it&apos;s invitation-only.</p>
            </div>
            <dl className="bx-plans">
              {PLANS.map((p) => (
                <div key={p.name} className="bx-plan">
                  <dt>
                    <span>{p.name}</span>
                    <b>{p.price}</b>
                  </dt>
                  <dd>{p.what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- questions */}
        <section className="bx-faq" aria-labelledby="bx-faq-h">
          <div className="bx-wrap bx-faq-grid">
            <h2 id="bx-faq-h">Questions organisers ask</h2>
            <div className="bx-faq-list">
              {QUESTIONS.map((x) => (
                <details key={x.q}>
                  <summary>{x.q}</summary>
                  <p>{x.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- the last call */}
        <section className="bx-close bx-turf" id="bx-close">
          <div className="bx-wrap">
            <h2>Running a golf event this year?</h2>
            <p>Give it the coverage it deserves.</p>
            <div className="bx-hero-actions">
              <Link href={cta.href} className="bx-btn">
                {cta.label}
              </Link>
              {demo && (
                <Link href={`/t/${demo}`} className="bx-link-light">
                  See an example
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="bx-wrap bx-foot">
        <span>{BRAND.domain || BRAND.name}</span>
        <span className="bx-foot-links">
          <Link href="/join">Find a tournament</Link>
          <Link href="/privacy">Privacy</Link>
          <span>Made in Ireland</span>
        </span>
      </footer>

      <StickyCta href={cta.href} label={cta.label} />
    </div>
  );
}

function Phone({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`bx-phone${className ? ` ${className}` : ""}`}>
      <Image src={src} width={1170} height={1992} alt={alt} sizes="(min-width: 960px) 300px, 62vw" />
    </div>
  );
}

function Flag() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.1)" />
      <path d="M12 6v20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 7l10 4-10 4z" fill="var(--gold, #d4a83a)" />
      <ellipse cx="16" cy="25.5" rx="7" ry="1.6" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
