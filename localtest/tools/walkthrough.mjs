// A screen recording of a real round on the made-up Atlantic Cup: the sample round's fallback. Run after frontshots.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
const BASE = "http://127.0.0.1:3100";
const OWNER = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const slug = sql(`select slug from tournaments where slug like 'the-atlantic-cup%' limit 1`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setScore(pg, who, n) {
  const s = pg.locator(".pscore.entry", { hasText: who }).locator(".score-step");
  for (let i = 0; i < 20; i++) {
    const v = await s.getAttribute("data-value");
    const par = Number(await s.getAttribute("data-par"));
    const cur = v === "" ? null : Number(v);
    if (cur === n) return;
    if (cur === null && n === par) await s.locator(".ss-val").click();
    else await s.locator((cur ?? par) < n ? ".ss-plus" : ".ss-minus").click();
    await sleep(380);
  }
}
fs.rmSync("/var/tmp/ospg/rec", { recursive: true, force: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices["iPhone 13"].userAgent, recordVideo: { dir: "/var/tmp/ospg/rec", size: { width: 390, height: 844 } },
  permissions: ["geolocation"], geolocation: { latitude: 53.09209, longitude: -7.89095, accuracy: 5 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/t/${slug}`);
await p.evaluate(async ([t, pin]) => fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, mode: "organiser", pin }) }), [slug, OWNER]);
await p.evaluate(() => { localStorage.setItem("mgs-gps-tip", "1"); localStorage.setItem("mgs_install_hint", "9999999999999"); });
await p.goto(`${BASE}/t/${slug}/score`, { waitUntil: "networkidle" });
await p.locator(".score-step").first().waitFor();
await p.locator(".install-hint button").click({ timeout: 1500 }).catch(() => {});
await sleep(1500);
for (const [who, n] of [["Declan", 4], ["Marcus", 5], ["Ronan", 4], ["Shane", 4]]) await setScore(p, who, n);
await sleep(800);
await p.locator(".gps-tab").click();
await sleep(2600);
await p.getByRole("button", { name: /^Close/ }).first().click({ timeout: 3000 }).catch(() => {});
await sleep(800);
await p.locator(".next-hole").click();
await p.locator(".shotcard").waitFor({ timeout: 10000 });
await sleep(2200);
await p.locator(".shotcard button", { hasText: /putt|Holed|chip/i }).first().click({ timeout: 3000 }).catch(() => {});
await sleep(2000);
sql(`update posts set broadcast_status=null, broadcast_path=null where media_path like ${"'"}%putt%${"'"}`);
await p.goto(`${BASE}/t/${slug}/highlights`, { waitUntil: "networkidle" });
await sleep(5000);
await p.goto(`${BASE}/t/${slug}/leaderboard`, { waitUntil: "networkidle" });
await sleep(3000);
{
  const tid = sql(`select id from tournaments where slug='${slug}'`);
  const r1 = sql(`select id from rounds where tournament_id='${tid}' and number=1`);
  sql(`delete from ai_pieces where tournament_id='${tid}'`);
  sql(`insert into ai_pieces (tournament_id, round_id, kind, title, body, trigger, status, published_at) values ('${tid}', '${r1}', 'bulletin', 'All square with five to play', 'Declan birdies the 13th to draw level with Shane on 29 points. Marcus lurks one back, and Ronan needs something special on the way in.', 'h13', 'published', now())`);
}
await p.goto(`${BASE}/t/${slug}/feed`, { waitUntil: "networkidle" });
await sleep(1200);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 260); await sleep(500); }
await sleep(1500);
const video = p.video();
await ctx.close();
await b.close();
const src = await video.path();
execSync(`ffmpeg -v error -y -ss 1.2 -i ${src} -vf "scale=720:-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 26 -movflags +faststart -an /home/claude/october-special/public/home/clips/walkthrough.mp4`);
console.log("saved walkthrough", fs.statSync("/home/claude/october-special/public/home/clips/walkthrough.mp4").size);
