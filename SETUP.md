# Getting the October Special live

About 30 minutes. Do the steps in order. Never paste keys into a chat. They only go into Supabase and Vercel.

## 1. Supabase (database, live updates, photo and video storage)
1. Go to supabase.com and create a free project. Pick the **Europe (Ireland)** region and choose a database password (save it somewhere).
2. When it's ready, open **SQL Editor → New query**. Paste the whole of `supabase/schema.sql` and press **Run**. You should see "Success".
3. Open a new query, paste the whole of `supabase/seed.sql` and press **Run**. This loads the seven rounds and both players.
4. Go to **Project Settings → API** (or **Data API**). Keep this tab open. You need three values from it:
   - Project URL
   - `anon` / publishable key
   - `service_role` / secret key (**secret, never share**)

## 2. Anthropic (the AI writer)
1. Go to console.anthropic.com → **API Keys → Create key**. Add some credit (€5 covers the whole trip easily).
2. Copy the key.

## 3. Vercel (hosting)
1. Go to vercel.com and sign in with GitHub.
2. **Add New → Project** and import the `october-special` repo.
3. Before pressing Deploy, open **Environment Variables** and add these:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `SESSION_SECRET` | any long random text, at least 32 characters (mash the keyboard) |
| `ORGANISER_PIN` | your organiser PIN, e.g. 6 digits |
| `ORGANISER_PLAYER_ID` | `oisin` |
| `CONTRIBUTOR_PIN` | a PIN for caddies and friends who post |

4. Press **Deploy**. After a minute or two you get a link like `october-special.vercel.app`.

## 4. First visit
1. Open the site → **Log in → Organiser** with your `ORGANISER_PIN`.
2. **Admin → Players and PINs:** set Neil's PIN and fill in both profiles (the AI uses them).
3. **Admin → Rounds:** set dates, tee times, tees, handicap shots and who scores each round. Tap **Check par and stroke index** and compare with the real card on the day.
4. **Admin → AI writing:** write the Round 1 preview, read it, then publish.
5. Send Neil the link and his PIN. Send everyone else just the link.

## On the course
- **Phone camera:** Settings → Camera → Formats → **Most Compatible**, and film at 1080p, not 4K. Keep clips under 30 seconds.
- **No signal?** Keep scoring. Holes save on the phone and send themselves when signal comes back.
- **Wrong score?** Go back to the hole and save it again. That replaces the old score.
- **Paper card as backup**, always.

## If something breaks
- Scores not appearing for followers: pull down to refresh. The page also refreshes every 30 seconds.
- AI not writing: check `ANTHROPIC_API_KEY` in Vercel and that the account has credit.
- Anything else: tell Claude what you saw.
