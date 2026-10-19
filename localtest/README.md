# Local test environment

Runs the whole site on one machine with stand-ins for everything outside it, so every feature can be tested end to
end without touching the real database, spending money on the real services or sending real email.

| Real thing | Stand-in here |
|---|---|
| Supabase database and data API | Postgres 16 on port 5433 and PostgREST on 3000 |
| Supabase storage, Claude, ElevenLabs, Shotstack, Gemini, GolfAPI | `harness/stub.mjs` on 54321 (files go to `/var/tmp/ospg/files`) |
| Email | `harness/smtp/server.mjs` on 2525 (each message saved as JSON in `/var/tmp/ospg/mail`) |
| The site | `next start` on 3100, built from this repo |

## First time

    bash localtest/setup.sh

About five minutes: links the scripts into `/var/tmp/ospg`, makes local keys and `.env.local` (made-up values),
creates the database from `supabase/schema.sql` and `seed.sql`, makes stand-in phone videos, builds and starts the
app. Re-running it skips what is already done. Linux only for now.

After a workspace restart, bring the services back with `bash /var/tmp/ospg/up.sh` then
`bash /var/tmp/ospg/restart-app.sh`. After changing app code, `npm run build` then `restart-app.sh`.

## Running tests

- Everything: `bash /var/tmp/ospg/runall.sh` (about 15 minutes). Every line should say `ALL PASSED`; look for both
  `FAIL` and `Error`, since a crash prints only the latter.
- A few: `bash /var/tmp/ospg/one.sh sampletest.mjs phaseftest.mjs` (resets the database, runs `e2e.mjs`, then those).
- `fresh.sh` resets the database to the seed. `startapp.sh` with `VOICE=1` starts the app with the voice stand-in.

## What's here

- `tests/` browser tests (Playwright). `e2e.mjs` builds the base tournament the others use. `runall.sh` runs every
  one; the last two (`ownersample`, `filmaudio`) start the app with the voice stand-in.
- `tools/` front page screens (`frontshots.mjs`, then `compose.py`), page review shots (`pagelook.mjs`), the sample
  round's starting data (`samplefixture.mjs`) and its fallback recording (`walkthrough.mjs`), film graphics check
  (`gfx.mjs`), GPS lab (`gpslab.mjs`).
- `harness/` the start and reset scripts, the stand-ins, and `bootstrap.sql` (the Supabase roles and schemas that
  `schema.sql` expects).
- `fixtures/` course data for the GolfAPI stand-in and short clips for the upload tests. `fixtures.sh` makes the
  large phone-format videos for the trimming tests.

Edit scripts here, not in `/var/tmp/ospg`: those are links back to this folder. The scripts name the project by its
path in the cloud workspace (`/home/claude/october-special`); `setup.sh` links that path to wherever the repo is.
