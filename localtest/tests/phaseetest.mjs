// Phase E: the end-of-tournament film. The camera's "what are you filming?" and the turn-your-phone nudge, the
// film locked until the tournament is over, the site owner's brand pack, music and limits, the big-tile questions,
// the production screen (the phone can go away), the finished film, the edit itself (two voices, music under the
// commentary, the brand pack, upright framing, predictions before Round 1), the studio, and the limits.
// Run after fresh + e2e, with the stub up.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtA -c "${sql.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 15000) => { for (let i = 0; i < ms / 250; i++) { const v = await f(); if (v) return v; await sleep(250); } return await f(); };
const OWNER = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
fs.mkdirSync("/var/tmp/ospg/shots", { recursive: true });
fs.mkdirSync("/var/tmp/ospg/vid", { recursive: true });
for (const f of fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-") || f === "tts.log" || f === "callback.log")) fs.rmSync(`/var/tmp/ospg/${f}`);
q(`delete from reels; delete from site_settings; delete from posts where kind='video'`);

// ---- Clips: an API client logged in as Neil (a player) posts real, seekable clips on round 1
let cookie = "";
const call = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
{
  // Signed in as Neil with his own link (the organiser makes it)
  await call("/api/login", { mode: "organiser", pin: "1234" });
  const u = (await call("/api/admin", { action: "playerLink", playerId: "neil", reset: true })).j.url;
  const out = await fetch(`${BASE}/api/login?t=${T}`, { method: "DELETE", headers: { cookie } });
  cookie = (out.headers.get("set-cookie") ?? cookie).split(";")[0];
  await call("/api/login", { mode: "link", code: u.split("/in/")[1], step: "confirm" });
}
const rid = (n) => q(`select r.id from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${T}' and r.number=${n}`);
const upload = async (file, type) => {
  const up = await call("/api/upload-url", { filename: file.split("/").pop(), contentType: type });
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([fs.readFileSync(file)], { type }), file.split("/").pop());
  await fetch(up.j.signedUrl, { method: "PUT", body: fd });
  return up.j.path;
};
const mkClip = (name, size, t) => {
  const out = `/var/tmp/ospg/vid/${name}.webm`;
  execSync(`ffmpeg -y -loglevel error -f lavfi -i testsrc=size=${size}:rate=25 -f lavfi -i sine=frequency=440:duration=${t} -t ${t} -c:v libvpx -b:v 300k -c:a libopus ${out}`);
  return out;
};
const clipsSpec = [
  { size: "640x360", t: 7, hole: 2, body: "Oisin's drive on 2", tags: [], player: "oisin" },
  { size: "640x360", t: 6, hole: 5, body: "Oisin's approach on 5", tags: [], player: "oisin" },
  { size: "640x360", t: 7, hole: 5, body: "Neil chips in on 5!", tags: ["chip-in"], player: "neil" },
  { size: "360x640", t: 4, hole: 6, body: "Oisin's putt on 6", tags: [], player: "oisin" },
];
for (const [i, c] of clipsSpec.entries()) {
  const path = await upload(mkClip(`e-clip-${i}`, c.size, c.t), "video/webm");
  await call("/api/posts", { roundId: rid(1), hole: c.hole, body: c.body, tags: c.tags, playerIds: [c.player], kind: "video", mediaPath: path, details: { shape: c.size === "360x640" ? "portrait" : "landscape", dur: String(c.t) } });
}
ok(q(`select count(*) from posts where kind='video'`) === "4", "four clips on round 1 (three wide, one upright)");

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const phone = async (extra = {}) => {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["camera", "microphone"], ...extra });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
};

// ================================================================ The camera when no round is live
q(`update rounds set status='complete' where status='live'`);
const org = await phone();
await org.goto(`${BASE}/t/${T}`);
await org.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await org.goto(`${BASE}/t/${T}/record`, { waitUntil: "networkidle" });
await org.locator(".cam-ask").waitFor({ timeout: 15000 });
const asks = await org.locator(".cam-ask-tile").allInnerTexts();
ok(asks[0] === "Interview" && asks.includes("Prediction") && asks.includes("Scene-setting") && asks.includes("Something else"), `between rounds the camera asks what you're filming, interview first (${asks.join(", ")})`);
await org.screenshot({ path: "/var/tmp/ospg/shots/phasee-cam-ask.png" });
await org.locator(".cam-ask-tile", { hasText: "Interview" }).click();
await org.locator(".cam-prompt").waitFor();
ok(/how did it go/i.test(await org.locator(".cam-prompt").innerText()), "and helps with a prompt on screen");
ok((await org.locator(".cam-ask").count()) === 0, "then the camera is ready");

// Before a ball is struck: predictions first; and the phone-the-wrong-way nudge for an upright tournament
q(`update rounds set status='upcoming'; delete from hole_entries; delete from cards; delete from card_signatures`);
q(`update tournaments set share_shape='portrait' where slug='${T}'`);
const wide = await phone({ viewport: { width: 844, height: 390 } });
await wide.goto(`${BASE}/t/${T}`);
await wide.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await wide.goto(`${BASE}/t/${T}/record`, { waitUntil: "networkidle" });
await wide.locator(".cam-ask").waitFor({ timeout: 15000 });
const pre = await wide.locator(".cam-ask-tile").allInnerTexts();
ok(pre[0] === "Prediction", `before the event: predictions first (${pre.join(", ")})`);
await wide.locator(".cam-ask-tile", { hasText: "Prediction" }).click();
await wide.locator(".cam-turn").waitFor({ timeout: 10000 });
ok(/Turn your phone upright/.test(await wide.locator(".cam-turn").innerText()), "held sideways for an upright tournament: asked to turn the phone, with Film anyway");
await wide.screenshot({ path: "/var/tmp/ospg/shots/phasee-cam-turn.png" });
await wide.getByRole("button", { name: "Film anyway" }).click();
ok((await wide.locator(".cam-turn").count()) === 0, "Film anyway clears it");
await wide.context().close();

// A prediction clip, posted as the camera would
const predPath = await upload(mkClip("e-pred", "360x640", 5), "video/webm");
await call("/api/posts", { roundId: null, hole: null, body: "Neil: Oisin by ten points", tags: [], playerIds: ["neil"], kind: "video", mediaPath: predPath, details: { shape: "portrait", dur: "5", clipType: "prediction" } });
ok(q(`select details->>'clipType' from posts where body like 'Neil: Oisin%'`) === "prediction", "a prediction is kept as one");

// "Not a shot?" during play: a clip filmed mid-round can be made an interview afterwards
q(`update rounds set status='live' where id='${rid(1)}'`);
await org.goto(`${BASE}/t/${T}/record`, { waitUntil: "networkidle" });
await sleep(800);
ok((await org.locator(".cam-ask").count()) === 0, "during a round: no question, the camera is straight on");
await org.context().close();

// ================================================================ Locked until the tournament is over
const p = await phone();
await p.goto(`${BASE}/t/${T}`);
await p.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await p.goto(`${BASE}/t/${T}/film`, { waitUntil: "networkidle" });
await p.locator(".film-locked").waitFor({ timeout: 15000 });
const missing = await p.locator(".film-missing li").allInnerTexts();
ok(missing.length >= 2 && missing.some((m) => /Round 1.*card isn't final/.test(m)) && missing.some((m) => /Round 2 hasn't been played/.test(m)), `locked, saying what's still to do (${missing[0]} …)`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-locked.png" });
await p.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
ok(/clips so far/.test(await p.locator(".org-tile, .tile", { hasText: "Highlights film" }).first().innerText()) && (await p.getByText("Time for the film").count()) === 0, "organiser home: the film tile counts clips; no film to-do until it's over");
ok((await p.getByText("AI director").count()) === 0 && (await p.getByText("Quick reel").count()) === 0, "the old AI director and Quick reel panels are gone");

// Every round complete: the film unlocks
q(`update rounds set status='complete'`);
await p.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
ok((await p.getByText("Time for the film").count()) === 1 && (await p.getByRole("link", { name: "Make the film" }).count()) >= 1, "every round complete: 'Time for the film' at the top of the to-do list, with Make the film");
await p.goto(`${BASE}/t/${T}/highlights`, { waitUntil: "networkidle" });
ok((await p.locator(".reel-film-btn").count()) === 1, "Highlights has a Film button for the organiser");

// ================================================================ The site owner: limits, brand pack, music
const own = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const o = await own.newPage();
o.on("pageerror", (e) => console.log("pageerror:", e.message));
await o.goto(`${BASE}/console`, { waitUntil: "networkidle" });
await o.getByRole("button", { name: "Use the site owner PIN" }).click();
await o.fill("#opin", OWNER);
await o.getByRole("button", { name: "Sign in", exact: true }).click();
await o.getByRole("heading", { name: "Overview" }).waitFor();
await o.goto(`${BASE}/console/settings`, { waitUntil: "networkidle" });
await o.locator(".owner-films").waitFor({ timeout: 15000 });
ok(true, "the owner page has a Films section");
await o.getByLabel("Monthly limit, all tournaments ($)").fill("30");
await o.getByLabel("Films each tournament can make").fill("2");
await o.getByRole("button", { name: "Save the limits" }).click();
ok(await until(() => q(`select value->>'perTournament' from site_settings where key='films'`) === "2"), "limits saved: $30 a month across the site, 2 films a tournament");
// The brand pack: an upright intro and ending
const intro = mkClip("e-intro", "360x640", 2);
const outro = mkClip("e-outro", "360x640", 2);
const slotInput = (slot, shape) => o.locator(".owner-slot", { hasText: slot }).locator(`input[type=file]`).nth(shape === "portrait" ? 0 : 1);
await slotInput("Intro", "portrait").setInputFiles(intro);
ok(await until(() => !!q(`select value->'intro'->'portrait'->>'path' from site_settings where key='brand'`), 20000), "an upright intro uploaded and kept");
await slotInput("Ending", "portrait").setInputFiles(outro);
ok(await until(() => !!q(`select value->'outro'->'portrait'->>'path' from site_settings where key='brand'`), 20000), "and an ending");
// A music track
const track = "/var/tmp/ospg/vid/e-track.wav";
execSync(`ffmpeg -y -loglevel error -f lavfi -i sine=frequency=220:duration=40 -ac 2 ${track}`);
await o.getByPlaceholder("Sunday charge").fill("Sunday charge");
await o.getByPlaceholder("Epic, building").fill("Epic");
await o.locator('input[type=file][accept*="audio"]').setInputFiles(track);
await o.getByRole("button", { name: "Add the track" }).click();
ok(await until(() => q(`select jsonb_array_length(value) from site_settings where key='music'`) === "1", 20000), "a music track added, with its length read");
await o.screenshot({ path: "/var/tmp/ospg/shots/phasee-owner-films.png", fullPage: true });
await own.close();

// ================================================================ The questions
await p.goto(`${BASE}/t/${T}/film?new=1`, { waitUntil: "networkidle" });
const qText = () => p.locator(".wz-q").innerText();
await p.locator(".film-flow").waitFor({ timeout: 15000 });
ok((await qText()) === "How long?", "first question: how long");
const lens = await p.locator(".wz-tile").evaluateAll((els) => els.map((e) => [e.querySelector(".wz-t").textContent, e.disabled, e.querySelector(".wz-n")?.textContent ?? ""]));
ok(lens.length === 3 && lens[0][0] === "3 minutes" && lens[0][2] === "Best for your clips" && lens[1][1] && lens[2][1], `3, 5 or 8 minutes; with four shots only 3 fits (${lens.map((l) => `${l[0]}${l[1] ? " off" : ""}`).join(", ")})`);
ok(/4 shots filmed, plus an interview or the like/.test(await p.locator(".wz-hint").innerText()), "the prediction counts as an extra, not a shot");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-q-length.png" });
await p.locator(".wz-tile", { hasText: "3 minutes" }).click();
ok((await qText()) === "What shape?", "mixed clips: the shape is asked");
ok((await p.locator('.wz-tile[aria-pressed="true"] .wz-t').innerText()) === "Phone (upright)", "the tournament's setting (phones) is already picked");
ok(/and 3 wide/.test(await p.locator(".wz-hint").innerText()), "says how many were filmed the other way");
ok((await p.locator(".film-other").count()) === 0, "with only one upright clip, leaving the rest out isn't offered");
await p.locator(".wz-next").click();
ok((await qText()) === "What do you want to hear?", "sound");
await p.locator(".wz-tile", { hasText: "Both" }).click();
ok((await qText()) === "Who's in the commentary box?", "the booth");
await p.locator(".wz-tile", { hasText: "commentator and a pundit" }).click();
ok((await qText()) === "How should they sound?", "the style");
fs.rmSync("/var/tmp/ospg/tts.log", { force: true });
const [sampleRes] = await Promise.all([p.waitForResponse((r) => r.url().endsWith("/api/film") && r.request().postData()?.includes('"sample"')), p.locator(".film-style", { hasText: "Dry and witty" }).getByRole("button", { name: "Hear it" }).click()]);
const sampleUrls = (await sampleRes.json()).urls ?? [];
ok(sampleUrls.length === 2 && new Set(sampleUrls).size === 2, `Hear it: a sample in both voices (${sampleUrls.length} recordings)`);
const sample = fs.existsSync("/var/tmp/ospg/tts.log") ? fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-q-style.png" });
await p.locator(".wz-tile", { hasText: "Dry and witty" }).click();
ok((await qText()) === "Music?", "music");
ok((await p.locator(".wz-tile", { hasText: "Sunday charge" }).count()) === 1 && (await p.locator(".wz-tile", { hasText: "No music" }).count()) === 1, "the site's track, or none");
await p.locator(".wz-tile", { hasText: "Sunday charge" }).click();
ok((await qText()) === "Ready to make your film", "the summary");
const sum = await p.locator(".film-summary").innerText();
ok(/3 minutes/.test(sum) && /Phone \(upright\)/.test(sum) && /Both/.test(sum) && /Commentator and pundit, dry and witty/.test(sum) && /Sunday charge/.test(sum), `summary: ${sum.replace(/\n/g, " ")}`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-q-ready.png" });

// ================================================================ In production, then ready
const madeAt = Date.now();
await p.getByRole("button", { name: "Make my film" }).click();
await p.locator(".film-prod").waitFor({ timeout: 15000 });
ok((await p.locator(".clapper").count()) === 1 && /in production/.test(await qText()), "the clapperboard: your film is in production");
const steps = await p.locator(".film-steps li").allInnerTexts();
ok(steps.join("|") === "Choosing the shots and writing the script|Recording the commentary|Putting it together|Ready to watch", `plain steps (${steps.join(", ")})`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-production.png" });
const reelId = q(`select id from reels order by created_at desc limit 1`);
ok(!!reelId && q(`select status||'|'||stage from reels where id='${reelId}'`).startsWith("planning|"), "the film is being made on the server");
// Close the app: the server carries on
await p.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
ok(await until(() => q(`select status from reels where id='${reelId}'`) === "done", 120000), "with the app closed, the film still finishes");
ok(q(`select renders from reels where id='${reelId}'`) === "1" && Number(q(`select cost_cents from reels where id='${reelId}'`)) > 0, "it counts as one film, with its cost");
// Back to the film
await p.goto(`${BASE}/t/${T}/film`, { waitUntil: "networkidle" });
await p.locator(".film-ready").waitFor({ timeout: 15000 });
ok((await p.locator(".film-video").count()) === 1 && (await p.locator(".film-video").getAttribute("class")).includes("upright"), "coming back: the film, upright, ready to watch");
for (const name of ["Share", "Save to this phone", "Change something", "Make another version"]) ok((await p.locator(".film-actions .btn", { hasText: name }).count()) === 1, `button: ${name}`);
ok(/1 more film can be made/.test(await p.locator(".film-sub").innerText()), "one more film allowed for this tournament");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-ready.png" });
ok(q(`select count(*) from posts where id=(select post_id from reels where id='${reelId}')`) === "1", "the film is in Highlights");

// ================================================================ The edit itself
// The film's edit: the biggest one sent to the renderer since the film was started (broadcast clips are small)
const editSince = (ms) => JSON.parse(fs.readFileSync(fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-")).map((f) => `/var/tmp/ospg/${f}`).filter((f) => fs.statSync(f).mtimeMs >= ms).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0], "utf8"));
const edit = editSince(madeAt);
const fileOf = (body) => q(`select media_path from posts where kind='video' and body='${body.replace(/'/g, "''")}'`).split("/").pop();
const clipFiles = clipsSpec.map((c) => fileOf(c.body));
const isShot = (c) => c.asset.type === "video" && clipFiles.some((f) => c.asset.src.includes(f));
const tracks = edit.timeline.tracks;
const all = tracks.flatMap((t) => t.clips);
ok(edit.output.resolution === "1080" && edit.output.aspectRatio === "9:16", `output upright (${edit.output.resolution}, ${edit.output.aspectRatio})`);
const vids = all.filter((c) => c.asset.type === "video").sort((a, b) => a.start - b.start);
const brandIntro = q(`select value->'intro'->'portrait'->>'path' from site_settings where key='brand'`);
const brandOutro = q(`select value->'outro'->'portrait'->>'path' from site_settings where key='brand'`);
ok(vids[0]?.asset.src.includes(brandIntro) && vids[0].start === 0, "opens with the branded intro");
const last = vids.at(-1);
ok(last?.asset.src.includes(brandOutro), "ends with the branded ending");
const cards = all.filter((c) => c.asset.type === "image" && /director\/card/.test(c.asset.src)).sort((a, b) => a.start - b.start);
ok(cards.length >= 2 && cards[0].start >= vids[0].length - 0.1, "then the tournament's own title card");
const predFile = fileOf("Neil: Oisin by ten points");
const predClip = vids.find((c) => c.asset.src.includes(predFile));
const firstShot = vids.filter(isShot).sort((a, b) => a.start - b.start)[0];
ok(predClip && firstShot && predClip.start < firstShot.start, "the prediction plays before the first shot of round 1");
ok(predClip && predClip.asset.volume >= 0.9, "with its own sound up");
// Wide clips in an upright film: cropped around the golfer, not blurred
const wideClips = vids.filter((c) => clipFiles.slice(0, 3).some((f) => c.asset.src.includes(f)));
ok(wideClips.length >= 3 && wideClips.every((c) => c.asset.crop && (c.asset.crop.left > 0 || c.asset.crop.right > 0)) && wideClips.some((c) => Math.abs(c.asset.crop.left - c.asset.crop.right) > 0.1), "wide clips are cropped to an upright slice around the golfer (not centred blindly)");
ok(!all.some((c) => c.filter === "blur" && isShot(c)), "no blurred fill behind them");
// Two voices
const tts = fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(sample.length);
const voices = new Set(tts.map((t) => t.voice));
ok(tts.length >= 6 && voices.size === 2, `commentary recorded in two voices (${[...voices].join(", ")}, ${tts.length} lines)`);
const planPrompt = fs.readFileSync(fs.readdirSync("/var/tmp/ospg").filter((f) => /^prompt-\d+\.txt$/.test(f)).map((f) => `/var/tmp/ospg/${f}`).filter((f) => /film editor|highlights package/.test(fs.readFileSync(f, "utf8"))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], "utf8");
ok(/pundit/i.test(planPrompt) && /commentator/i.test(planPrompt) && /bone-dry/.test(planPrompt), "the director writes for a commentator and a pundit, in the chosen style");
ok(/OFF-COURSE CLIPS/.test(planPrompt) && /Prediction/.test(planPrompt), "and is told about the prediction");
ok(/go quiet|own sound/i.test(planPrompt), "Both: the commentator goes quiet while the shot plays");
// No two lines overlap
const trackPath = q(`select value->0->>'path' from site_settings where key='music'`);
const lines = all.filter((c) => c.asset.type === "audio" && !/whoosh/.test(c.asset.src) && !c.asset.src.includes(trackPath.split("/").pop())).sort((a, b) => a.start - b.start);
ok(lines.length >= 6 && lines.every((c, i) => i === 0 || c.start >= lines[i - 1].start + lines[i - 1].length - 0.01), `no two lines of commentary overlap (${lines.length} lines)`);
// Music: the site's track, under the commentary, fading out at the end
const music = all.filter((c) => c.asset.type === "audio" && c.asset.src.includes(trackPath.split("/").pop())).sort((a, b) => a.start - b.start);
ok(music.length >= 3 && !edit.timeline.soundtrack, `the site's own track laid under the film in ${music.length} pieces`);
const levels = music.map((m) => m.asset.volume);
ok(Math.max(...levels) > Math.min(...levels) * 1.8, `louder on the cards, down under the talking (${Math.min(...levels)} to ${Math.max(...levels)})`);
ok(music[0].asset.effect === "fadeIn" && /fadeOut/.test(music.at(-1).asset.effect ?? ""), "fades in at the start and out at the end");
const filmEnd = Math.max(...all.map((c) => c.start + c.length));
ok(Math.abs(music.at(-1).start + music.at(-1).length - filmEnd) < 3, "runs to the end of the film");
// Shots' own sound: each shot plays with its sound up while nobody's talking
ok(vids.filter(isShot).some((c) => c.asset.volume >= 0.9), "Both: the shots' own sound is up while they play");

// ================================================================ The email
const mails = fs.readdirSync("/var/tmp/ospg/mail").filter((f) => Number(f.split("-")[0]) >= madeAt).map((f) => JSON.parse(fs.readFileSync(`/var/tmp/ospg/mail/${f}`, "utf8")));
const filmMail = mails.find((m) => /film/i.test(m.subject) && /ready/i.test(m.subject));
ok(!filmMail, "no email yet: nobody's signed in to this tournament with email");
q(`insert into accounts (email) values ('organiser@example.com') on conflict do nothing; insert into account_tournaments (account_id, tournament_id) select a.id, t.id from accounts a, tournaments t where a.email='organiser@example.com' and t.slug='${T}' on conflict do nothing`);

// ================================================================ The studio
await p.getByRole("link", { name: "Change something" }).click();
await p.locator(".studio").waitFor({ timeout: 15000 });
await p.locator(".studio-row").first().waitFor();
const rows = await p.locator(".studio-row").count();
ok(rows >= 6, `the studio lists the film's pieces (${rows})`);
ok((await p.locator(".studio-thumb").count()) >= 4, "with stills from the clips");
ok((await p.getByText("Pundit").count()) >= 1 && (await p.getByText("Commentator").count()) >= 1, "the two seats");
const seat2 = p.locator(".seat", { hasText: "Pundit" });
ok((await seat2.locator('.pick-tile[aria-pressed="true"]').innerText()) === "Female" || (await seat2.innerText()).includes("Alice"), "the pundit's seat starts on the female voice");
await seat2.locator(".pick-tile", { hasText: "Female" }).click();
await seat2.getByLabel("Pundit accent").selectOption("Irish");
await seat2.getByLabel("Pundit voice").selectOption("pundit02");
ok(await until(async () => (await seat2.getByLabel("Pundit voice").inputValue()) === "pundit02"), "the pundit changed to an Irish female voice");
ok((await p.getByRole("button", { name: /Record it yourself/ }).count()) >= 3, "every line can be recorded yourself");
// Edit a line
const first = p.locator(".studio-line").first();
const ta = first.locator("textarea");
await ta.fill("A fresh line for the opening.");
await ta.blur();
await sleep(800);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-studio.png", fullPage: true });
await p.getByRole("button", { name: "Make the film again" }).click();
await p.locator(".film-prod").waitFor({ timeout: 15000 });
ok(await until(() => q(`select status||'|'||renders from reels where id='${reelId}'`) === "done|2", 120000), "made again: the second film of the tournament");
const tts2 = fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(sample.length + tts.length);
ok(tts2.some((t) => /fresh line/.test(t.text)) && tts2.filter((t) => t.voice !== "pundit02").length === 1 && tts2.filter((t) => t.voice === "pundit02").length === 2, `recorded again: the changed line, and the pundit's lines in the new voice; the rest reused (${tts2.length})`);
const fm = await until(() => fs.readdirSync("/var/tmp/ospg/mail").sort().map((f) => JSON.parse(fs.readFileSync(`/var/tmp/ospg/mail/${f}`, "utf8"))).find((m) => m.to.join() === "organiser@example.com" && /film/i.test(m.subject)), 20000);
ok(!!fm && /film\?reel=/.test(fm.text ?? fm.html ?? ""), `the organiser's email says the film is ready (${fm?.subject})`);

// ================================================================ The limits
await p.goto(`${BASE}/t/${T}/film?new=1`, { waitUntil: "networkidle" });
await p.locator(".notice").waitFor({ timeout: 15000 });
ok(/made all 2 of its films/.test(await p.locator(".notice").innerText()), "two films made: no more for this tournament");
q(`update site_settings set value = jsonb_set(value, '{perTournament}', '5') where key='films'`);
q(`update site_settings set value = jsonb_set(value, '{monthlyCents}', '1') where key='films'`);
await p.goto(`${BASE}/t/${T}/film?new=1`, { waitUntil: "networkidle" });
await p.locator(".notice").waitFor({ timeout: 15000 });
ok(/month's film budget/.test(await p.locator(".notice").innerText()), "the site's monthly ceiling reached: films wait");
q(`update site_settings set value = jsonb_set(value, '{monthlyCents}', '3000') where key='films'`);

// Clips' own sound only: no commentary step, no voices recorded
await p.goto(`${BASE}/t/${T}/film?new=1`, { waitUntil: "networkidle" });
await p.locator(".film-flow").waitFor({ timeout: 15000 });
await p.locator(".wz-tile", { hasText: "3 minutes" }).click();
await p.locator(".wz-next").click();
await p.locator(".wz-tile", { hasText: "own sound" }).click();
ok((await qText()) === "Music?", "clips' own sound: straight to the music question");
await p.locator(".wz-tile", { hasText: "No music" }).click();
const sum2 = await p.locator(".film-summary").innerText();
ok(!/Commentary/.test(sum2) && /None/.test(sum2), "summary: no commentary, no music");
const ttsBefore = fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").length;
const madeAt2 = Date.now();
await p.getByRole("button", { name: "Make my film" }).click();
await p.locator(".film-prod").waitFor({ timeout: 15000 });
const steps2 = await p.locator(".film-steps li").allInnerTexts();
ok(!steps2.includes("Recording the commentary"), `no voices step (${steps2.join(", ")})`);
const reel2 = q(`select id from reels order by created_at desc limit 1`);
ok(await until(() => q(`select status from reels where id='${reel2}'`) === "done", 120000), "made");
ok(fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").length === ttsBefore, "no voices recorded");
const edit2 = editSince(madeAt2);
const all2 = edit2.timeline.tracks.flatMap((t) => t.clips);
ok(!all2.some((c) => c.asset.type === "audio" && !/whoosh/.test(c.asset.src)) && !edit2.timeline.soundtrack, "no narration, no music: the clips' own sound only");
ok(all2.filter(isShot).length >= 3 && all2.filter(isShot).every((c) => c.asset.volume >= 0.9 || c.asset.speed), "every shot plays with its sound up (bar the slow-motion holds)");

// ================================================================ A render that fails: plain words, Try again, nothing charged twice
await fetch("http://127.0.0.1:54321/__failnext");
await p.goto(`${BASE}/t/${T}/film?new=1`, { waitUntil: "networkidle" });
await p.locator(".film-flow").waitFor({ timeout: 15000 });
await p.locator(".wz-tile", { hasText: "3 minutes" }).click();
await p.locator(".wz-next").click();
await p.locator(".wz-tile", { hasText: "own sound" }).click();
await p.locator(".wz-tile", { hasText: "No music" }).click();
await p.getByRole("button", { name: "Make my film" }).click();
await p.locator(".film-prod").waitFor({ timeout: 15000 });
const reel3 = q(`select id from reels order by created_at desc limit 1`);
ok(await until(() => q(`select status from reels where id='${reel3}'`) === "failed", 120000), "the renderer fails");
await p.goto(`${BASE}/t/${T}/film?reel=${reel3}`, { waitUntil: "networkidle" });
await p.locator(".film-prod").waitFor({ timeout: 15000 });
ok(/didn't finish/.test(await qText()) && /could not be downloaded/.test(await p.locator(".film-prod .notice").innerText()), "says so in plain words, with the reason");
ok((await p.locator(".film-steps li.stuck").count()) === 1, "the step it stuck on is marked");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasee-failed.png" });
const edits3 = fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-")).length;
await p.getByRole("button", { name: "Try again" }).click();
ok(await until(() => q(`select status from reels where id='${reel3}'`) === "done", 120000), "Try again: the film finishes");
ok(fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-")).length === edits3 + 1, "only the render was done again");

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
