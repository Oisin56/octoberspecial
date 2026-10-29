// Phase D: the GPS tab (front, middle, back; arrows; units; weak signal; not near), readings kept against strokes,
// the stroke card (drive "about", "from N", Holed filled in, moving and taking off a distance), who may change what,
// the tournament's units, and what the AI writer is told. Run after fresh, with the stub up.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
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
const T = "october-special-2026";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtA -c "${sql.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { const v = await f(); if (v) return v; await sleep(250); } return await f(); };
fs.mkdirSync("/var/tmp/ospg/shots", { recursive: true });

// Round 2 is live on a course with GPS (the stub's Birr), nothing scored; Oisin keeps score for his group
const r2 = q(`select r.id from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${T}' and r.number=2`);
q(`delete from hole_entries where round_id='${r2}'; delete from ai_pieces where round_id='${r2}'; delete from shots; delete from gps_readings`);
q(`update rounds set status='complete' where status='live'; update rounds set status='live', course_slug='golfapi:012141520611:Ireland' where id='${r2}'`);
q(`update tournaments set units='yards' where slug='${T}'`);
const games = JSON.parse(q(`select coalesce(games, 'null') from rounds where id='${r2}'`) || "null");
if (games) {
  for (const g of games) if (g.sides.some((s) => (s.playerIds ?? [s.id]).includes("oisin"))) g.scorerId = "oisin";
  q(`update rounds set games='${JSON.stringify(games)}'::jsonb where id='${r2}'`);
} else q(`update rounds set scorer_id='oisin' where id='${r2}'`);
q(`update players set link_code='neil-phase-d-link-0001', link_used_at=null where id='neil'`);
const h1par = Number(q(`select (holes->0->>'par') from rounds where id='${r2}'`));

// Hole 1 on the stub's course: the tee (between its two markers) and the middle of the green
const TEE = [53.0918, -7.8957];
const GREEN = { front: [53.0947, -7.8947], middle: [53.09485, -7.8947], back: [53.095, -7.8947] };
const along = (f) => [TEE[0] + (GREEN.middle[0] - TEE[0]) * f, TEE[1] + (GREEN.middle[1] - TEE[1]) * f];
const yds = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180, R = 6371008.8;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.0936133);
};
const near = (a, b, d = 2) => Math.abs(a - b) <= d;
// API calls from the phone itself (its session cookie is only sent by the browser)
const call = (pg, path, body) => pg.evaluate(async ([path, body]) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, ok: r.ok }; }, [path, body]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["geolocation"], geolocation: { latitude: TEE[0], longitude: TEE[1], accuracy: 5 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const at = (p, acc = 5) => ctx.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: acc });
await page.goto(`${BASE}/t/${T}`);
await page.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await page.goto(`${BASE}/t/${T}/score`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).waitFor();

// ---- The tab
const tab = page.locator(".gps-tab");
await tab.waitFor({ timeout: 15000 });
const tb = await tab.boundingBox();
const vw = page.viewportSize().width;
ok(tb.x + tb.width >= vw - 1 && tb.height >= 60, `a big GPS tab on the right edge (${Math.round(tb.width)}×${Math.round(tb.height)}px)`);
ok((await tab.innerText()).includes("GPS"), "labelled GPS");
await page.screenshot({ path: "/var/tmp/ospg/shots/phased-score-tab.png" });
const mid = page.locator(".gps-n.mid b");
const num = async (sel) => Number((await page.locator(sel).innerText()).replace(/\D/g, ""));
const settle = async () => until(async () => /\d/.test(await mid.innerText()));

// On the tee: tap the tab, the numbers come up
await tab.click();
await page.locator(".gps-panel").waitFor();
await settle();
ok((await page.locator(".gps-hole strong").innerText()) === "Hole 1", "opens on the hole the scorecard is on");
const m1 = await num(".gps-n.mid b"), f1 = await num(".gps-n.front b"), b1 = await num(".gps-n.back b");
ok(near(m1, yds(TEE, GREEN.middle)) && f1 < m1 && m1 < b1, `on the tee: front ${f1}, middle ${m1}, back ${b1} yards`);
const order = await page.locator(".gps-n span").allInnerTexts();
ok(order.join(",") === "Back,Middle,Front", "back at the top, front at the bottom, as you look at the green");
const midSize = await mid.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
ok(midSize >= 48, `the middle in big numbers (${midSize}px)`);
await page.screenshot({ path: "/var/tmp/ospg/shots/phased-gps-panel.png" });
let rd = await until(() => q(`select count(*) from gps_readings`) === "1" && q(`select player_id||'|'||hole||'|'||source||'|'||to_middle||'|'||from_tee from gps_readings`));
ok(rd && rd.startsWith(`oisin|1|gps|${m1}|`) && Number(rd.split("|")[4]) < 10, `kept for Oisin on hole 1, distances worked out on the server (${rd})`);
ok(q(`select count(*) from public_gps where to_middle=${m1}`) === "1" && !q(`select string_agg(column_name, ',') from information_schema.columns where table_name='public_gps'`).match(/\blat\b|\blon\b/), "everyone sees the distances, nobody sees where he stood");

// Measure again on the same spot: no second reading
await page.locator(".gps-again").click();
await sleep(1500);
ok(q(`select count(*) from gps_readings`) === "1", "measuring again on the same spot doesn't add another");

// Close, then the tab shows the last middle
await page.locator(".gps-close").click();
await until(async () => (await page.locator(".gps-panel").count()) === 0, 2000);
ok((await page.locator(".gps-panel").count()) === 0, "Close puts it away (it slides off)");
ok((await tab.innerText()).includes(String(m1)), "the tab shows the last middle number");

// Second shot, from the fairway
const P2 = along(0.6);
await at(P2);
await tab.click();
await until(async () => (await num(".gps-n.mid b")) !== m1);
const m2 = await num(".gps-n.mid b");
ok(near(m2, yds(P2, GREEN.middle)), `on the fairway: ${m2} to the middle`);

// Metres, just on this phone
await page.locator(".gps-units .pick-tile", { hasText: "Metres" }).click();
const mm = await num(".gps-n.mid b");
ok((await page.locator('.gps-units .pick-tile[aria-pressed="true"]').evaluate((e) => getComputedStyle(e).backgroundColor)) !== (await page.locator(".gps-panel").evaluate((e) => getComputedStyle(e).backgroundColor)), "the chosen unit stands out");
ok(near(mm, Math.round(m2 / 1.0936133), 1) && (await page.locator(".gps-unit").innerText()).startsWith("metres"), `Metres: ${mm} metres`);
ok((await page.evaluate(() => localStorage.getItem("mgs-units"))) === "metres", "remembered on this phone");
await page.screenshot({ path: "/var/tmp/ospg/shots/phased-gps-metres.png" });
await page.locator(".gps-units .pick-tile", { hasText: "Yards" }).click();

// The arrows: a look at another hole files nothing
await page.locator(".gps-panel").getByRole("button", { name: "Next hole" }).click();
await until(async () => (await page.locator(".gps-hole strong").innerText()) === "Hole 2");
await sleep(1500);
ok(q(`select count(*) from gps_readings where hole=2`) === "0", "looking at hole 2 with the arrows files nothing");
await page.locator(".gps-panel").getByRole("button", { name: "Previous hole" }).click();
await until(async () => (await page.locator(".gps-hole strong").innerText()) === "Hole 1");

// Weak signal
await at(along(0.92), 40);
await page.locator(".gps-again").click();
await page.locator(".gps-weak").waitFor({ timeout: 10000 });
ok(/out by about \d+ yds/.test(await page.locator(".gps-weak").innerText()), "a weak signal says how far out it could be");
const m3 = await num(".gps-n.mid b");
ok(await until(() => q(`select count(*) from gps_readings where hole=1`) === "3"), "three readings on hole 1: tee, fairway, near the green");

// Somewhere else entirely
await at([53.35, -6.26]);
await page.locator(".gps-again").click();
await page.getByText(/not near hole 1/).waitFor({ timeout: 10000 });
ok(true, "miles away: says you're not near the hole");
await sleep(800);
ok(q(`select count(*) from gps_readings`) === "3", "and keeps nothing");

// Swipe right to put it away
const pb = await page.locator(".gps-panel").boundingBox();
await page.mouse.move(pb.x + 40, pb.y + 200);
await page.mouse.down();
await page.mouse.move(pb.x + 160, pb.y + 205, { steps: 4 });
await page.mouse.move(pb.x + 300, pb.y + 210, { steps: 4 });
await page.mouse.up();
await until(async () => (await page.locator(".gps-panel").count()) === 0, 3000);
ok((await page.locator(".gps-panel").count()) === 0, "a swipe to the right puts it away");

// ---- The hole is done: Oisin one over, Neil par. The card has his strokes with the distances on them.
const tap = (who, n) => setScore(page, who, n);
await tap("Oisin", h1par + 1);
await tap("Neil", h1par);
await page.getByText("Saved for everyone").waitFor({ timeout: 10000 });
await page.locator(".after-hole").waitFor();
await page.locator(".after-hole .btn", { hasText: "Add detail" }).click();
const mo = page.locator(".dtl");
await mo.waitFor();
ok(!(await tab.isVisible()), "the tab steps aside while he adds detail");
await mo.locator(".dtl-tab", { hasText: "Oisin" }).click();
const rowsOf = async () =>
  mo.locator(".dtl-shot").evaluateAll((els) => els.map((e) => [e.querySelector(".dtl-what")?.firstChild?.textContent?.trim() ?? "", e.querySelector(".dtl-sub")?.textContent?.trim() ?? ""]));
let rows = await rowsOf();
ok(rows.length === h1par + 1, `a card for each of his ${h1par + 1} strokes`);
const drive = yds(TEE, P2);
const dm = rows[0][1].match(/went about (\d+)/);
ok(rows[0][0].startsWith("Tee shot") && !!dm && near(Number(dm[1]), drive, 3), `stroke 1: the tee shot, ${rows[0][1]} (tee to the second)`);
ok(rows[1][1] === `from ${m2} yds`, `stroke 2: ${rows[1][1]}`);
ok(rows[2][1] === `from ${m3} yds`, `stroke 3: ${rows[2][1]}`);
ok(/^Holed/.test(rows[h1par][0]), `the last stroke: holed (${rows[h1par][0]})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/phased-strokes.png" });

// That near-the-green number was for his fourth: move it
await mo.locator(".dtl-shot").nth(2).locator(".dtl-card-main").click();
await mo.getByRole("button", { name: "Measured for a different shot?" }).click();
await mo.getByText("Measured for which shot?").waitFor();
await page.screenshot({ path: "/var/tmp/ospg/shots/phased-move.png" });
await mo.locator(".dtl-tiles.four .dtl-tile", { hasText: /^4$/ }).click();
await mo.locator(".dtl-shot.open .dtl-card-main").click();
rows = await rowsOf();
ok(rows[2][1] === "" && rows[3][1] === `from ${m3} yds`, "moved to stroke 4 with one tap");
ok(await until(() => q(`select seq from gps_readings where to_middle=${m3}`) === "4"), "and kept there for everyone");
// Then off altogether
await mo.locator(".dtl-shot").nth(3).locator(".dtl-card-main").click();
await mo.getByRole("button", { name: "Measured for a different shot?" }).click();
await mo.getByRole("button", { name: "Take it off" }).click();
await mo.locator(".dtl-shot.open .dtl-card-main").click();
rows = await rowsOf();
ok(rows.filter((r) => /from \d/.test(r[1])).length === 2 && rows[3][1] === "", "Take it off: gone from his strokes");
ok(await until(() => q(`select ignored from gps_readings where to_middle=${m3}`) === "t"), "kept aside, not deleted");

// He says what his second was: from the fairway distance, its likeliest kinds first
await mo.locator(".dtl-shot").nth(1).locator(".dtl-card-main").click();
const tiles = await mo.locator(".dtl-shot.open .dtl-tile").allInnerTexts();
await mo.locator(".dtl-shot.open .dtl-tile").first().click();
const shot2 = await until(() => q(`select seq||'|'||author_player_id||'|'||kind from shots where player_id='oisin' and hole=1`));
ok(shot2 && shot2.startsWith("2|oisin|") && tiles.length === 4 && tiles.at(-1) === "Other", `saved on stroke 2, logged by Oisin (${shot2}; offered ${tiles.join(", ")})`);

// ---- Neil's phone: anyone in the group can tell and change Oisin's shots
const nctx = await browser.newContext({ ...devices["iPhone 13"] });
const np = await nctx.newPage();
await np.goto(`${BASE}/t/${T}`);
const lr = await np.request.post(`${BASE}/api/login`, { data: { t: T, mode: "link", code: "neil-phase-d-link-0001", step: "confirm" } });
ok(lr.ok() && (await lr.json()).playerId === "neil", "Neil logged in on his own phone");
await np.goto(`${BASE}/t/${T}/shots?round=2&hole=1`, { waitUntil: "networkidle" });
const nmo = np.locator(".dtl");
await nmo.waitFor();
await nmo.locator(".dtl-tab", { hasText: "Oisin" }).click();
const told2 = nmo.locator(".dtl-shot").nth(1);
ok(/by Oisin/.test(await told2.innerText()), "Oisin's own shot shows who told it");
ok(!(await told2.locator(".dtl-card-main").isDisabled()), "and Neil can open it (anyone in the group)");
await nmo.locator(".dtl-shot").nth(2).locator(".dtl-card-main").click();
await nmo.locator(".dtl-shot.open .dtl-tile").first().click();
const byNeil = await until(() => q(`select seq||'|'||author_player_id||'|'||author_name from shots where player_id='oisin' and hole=1 and seq=3`));
ok(byNeil === "3|neil|Neil", `Neil adds stroke 3 for Oisin (${byNeil})`);
await np.screenshot({ path: "/var/tmp/ospg/shots/phased-neil.png" });
// Oisin (his own shot, and the organiser) can change Neil's entry for him
await page.reload({ waitUntil: "networkidle" });
const neilShot = q(`select client_id from shots where player_id='oisin' and hole=1 and seq=3`);
const od = await call(page, "/api/shots", { t: T, op: "delete", clientId: neilShot });
ok(od.ok, "the player himself can clear a shot someone else logged for him");

// A reading too far from the hole is refused by the server
const far = await call(page, "/api/gps", { t: T, clientId: "far-away-reading-01", roundId: r2, hole: 1, playerId: "oisin", lat: 53.35, lon: -6.26, accuracy: 5, takenAt: new Date().toISOString(), source: "gps" });
ok(far.status === 200 && q(`select count(*) from gps_readings where client_id='far-away-reading-01'`) === "0", "a reading miles from the hole isn't kept (the phone stops retrying it)");

// ---- A phone that hasn't been asked about location: one line first, then the phone's own question
const lctx = await browser.newContext({ ...devices["iPhone 13"] });
const lp = await lctx.newPage();
await lp.goto(`${BASE}/t/${T}`);
await lp.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await lp.goto(`${BASE}/t/${T}/score`, { waitUntil: "networkidle" });
await lp.locator(".gps-tab").click();
await lp.getByText("Measure uses your location to work out the yardage.").waitFor({ timeout: 10000 });
ok((await lp.locator(".gps-again").isVisible()) === false, "never asked yet: one line first, and a Measure button (the phone's own question comes after)");
await lp.screenshot({ path: "/var/tmp/ospg/shots/phased-location-line.png" });
await lp.locator(".gps-msg").getByRole("button", { name: "Measure" }).click();
await lp.getByText(/hasn.t allowed location/).waitFor({ timeout: 10000 });
ok(true, "said no: Measure says how to switch location on");
ok((await lp.evaluate(() => localStorage.getItem("mgs-gps-loc"))) === "1", "the line is shown once on this phone");
await lctx.close();

// ---- The tournament's units: metres for a new phone
q(`update tournaments set units='metres' where slug='${T}'`);
const mctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["geolocation"], geolocation: { latitude: P2[0], longitude: P2[1], accuracy: 5 } });
const mp = await mctx.newPage();
await mp.goto(`${BASE}/t/${T}`);
await mp.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await mp.goto(`${BASE}/t/${T}/score`, { waitUntil: "networkidle" });
await mp.locator(".gps-tab").click();
await until(async () => /\d/.test(await mp.locator(".gps-n.mid b").innerText()));
ok((await mp.locator('.gps-units .pick-tile[aria-pressed="true"]').innerText()) === "Metres", "a tournament set to metres opens in metres on a new phone");
// A new phone with no scorecard open: the first hole he hasn't a score on (hole 2)
const g2 = [53.09685, -7.8947];
ok((await mp.locator(".gps-hole strong").innerText()) === "Hole 2" && near(Number((await mp.locator(".gps-n.mid b").innerText()).replace(/\D/g, "")), Math.round(yds(P2, g2) / 1.0936133), 2), "on the first hole he hasn't scored, in metres");
q(`update tournaments set units='yards' where slug='${T}'`);

// ---- What the AI writer is told: the strokes in order, with the distances, nothing guessed
const before = Date.now();
const gen = await call(page, "/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r2 });

const prompts = fs.readdirSync("/var/tmp/ospg").filter((f) => /^prompt-\d+\.txt$/.test(f)).map((f) => [f, fs.statSync(`/var/tmp/ospg/${f}`).mtimeMs]).filter((x) => x[1] >= before - 1000).sort((a, b) => b[1] - a[1]);
const latest = prompts.length ? fs.readFileSync(`/var/tmp/ospg/${prompts[0][0]}`, "utf8") : "";
const line = latest.split("\n").find((l) => l.startsWith("- H1 Oisin"));
if (line) {
  ok(/1 Tee shot, from \d+ yds, went about \d+ yds; 2 [^;]*from \d+ yds/.test(line) && !line.includes(`from ${m3}`), `the writer's line for Oisin: ${line}`);
  ok(latest.includes("never infer what a player was trying to do"), "and the rule: distances, never guessed intent");
} else ok(false, `no prompt with the stroke timeline (status ${gen.status}, ${prompts.length} new prompts)`);

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
