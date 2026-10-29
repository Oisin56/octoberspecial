import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { isOwner } from "@/lib/auth";
import { BroadcastBoard, StepPhone, StickyCta, Ticker } from "./Broadcast";
import { HeaderLink } from "./WelcomeBack";
import { Phone } from "./Phone";
import { Icon, type IconName } from "./Icons";
import { FilmStill, HighlightGraphics, ThemeScroller } from "./FilmShowcase";

/**
 * The front page, for the person who runs the golf. Built to the G3 blueprint: one promise, who it's for, the features
 * shown working on real screens, the film, the full list, price, questions, one last button.
 */

const MADE_FOR = [
  { img: "/home/photos/mates.jpg", title: "Mates' rounds", body: "The Saturday fourball, with a leaderboard and the bragging rights.", alt: "Three golfers raising a drink by the green" },
  { img: "/home/photos/trip.jpg", title: "Golf trips", body: "The annual away weekend. Every round, every story, and a film at the end.", alt: "Golfers on a clifftop green by the sea at dusk" },
  { img: "/home/photos/society.jpg", title: "Societies", body: "Run the fixtures with less admin while the members follow from home.", alt: "Three golfers waiting on a tee beside a buggy" },
  { img: "/home/photos/solo.jpg", title: "Your own round", body: "Film it, score it, and get a TV-style edit of the day.", alt: "A golfer marking his ball on the green" },
] as const;

const ON_COURSE = [
  { title: "No signal, no problem", body: "Scores wait on the phone and send when there's signal.", img: "/home/offline.jpg", alt: "The scorecard: saved on this phone, sends when there's signal" },
  { title: "GPS yardages on demand", body: "Front, middle and back, from where you stand. Over 40,000 courses.", img: "/home/gps.jpg", alt: "Distances to the front, middle and back of the green" },
  { title: "Film the moment", body: "Anyone in the group can film. Trim it on the spot and it's straight on the feed.", img: "/home/record.jpg", alt: "Filming a putt on the course, recording" },
  { title: "One tap tells the story", body: "Add detail with a tap, the likeliest answer first. Or skip it. The score is enough.", img: "/home/shotcard.jpg", alt: "Add detail: the tee shot, with the likeliest clubs first" },
  { title: "See where you stand", body: "The leaderboard moves as every group scores.", img: "/home/follow.jpg", alt: "The live leaderboard on the phone" },
];

const AT_HOME = [
  { icon: "board", title: "Live leaderboard", body: "Moves as each score goes in." },
  { icon: "feed", title: "Feed and live bulletins", body: "Every clip, photo and note, with bulletins as it happens." },
  { icon: "clip", title: "Highlights", body: "Clips with TV graphics, to like and comment on." },
  { icon: "mail", title: "Previews and round reports", body: "In their inbox, before and after each round." },
] as const;

const SETUP = [
  { title: "Find your course", body: "Tees, pars, stroke indexes and yardages fill themselves in." },
  { title: "We do the research", body: "The course's history, its signature holes and a note on every hole." },
  { title: "Add the players", body: "Each can add a bio, or you can add it for them." },
  { title: "Send one link", body: "Players tap it and they're in. Nothing to download." },
] as const;

const YOURS = [
  ["Formats", "Stroke play, Stableford, match play"],
  ["Games", "Fourballs, foursomes, skins"],
  ["Length", "One round or a whole week"],
  ["Extras", "Closest to the pin, long drive, tee times"],
] as const;

const STUDIO = [
  { title: "Commentary", body: "Two voices, or record your own." },
  { title: "Music", body: "Choose the soundtrack." },
  { title: "Any length, any screen", body: "A quick cut or the whole trip, upright or wide." },
  { title: "More than golf", body: "Previews, interviews and travel clips, if you like." },
] as const;

const THEMES = [
  { id: "links", name: "Links Championship", note: "Navy, with the yellow scoreboard" },
  { id: "spring", name: "Spring Classic", note: "Rich green, a white leaderboard" },
  { id: "championship", name: "National Open", note: "Navy, red and a crisp white board" },
  { id: "teamcup", name: "Team Cup", note: "Navy and gold, each side in its colours" },
] as const;

const EVERYTHING: { icon: IconName; title: string; items: string[] }[] = [
  { icon: "card", title: "Scoring", items: ["Stableford, stroke and match play", "Fourballs, foursomes and skins", "Handicap strokes worked out", "Closest to the pin and long drive", "Cards checked and signed on the phone"] },
  { icon: "pin", title: "On the course", items: ["One-thumb scoring", "GPS distances to the green", "Clips filmed and trimmed on the spot", "Voice notes", "Works with no signal"] },
  { icon: "board", title: "At home", items: ["Live leaderboard", "Highlights with TV graphics", "Comments and likes", "Previews and round reports by email"] },
  { icon: "clip", title: "The film", items: ["Made when the last card is in", "Commentary, music and graphics", "A studio to change anything", "Ready to share"] },
  { icon: "lock", title: "Privacy", items: ["Seen only by people with the link", "Kept out of search engines", "No adverts or tracking", "One-tap unsubscribe"] },
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
        {/* ---------------------------------------------------------------- at home */}
        <section className="bx-home bx-screen" aria-labelledby="bx-home-h">
          <div className="bx-wrap bx-home-grid">
            <div className="bx-home-copy">
              <h2 id="bx-home-h">Fans at home follow every shot.</h2>
              <ul className="bx-feats">
                {AT_HOME.map((f) => (
                  <li key={f.title}>
                    <Icon name={f.icon} />
                    <div>
                      <strong>{f.title}</strong>
                      <span>{f.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="bx-email" aria-label="A round report email">
                <span className="bx-email-from">{BRAND.name}</span>
                <strong>Round 1: Declan leads at The Atlantic Links</strong>
                <span>Thirty feet at the 11th, a birdie at the 12th, and Marcus and Shane a shot behind with six to play&hellip;</span>
              </div>
            </div>
            <div className="bx-screens">
              <div className="lp">
                <div className="lp-lid">
                  <span className="lp-cam" aria-hidden />
                  <div className="lp-screen">
                    <Image src="/home/board-wide.jpg" width={2560} height={1600} alt="On a laptop: the feed, with the live leaderboard beside it" sizes="(min-width: 960px) 640px, 88vw" />
                  </div>
                </div>
                <div className="lp-base" aria-hidden>
                  <span className="lp-notch" />
                </div>
              </div>
              <Phone dark className="bx-home-phone">
                <Image src="/home/highlight.jpg" width={1170} height={2532} alt="A clip in the highlights, with the leaderboard on it: hole 11, Declan from thirty feet" sizes="(min-width: 960px) 220px, 36vw" />
                <HighlightGraphics />
              </Phone>
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
                  <div className="bx-try">
                    <Link href="/try" className="bx-btn">
                      Try a sample round
                    </Link>
                    <span>Three holes, no sign-up</span>
                  </div>
                </div>
              }
            />
            <div className="bx-course-foot">
              <Link href="/try" className="bx-btn">
                Try a sample round
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- set up */}
        <section className="bx-setup bx-screen" aria-labelledby="bx-setup-h">
          <div className="bx-wrap bx-setup-grid">
            <div>
              <h2 id="bx-setup-h">Pick the course. We do the rest.</h2>
              <ol className="bx-setup-steps">
                {SETUP.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}</strong>
                    <span>{s.body}</span>
                  </li>
                ))}
              </ol>
              <p className="bx-setup-more">The more you add, the better the reports and commentary.</p>
              <p className="bx-yours-h">All of it yours to change</p>
              <dl className="bx-spec">
                {YOURS.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Phone src="/home/setup.jpg" alt="Setting up: which tees at The Atlantic Links?" sizes="(min-width: 960px) 300px, 62vw" className="bx-setup-phone" />
          </div>
        </section>

        {/* ---------------------------------------------------------------- the film */}
        <section className="bx-film-sec" aria-labelledby="bx-film-h">
          <div className="bx-wrap">
            <div className="bx-film-head">
              <h2 id="bx-film-h">A film made for you. Yours to direct.</h2>
              <p>When the last card is in, the best shots become a film with TV graphics, commentary and music.</p>
            </div>
            <FilmStill />
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
          <div className="bx-themes" aria-labelledby="bx-themes-h">
            <div className="bx-wrap">
              <h3 id="bx-themes-h">Four looks, or your own colours.</h3>
            </div>
            <ThemeScroller themes={THEMES} />
          </div>
        </section>

        {/* ---------------------------------------------------------------- who it's for */}
        <section className="bx-for" aria-labelledby="bx-for-h">
          <div className="bx-wrap">
            <h2 id="bx-for-h">For every round worth talking about.</h2>
            <ul className="bx-for-list">
              {MADE_FOR.map((m) => (
                <li key={m.title}>
                  <div className="bx-for-img">
                    <Image src={m.img} width={1200} height={1500} alt={m.alt} sizes="(min-width: 960px) 280px, 72vw" />
                    <h3>{m.title}</h3>
                  </div>
                  <p>{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- everything */}
        <section className="bx-all" aria-labelledby="bx-all-h">
          <div className="bx-wrap">
            <h2 id="bx-all-h">Everything that&apos;s included.</h2>
            <div className="bx-all-grid">
              {EVERYTHING.map((g) => (
                <div key={g.title}>
                  <h3>
                    <Icon name={g.icon} />
                    {g.title}
                  </h3>
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
          <Link href="/join">Join my tournament</Link>
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
