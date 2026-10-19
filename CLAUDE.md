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
- `src/lib/engine.ts` scoring (stroke, Stableford, match, team formats, handicaps); `live.ts` leaderboards;
  `sample.ts` the sample round; `screens.json` front page screen sizes and status bar colours.
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
