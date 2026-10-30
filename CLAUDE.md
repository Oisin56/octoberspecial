@AGENTS.md

# MyGolfBroadcast

Golf trips and society days covered like a major: live scoring on the course, a leaderboard and feed for people at
home, AI-written previews, bulletins and round reports, and a highlights film with commentary.
Production: https://mygolfbroadcast.com. Repo: Oisin56/octoberspecial. Stack: Next.js 16 (App Router), Supabase
(Postgres, storage, realtime), Vercel. Outside services: Claude (writing), ElevenLabs (voice), Shotstack (film
renders), Gemini (video), GolfAPI (course data and GPS), SMTP (email).

## The owner, and how to work with him

Oisin is a GP in Ireland, not a developer. Talk in plain words about what people will see and do, not code.

- Blueprint first. Before building anything, lay out exactly what will be built (screens, wording, behaviour) and get
  his sign-off. Spitballing questions get an opinion and a recommendation, not a build.
- If a feature isn't perfect, leave it out. Restraint over decoration; no AI design tells; read like a commercial
  brand. Audience is 50+: big buttons, big type, no friction.
- No trademarked tournament names anywhere on the site (no "Masters", "The Open", "Ryder Cup", Augusta's
  "A Tradition Unlike Any Other"). Themes are named Links Championship, Spring Classic, National Open, Team Cup.
- Never ask for, accept or print API keys or passwords in chat. Real keys live only in Vercel and Supabase
  environment variables. `.env.local` here holds made-up local values only.
- Copy style: sentence case, no dashes as punctuation in site copy, Irish/UK spelling, to-par shown as −2 / +3 / E.

## Commands

- Unit tests: `npx vitest run` (scoring engine, sample round, etc.).
- Type check: `npx tsc --noEmit`. Build: `npm run build`.
- Browser tests and the local stand-ins for every outside service: see `localtest/README.md`.
  First time in a new workspace: `bash localtest/setup.sh`. Then `bash /var/tmp/ospg/runall.sh`, or
  `bash /var/tmp/ospg/one.sh sampletest.mjs phaseftest.mjs` for a few.
- Edit test scripts in `localtest/`, never in `/var/tmp/ospg` (those are links back here).

## Shipping

- Work on a branch, push it, and send Oisin the Vercel preview link. Get the preview URL with
  `gh api repos/Oisin56/octoberspecial/commits/<sha>/status` (or `deployments?sha=<sha>` then the deployment's
  statuses `environment_url`).
- When he approves, fast-forward `main` to the branch and push; Vercel deploys production.
- Commit as him, with this footer:
  `git -c user.name=Oisin -c user.email=o.ocarroll1@icloud.com commit`
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Database changes go in `supabase/schema.sql` (safe to re-run). Oisin pastes it into the Supabase SQL editor;
  tell him when a change needs that.

## Where things are

- `src/app/t/[slug]/…` the tournament: scorecard, feed, record, follow, owner tools. `src/app/new` the set-up
  wizard. `src/app/try` the sample round. `src/app/owner` the site owner's page.
- `src/lib/research.ts` course research in the background (club site, hole pages, history), kept in the course
  library (`course_library` table) for every tournament at that course.
- Sign-in: one per person, by email (a link and a 6-digit code, no password). `src/lib/accounts.ts` (codes, My golf,
  "Is this you?" offers, joining player spots), `src/lib/auth.ts` (the cookie: a role per tournament, plus the account),
  checked on every request by `context()` in `src/lib/server-data.ts`. Players get in with one-use personal links (Send
  again bumps `players.link_gen`, signing old phones out). The site owner is the account with `OWNER_EMAIL`, plus a
  second check (`src/lib/owner-check.ts`: passkey or emailed code); the old owner PIN works only until that's done once.
- `src/lib/engine.ts` scoring (stroke, Stableford, match, team formats, handicaps); `live.ts` leaderboards;
  `sample.ts` the sample round; `screens.json` front page screen sizes and status bar colours.
- The AI writers' grid: `src/lib/grid.ts` (one row per player per hole, told / known from the score / not told),
  `figures.ts` (the counts, always "N of the M told"), `moments.ts` (the story finder, plain rules), `writerBrief.ts`
  (what the writer is handed), `filmCards.ts` (the film's clip cards), `factcheck.ts` (the quiet check: one retry,
  then the line is left out; logged in `fact_checks`, shown on the console's Health page). It's the only writer, for
  every piece and film. `testRound.ts` is a made-up 18-hole round with a fixed story for the tests.
- `src/components/front/` the front page. Its phone screens are real app screens taken by
  `localtest/tools/frontshots.mjs` (made-up names only), composed to 1170×2532 by `compose.py`;
  `pagelook.mjs` takes section screenshots of the page for review.

## Pitfalls

- Never run `pkill -f "next start"` (or anything matching its own command line): it kills the shell running it.
  Use `bash /var/tmp/ospg/restart-app.sh`, which stops the app by process name.
- After changing files in `public/`, restart the app and clear `.next/cache/images`, or old images are served.
- A test runner that crashes prints `Error`, not `FAIL`: check for both.
- CSS class names are global; check a new class isn't already used (`.ph`, `.sf-label` have bitten before).
- Times are Europe/Dublin.
- Sign-in emails link to `SITE_URL`, so on a preview use the 6-digit code rather than the button.
