// On the course: scores stick as they're tapped, the two buttons after the scores, Add detail (the same four rows on
// every shot), clips that guess first, the bar (Score / Record / Detail), home-screen app, screen awake.
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
ok(heights.length === 5 && heights.every((h) => h >= 60), `big buttons at the foot of the page: Score, Record, Detail, Live, More (${heights.join(", ")}px)`);
ok((await bar.getByRole("link", { name: "Record" }).getAttribute("href")).includes("/record?round=2"), "Record goes to the camera, for this round");
ok((await page.evaluate(() => window.__wake)) >= 1, "the screen is kept awake during a live round");
ok((await page.locator(".install-hint").count()) === 0, "no install hint on the scorecard itself");

// ---- Scores stick as they're tapped
// One tap per player on a number tile (the hole starts blank)
const tap = (who, n) => setScore(page, who, n);
await page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).waitFor();
const h1par = Number(q(`select (holes->0->>'par') from rounds where id='${r2}'`));
const blank = await page.locator('.pscore.entry .score-step:not([data-value=""])').count();
ok(blank === 0, "the hole starts blank: no par filled in for anyone");
ok((await page.locator(".hole-result").count()) === 0, "and no result shown before the scores are in");
ok((await page.locator(".after-hole").count()) === 0, "no buttons to move on before any score is in");
await tap("Oisin", h1par + 1);
ok((await page.locator(".hole-result").count()) === 0, "one score in: still no result for the hole");
ok((await page.locator(".after-hole").count()) === 0, "and the two buttons aren't there yet (they appear, not grey out)");
await tap("Neil", h1par - 1); // a birdie for Neil
await page.locator(".after-hole.arrive").waitFor({ timeout: 5000 });
const ah = await page.locator(".after-hole .btn").evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\n/g, " "), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width), cls: e.className })));
ok(ah.length === 2 && ah.every((b) => b.h >= 60) && Math.abs(ah[0].w - ah[1].w) <= 2, `the last score in: two big buttons side by side (${ah.map((b) => `${b.t} ${b.h}px`).join(" | ")})`);
ok(/^Add detail\s+Neil birdie$/.test(ah[0].t) && /secondary/.test(ah[0].cls) && /^On to hole 2/.test(ah[1].t) && !/secondary/.test(ah[1].cls), "Add detail (outlined) names Neil's birdie; On to hole 2 is solid");
ok((await page.locator(".shotcard, .dtl").count()) === 0, "nothing pops up after a birdie");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-two-buttons.png" });
await page.getByText("Saved for everyone").waitFor({ timeout: 10000 });
const row = JSON.parse(q(`select scores::text from hole_entries where round_id='${r2}' and hole=1`) || "{}");
ok(row.oisin?.gross === h1par + 1 && row.neil?.gross === h1par - 1, "each tap is saved for everyone straight away, no Save button needed");
await sleep(2500);
ok(q(`select count(*) from ai_pieces where round_id='${r2}' and trigger='h1'`) === "0", "no news goes out while the hole is still being entered");

// Away to Detail, back via the bar: same hole, same numbers
await bar.getByRole("link", { name: "Detail" }).click();
await page.waitForURL(/\/shots\?round=2&hole=1/);
ok(true, "Detail opens for this round and hole");
await bar.getByRole("link", { name: "Score" }).click();
await page.waitForURL(/\/score$/);
await page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).waitFor();
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

// ---- Add detail: the hole's shots, the same four rows on every shot
q(`delete from shots`);
q(`delete from hole_notes`);
const ad = page.locator(".dtl");
await page.locator(".after-hole .btn", { hasText: "Add detail" }).click();
await ad.waitFor();
const tabs = await ad.locator(".dtl-tab .nm").allInnerTexts();
ok(tabs.join(",") === "Oisin,Neil", `tabs for the group's players, all in view (${tabs.join(", ")})`);
ok((await ad.locator('.dtl-tab[aria-selected="true"] .nm').innerText()) === "Neil", "opened from Neil birdie: it opens on Neil");
ok((await ad.locator(".dtl-head").innerText()).startsWith(`Neil · ${h1par - 1} on the par ${h1par} 1st`), `the header says what's known (${await ad.locator(".dtl-head").innerText()})`);
const nRows = await ad.locator(".dtl-shot .dtl-what").allInnerTexts();
ok(nRows.length === h1par - 1 && /^Tee shot/.test(nRows[0]) && /^Holed/.test(nRows.at(-1)), `a card for each stroke, the tee shot and the holed last stroke filled in (${nRows.map((x) => x.split("\n")[0]).join(" | ")})`);
ok((await ad.locator(".dtl-tile").count()) === 0, "unbusy: no choices on screen until a shot is tapped");
ok((await ad.locator(".dtl-shot.told").count()) === 0, "nothing told yet: every card pale");
await page.screenshot({ path: "/var/tmp/ospg/shots/detail-list.png" });
// Stroke 1: the tee shot is known, so the club row is open; the rest are one line each
await ad.locator(".dtl-shot").first().locator(".dtl-card-main").click();
ok((await ad.locator(".dtl-row").count()) === 1, "one row of choices open at a time");
const clubs = await ad.locator(".dtl-tile").allInnerTexts();
ok(clubs.join(",") === "Driver,3 wood,Hybrid,Other", `tee shot on a par ${h1par}: the likeliest clubs first, and Other (${clubs.join(", ")})`);
ok(/Shot: tee shot/.test(await ad.locator(".dtl-shot.open").innerText()) && (await ad.locator(".dtl-folded", { hasText: "Outcome" }).count()) === 1 && (await ad.locator(".dtl-folded", { hasText: "More" }).count()) === 1, "Shot is a line (with Change), Outcome and More wait below");
ok((await ad.locator('.dtl-tile[aria-pressed="true"]').count()) === 0, "suggested, never picked for you");
const tileH = await ad.locator(".dtl-tile, .dtl-tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(tileH.every((h) => h >= 50), `big tiles (smallest ${Math.min(...tileH)}px)`);
await page.screenshot({ path: "/var/tmp/ospg/shots/detail-club.png" });
await ad.getByRole("button", { name: "Driver", exact: true }).click();
ok((await ad.locator(".dtl-folded", { hasText: "Club: Driver ✓" }).count()) === 1, "the club folds to one line: Club: Driver ✓");
const outs = await ad.locator(".dtl-tile").allInnerTexts();
ok(outs.length === 6 && outs[0] === "Fairway" && outs.at(-1) === "Water", `then the outcome: six, likeliest first, water from the course guide (${outs.join(", ")})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/detail-outcome.png" });
await ad.getByRole("button", { name: "Fairway", exact: true }).click();
// The card closes and the next shot opens, ready: the kind of shot first
await ad.locator(".dtl-shot.open .dtl-row-name", { hasText: "Shot" }).waitFor();
const kinds = await ad.locator(".dtl-tile").allInnerTexts();
ok(kinds.join(",") === "Second,Approach,Recovery,Other", `stroke 2 opens by itself: its likeliest kinds and Other (${kinds.join(", ")})`);
ok(/^Tee shot, Driver: fairway/.test(await ad.locator(".dtl-shot").first().locator(".dtl-what").innerText()), "stroke 1 reads as one line");
await ad.getByRole("button", { name: "Second", exact: true }).click();
await ad.getByRole("button", { name: "Other", exact: true }).click();
const bag = await ad.locator(".dtl-tile").count();
ok(bag === 16, `Other opens the whole bag in three columns (${bag} clubs)`);
await ad.getByRole("button", { name: "5 iron", exact: true }).click();
await ad.getByRole("button", { name: "Short of the green", exact: true }).click();
await ad.locator(".dtl-shot.open .dtl-row-name", { hasText: "Shot" }).waitFor();
await ad.getByRole("button", { name: "Chip", exact: true }).click();
const chipClubs = await ad.locator(".dtl-tile").allInnerTexts();
ok(chipClubs[0] === "Sand wedge", `a chip: wedges first (${chipClubs.join(", ")})`);
await ad.getByRole("button", { name: "Sand wedge", exact: true }).click();
await ad.getByRole("button", { name: "Close", exact: true }).click();
// The last stroke went in: no outcome row, and a putt's length instead of a club
await ad.locator(".dtl-shot.open .dtl-row-name", { hasText: "Shot" }).waitFor();
ok((await ad.locator(".dtl-tile").first().innerText()) === "Putt", "the stroke that went in: Putt first");
await ad.getByRole("button", { name: "Putt", exact: true }).click();
const lengths = await ad.locator(".dtl-tile").allInnerTexts();
ok(lengths.join(",") === "Tap-in,3 to 10 ft,10 to 30 ft,30 ft+", `a putt: its length, not a club (${lengths.join(", ")})`);
ok((await ad.locator(".dtl-shot.open .dtl-folded", { hasText: "Outcome" }).count()) === 0 && (await ad.locator(".dtl-shot.open .dtl-folded", { hasText: "More" }).count()) === 0, "no outcome (it went in) and no More on a putt");
await ad.getByRole("button", { name: "3 to 10 ft", exact: true }).click();
await waitShot();
async function waitShot() {
  for (let i = 0; i < 20 && (await ad.locator(".dtl-shot.open").count()); i++) await sleep(150);
}
ok((await ad.locator(".dtl-shot.open").count()) === 0, "the last card closes: nothing left open");
let srow = "";
for (let i = 0; i < 30; i++) { await sleep(300); srow = q(`select string_agg(seq||' '||kind||':'||outcome||':'||coalesce(club,'')||':'||coalesce(distance,''), ' > ' order by seq) from shots where hole=1 and player_id='neil'`); if (/putt/.test(srow)) break; }
ok(srow === "1 tee:Fairway:Driver: > 2 second:Short of the green:5 iron: > 3 chip:Close:Sand wedge: > 4 putt:Holed:Putter:3 to 10 ft", `each tap saved on its stroke as it happened (${srow})`);
const told4 = await ad.locator(".dtl-shot .dtl-what").allInnerTexts();
ok(told4.map((x) => x.split("\n")[0]).join(" | ") === "Tee shot, Driver: fairway | Second, 5 iron: short of the green | Chip, Sand wedge: close | Putt, 3 to 10 ft: holed", `his hole reads in stroke order (${told4.map((x) => x.split("\n")[0]).join(" | ")})`);
ok((await ad.locator(".dtl-tab", { hasText: "Neil" }).locator(".tick").count()) === 1, "his tab gets a tick");
// More: closed unless tapped
await ad.locator(".dtl-shot").first().locator(".dtl-card-main").click();
ok((await ad.locator(".dtl-tile").count()) === 0, "a told shot opens with every row as one line");
await ad.locator(".dtl-shot.open .dtl-folded", { hasText: "More" }).click();
await ad.getByRole("button", { name: "Flushed", exact: true }).click();
await ad.getByRole("button", { name: "Draw", exact: true }).click();
let more = "";
for (let i = 0; i < 20; i++) { await sleep(300); more = q(`select coalesce(contact,'')||'|'||coalesce(shape,'')||'|'||coalesce(flight,'') from shots where hole=1 and player_id='neil' and seq=1`); if (more === "Flushed|Draw|") break; }
ok(more === "Flushed|Draw|", `More: contact and shape, each optional (${more})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/detail-more.png" });
await ad.locator(".dtl-shot.open .dtl-card-main").click();
// Clear a shot
await ad.locator(".dtl-shot").nth(2).locator(".dtl-card-main").click();
await ad.getByRole("button", { name: "Clear this shot" }).click();
for (let i = 0; i < 20; i++) { await sleep(300); if (q(`select count(*) from shots where player_id='neil' and hole=1`) === "3") break; }
ok(q(`select count(*) from shots where player_id='neil' and hole=1`) === "3", "Clear takes a shot back off");
// Oisin: blank, pale cards, nothing to do unless he wants to
await ad.locator(".dtl-tab", { hasText: "Oisin" }).click();
ok((await ad.locator(".dtl-shot").count()) === h1par + 1 && (await ad.locator(".dtl-tile").count()) === 0, `Oisin: a card for each of his ${h1par + 1} strokes, no choices showing`);
// The wind: the weather isn't reachable here, so the group says
const wl = await ad.locator(".dtl-wind").innerText();
ok(/^Wind/.test(wl), `the wind line (${wl})`);
await ad.locator(".dtl-wind").click();
const winds = await ad.locator(".dtl-wind-pick .dtl-tile").allInnerTexts();
ok(winds.length === 7 && winds[0] === "Calm", `wind: one row of seven (${winds.join(", ")})`);
await ad.getByRole("button", { name: "Helping", exact: true }).click();
let wind = "";
for (let i = 0; i < 20 && !wind; i++) { await sleep(300); wind = q(`select coalesce(wind,'') from hole_notes where round_id='${r2}' and hole=1`); }
ok(wind === "Helping" && /Wind: helping/.test(await ad.locator(".dtl-wind").innerText()), "the group's wind is kept for the hole");
// Say it to the commentators: hold, talk, let go (goes with the player picked)
fs.rmSync("/var/tmp/ospg/stt.log", { force: true });
const mic = ad.getByRole("button", { name: "Hold to tell the commentators" });
ok((await ad.getByText("Only the commentators hear this.").count()) === 1, "under the button: only the commentators hear this");
await mic.scrollIntoViewIfNeeded();
const mb = await mic.boundingBox();
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down();
await ad.getByText(/Listening/).waitFor({ timeout: 5000 });
await sleep(1500);
await page.mouse.up();
await ad.getByText(/Saved for the commentators: “Neil lipped out on the birdie putt.”/).waitFor({ timeout: 15000 });
const stt = JSON.parse(fs.readFileSync("/var/tmp/ospg/stt.log", "utf8").trim().split("\n").at(-1));
ok(stt.fields.model_id[0] === "scribe_v2" && stt.audioBytes > 1500 && ["Neil", "Oisin", "Wicklow Golf Club", "birdie", "lip-out", "gimme"].every((k) => stt.fields.keyterms.includes(k)), `hold to talk: Scribe v2, told the names, course and golf words up front (${stt.fields.keyterms.length} terms)`);
let note = "";
for (let i = 0; i < 20 && !note; i++) { await sleep(400); note = q(`select body||'|'||array_to_string(player_ids,',')||'|'||visibility||'|'||array_to_string(tags,',') from posts where round_id='${r2}' and hole=1 and kind='note'`); }
ok(note === "Oisin: Neil lipped out on the birdie putt.|oisin|report|voice", `saved for the commentators, never the feed (${note})`);
const feed = await (await page.request.get(`${BASE}/api/state?t=${T}`)).json();
ok(!(feed.state?.posts ?? []).some((p) => p.tags?.includes("voice")), "followers never see it");
await page.screenshot({ path: "/var/tmp/ospg/shots/detail-voice.png" });
// The same way out, always
const foot = await ad.locator(".dtl-foot .btn").allInnerTexts();
ok(foot[0] === "Back to the scorecard" && /^On to hole 2/.test(foot[1]), `the same two buttons at the bottom (${foot.join(" | ")})`);
await ad.getByRole("button", { name: "Back to the scorecard" }).click();
await page.locator(".after-hole").waitFor();
ok((await ad.count()) === 0, "Back to the scorecard: the hole, with its two buttons");
await page.locator(".after-hole .btn", { hasText: "Add detail" }).click();
await ad.waitFor();
await ad.getByRole("button", { name: /On to hole 2/ }).click();
await page.getByRole("button", { name: /Hole 2\. Tap to choose/ }).waitFor();
ok((await ad.count()) === 0, "On to hole 2 from Add detail: straight to the next hole");
let pieces = "0";
for (let i = 0; i < 30 && pieces === "0"; i++) {
  await sleep(500);
  pieces = q(`select count(*) from ai_pieces where round_id='${r2}' and trigger='h1'`);
}
ok(pieces === "1", "moving on finishes the hole and Neil's birdie makes the news, once");

// A par hole: the label is plain, and an ordinary hole is scores in, tap on
const h2par = Number(q(`select (holes->1->>'par') from rounds where id='${r2}'`));
await tap("Oisin", h2par);
await tap("Neil", h2par);
await page.locator(".after-hole").waitFor();
ok((await page.locator(".after-hole .btn").first().innerText()).trim() === "Add detail", "a par hole: just Add detail");
const swipeX = async (from, to) => {
  const y = 330;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move((from + to) / 2, y, { steps: 3 });
  await page.mouse.move(to, y, { steps: 3 });
  await page.mouse.up();
};
await swipeX(330, 60);
await page.getByRole("button", { name: /Hole 3\. Tap to choose/ }).waitFor({ timeout: 10000 });
ok(true, "swipe left still moves on");
ok(q(`select count(*) from shots where hole=2`) === "0" && q(`select count(*) from posts where round_id='${r2}' and hole=2`) === "0", "nothing tapped, nothing saved");

// Anyone in the group: Detail on the bar opens the same screen, for the hole being played
await bar.getByRole("link", { name: "Detail" }).click();
await page.waitForURL(/\/shots\?round=2&hole=3/);
await ad.waitFor();
ok(/the par \d 3rd/.test(await ad.locator(".dtl-head").innerText()), "Detail on the bar opens Add detail for the hole being played");
await ad.locator(".dtl-tab", { hasText: "Neil" }).click();
await ad.locator(".dtl-shot").first().locator(".dtl-card-main").click();
await ad.locator(".dtl-tile").first().click();
await ad.locator(".dtl-row .dtl-tile").first().click();
for (let i = 0; i < 20; i++) { await sleep(300); if (q(`select count(*) from shots where hole=3 and player_id='neil'`) === "1") break; }
ok(q(`select count(*) from shots where hole=3 and player_id='neil' and seq=1`) === "1", "Neil's tee shot told there");
await ad.getByRole("button", { name: /On to hole 4/ }).click();
await ad.locator(".dtl-head", { hasText: "4th" }).waitFor();
ok(true, "On to hole 4 moves through the holes there too");
await ad.getByRole("button", { name: "Back to the scorecard" }).click();
await page.waitForURL(/\/score$/);

// The voice service wants its word list another way: it still works
await fetch("http://127.0.0.1:54321/__sttjson");

// Leave and reload: same hole
await page.goto(`${BASE}/t/${T}/live`);
await page.goto(`${BASE}/t/${T}/score`);
await page.getByRole("button", { name: /Hole 3\. Tap to choose/ }).waitFor({ timeout: 15000 });
ok(true, "a fresh visit to the scorecard returns to the hole you were on");

// ---- Record: in-app camera → trim → "Neil's shot 2 on the 3rd?" → post → back to the scorecard
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
await page.getByText("Neil's shot 2 on the 3rd?").waitFor({ timeout: 8000 }).catch(async (e) => { console.log("TITLE:", await page.locator(".cd-title").innerText(), q(`select player_id||':'||seq||':'||kind from shots where hole=3`)); throw e; });
ok(true, "the clip guesses first: Neil (picked last), the shot after his tee shot, the hole being played");
const cbtns = await page.locator(".cd-confirm .btn").allInnerTexts();
ok(cbtns.join(",") === "Yes, post it,Change", `one question: Yes, post it or Change (${cbtns.join(", ")})`);
await page.screenshot({ path: "/var/tmp/ospg/shots/clip-confirm.png" });
// Change: the same tabs and shot list as Add detail
await page.getByRole("button", { name: "Change", exact: true }).click();
await page.getByText("Which shot is it?").waitFor();
const ctabs = await page.locator(".dtl-tab .nm").allInnerTexts();
ok(ctabs.join(",") === "Oisin,Neil" && (await page.getByRole("button", { name: "The whole group" }).count()) === 1 && (await page.getByText("Not a shot? An interview or a chat").count()) === 1, "Change: the group's tabs, the shot list, The whole group, Not a shot?");
await page.screenshot({ path: "/var/tmp/ospg/shots/clip-change.png" });
await page.locator(".dtl-tab", { hasText: "Oisin" }).click();
ok((await page.locator(".dtl-shot").count()) === 1, "before the score is in: the shots told so far and one more (Oisin: just his first)");
await page.locator(".dtl-shot").first().locator(".dtl-card-main").click();
await page.getByText("Oisin's shot 1 on the 3rd?").waitFor();
ok(true, "tap the right shot: back to the question with the new words");
await page.getByRole("button", { name: "Change", exact: true }).click();
await page.locator(".dtl-tab", { hasText: "Neil" }).click();
await page.locator(".dtl-shot").nth(1).locator(".dtl-card-main").click();
await page.getByText("Neil's shot 2 on the 3rd?").waitFor();
// Add detail on a clip: the very same card
await page.getByRole("button", { name: "Add detail" }).click();
await page.locator(".dtl-shot.open .dtl-row-name", { hasText: "Shot" }).waitFor();
await page.getByRole("button", { name: "Chip", exact: true }).click();
await page.getByRole("button", { name: "Sand wedge", exact: true }).click();
await page.locator(".dtl-tile", { hasText: /^On the green$/ }).click();
await page.getByText("Neil's shot 2 on the 3rd?").waitFor();
ok(/Add detail: chip, sand wedge: on the green/.test(await page.locator(".cd-add-detail").innerText()), "Add detail on a clip uses the same card, then back to the question");
// Quick tap starts it, second tap stops it
const cmic = page.getByRole("button", { name: "Hold to say a caption" });
await cmic.click();
await page.getByText(/Listening/).waitFor({ timeout: 5000 });
await sleep(1200);
await page.getByRole("button", { name: /Listening/ }).click();
await page.waitForFunction(() => document.querySelector(".cd-cap textarea")?.value.includes("birdie"), null, { timeout: 15000 });
const sttLines = fs.readFileSync("/var/tmp/ospg/stt.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(sttLines.length >= 2 && sttLines.at(-1).fields.keyterms.length === 1 && sttLines.at(-1).fields.keyterms[0].startsWith("["), "tap to talk works too (and the word list is resent the way the service asks)");
const tilesBig = await page.locator(".cd-confirm .btn").first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
ok(tilesBig >= 60, "big Yes button");
await page.getByRole("button", { name: "Yes, post it" }).click();
await page.waitForURL(/\/score$/, { timeout: 15000 });
await page.getByText(/Clip saved/).waitFor({ timeout: 5000 });
ok(true, "posting goes straight back to the scorecard, which says the clip is saved");
let clip = "";
for (let i = 0; i < 40 && !clip; i++) { await sleep(500); clip = q(`select coalesce(trim_in::text,'-')||'|'||coalesce(trim_out::text,'-')||'|'||coalesce(details::text,'')||'|'||array_to_string(tags,',')||'|'||array_to_string(player_ids,',')||'|'||media_path from posts where round_id='${r2}' and hole=3 and kind='video'`); }
console.log("     clip:", clip);
const [tin, tout, det, , pids, mpath] = clip.split("|");
const dj = JSON.parse(det || "{}");
ok(Number(tin) >= 0.8 && Number(tout) > Number(tin) && dj.seq === 2 && dj.shot === "Chip" && dj.result === "On the green" && dj.club === "Sand wedge" && dj.shotId === q(`select client_id from shots where hole=3 and player_id='neil' and seq=2`) && pids === "neil", "the clip uploads in the background with its trim, its stroke, and what was told of it (linked to the shot)");
ok(fs.existsSync(`/var/tmp/ospg/files/${mpath}`) && fs.statSync(`/var/tmp/ospg/files/${mpath}`).size < 3_000_000, `a small upload (${Math.round(fs.statSync(`/var/tmp/ospg/files/${mpath}`).size / 1024)} KB for 3.5 seconds)`);

// ---- Filmed from a shot card: the player and the stroke are already known
await page.goto(`${BASE}/t/${T}/shots?round=2&hole=3`);
await ad.waitFor();
ok((await ad.locator('.dtl-tab[aria-selected="true"] .nm').innerText()) === "Oisin", "Add detail opens on the first player whose hole isn't told yet");
await ad.locator(".dtl-tab", { hasText: "Neil" }).click();
await ad.locator(".dtl-shot").nth(2).locator(".dtl-card-main").click();
await ad.getByRole("link", { name: "Film this shot" }).click();
await page.waitForURL(/\/record\?round=2&hole=3&player=neil&seq=3/);
await page.waitForFunction(() => !document.querySelector(".cam-rec")?.disabled, null, { timeout: 15000 });
await page.getByRole("button", { name: "Start recording" }).click();
await sleep(2200);
await page.getByRole("button", { name: "Stop recording" }).click();
await page.getByText("Trim the clip").waitFor({ timeout: 15000 });
await page.waitForFunction(() => /Keeping/.test(document.querySelector(".cd-note")?.textContent ?? ""), null, { timeout: 15000 });
await page.getByRole("button", { name: "Next" }).click();
await page.getByText("Neil's shot 3 on the 3rd?").waitFor();
ok(true, "trim, then straight to the question: who and which stroke came from the card");
const before = q(`select count(*) from shots`);
await page.getByRole("switch", { name: /Highlights film only/ }).click();
ok((await page.getByRole("button", { name: "Yes, save it for the film" }).count()) === 1, "film-only tick changes the button to 'Yes, save it for the film'");
await page.screenshot({ path: "/var/tmp/ospg/shots/oncourse-filmonly.png" });
await page.getByRole("button", { name: "Yes, save it for the film" }).click();
await page.waitForURL(/\/score$/, { timeout: 15000 });
let last = "";
for (let i = 0; i < 40 && !last; i++) { await sleep(500); last = q(`select visibility||'|'||coalesce(details->>'seq','')||'|'||coalesce(details->>'shotId','-') from posts where hole=3 and kind='video' order by created_at desc limit 1`); if (Number(q(`select count(*) from posts where hole=3 and kind='video'`)) < 2) last = ""; }
ok(last === "report|3|-", `the film-only clip sits on stroke 3, kept out of the feed, and no shot was made up for it (${last})`);
ok(q(`select count(*) from shots`) === before, "nothing told, nothing saved: no shot is invented for a clip");
await page.goto(`${BASE}/t/${T}/shots?round=2&hole=3`);
await ad.waitFor();


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
