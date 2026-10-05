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
| `GOLFCOURSEAPI_KEY` | your key from golfcourseapi.com (course search) |
| `SESSION_SECRET` | any long random text, at least 32 characters (mash the keyboard) |
| `ORGANISER_PIN` | your **site owner** PIN: runs every tournament and creates new ones. 6+ digits. |
| `CONTRIBUTOR_PIN` | a PIN for caddies and friends who post (you can also set one per tournament in Admin) |
| `SHOTSTACK_API_KEY` | from shotstack.io (AI director renders). Start with the free **sandbox** key: films are watermarked |
| `SHOTSTACK_ENV` | `stage` while testing; change to `v1` with your production key to remove the watermark |
| `ELEVENLABS_API_KEY` | from elevenlabs.io (AI voice-over) |
| `ELEVENLABS_VOICE_ID` | optional: a voice from your ElevenLabs Voice Library. Leave blank for the default narrator |
| `GEMINI_API_KEY` | from aistudio.google.com (Veo cinematic shots; needs billing turned on for Veo) |
| `HOME_TOURNAMENT` | `october-special-2026`, so the main address opens straight onto your trip. Remove it later to show the tournament list. |

4. Press **Deploy**. After a minute or two you get a link like `october-special.vercel.app`.

## 4. First visit
1. Open the site (it goes straight to the October Special) → **Log in → Organiser** with your `ORGANISER_PIN`.
2. **Admin → Players and PINs:** set Neil's PIN and fill in both profiles (the AI uses them).
3. **Admin → Rounds:** open each round with **Edit** and set the date, tee time, tees and handicaps (Set shots by hand, or Flat). The scorer is chosen under Matches and groups. Tap **Check par and stroke index** and compare with the real card on the day.
4. **Admin → AI writing:** write the Round 1 preview, read it, then publish.
5. Send Neil the link and his PIN. Send everyone else just the link.

## On the course
- **Night before, on Wi-Fi:** open the site, go to **Post**, and tap **Get the trimmer ready** so the video tools are saved on the phone.
- **Phone camera:** film at 1080p, not 4K. Long tripod recordings are fine.
- **Trimming:** on the scoring page tap **Add clip or note for this hole**, pick the video, drag to each shot and tap **Add this cut** (several cuts per recording, each tagged with hole and player). Only the cuts are uploaded.
- **No signal for clips?** Cuts are saved on the phone and send themselves when signal returns. Don't clear the browser until the banner disappears.
- **No signal?** Keep scoring. Holes save on the phone and send themselves when signal comes back.
- **Wrong score?** Go back to the hole and save it again. That replaces the old score.
- **Paper card as backup**, always.

## If something breaks
- Scores not appearing for followers: pull down to refresh. The page also refreshes every 30 seconds.
- AI not writing: check `ANTHROPIC_API_KEY` in Vercel and that the account has credit.
- Anything else: tell Claude what you saw.

## Making a new tournament (another group, another year)
Go to the site's address followed by `/new`, fill in the name and an organiser PIN, and enter your site owner PIN. The step-by-step setup then walks through look, players and teams, courses and formats, side games, writing style and invites. Each tournament gets its own address (`/t/its-name`) and its own PINs.

## The AI director (Admin → Highlights film)
1. Upload a music track once (royalty-free, e.g. Pixabay Music or Uppbeat).
2. Choose the round or whole tournament, the length and the shape (landscape for TV, portrait for phones), then **Write the plan**.
3. Check the plan: reorder or remove clips, fix captions, trim clips (From / to, in seconds), edit the narration. Scores on the cards come straight from the scoreboard.
   - **Score panel:** each clip shows a TV-style panel in the top corner with the hole, par, yards and the score as it stood when the shot was played. Fix the round or hole if it's wrong; the preview updates. Tick **Finishes the hole** for putts and chip-ins: the panel then switches to the new score near the end, with a BIRDIE / EAGLE / WINS THE HOLE flash. If an earlier hole wasn't entered, the panel shows the hole details only.
4. Optional: **Generate** any AI shots (1–5 minutes each). They're skipped until generated.
5. **Render the film.** It takes a minute or two and appears in Highlights automatically. Each render costs a little on Shotstack, ElevenLabs and Veo; nothing is charged until you press Render or Generate.
