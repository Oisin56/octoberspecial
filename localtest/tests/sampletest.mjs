// The front page's sample round: all five steps, on a phone and on a computer, with nothing sent to the server.
import { chromium, devices } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:3100";
const OUT = "/var/tmp/ospg/shots/sample";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
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
  }
  throw new Error(`couldn't set ${who} to ${n}`);
}

async function playRound(p, shot, label) {
  const sent = [];
  p.on("request", (r) => { if (r.method() !== "GET" && /\/api\//.test(r.url())) sent.push(r.url()); });
  await p.locator(".sr-bar").waitFor();
  await p.locator(".score-step").first().waitFor({ timeout: 15000 });
  ok((await p.locator(".pscore.entry").count()) === 3, `${label}: the real scorecard, you and two playing partners`);
  ok((await p.locator(".pscore.is-locked").count()) === 2 && (await p.getByText("Already in").count()) === 2, `${label}: Declan's and Marcus's scores are already in`);
  ok((await p.locator('.score-step[data-value=""]').count()) === 1 && (await p.locator(".pscore.entry", { hasText: "You" }).locator(".ss-plus").count()) === 1, `${label}: only yours to enter`);
  ok(/The Atlantic Links/.test(await p.locator(".score-top").innerText()), `${label}: at The Atlantic Links`);
  await shot("1-score");
  // Hole 1: par 4. You make 5
  await setScore(p, "You", 5);
  ok(!(await p.getByText(/waiting for signal/).count()), `${label}: no "waiting for signal" in the sample`);
  // The GPS tab: over the card; drag it up and it stays; pull it out with a finger; push it back
  const tab = p.locator(".gps-tab");
  const box0 = await tab.boundingBox();
  await p.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await p.mouse.down(); await p.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2 - 60, { steps: 4 }); await p.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2 - 160, { steps: 6 }); await p.mouse.up();
  await sleep(200);
  const box1 = await tab.boundingBox();
  ok(box1.y < box0.y - 120 && !(await p.locator(".gps-panel").count()), `${label}: GPS tab dragged up (${Math.round(box0.y)} to ${Math.round(box1.y)}), panel not opened`);
  ok(Number(await p.evaluate(() => localStorage.getItem("mgs-gps-y"))) > 0, `${label}: and it remembers where`);
  // pull left: the panel follows the finger
  await p.mouse.move(box1.x + 20, box1.y + box1.height / 2);
  await p.mouse.down(); await p.mouse.move(box1.x - 40, box1.y + box1.height / 2, { steps: 4 });
  await p.locator(".gps-panel").waitFor();
  const half = await p.locator(".gps-panel").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  await p.mouse.move(box1.x - 240, box1.y + box1.height / 2, { steps: 8 }); await p.mouse.up();
  ok(half > 100, `${label}: pulling the tab brings the panel out with the finger (${Math.round(half)}px still off)`);
  await sleep(400);
  const open = await p.locator(".gps-panel").evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  ok(open === 0, `${label}: let go past a third: it opens`);
  await p.waitForFunction(() => /\d/.test(document.querySelector(".gps-n.mid b")?.textContent ?? ""), null, { timeout: 8000 });
  const mid = Number((await p.locator(".gps-n.mid b").innerText()).replace(/\D/g, ""));
  ok(mid > 50 && mid < 400, `${label}: GPS shows a distance to the middle (${mid} yards)`);
  await p.locator(".linklike", { hasText: "Got it" }).click().catch(() => {});
  await shot("2-gps");
  // push it right: away
  const pb = await p.locator(".gps-head").boundingBox();
  await p.mouse.move(pb.x + 60, pb.y + 90); await p.mouse.down(); await p.mouse.move(pb.x + 260, pb.y + 95, { steps: 8 }); await p.mouse.up();
  await sleep(500);
  ok(!(await p.locator(".gps-panel").count()), `${label}: pushed right: put away`);
  // a tap still opens it
  await tab.click(); await p.locator(".gps-panel").waitFor(); await sleep(350);
  ok(true, `${label}: a tap opens it too`);
  await p.locator(".gps-close").click(); await sleep(400);
  await p.locator(".after-hole").waitFor({ timeout: 8000 });
  ok(true, `${label}: the hole done, the two buttons (nothing pops up)`);
  await p.locator(".after-hole .btn", { hasText: "Add detail" }).click();
  await p.locator(".dtl").waitFor({ timeout: 8000 });
  await p.locator(".dtl-tab", { hasText: "Declan" }).click();
  ok(/Tee shot[^\n]*right/i.test(await p.locator(".dtl-shots").innerText()), `${label}: Declan's shots are already told`);
  await p.locator(".dtl-tab", { hasText: "You" }).click();
  ok(/Wind: hurting, light/.test(await p.locator(".dtl-wind").innerText()), `${label}: the wind on the hole, from the weather`);
  // The voice note for the commentators: a sample note, no microphone
  await p.getByRole("button", { name: "Hold to tell the commentators" }).click();
  await p.getByText(/greens are quick/).first().waitFor({ timeout: 8000 });
  ok(true, `${label}: the voice note writes down a sample note, for the commentators`);
  await p.locator(".dtl-shot").first().locator(".dtl-card-main").click();
  await p.locator(".dtl-shot.open .dtl-tile").first().waitFor();
  await shot("3-shotcard");
  // Film this shot: where the camera would open, and who filmed what
  await p.locator(".dtl-shot.open a", { hasText: "Film this shot" }).click();
  await p.locator(".sr-cam").waitFor({ timeout: 8000 });
  ok(/Marcus filmed Declan's putt/.test(await p.locator(".sr-cam").innerText()), `${label}: Film this shot shows where the camera opens, and that Marcus filmed Declan`);
  await shot("4-camera");
  await p.locator(".sr-cam").getByRole("button", { name: "Back to the scorecard" }).click();
  await p.locator(".dtl .dtl-next, .after-hole .btn:not(.secondary)").first().waitFor({ timeout: 8000 });
  await p.locator(".dtl .dtl-next, .after-hole .btn:not(.secondary)").first().click();
  await p.locator(".score-step").first().waitFor();
  ok((await p.locator(".hole-pick .n").innerText()).trim() === "2", `${label}: on to hole 2`);
  // Your score missing: a swipe on asks first
  ok((await p.locator(".after-hole").count()) === 0, `${label}: your score not in, no buttons to move on`);
  // (along the top line, clear of the GPS tab on the right edge)
  const sb = await p.locator(".score-top").boundingBox();
  const sy = sb.y + sb.height / 2;
  await p.mouse.move(sb.x + sb.width * 0.7, sy); await p.mouse.down(); await p.mouse.move(sb.x + sb.width * 0.4, sy + 2, { steps: 4 }); await p.mouse.move(sb.x + 10, sy + 3, { steps: 4 }); await p.mouse.up();
  await p.getByText("Your score isn't in.").waitFor({ timeout: 5000 });
  ok(true, `${label}: moving on without your score asks first ("Your score isn't in.")`);
  await p.getByRole("button", { name: /^Enter it$/ }).click();
  await setScore(p, "You", 4);
  await p.locator(".after-hole .btn", { hasText: "On to hole 3" }).click();
  await p.locator(".score-step").first().waitFor();
  // Hole 3: par 3. You make 3; Declan's 2 is in
  await setScore(p, "You", 3);
  await p.locator(".after-hole").waitFor();
  ok(/Declan birdie/.test(await p.locator(".after-hole .btn").first().innerText()), `${label}: Declan's birdie names itself on the button`);
  await p.locator(".after-hole .btn", { hasText: "Add detail" }).click();
  await p.locator(".dtl").waitFor();
  ok((await p.locator('.dtl-tab[aria-selected="true"]').innerText()).includes("Declan") && /holed from 30 ft/i.test(await p.locator(".dtl-shots").innerText()), `${label}: Declan's birdie, and how`);
  await p.locator(".dtl").getByText(/See what everyone at home saw/).click();
  // The highlight, as it looks in the film
  await p.locator(".fm-film video").waitFor({ timeout: 10000 });
  const t0 = Date.now();
  await p.locator(".fb-bug.is-in").waitFor({ timeout: 4000 });
  const bug = await p.locator(".fb-bug").innerText();
  ok(/Hole 3/.test(bug) && /You/.test(bug) && /Declan/.test(bug) && /Marcus/.test(bug), `${label}: the film's leaderboard, with you on it`);
  ok(/\b2\b/.test(await p.locator(".fb-row", { hasText: "You" }).locator(".fb-thru").innerText()), `${label}: before the putt, everyone thru 2`);
  await shot("5-film");
  await p.locator(".fb-flash", { hasText: "BIRDIE" }).waitFor({ timeout: 12000 });
  const at = (Date.now() - t0) / 1000;
  ok(at > 6 && at < 10, `${label}: BIRDIE as the ball drops (${at.toFixed(1)}s in)`);
  await shot("6-birdie");
  await p.locator(".fb-strap", { hasText: "Declan" }).waitFor({ timeout: 5000 });
  ok(/F/.test(await p.locator(".fb-row", { hasText: "You" }).locator(".fb-thru").innerText()), `${label}: then the leaderboard catches up`);
  await sleep(300);
  await shot("7-strap");
  ok(!(await p.locator(".fm-film").getByText(/subtitle|caption/i).count()), `${label}: no subtitles`);
  ok(await p.locator(".sr-bar .sr-again").isVisible(), `${label}: Start again is still there on the film`);
  await p.getByRole("button", { name: "See the feed" }).first().click();
  await p.locator(".sr-feed").waitFor();
  await sleep(800);
  const first = await p.locator(".sr-feed article, .sr-feed .sf-card").first().innerText().catch(() => "");
  const feed = await p.locator(".sr-feed").innerText();
  ok(/After three/.test(feed) && /Your card: bogey, par, par\./.test(feed) && /In your words: .Lovely morning for it/.test(feed), `${label}: the bulletin leads with your round and quotes your note`);
  ok(feed.indexOf("After three") < feed.indexOf("Lovely morning") && feed.indexOf("After three") < feed.indexOf("Thirty feet for birdie"), `${label}: the bulletin is at the top of the feed`);
  ok(/Level at the top|Top of the leaderboard|Birdie at the|Rough one|Following every hole/.test(feed) && /View all 2 comments/.test(feed), `${label}: comments from home`);
  void first;
  await shot("8-feed");
  ok((await p.locator(".sr-feed .sf-label").first().evaluate((e) => getComputedStyle(e).position)) === "static", `${label}: the feed's Player and Fan labels sit in their cards`);
  ok(!(await p.locator(".sr-feed .sf-live-more").isVisible()) && !(await p.locator(".sr-feed .sf-act.share").first().isVisible()), `${label}: no links to pages the sample doesn't have`);
  await p.locator(".sr-feed .sf-card", { hasText: "Thirty feet for birdie" }).locator("video, .sf-media, img").first().click().catch(() => {});
  await p.locator(".fm-film").waitFor({ timeout: 5000 }).then(() => ok(true, `${label}: the clip in the feed plays the film again`)).catch(() => ok(false, `${label}: the clip in the feed plays the film again`));
  await p.getByRole("button", { name: "See the feed" }).first().click();
  await p.locator(".sr-feed").waitFor();
  ok(sent.length === 0, `${label}: nothing sent to the server (${sent.slice(0, 3).join(", ")})`);
  const askedFor = await p.evaluate(() => window.__asked);
  ok(askedFor.length === 0, `${label}: no location, camera or microphone asked for (${askedFor.join(", ")})`);
  // Start again: a fresh round
  await p.getByRole("button", { name: "Play it again" }).click();
  await p.locator(".score-step").first().waitFor();
  ok((await p.locator('.score-step[data-value=""]').count()) === 1 && (await p.locator(".hole-pick .n").innerText()).trim() === "1", `${label}: Play it again starts afresh on hole 1`);
}

const b = await chromium.launch();
// ---- a phone: the sample itself
{
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__asked = [];
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition = () => window.__asked.push("location");
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__asked.push("media"); throw new Error("no"); };
  });
  await p.goto(`${BASE}/try`, { waitUntil: "networkidle" });
  await playRound(p, (n) => p.screenshot({ path: `${OUT}/phone-${n}.png` }), "phone");
  ok(errs.length === 0, `phone: no errors (${errs.slice(0, 2).join(" | ")})`);
  await ctx.close();
}
// ---- a computer: the guidance beside a phone running the same page
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${BASE}/try`, { waitUntil: "networkidle" });
  await p.locator(".tr-phone iframe").waitFor();
  ok(/Score three holes/.test(await p.locator(".tr-steps li.is-on").innerText()), "computer: the guidance starts on step 1");
  const f = p.frameLocator(".tr-phone iframe");
  await f.locator(".score-step").first().waitFor({ timeout: 15000 });
  await p.screenshot({ path: `${OUT}/desk-1.png` });
  ok(errs.length === 0, `computer: no errors (${errs.slice(0, 2).join(" | ")})`);
  await ctx.close();
}
await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
