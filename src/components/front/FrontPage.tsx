import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { isOwner } from "@/lib/auth";
import { BroadcastBoard, InView, StepPhone, StickyCta, Ticker } from "./Broadcast";
import { HeaderLink } from "./WelcomeBack";

/**
 * The front page, for the person who runs the golf. Built to the G3 blueprint: one promise, who it's for, the features
 * shown working on real screens, the film, the full list, price, questions, one last button.
 */

const MADE_FOR = [
  { img: "/home/photos/mates.jpg", title: "Mates' rounds", body: "The Saturday fourball, with a leaderboard and the bragging rights.", alt: "Three golfers raising a drink by the green" },
  { img: "/home/photos/trip.jpg", title: "Golf trips", body: "The annual away weekend. Every round, every story, and a film at the end.", alt: "Golfers on a clifftop green by the sea at dusk" },
  { img: "/home/photos/society.jpg", title: "Societies and club days", body: "Run the fixtures with less admin while the members follow from home.", alt: "Three golfers waiting on a tee beside a buggy" },
  { img: "/home/photos/solo.jpg", title: "Your own round", body: "Film it, score it, and get a TV-style edit of the day.", alt: "A golfer marking his ball on the green" },
] as const;

const ON_COURSE = [
  { title: "Score with one thumb", body: "Plus and minus, one hole at a time. Nothing is saved until you tap, and everyone sees it straight away.", img: "/home/play.jpg", alt: "The scorecard: minus, the score, plus, for each player" },
  { title: "Distances a tap away", body: "Front, middle and back of the green, measured from where you stand.", img: "/home/gps.jpg", alt: "Distances to the front, middle and back of the green" },
  { title: "Say what happened", body: "After each hole, tap how the birdie went in, hold to record a voice note, or film the shot and trim it there and then.", img: "/home/shotcard.jpg", alt: "After the hole: how did Declan make birdie, with Clip and Hold to talk" },
  { title: "No signal, no problem", body: "Scores are kept on the phone and sent the moment there's signal again.", img: "/home/offline.jpg", alt: "Saved on this phone. Sends when there's signal" },
];

const SETUP = [
  { title: "Name it and pick the course", body: "The card, the tees and the handicaps fill themselves in." },
  { title: "Add the players", body: "Names and handicaps. Individuals or teams." },
  { title: "Send one link", body: "Players tap it and they're in. Nothing to download." },
] as const;

const YOURS = ["Stableford, stroke play and match play", "Fourballs, foursomes and skins", "One round or a whole week", "Tee times and handicaps", "Four looks, or your own colours"] as const;

const STUDIO = [
  { title: "Commentary", body: "Two voices, a commentator and a pundit, or record your own." },
  { title: "Music", body: "Choose the soundtrack." },
  { title: "Three lengths", body: "Three, five or eight minutes." },
  { title: "More than golf", body: "Add previews, interviews and travel clips, or keep it to the golf." },
] as const;

const EVERYTHING = [
  { title: "Scoring", items: ["Stableford, stroke and match play", "Fourballs, foursomes and skins", "Handicap strokes worked out", "Closest to the pin and long drive", "Cards checked and signed on the phone"] },
  { title: "On the course", items: ["One-thumb scoring", "GPS distances to the green", "Clips filmed and trimmed on the spot", "Voice notes", "Works with no signal"] },
  { title: "At home", items: ["Live leaderboard", "Highlights with TV graphics", "Comments and likes", "Previews and round reports by email"] },
  { title: "The film", items: ["Made when the last card is in", "Commentary, music and graphics", "A studio to change anything", "Ready to share"] },
  { title: "Privacy", items: ["Seen only by people with the link", "Kept out of search engines", "No adverts or tracking", "One-tap unsubscribe"] },
] as const;

const PLANS = [
  { name: "Free", price: "€0", what: "Scoring, live leaderboard, posts and photos" },
  { name: "Trip", price: "€49", what: "Previews, live updates, round reports and newsletter emails, kept for good" },
  { name: "Broadcast", price: "€99", what: "Everything in Trip, plus the highlights film and share kit" },
  { name: "Society", price: "€149 a year", what: "Broadcast for every event your group runs that year" },
] as const;

const QUESTIONS = [
  { q: "Do the players need to download an app?", a: "No. Each player gets a link. They tap it and they're in, on any phone, and they can add it to their home screen." },
  { q: "What if there's no signal on the course?", a: "Scoring keeps working. Scores are kept on the phone and go up the moment there's signal again." },
  { q: "Who can see our scores?", a: "Only people you share the link with. There's no search for tournaments, and tournament pages are kept out of Google." },
  { q: "Does it work for a single round?", a: "Yes. A round with your mates, or a round on your own that you film yourself." },
  { q: "Can a society or a club use it?", a: "Yes. Individuals or teams, Stableford, stroke play or match play, one round or several." },
  { q: "What does it cost?", a: "Nothing while it's invitation-only. Scoring and the live leaderboard will always be free." },
] as const;

export async function FrontPage() {
  const owner = await isOwner().catch(() => false);
  const cta = owner ? { href: "/new", label: "Start now" } : { href: "/invite", label: "Request an invite" };

  return (
    <div className="theme-root bx" data-theme="clubhouse">
      {/* ---------------------------------------------------------------- hero: a photo, the promise, the scoreboard */}
      <section className="bx-hero">
        <Image src="/home/photos/hero.jpg" alt="" fill priority sizes="100vw" className="bx-hero-img" />
        <div className="bx-hero-shade" aria-hidden />
        <header className="bx-wrap bx-bar">
          <Link href="/" className="bx-mark" aria-label={`${BRAND.name} home`}>
            <Flag />
            <span>
              {BRAND.mark[0]}
              <b>{BRAND.mark[1]}</b>
              {BRAND.mark[2]}
            </span>
          </Link>
          <HeaderLink />
        </header>
        <div className="bx-wrap bx-hero-grid">
          <div className="bx-hero-copy">
            <h1>{BRAND.tagline}</h1>
            <p className="bx-hero-sub">Live leaderboard. Round reports. A film to keep.</p>
            <Link href={cta.href} className="bx-btn" id="bx-top-cta">
              {cta.label}
            </Link>
          </div>
          <BroadcastBoard />
        </div>
        <Ticker />
      </section>

      <main>
        {/* ---------------------------------------------------------------- who it's for */}
        <section className="bx-for" aria-labelledby="bx-for-h">
          <div className="bx-wrap">
            <h2 id="bx-for-h">For every round worth talking about.</h2>
            <ul className="bx-for-list">
              {MADE_FOR.map((m) => (
                <li key={m.title}>
                  <div className="bx-for-img">
                    <Image src={m.img} width={1200} height={1500} alt={m.alt} sizes="(min-width: 960px) 280px, 72vw" />
                  </div>
                  <h3>{m.title}</h3>
                  <p>{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- at home */}
        <section className="bx-home bx-screen" aria-labelledby="bx-home-h">
          <div className="bx-wrap bx-home-grid">
            <div className="bx-home-copy">
              <h2 id="bx-home-h">Everyone at home follows every shot.</h2>
              <ul className="bx-lines">
                <li>The leaderboard moves as each score goes in.</li>
                <li>Clips land with TV graphics, for likes and comments.</li>
                <li>A preview before each round and a report after it, in everyone&apos;s inbox.</li>
              </ul>
              <div className="bx-email" aria-label="A round report email">
                <span className="bx-email-from">{BRAND.name}</span>
                <strong>Round 1: Declan leads at Birr</strong>
                <span>Thirty feet at the 11th, a birdie at the 12th, and Marcus and Shane a point behind with six to play&hellip;</span>
              </div>
            </div>
            <div className="bx-screens">
              <div className="bx-laptop">
                <div className="bx-laptop-screen">
                  <Image src="/home/board-wide.jpg" width={1600} height={1000} alt="The live leaderboard on a laptop" sizes="(min-width: 960px) 640px, 88vw" />
                </div>
                <div className="bx-laptop-base" />
              </div>
              <div className="bx-phone bx-home-phone">
                <Image src="/home/highlight.jpg" width={1170} height={1992} alt="A clip in the highlights: hole 11, Declan from thirty feet" sizes="(min-width: 960px) 220px, 36vw" />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- on the course */}
        <section className="bx-course bx-turf" aria-labelledby="bx-course-h">
          <div className="bx-wrap">
            <StepPhone
              steps={ON_COURSE}
              head={
                <div className="bx-course-head">
                  <h2 id="bx-course-h">Quick on the course.</h2>
                  <p>Big buttons, one hole at a time, and anyone in the group can help.</p>
                </div>
              }
            />
            <div className="bx-course-foot">
              <Link href="/try" className="bx-btn bx-btn-ghost">
                Try a sample round
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- set up */}
        <section className="bx-setup bx-screen" aria-labelledby="bx-setup-h">
          <div className="bx-wrap bx-setup-grid">
            <div>
              <h2 id="bx-setup-h">Ready in minutes. You decide everything.</h2>
              <ol className="bx-setup-steps">
                {SETUP.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </li>
                ))}
              </ol>
              <p className="bx-yours-h">All of it yours to change</p>
              <ul className="bx-yours">
                {YOURS.map((y) => (
                  <li key={y}>{y}</li>
                ))}
              </ul>
            </div>
            <div className="bx-phone bx-setup-phone">
              <Image src="/home/setup.jpg" width={1170} height={1992} alt="The set-up questions: which tees at Birr Golf Club?" sizes="(min-width: 960px) 300px, 62vw" />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- the film */}
        <section className="bx-film-sec" aria-labelledby="bx-film-h">
          <div className="bx-film-top">
            <Image src="/home/photos/broadcast.jpg" alt="" fill sizes="100vw" className="bx-film-bg" />
            <div className="bx-wrap bx-film-head">
              <h2 id="bx-film-h">A film made for you. Yours to direct.</h2>
              <p>When the last card is in, the best shots are cut into a film with TV graphics, commentary and music. Ready to share the morning after.</p>
            </div>
          </div>
          <div className="bx-wrap">
            <InView className="bx-film">
              <Image src="/home/relive.jpg" width={1280} height={720} alt="The title card from a tournament's highlights film" sizes="(min-width: 1200px) 1120px, 94vw" />
              <div className="bx-film-third" aria-hidden>
                <b>Declan</b>
                <span>Leads after round 1</span>
              </div>
            </InView>
            <p className="bx-studio-h">In the studio, change anything</p>
            <dl className="bx-studio">
              {STUDIO.map((s) => (
                <div key={s.title}>
                  <dt>{s.title}</dt>
                  <dd>{s.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- everything */}
        <section className="bx-all" aria-labelledby="bx-all-h">
          <div className="bx-wrap">
            <h2 id="bx-all-h">Everything that&apos;s included.</h2>
            <div className="bx-all-grid">
              {EVERYTHING.map((g) => (
                <div key={g.title}>
                  <h3>{g.title}</h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- prices and questions, together */}
        <section className="bx-ref" aria-label="Prices and questions">
          <div className="bx-wrap bx-ref-grid">
            <h2 id="bx-prices-h">Prices</h2>
            <div>
              <p className="bx-ref-lead">Scoring is free. Upgrade when you want the write-ups and the film. These are planned prices: nothing is charged while it&apos;s invitation-only.</p>
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
            <h2 id="bx-faq-h">Questions</h2>
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
        <section className="bx-close" id="bx-close">
          <Image src="/home/photos/hero.jpg" alt="" fill sizes="100vw" className="bx-close-img" />
          <div className="bx-wrap">
            <h2>Ready for your next round?</h2>
            <Link href={cta.href} className="bx-btn">
              {cta.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="bx-wrap bx-foot">
        <span>{BRAND.domain || BRAND.name}</span>
        <span className="bx-foot-links">
          <Link href="/account">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
          <span>Made in Ireland</span>
        </span>
      </footer>

      <StickyCta href={cta.href} label={cta.label} />
    </div>
  );
}

function Flag() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.12)" />
      <path d="M12 6v20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 7l10 4-10 4z" fill="var(--gold, #d4a83a)" />
      <ellipse cx="16" cy="25.5" rx="7" ry="1.6" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
