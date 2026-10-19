// On the course: scores stick as they're tapped, the bar (Score / Record / Note), home-screen app, screen awake.
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

// Round 2 is live and nothing is scored yet
const r2 = q(`select r.id from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${T}' and r.number=2`);
q(`delete from hole_entries where round_id='${r2}'`);
q(`delete from ai_pieces where round_id='${r2}'`);
q(`update rounds set status='live' where id='${r2}'`);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["camera", "microphone"] });
// Record wake-lock requests (headless phones don't have a real screen to keep on)
await ctx.addInitScript(() => {
  window.__wake = 0;
  Object.defineProperty(navigator, "wakeLock", { value: { request: async () => { window.__wake++; return { release: async () => {} }; } } });
});
const page = await ctx.newPage();
await page.goto(`${BASE}/t/${T}`);
await page.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });

// ---- Home-screen app
const man = await (await page.request.get(`${BASE}/t/${T}/app.webmanifest`)).json();
ok(man.start_url === `/t/${T}/go` && man.display === "standalone" && man.icons.length === 3, "home-screen app: full screen, opens via /go");
const icon = await page.request.get(`${BASE}/api/app-icon?s=192`);
ok(icon.headers()["content-type"] === "image/png" && (await icon.body()).length > 500, "app icon is a PNG");
await page.goto(`${BASE}/t/${T}`);
ok((await page.locator('link[rel="manifest"]').getAttribute("href")) === `/t/${T}/app.webmanifest` && (await page.locator('link[rel="apple-touch-icon"]').count()) >= 1, "pages link the app manifest and iPhone icon");
await page.goto(`${BASE}/t/${T}/go`);
await page.waitForURL(/\/score$/, { timeout: 15000 });
ok(true, "the app opens straight onto the scorecard while a round is live");

// ---- The bar
const bar = page.locator("nav.oncourse");
await bar.waitFor();
const heights = await bar.locator(".oc-btn").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(heights.length === 5 && heights.every((h) => h >= 60), `big buttons at the foot of the page: Score, Record, Note, Live, More (${heights.join(", ")}px)`);
ok((await bar.getByRole("link", { name: "Record" }).getAttribute("href")).includes("/record?round=2"), "Record goes to the camera, for this round");
ok((await page.evaluate(() => window.__wake)) >= 1, "the screen is kept awake during a live round");
ok((await page.locator(".install-hint").count()) === 0, "no install hint on the scorecard itself");

// ---- Scores stick as they're tapped
// One tap per player on a number tile (the hole starts blank)
const tap = (who, n) => setScore(page, who, n);
await page.getByText(/Next: hole 2/).waitFor();
const h1par = Number(q(`select (holes->0->>'par') from rounds where id='${r2}'`));
const blank = await page.locator('.pscore.entry .score-step:not([data-value=""])').count();
ok(blank === 0, "the hole starts blank: no par filled in for anyone");
ok((await page.locator(".hole-result").count()) === 0, "and no result shown before the scores are in");
await tap("Oisin", h1par + 1);
ok((await page.locator(".hole-result").count()) === 0, "one score in: still no result for the hole");
await tap("Neil", h1par - 1); // a birdie for Neil
await page.getByText("Saved for everyone").waitFor({ timeout: 10000 });
const row = JSON.parse(q(`select scores::text from hole_entries where round_id='${r2}' and hole=1`) || "{}");
ok(row.oisin?.gross === h1par + 1 && row.neil?.gross === h1par - 1, "each tap is saved for everyone straight away, no Save button needed");
await sleep(2500);
ok(q(`select count(*) from ai_pieces where round_id='${r2}' and trigger='h1'`) === "0", "no news goes out while the hole is still being entered");

// Away to write a note, back via the bar: same hole, same numbers
await bar.getByRole("link", { name: "Note" }).click();
await page.waitForURL(/\/shots\?round=2&hole=1/);
ok(true, "Note opens for this round and hole");
await bar.getByRole("link", { name: "Score" }).click();
await page.waitForURL(/\/score$/);
await page.getByText(/Next: hole 2/).waitFor();
const vals = await page.locator(".pscore.entry .score-step").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
ok(vals[0] === String(h1par + 1) && vals[1] === String(h1par - 1), `back on hole 1 with the scores as left (${vals.join(", ")})`);

// Fits one phone screen, nothing to scroll
const fit = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, win: window.innerHeight }));
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-score.png" });
ok(fit.doc <= fit.win + 4, `the scorecard fits the screen without scrolling (${fit.doc}px page, ${fit.win}px screen)`);

ok((await page.locator(".site-head").isVisible()) === false, "the scorecard is full screen (the site header steps aside)");
// Hole picker: one tap on the hole number, one on the hole
await page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).click();
const sheetBtns = await page.locator(".hole-sheet .grid button").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(sheetBtns.length === 18 && sheetBtns.every((h) => h >= 60), "tapping the hole number shows all 18 holes as big buttons");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-holes.png" });
await page.locator(".hole-sheet .grid button", { hasText: /^7/ }).click();
await page.getByRole("button", { name: /Hole 7\. Tap to choose/ }).waitFor();
ok(true, "and jumps straight there");
await page.getByRole("button", { name: /Hole 7\. Tap to choose/ }).click();
await page.locator(".hole-sheet .grid button", { hasText: /^1Par/ }).click();
await page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).waitFor();
// A finished hole you go back to is locked: the scores, the result, and Edit score
await page.locator(".frozen").waitFor();
ok((await page.locator(".pscore.entry").count()) === 0 && (await page.locator(".frozen .fval").count()) === 2, "back on a finished hole: it's locked, showing the scores");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-locked.png" });
await page.getByRole("button", { name: "Edit score" }).click();
await page.locator(".pscore.entry").first().waitFor();
ok(true, "Edit score opens it again");

// No signal: still saved on the phone, sent when it's back
await ctx.setOffline(true);
await tap("Oisin", h1par + 2);
await page.getByText(/Saved on this phone/).waitFor({ timeout: 10000 });
ok(true, "with no signal the tap is kept on the phone");
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
for (let i = 0; i < 20 && JSON.parse(q(`select scores::text from hole_entries where round_id='${r2}' and hole=1`)).oisin.gross !== h1par + 2; i++) await sleep(500);
ok(JSON.parse(q(`select scores::text from hole_entries where round_id='${r2}' and hole=1`)).oisin.gross === h1par + 2, "it sends itself when the signal returns");
await tap("Oisin", h1par + 1); // back to the first score

// Next hole: the hole is finished, so the news goes out; then the shot card, with the question the scores raise
q(`delete from shots`);
await page.getByRole("button", { name: /Next: hole 2/ }).click();
const mo = page.locator(".shotcard");
await mo.waitFor();
const tabs = await mo.locator(".sc-player .nm").allInnerTexts();
ok(tabs.join(",") === "Oisin,Neil", `shot card: tabs for the group's players only (${tabs.join(", ")})`);
ok((await mo.locator('.sc-player[aria-selected="true"] .nm').innerText()) === "Neil" && (await mo.getByText("How did Neil make birdie?").count()) === 1, "Neil's birdie: the card opens on Neil, asking how he made it");
ok((await mo.locator('.sc-player[aria-selected="true"] .meta b').innerText()) === "Birdie", "his tab is marked Birdie");
const scTiles = await mo.locator(".sc-tile, .sc-player, .sc-act, .sc-next, .talk-btn, .sc-skip").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(scTiles.every((h) => h >= 52), `every button on the card is big (smallest ${Math.min(...scTiles)}px)`);
const moFit = await page.evaluate(() => { const r = document.querySelector(".shotcard"); return r.scrollHeight <= r.clientHeight + 2 && r.getBoundingClientRect().bottom <= window.innerHeight; });
ok(moFit, "the card fits the screen above the bar, no scrolling");
await page.screenshot({ path: "/var/tmp/ospg/shots/shot-prompt.png" });
// Swipe back to the hole just played, and forward again
const swipeX = async (from, to) => {
  const y = 330;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move((from + to) / 2, y, { steps: 3 });
  await page.mouse.move(to, y, { steps: 3 });
  await page.mouse.up();
};
await swipeX(60, 330);
await page.getByRole("button", { name: /Next: hole 2/ }).waitFor();
ok((await mo.count()) === 0, "swipe right on the card: back to the hole just played");
await swipeX(330, 60);
await mo.waitFor();
ok(true, "swipe left on the scorecard: on to the card (same as Next)");
// One tap answers the question, and logs the shot
await mo.getByRole("button", { name: "Long putt" }).click();
await mo.locator(".sc-row", { hasText: "Putt: holed from 30 ft+" }).waitFor();
let srow = "";
for (let i = 0; i < 20 && !srow; i++) { await sleep(300); srow = q(`select player_id||'|'||kind||'|'||outcome||'|'||club from shots where hole=1 and player_id='neil'`); }
ok(srow === "neil|putt|Holed from 30 ft+|Putter", `one tap: saved straight away as Neil's putt, holed from 30 ft+ (${srow})`);
const neilRows = await mo.locator(".sc-row .sc-what").allInnerTexts();
ok(neilRows.length === 4 && neilRows[0] === "Tee shot" && /holed from 30/.test(neilRows[3]), `his hole as strokes: the tee shot filled in, the putt on the last of his four (${neilRows.join(" | ")})`);
ok(q(`select seq from shots where hole=1 and player_id='neil'`) === "4", "saved on stroke 4");
// Oisin: his card starts blank; the tab stays on him while his shots go in
await mo.locator(".sc-player", { hasText: "Oisin" }).click();
ok((await mo.locator(".sc-row").count()) === h1par + 1, `Oisin: a row for each of his ${h1par + 1} strokes`);
ok((await mo.getByText("Tap any shot to say what happened").count()) === 1, "nothing to do unless he wants to");
await mo.locator(".sc-row").first().locator(".sc-row-main").click();
ok((await mo.locator('.sc-kind[aria-pressed="true"]').innerText()) === "Tee shot", "Oisin: tap stroke 1, the tee shot is picked for him");
const teeOptions = await mo.locator(".sc-tile").allInnerTexts();
ok(teeOptions.length === 7 && teeOptions[6] === "More…" && teeOptions.slice(0, 3).join(",") === "Fairway,Left,Right" && teeOptions.includes("Out of bounds"), `par 5 tee shot outcomes, with hazards from the course guide (${teeOptions.join(", ")})`);
await mo.getByRole("button", { name: "Right", exact: true }).click();
ok((await mo.locator('.sc-kind[aria-pressed="true"]').innerText()) === "Second shot", "a par 5: next comes the second shot");
await mo.getByRole("button", { name: "Laid up" }).click();
ok((await mo.locator('.sc-kind[aria-pressed="true"]').innerText()) === "Approach", "laid up, so next is the approach");
await page.screenshot({ path: "/var/tmp/ospg/shots/shot-card.png" });
await mo.getByRole("button", { name: "Stiff" }).click();
await mo.getByText(/What did Oisin hit\?/).waitFor();
ok(true, "a shot worth knowing about asks for the club (if you know)");
await page.screenshot({ path: "/var/tmp/ospg/shots/shot-club.png" });
await mo.getByRole("button", { name: "Short iron" }).click();
ok((await mo.locator('.sc-player[aria-selected="true"] .nm').innerText()) === "Oisin", "still on Oisin");
await mo.locator(".sc-row", { hasText: "Approach: stiff (short iron)" }).waitFor({ timeout: 5000 });
const oRows = await mo.locator(".sc-row .sc-what").allInnerTexts();
ok(oRows.slice(0, 3).join(" | ") === "Tee shot: right | Second shot: laid up | Approach: stiff (short iron)", `his hole reads in stroke order (${oRows.join(" | ")})`);
let rows = "";
for (let i = 0; i < 20; i++) { await sleep(300); rows = q(`select string_agg(kind||':'||outcome||':'||coalesce(club,'')||':'||coalesce(distance,''), ' > ' order by logged_at) from shots where player_id='oisin' and hole=1`); if (/100/.test(rows)) break; }
ok(rows === "tee:Right:: > second:Laid up:: > approach:Stiff:Short iron:", `each tap saved as it happened (${rows})`);
ok(q(`select string_agg(seq::text, ',' order by seq) from shots where player_id='oisin' and hole=1`) === "1,2,3", "on strokes 1, 2 and 3");
await mo.locator(".sc-row", { hasText: "Approach: stiff" }).locator(".sc-row-main").click();
await mo.getByRole("button", { name: "Clear this shot" }).click();
for (let i = 0; i < 20; i++) { await sleep(300); if (q(`select count(*) from shots where player_id='oisin' and hole=1`) === "2") break; }
ok(q(`select count(*) from shots where player_id='oisin' and hole=1`) === "2", "Clear takes a shot back off");
// Say it: hold, talk, let go (goes with the player picked)
fs.rmSync("/var/tmp/ospg/stt.log", { force: true });
const mic = mo.getByRole("button", { name: "Hold to talk" });
const mb = await mic.boundingBox();
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down();
await mo.getByText(/Listening/).waitFor({ timeout: 5000 });
await sleep(1500);
await page.mouse.up();
await mo.getByText(/Saved: “Neil lipped out on the birdie putt.”/).waitFor({ timeout: 15000 });
const stt = JSON.parse(fs.readFileSync("/var/tmp/ospg/stt.log", "utf8").trim().split("\n").at(-1));
ok(stt.fields.model_id[0] === "scribe_v2" && stt.audioBytes > 1500 && ["Neil", "Oisin", "Wicklow Golf Club", "birdie", "lip-out", "gimme"].every((k) => stt.fields.keyterms.includes(k)), `hold to talk: Scribe v2, told the names, course and golf words up front (${stt.fields.keyterms.length} terms)`);
let note = "";
for (let i = 0; i < 20 && !note; i++) { await sleep(400); note = q(`select body||'|'||array_to_string(player_ids,',') from posts where round_id='${r2}' and hole=1 and kind='note'`); }
ok(note === "Oisin: Neil lipped out on the birdie putt.|oisin", `what's said is saved straight away, with the player picked (${note})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-talk.png" });
await swipeX(330, 60);
await page.getByText(/Next: hole 3/).waitFor();
let pieces = "0";
for (let i = 0; i < 30 && pieces === "0"; i++) {
  await sleep(500);
  pieces = q(`select count(*) from ai_pieces where round_id='${r2}' and trigger='h1'`);
}
ok(pieces === "1", "moving on finishes the hole and Neil's birdie makes the news, once");

// A par hole: no question, it opens on the player picked last, and waits
const h2par = Number(q(`select (holes->1->>'par') from rounds where id='${r2}'`));
await tap("Oisin", h2par);
await tap("Neil", h2par);
await page.getByRole("button", { name: /Next: hole 3/ }).click();
await mo.waitFor();
ok((await mo.locator(".sc-q").count()) === 0 && (await mo.locator('.sc-player[aria-selected="true"] .nm').innerText()) === "Oisin", "no question on a quiet hole; still on Oisin from last time");
await sleep(7000);
ok((await mo.count()) === 1, "the card waits for you (no timer)");
await mo.getByRole("button", { name: /On to hole 3/ }).click();
await page.getByText(/Next: hole 4/).waitFor({ timeout: 10000 });
ok(q(`select count(*) from shots where hole=2`) === "0" && q(`select count(*) from posts where round_id='${r2}' and hole=2`) === "0", "nothing tapped, nothing saved");

// Anyone in the group: the Note button opens the same card, for the hole being played
await bar.getByRole("link", { name: "Note" }).click();
await page.waitForURL(/\/shots\?round=2&hole=3/);
await mo.waitFor();
ok((await mo.locator(".sc-head strong").innerText()) === "Hole 3", "Note on the bar opens the shot card for the hole being played");
await mo.locator(".sc-player", { hasText: "Neil" }).click();
await mo.getByRole("button", { name: "Fairway" }).click();
await swipeX(330, 60);
await mo.locator(".sc-head strong", { hasText: "Hole 4" }).waitFor();
ok(true, "swipe moves through the holes there too");
await swipeX(60, 330);
await mo.locator(".sc-head strong", { hasText: "Hole 3" }).waitFor();
ok((await mo.locator(".sc-row", { hasText: "Tee shot: fairway" }).count()) === 1, "and back again, with what's been logged");
await bar.getByRole("link", { name: "Score" }).click();
await page.waitForURL(/\/score$/);

// The voice service wants its word list another way: it still works
await fetch("http://127.0.0.1:54321/__sttjson");

// Leave and reload: same hole
await page.goto(`${BASE}/t/${T}/live`);
await page.goto(`${BASE}/t/${T}/score`);
await page.getByText(/Next: hole 4/).waitFor({ timeout: 15000 });
ok(true, "a fresh visit to the scorecard returns to the hole you were on");

// ---- Record: in-app camera → trim → who, shot, result, club → post → back to the scorecard
await bar.getByRole("link", { name: "Record" }).click();
await page.waitForURL(/\/record\?round=2&hole=3/);
const recBtn = page.getByRole("button", { name: "Start recording" });
await recBtn.waitFor({ timeout: 15000 });
await page.waitForFunction(() => !document.querySelector(".cam-rec").disabled, null, { timeout: 15000 });
ok((await page.locator("nav.oncourse").count()) === 0, "the camera is full screen (no bar over it)");
const recSize = await page.locator(".cam-rec").evaluate((e) => Math.round(e.getBoundingClientRect().width));
ok(recSize >= 84, `one big record button (${recSize}px)`);
await recBtn.click();
await sleep(3500);
await page.getByRole("button", { name: "Stop recording" }).click();
await page.getByText("Trim the clip").waitFor({ timeout: 15000 });
await page.waitForFunction(() => /Keeping/.test(document.querySelector(".cd-note")?.textContent ?? ""), null, { timeout: 15000 });
ok(true, "record, stop, and straight on to trimming");
// drag the start handle a third of the way in
const tb = await page.locator(".trimbar").boundingBox();
await page.mouse.move(tb.x + 2, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + tb.width * 0.33, tb.y + tb.height / 2, { steps: 5 });
await page.mouse.up();
const keep = await page.locator(".cd-note").innerText();
ok(/Keeping 0:0[12]/.test(keep), `dragging the start handle trims it, no download needed (${keep})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-trim.png" });
await page.getByRole("button", { name: "Next" }).click();
await page.getByText("Who's playing the shot?").waitFor();
const whoCd = await page.locator(".cd-grid button").allInnerTexts();
ok(whoCd.join(",") === "Oisin,Neil,The whole group", `who: the group only (${whoCd.join(", ")})`);
await page.getByRole("button", { name: "Neil", exact: true }).click();
await page.getByText("What shot?").waitFor();
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-shot.png" });
await page.getByRole("button", { name: "Chip", exact: true }).click();
await page.getByText("How did it finish?").waitFor();
await page.getByRole("button", { name: "Holed" }).click();
await page.getByText("Which club?").waitFor();
await page.getByRole("button", { name: "Wedge", exact: true }).click();
await page.getByText("Ready to post").waitFor();
// Quick tap starts it, second tap stops it
const cmic = page.getByRole("button", { name: "Hold to talk" });
await cmic.click();
await page.getByText(/Listening/).waitFor({ timeout: 5000 });
await sleep(1200);
await page.getByRole("button", { name: /Listening/ }).click();
await page.waitForFunction(() => document.querySelector(".cd-cap textarea")?.value.includes("birdie"), null, { timeout: 15000 });
const sttLines = fs.readFileSync("/var/tmp/ospg/stt.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(sttLines.length >= 2 && sttLines.at(-1).fields.keyterms.length === 1 && sttLines.at(-1).fields.keyterms[0].startsWith("["), "tap to talk works too (and the word list is resent the way the service asks)");
ok(/Neil · Chip · Holed · Wedge · hole 3/.test(await page.locator(".cd-summary").innerText()), "four taps: who, shot, how it finished, club");
const tilesBig = await page.locator(".cd-primary").evaluate((e) => Math.round(e.getBoundingClientRect().height));
ok(tilesBig >= 60, "big Post button");
await page.getByRole("button", { name: "Post the clip" }).click();
await page.waitForURL(/\/score$/, { timeout: 15000 });
await page.getByText(/Clip saved/).waitFor({ timeout: 5000 });
ok(true, "posting goes straight back to the scorecard, which says the clip is saved");
let clip = "";
for (let i = 0; i < 40 && !clip; i++) { await sleep(500); clip = q(`select coalesce(trim_in::text,'-')||'|'||coalesce(trim_out::text,'-')||'|'||coalesce(details::text,'')||'|'||array_to_string(tags,',')||'|'||array_to_string(player_ids,',')||'|'||media_path from posts where round_id='${r2}' and hole=3 and kind='video'`); }
console.log("     clip:", clip);
const [tin, tout, det, tg, pids, mpath] = clip.split("|");
ok(Number(tin) >= 0.8 && Number(tout) > Number(tin) && JSON.parse(det).shot === "Chip" && JSON.parse(det).result === "Holed" && JSON.parse(det).club === "Wedge" && tg === "chip-in" && pids === "neil", "the clip uploads in the background with its trim, who, shot, result and club (tagged chip-in)");
ok(fs.existsSync(`/var/tmp/ospg/files/${mpath}`) && fs.statSync(`/var/tmp/ospg/files/${mpath}`).size < 3_000_000, `a small upload (${Math.round(fs.statSync(`/var/tmp/ospg/files/${mpath}`).size / 1024)} KB for 3.5 seconds)`);

// ---- Filmed from the shot card: the player and the shot just logged are already filled in
await page.goto(`${BASE}/t/${T}/shots?round=2&hole=3`);
await mo.waitFor();
ok((await mo.locator('.sc-player[aria-selected="true"] .nm').innerText()) === "Neil", "the card remembers the last player picked");
await mo.getByRole("link", { name: "Record a clip" }).click();
await page.waitForURL(/\/record\?round=2&hole=3&player=neil&shot=/);
await page.waitForFunction(() => !document.querySelector(".cam-rec")?.disabled, null, { timeout: 15000 });
await page.getByRole("button", { name: "Start recording" }).click();
await sleep(2200);
await page.getByRole("button", { name: "Stop recording" }).click();
await page.getByText("Trim the clip").waitFor({ timeout: 15000 });
await page.waitForFunction(() => /Keeping/.test(document.querySelector(".cd-note")?.textContent ?? ""), null, { timeout: 15000 });
await page.getByRole("button", { name: "Next" }).click();
await page.getByText("Ready to post").waitFor();
const pre = await page.locator(".cd-summary").innerText();
ok(/^Neil · Chip · Holed/.test(pre), `trim, then straight to Post: who and what are already known from the shot card (${pre})`);
const before = q(`select count(*) from shots`);
await page.getByRole("switch", { name: /Highlights film only/ }).click();
ok((await page.getByRole("button", { name: "Save for the film" }).count()) === 1, "film-only tick changes the button to 'Save for the film'");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-filmonly.png" });
await page.getByRole("button", { name: "Save for the film" }).click();
await page.waitForURL(/\/score$/, { timeout: 15000 });
let linked = "";
for (let i = 0; i < 40 && !linked; i++) { await sleep(500); linked = q(`select coalesce(details->>'shotId','') from posts where hole=3 and kind='video' and details->>'shotId' is not null order by created_at desc limit 1`); if (Number(q(`select count(*) from posts where hole=3 and kind='video' and details->>'shotId' is not null`)) < 2) linked = ""; }
ok(!!linked && linked === q(`select client_id from shots where hole=3 and player_id='neil' and kind='chip'`) && q(`select count(*) from shots`) === before, "the clip is linked to the logged shot (no duplicate shot)");
ok(q(`select count(*) from posts where hole=3 and kind='video' and details->>'shotId' is not null`) === "2", "a clip filmed without the shot card logs its shot too, and links to it");
ok(q(`select visibility from posts where hole=3 and kind='video' order by created_at desc limit 1`) === "report", "the film-only clip is kept out of the feed (film only)");

// ---- Install hint (iPhone, in the browser), once
await page.goto(`${BASE}/t/${T}/live`);
const hint = page.locator(".install-hint");
await hint.waitFor({ timeout: 10000 });
ok(/Add to Home Screen/.test(await hint.innerText()), "on iPhone the page explains how to add it to the home screen");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-live.png" });
await hint.getByRole("button", { name: "Got it" }).click();
await page.reload();
await page.locator("nav.oncourse").waitFor();
await sleep(800);
ok((await hint.count()) === 0, "and doesn't nag once dismissed");

// ---- No live round: the everyday bar (no Score, Record or Note)
q(`update rounds set status='complete' where id='${r2}'`);
await page.reload();
await page.waitForLoadState("networkidle");
ok((await page.locator("nav.tabbar.live").count()) === 0 && (await page.locator("nav.tabbar").getByRole("link", { name: "Record" }).count()) === 0, "no round live: no Score, Record or Note on the bar");
q(`update rounds set status='upcoming' where id='${r2}'`);

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
