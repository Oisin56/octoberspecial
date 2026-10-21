// Real screens for the front page, from a made-up tournament (invented names). Run after fresh, with the stub up.
// Writes 1170-wide JPEGs into the app's public/home folder.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
async function setScore(pg, who, n) {
  const s = pg.locator(".pscore.entry", { hasText: who }).locator(".score-step");
  for (let i = 0; i < 20; i++) {
    const v = await s.getAttribute("data-value");
    const par = Number(await s.getAttribute("data-par"));
    const cur = v === "" ? null : Number(v);
    if (cur === n) return;
    if (cur === null && n === par) await s.locator(".ss-val").click();
    else await s.locator((cur ?? par) < n ? ".ss-plus" : ".ss-minus").click();
  }
  throw new Error(`couldn't set ${who} to ${n}`);
}

const BASE = "http://127.0.0.1:3100";
const OUT = "/home/claude/october-special/public/home";
const env = fs.readFileSync("/home/claude/october-special/.env.local", "utf8");
const OWNER = env.match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
const SECRET = (process.env.SESSION_SECRET || env.match(/^SESSION_SECRET=(.*)$/m)?.[1] || "dev").trim();
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
sql(`delete from tournaments where slug like 'the-atlantic-cup%'`);

// ---- the tournament
const wizard = {
  who: "individuals",
  name: "The Atlantic Cup",
  subtitle: "Four friends. Two rounds. One trophy.",
  rounds: [1, 2].map((n) => ({ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", tee: "White", format: "stroke", date: `2026-10-1${n}`, time: "09:30" })),
  players: [
    { key: "p1", name: "Declan", index: 12.4 },
    { key: "p2", name: "Marcus", index: 8.1 },
    { key: "p3", name: "Ronan", index: 17.6 },
    { key: "p4", name: "Shane", index: 5.3 },
  ],
  organiserPlays: true,
  teams: [],
  win: "stroke",
  draw: "random",
  prizes: [],
  extras: { feed: true, ai: true, video: true },
  theme: "spring",
  units: "yards",
  share: "portrait",
};
const made = await fetch(`${BASE}/api/tournaments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wizard, pin: "2468", ownerPin: OWNER }) }).then((r) => r.json());
const slug = made.slug;
if (!slug) throw new Error(`not made: ${JSON.stringify(made)}`);
const tid = sql(`select id from tournaments where slug='${slug}'`);
const r1 = sql(`select id from rounds where tournament_id='${tid}' and number=1`);
const pid = (n) => sql(`select id from players where tournament_id='${tid}' and name='${n}'`);
const ids = ["Declan", "Marcus", "Ronan", "Shane"].map(pid);
const games = JSON.parse(sql(`select coalesce(games, '[]') from rounds where id='${r1}'`));
const gid = games[0]?.id ?? "main";
sql(`update tournaments set published=true where id='${tid}'; update rounds set status='live' where id='${r1}'; update rounds set course_name='The Atlantic Links' where tournament_id='${tid}'`);
// The course's photo: a links green by the sea (the made-up Atlantic Links)
fs.mkdirSync(`/var/tmp/ospg/files/photo/${slug}`, { recursive: true });
fs.copyFileSync("/home/claude/october-special/public/home/photos/trip.jpg", `/var/tmp/ospg/files/photo/${slug}/course.jpg`);
sql(`update rounds set photo_path='photo/${slug}/course.jpg' where tournament_id='${tid}'`);
// Eleven holes in: a close finish
const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4];
const plus = [
  [1, 0, 1, 0, 1, 2, 0, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1],
  [2, 1, 1, 1, 2, 1, 0, 2, 1, 1, 2],
  [0, 0, 1, -1, 0, 1, 0, 0, 0, 1, 0],
];
for (let h = 1; h <= 11; h++) {
  const scores = Object.fromEntries(ids.map((id, i) => [id, { gross: pars[h - 1] + plus[i][h - 1] }]));
  sql(`insert into hole_entries (round_id, game, hole, scores) values ('${r1}', '${gid}', ${h}, '${JSON.stringify(scores)}')`);
}

const b = await chromium.launch();
// Phone screens: the app as installed on the home screen (no browser bars), 390 wide; the status bar strip is
// added on top (compose.py), making the full 390 x 844 screen
const PHONE = { ...devices["iPhone 13"], viewport: { width: 390, height: 797 }, screen: { width: 390, height: 844 } };
const manifest = {};
const shot = async (p, name) => {
  await p.screenshot({ path: `/var/tmp/ospg/shots/raw-${name}.png` });
  const tone = execSync(`python3 /var/tmp/ospg/compose.py /var/tmp/ospg/shots/raw-${name}.png ${OUT}/${name}.jpg`).toString().trim();
  manifest[name] = { dark: tone === "dark" };
  fs.writeFileSync("/home/claude/october-special/src/lib/screens.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log("saved", name, tone);
};
/** The made-up course's name wherever the real course's shows on a screen */
const atlantic = (p) => p.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (/Birr/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Birr Golf Club|Birr/g, "The Atlantic Links");
});

// ---- The standings after 11 (for the front page's scoreboard story)
{
  const ctx = await b.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}/leaderboard`, { waitUntil: "networkidle" });
  await p.locator(".board").first().waitFor();
  console.log("THRU11", (await p.locator(".board").first().innerText()).replace(/\s+/g, " "));
  await ctx.close();
}

// ---- Set up: the wizard's first question
{
  const ctx = await b.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/owner`);
  await p.evaluate(async (pin) => fetch("/api/owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "signin", pin }) }), OWNER);
  await p.goto(`${BASE}/new`, { waitUntil: "networkidle" });
  await p.locator(".wz-tile").first().waitFor();
  await p.locator(".wz-tile", { hasText: "A group of us" }).click();
  await p.fill("#wz-name", "The Atlantic Cup");
  await p.locator(".wz-next").click();
  await p.getByText("Yes, I'm playing").click();
  const people = [["Declan", "12.4"], ["Marcus", "8.1"], ["Ronan", "17.6"], ["Shane", "5.3"]];
  for (const [i, [n, h]] of people.entries()) {
    if (i) await p.getByText("+ Add another player").click();
    const row = p.locator(".wz-player").nth(i);
    await row.locator("input").nth(0).fill(n);
    await row.locator("input").nth(1).fill(h);
  }
  await p.locator(".wz-next").click();
  await p.locator(".wz-tile", { hasText: "Lowest total score" }).click();
  await p.locator(".wz-nums .num-tile", { hasText: /^2$/ }).click();
  await p.fill("#wz-q", "Birr");
  await p.getByRole("button", { name: "Search" }).click();
  await p.locator(".wz-hit").first().waitFor();
  await p.locator(".wz-hit").first().click();
  await p.waitForFunction(() => document.querySelector(".wz-q")?.textContent?.startsWith("Which tees"));
  await sleep(400);
  await atlantic(p);
  await shot(p, "setup");
  await ctx.close();
}

// ---- Play: hole 12 on the scorecard, with the GPS tab
{
  const ctx = await b.newContext({ ...PHONE, permissions: ["geolocation"], geolocation: { latitude: 53.09164, longitude: -7.89111, accuracy: 5 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}`);
  await p.evaluate(async (t) => fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, mode: "organiser", pin: "2468" }) }), slug);
  await p.goto(`${BASE}/t/${slug}/score`, { waitUntil: "networkidle" });
  await p.locator(".pscore.entry").first().waitFor();
  const tap = (who, n) => setScore(p, who, n);
  await tap("Declan", 2);
  await tap("Marcus", 3);
  await p.locator(".gps-tab").waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(800);
  await shot(p, "play");
  await p.locator(".gps-tab").click();
  await p.waitForFunction(() => /\d/.test(document.querySelector(".gps-n.mid b")?.textContent ?? ""), null, { timeout: 15000 });
  await p.evaluate(() => localStorage.setItem("mgs-gps-tip", "1"));
  await p.locator(".linklike", { hasText: "Got it" }).click().catch(() => {});
  await sleep(500);
  await shot(p, "gps");
  // The hole finished: the "what happened" card, with Record and the voice note
  await p.getByRole("button", { name: /^Close/ }).first().click().catch(() => {});
  await sleep(500);
  sql(`delete from gps_readings where tournament_id='${tid}'`);
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/gps/i.test(k)) localStorage.removeItem(k); });
  await tap("Ronan", 4);
  await tap("Shane", 3);
  await sleep(600);
  await p.locator(".next-hole").click();
  await p.locator(".shotcard").waitFor({ timeout: 10000 });
  await p.locator(".sc-player", { hasText: "Marcus" }).click();
  await sleep(400);
  // A shot opened: what happened, one tap
  await p.locator(".sc-row-main").first().click();
  await sleep(700);
  await shot(p, "shotcard");
  // No signal: the score is kept on the phone and sent later
  await p.goto(`${BASE}/t/${slug}/score`, { waitUntil: "networkidle" });
  await p.locator(".hole-pick .n").waitFor();
  if ((await p.locator(".hole-pick .n").innerText()).trim() !== "13") await p.getByRole("button", { name: "Next hole" }).click();
  await p.locator(".pscore.entry").first().waitFor();
  await ctx.setOffline(true);
  await tap("Declan", 4);
  await p.getByText(/Saved on this phone/).waitFor({ timeout: 15000 }).catch(() => {});
  await sleep(400);
  await shot(p, "offline");

  await ctx.close();
  // That score was only for the picture: the story stays at the 12th
  sql(`delete from hole_entries where round_id='${r1}' and hole >= 13`);
}

// ---- Filming: the camera on, recording (a stand-in camera plays the putt clip)
{
  execSync(`ffmpeg -loglevel error -y -ss 0.2 -t 3 -i /home/claude/october-special/public/home/clips/putt.mp4 -vf "fps=15,crop=380:600:0:330,scale=720:1136" -pix_fmt yuv420p /var/tmp/ospg/putt.y4m`);
  const cam = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=/var/tmp/ospg/putt.y4m"] });
  const ctx = await cam.newContext({ ...PHONE, permissions: ["camera", "microphone"] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}`);
  await p.evaluate(async (t) => fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, mode: "organiser", pin: "2468" }) }), slug);
  await p.evaluate(() => { localStorage.setItem("mgs_camera_tip", "1"); localStorage.setItem("mgs_install_hint", "9999999999999"); });
  await p.goto(`${BASE}/t/${slug}/record?hole=12&round=1`, { waitUntil: "networkidle" });
  await p.locator(".cam-ask-tile").first().click({ timeout: 3000 }).catch(() => {});
  await p.waitForFunction(() => { const v = document.querySelector(".cam-view"); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  await p.locator(".cam-rec").click();
  await p.locator(".cam-rec-banner").waitFor({ timeout: 8000 });
  await sleep(2300);
  await shot(p, "record");
  await ctx.close();
  await cam.close();
}

// ---- The feed: a clip with its graphics, comments and likes
{
  fs.mkdirSync(`/var/tmp/ospg/files/video/${slug}`, { recursive: true });
  fs.copyFileSync("/home/claude/october-special/public/home/clips/putt.webm", `/var/tmp/ospg/files/video/${slug}/putt.webm`);
  const declan = ids[0];
  sql(`insert into posts (tournament_id, round_id, hole, author_name, author_player_id, kind, body, media_path, player_ids, details, created_at) values ('${tid}', '${r1}', 11, 'Marcus', '${ids[1]}', 'video', 'Declan from thirty feet', 'video/${slug}/putt.webm', array['${declan}'], '{"shot":"Putt","result":"Holed","club":"Putter"}', now() - interval '6 minutes')`);
  const post = sql(`select id from posts where tournament_id='${tid}' and kind='video' limit 1`);
  for (const who of ["Aoife", "Ronan", "Shane", "Dad"]) sql(`insert into likes (post_id, tournament_id, liker) values ('${post}', '${tid}', '${who}') on conflict do nothing`);
  sql(`insert into comments (tournament_id, round_id, author_name, body, created_at) values ('${tid}', '${r1}', 'Aoife', 'Get in! Watching from the kitchen', now() - interval '4 minutes'), ('${tid}', '${r1}', 'Ronan', 'Jammy. Still buying the first round though', now() - interval '3 minutes')`);
  const ctx = await b.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}/feed`, { waitUntil: "networkidle" });
  await p.getByText("Declan from thirty feet").first().scrollIntoViewIfNeeded().catch(() => {});
  await p.evaluate(() => window.scrollBy(0, -120));
  await sleep(1500);
  await shot(p, "feed");
  await p.goto(`${BASE}/t/${slug}/highlights`, { waitUntil: "networkidle" });
  await sleep(2500);
  await shot(p, "highlight");
  await ctx.close();
}

// ---- Follow: the leaderboard a fan sees
{
  const ctx = await b.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}/leaderboard`, { waitUntil: "networkidle" });
  await p.locator(".board").first().waitFor();
  await sleep(600);
  console.log("THRU12", (await p.locator(".board").first().innerText()).replace(/\s+/g, " "));
  await shot(p, "follow");
  await ctx.close();
}

// ---- Follow, on a laptop: the feed with the leaderboard beside it, in the Links Championship look
{
  sql(`delete from ai_pieces where tournament_id='${tid}'`);
  sql(`insert into ai_pieces (tournament_id, round_id, kind, title, body, trigger, status, published_at) values ('${tid}', '${r1}', 'bulletin', 'Declan breaks clear at the 12th', 'A birdie at the short 12th takes Declan to three under and a shot clear. Marcus and Shane are tied at two under, and Ronan made a net par to stay in touch.', 'h12', 'published', now() - interval '2 minutes')`);
  sql(`update tournaments set theme='links' where id='${tid}'`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/t/${slug}/feed`, { waitUntil: "networkidle" });
  await p.locator(".sf-side .board").first().waitFor();
  await sleep(1500);
  await p.screenshot({ path: `${OUT}/board-wide.jpg`, type: "jpeg", quality: 84 });
  console.log("saved board-wide");
  sql(`update tournaments set theme='spring' where id='${tid}'`);
  await ctx.close();
}

// ---- The looks: each theme's leaderboard (on a computer) and the tournament's home (on a phone)
for (const theme of ["links", "spring", "championship", "teamcup"]) {
  sql(`update tournaments set theme='${theme}' where id='${tid}'`);
  {
    const ctx = await b.newContext({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/t/${slug}/leaderboard`, { waitUntil: "networkidle" });
    const board = p.locator(".board").first();
    await board.waitFor();
    await sleep(500);
    await board.screenshot({ path: `${OUT}/theme-${theme}-board.png` });
    const box = await board.boundingBox();
    manifest[`theme-${theme}-board`] = { w: Math.round(box.width * 2), h: Math.round(box.height * 2) };
    await ctx.close();
  }
  {
    const ctx = await b.newContext(PHONE);
    const p = await ctx.newPage();
    await p.evaluate?.(() => {});
    await p.goto(`${BASE}/t/${slug}`, { waitUntil: "networkidle" });
    await p.evaluate(() => localStorage.setItem("mgs_install_hint", "9999999999999"));
    await p.reload({ waitUntil: "networkidle" });
    await sleep(800);
    await shot(p, `theme-${theme}`);
    await ctx.close();
  }
}
sql(`update tournaments set theme='spring' where id='${tid}'`);

// ---- Relive: a title card from the film (the real graphic the film uses)
{
  const spec = { k: "title", h: "The Atlantic Cup", s: "Round 1, Birr", e: "Highlights", theme: "spring", w: 1280, ht: 720, bg: true, v: 6 };
  const d = Buffer.from(JSON.stringify(spec)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`card:${d}`).digest("base64url").slice(0, 24);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const r = await p.goto(`${BASE}/api/director/card?d=${d}&sig=${sig}`);
  if (r.status() !== 200) console.log("card", r.status());
  await sleep(300);
  await p.screenshot({ path: `${OUT}/relive.jpg`, type: "jpeg", quality: 85, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  console.log("saved relive");
  await ctx.close();
}
await b.close();
