// Phase A: nine-hole rounds, scorer-only entry and the live card, corrections, unfinished holes,
// and the camera (recording indicator, zoom, the camera kept ready between clips, the iPhone tip). Run after fresh + e2e.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
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
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function agent() {
  let cookie = "";
  const call = async (path, body) => {
    const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  call.cookie = () => cookie;
  return call;
}
const org = agent(), neil = agent();
await org("/api/login", { mode: "organiser", pin: "1234" });
await neil("/api/login", { mode: "player", playerId: "neil", pin: "2468" });
const tid = sql(`select id from tournaments where slug='${T}'`);

// ---- A6: a round on the back nine
const add = await org("/api/admin", { action: "saveRound", round: { courseRef: "local:macreddin", tee: "White", hole_set: "back" } });
ok(add.status === 200, "a round can be added on the back nine of an 18-hole course");
const rid = add.j.id;
const rn = Number(sql(`select number from rounds where id='${rid}'`));
const games = [{ id: "main", sides: [{ id: "oisin", playerIds: ["oisin"] }, { id: "neil", playerIds: ["neil"] }], scorerId: "oisin" }];
ok(
  (await org("/api/admin", { action: "saveRound", round: { id: rid, play: "singles", format: "match", points_rule: { front: 0, back: 0, full: 1 }, handicap_rule: { mode: "manual", shots: {} }, games } })).status === 200,
  "set up as a singles match",
);
ok(sql(`select hole_set || ':' || jsonb_array_length(holes) from rounds where id='${rid}'`) === "back:18", "the whole card is kept; the round plays the back nine");
sql(`update rounds set status='upcoming' where tournament_id='${tid}' and status='live'`);
sql(`update rounds set status='live' where id='${rid}'`);
ok((await org("/api/score", { roundId: rid, game: "main", hole: 3, scores: { oisin: { gross: 4 } } })).status === 400, "a hole that isn't in the round is refused");
const pars = JSON.parse(sql(`select holes::text from rounds where id='${rid}'`)).map((h) => h.par);

const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
async function phone(agentCookie, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"], ...extra });
  await ctx.addCookies([{ name: "os_session", value: agentCookie.split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
}
const p = await phone(org.cookie());
await p.goto(`${BASE}/t/${T}/score?round=${rn}`, { waitUntil: "networkidle" });
await p.locator(".hole-pick .n").waitFor();
ok((await p.locator(".hole-pick .n").innerText()).trim() === "10", "the scorecard starts on the 10th");
ok(await p.getByRole("button", { name: "Previous hole" }).isDisabled(), "nothing before the 10th");
ok(/9 holes/.test(await p.locator(".score-top .where").innerText()), "the top line says it's 9 holes");
await p.getByRole("button", { name: /Hole 10\. Tap to choose/ }).click();
const nums = await p.locator(".hole-sheet .grid button").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
ok(nums.join(",") === "10,11,12,13,14,15,16,17,18", `the hole list is the nine played (${nums.join(",")})`);
await p.locator(".hole-sheet .grid button", { hasText: /^18/ }).click();
await p.getByRole("button", { name: /Finish: check the card/ }).waitFor();
ok(true, "the 18th is the last hole: Finish, check the card");

// An unfinished hole: one score in, Next, the hole is marked not finished
await p.getByRole("button", { name: /Hole 18\. Tap to choose/ }).click();
await p.locator(".hole-sheet .grid button", { hasText: /^10/ }).click();
await setScore(p, "Oisin", pars[9]);
await p.getByRole("button", { name: /Next: hole 11/ }).tap();
await p.getByText("Neil's score isn't in.").waitFor();
ok(true, "Next with a score missing asks first: enter it, or skip");
await p.getByRole("button", { name: "Skip for now and come back" }).tap();
await p.getByText(/Hole 10 isn't finished: a score is missing/).waitFor();
ok((await p.locator(".hole-pick .n").innerText()).trim() === "11", "Next with a score missing moves on, and says the hole isn't finished");
await p.getByRole("button", { name: /Hole 11\. Tap to choose/ }).click();
ok((await p.locator(".hole-sheet .grid button.part", { hasText: /^10/ }).count()) === 1, "the hole list marks the 10th as not finished");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasea-holes9.png" });
await p.getByRole("button", { name: "Back to hole 11" }).click();
ok((await org("/api/cards", { action: "submit", roundId: rid, game: "main" })).status === 400, "the card can't be submitted with a hole missing");

// The More sheet for a score off the tiles
{
  const neil = p.locator(".pscore.entry", { hasText: "Neil" }).locator(".score-step");
  ok((await neil.getAttribute("data-value")) === "", "Neil's score starts faded: not entered, nothing saved");
  await neil.locator(".ss-val").tap(); // par
  await neil.locator(".ss-val").tap(); // the full list
  await p.locator(".hole-sheet .grid.numbers button", { hasText: /^9/ }).tap();
  ok((await neil.getAttribute("data-value")) === "9", "tap the number for the full list: any score from 1 to 15");
}

// Finish the nine by API: Oisin wins 10 and 11, the rest halved (once the phone's last taps have gone)
await sleep(2500);
for (let h = 10; h <= 18; h++) {
  const r = await org("/api/score", { roundId: rid, game: "main", hole: h, scores: { oisin: { gross: pars[h - 1] - (h <= 11 ? 1 : 0) }, neil: { gross: pars[h - 1] } } });
  if (r.status !== 200) ok(false, `hole ${h} (${JSON.stringify(r.j)})`);
}
ok((await org("/api/cards", { action: "submit", roundId: rid, game: "main" })).status === 200, "nine holes in: the card can be submitted");
const rules = await (await fetch(`${BASE}/t/${T}/rules`)).text();
const pr = await phone(org.cookie());
await pr.goto(`${BASE}/t/${T}/rules`, { waitUntil: "networkidle" });
const rulesText = await pr.locator("article").innerText();
ok(/9 holes \(the back nine\): given on the toughest of the nine by stroke index/.test(rulesText), "the rules explain the nine and where the shots go");
ok(/Worth 1: the 9 holes 1\./.test(rulesText), "and the round's single point");
void rules;
await pr.goto(`${BASE}/t/${T}/rounds/${rn}`, { waitUntil: "networkidle" });
ok((await pr.locator("table.card").count()) === 1 && (await pr.locator("table.card thead th").count()) === 11, "the round's scorecard is one card of nine holes");
const rtext = await pr.locator("main").innerText();
ok(/Oisin won 2&1/.test(rtext), `the result over nine: won 2&1 (${(rtext.match(/Oisin[^\n]*UP|[^\n]*won[^\n]*/) ?? [""])[0]})`);
await pr.screenshot({ path: "/var/tmp/ospg/shots/phasea-round9.png", fullPage: true });

// ---- A1: only the scorer enters scores; everyone else gets the live card
sql(`delete from cards where round_id='${rid}'`);
sql(`delete from card_signatures where round_id='${rid}'`);
sql(`update rounds set status='live' where id='${rid}'`);
const np = await phone(neil.cookie());
await np.goto(`${BASE}/t/${T}/score?round=${rn}`, { waitUntil: "networkidle" });
await np.locator(".live-card").waitFor({ timeout: 15000 }).catch(async (e) => { await np.screenshot({ path: "/var/tmp/ospg/shots/dbg-neil.png" }); console.log("URL", np.url(), (await np.locator("body").innerText()).slice(0, 600)); throw e; });
ok((await np.locator(".live-card .keeper .who").innerText()) === "Oisin is keeping score", "Neil gets the live card: Oisin is keeping score");
ok((await np.locator(".pscore.entry, .num-tile").count()) === 0, "no score buttons for Neil");
ok((await np.locator("nav.oncourse .oc-btn").first().innerText()).includes("Card"), "his bar says Card, not Score");
ok((await np.locator(".live-card table.card").count()) === 1, "with the match's card, live");
await np.screenshot({ path: "/var/tmp/ospg/shots/phasea-livecard.png" });

// The organiser isn't this match's scorer now: live card, and a logged correction instead
await org("/api/admin", { action: "saveRound", round: { id: rid, games: [{ ...games[0], scorerId: "neil" }] } });
const before = Number(sql(`select count(*) from score_changes where round_id='${rid}'`));
ok((await org("/api/score", { roundId: rid, game: "main", hole: 12, scores: { oisin: { gross: 9 }, neil: { gross: 4 } } })).status === 403, "the organiser can't score someone else's match from the scorecard");
await p.goto(`${BASE}/t/${T}/score?round=${rn}`, { waitUntil: "networkidle" });
await p.locator(".live-card").waitFor();
ok((await p.locator(".live-card .keeper .who").innerText()) === "Neil is keeping score", "the organiser sees the live card too");
await p.getByRole("link", { name: "Correct a score (logged)" }).click();
await p.locator(".correcting").waitFor();
ok(/every change is logged/.test(await p.locator(".correcting").innerText()), "correcting: a banner says every change is logged");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasea-correct.png" });
ok((await org("/api/score", { roundId: rid, game: "main", hole: 12, correct: true, scores: { oisin: { gross: pars[11] + 1 }, neil: { gross: pars[11] } } })).status === 200, "a correction from Admin is saved");
ok(Number(sql(`select count(*) from score_changes where round_id='${rid}' and action='score corrected by the organiser'`)) === before + 1, "and logged");
const ap = await phone(org.cookie());
await ap.goto(`${BASE}/t/${T}/admin#cards`, { waitUntil: "networkidle" });
await ap.getByText("Score corrections").waitFor();
ok((await ap.getByRole("link", { name: "Correct a score" }).count()) >= 1, "Admin, Scorecards: Correct a score on every card");

// ---- A4, A5, A7: the camera
sql(`update rounds set status='upcoming' where id='${rid}'`);
sql(`update rounds set status='live' where tournament_id='${tid}' and number=2`);
const cam = await phone(org.cookie(), { ...devices["iPhone 13"] });
await cam.addInitScript(() => {
  window.__gum = 0;
  window.__vib = [];
  window.__streams = [];
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__gum++;
    const s = await real(c);
    window.__streams.push(s);
    return s;
  };
  navigator.vibrate = (x) => (window.__vib.push(x), true);
});
await cam.goto(`${BASE}/t/${T}/score`, { waitUntil: "networkidle" });
await cam.locator("nav.oncourse").getByRole("link", { name: "Record" }).click();
const recBtn = cam.getByRole("button", { name: "Start recording" });
await cam.waitForFunction(() => document.querySelector(".cam-rec") && !document.querySelector(".cam-rec").disabled, null, { timeout: 15000 });
ok((await cam.locator(".cam-time").innerText()) === "Ready: tap to record", "ready: says tap to record");
await cam.locator(".cam-tip").waitFor();
const tipText = await cam.locator(".cam-tip").innerText();
ok(/Website Settings/.test(tipText) && /Camera and Microphone to Allow/.test(tipText) && /Shake to Undo/.test(tipText), "iPhone: step-by-step to stop the camera question (and the Undo pop-up)");
await cam.screenshot({ path: "/var/tmp/ospg/shots/phasea-cam-tip.png" });
await cam.getByRole("button", { name: "Later" }).click();
const zooms = await cam.locator(".cam-zoom button").allInnerTexts();
ok(zooms.join(",") === "1×,2×,3×", `zoom buttons (${zooms.join(", ")})`);
ok((await cam.locator(".cam-native").count()) === 1, "iPhone: a button for the iPhone's own camera, for full zoom");
await cam.locator(".cam-zoom button", { hasText: "2×" }).click();
ok(/scale\(2\)/.test(await cam.locator(".cam-view").getAttribute("style")), "2×: the picture is enlarged");
await recBtn.click();
await cam.locator(".cam.recording").waitFor();
await sleep(1600);
const banner = await cam.locator(".cam-rec-banner").innerText();
ok(/REC 0:0[12]/.test(banner), `recording: a big red REC banner with the time (${banner.replace(/\s+/g, " ")})`);
ok((await cam.locator(".cam-top").count()) === 0, "nothing else at the top while recording");
ok((await cam.locator(".cam-time").innerText()) === "Tap the square to stop", "and how to stop");
await cam.screenshot({ path: "/var/tmp/ospg/shots/phasea-cam-rec.png" });
await cam.getByRole("button", { name: "Stop recording" }).click();
await cam.locator(".cd").waitFor({ timeout: 15000 });
ok(true, "a zoomed recording comes through to the clip screen");
const vib = await cam.evaluate(() => window.__vib);
ok(vib.length >= 2, `a buzz when recording starts and stops (Android) (${vib.length})`);
const camOff = () => cam.evaluate(() => window.__streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
ok(await camOff(), "the camera switches off as soon as the clip is filmed (no light left on, no battery drain)");
// Throw it away, back to the scorecard: the camera is off there too
cam.once("dialog", (d) => d.accept());
await cam.locator(".cd-back").click();
await cam.waitForFunction(() => document.querySelector(".cam-rec") && !document.querySelector(".cam-rec").disabled, null, { timeout: 15000 });
ok((await cam.locator(".cam-tip").count()) === 0, "Later: the tip waits until the next visit");
await cam.getByRole("button", { name: "‹ Scorecard" }).click();
await cam.waitForURL(/\/score/);
await sleep(300);
ok(await camOff(), "leaving the camera switches it off");
// A new visit: the tip again, and Done it puts it away for good
await cam.evaluate(() => sessionStorage.clear());
await cam.locator("nav.oncourse").getByRole("link", { name: "Record" }).click();
await cam.locator(".cam-tip").waitFor();
await cam.getByRole("button", { name: "Done it" }).click();
await cam.getByRole("button", { name: "‹ Scorecard" }).click();
await cam.waitForURL(/\/score/);
await cam.evaluate(() => sessionStorage.clear());
await cam.locator("nav.oncourse").getByRole("link", { name: "Record" }).click();
await cam.waitForFunction(() => document.querySelector(".cam-rec") && !document.querySelector(".cam-rec").disabled, null, { timeout: 15000 });
ok((await cam.locator(".cam-tip").count()) === 0, "Done it: the tip doesn't come back");

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
