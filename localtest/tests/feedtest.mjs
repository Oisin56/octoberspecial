import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const b = await chromium.launch();

// --- still frames: a poster can only sit next to a video in this tournament
{
  let cookie = "";
  const call = async (body) => {
    const r = await fetch(BASE + "/api/upload-url", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  const login = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: T, mode: "player", playerId: "neil", pin: "2468" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const good = await call({ contentType: "image/jpeg", filename: "p.jpg", posterFor: `video/${T}/abc-123.webm` });
  ok(good.status === 200 && good.j.path === `video/${T}/abc-123.webm.jpg`, "a clip's still frame is saved next to it");
  const bad = await call({ contentType: "image/jpeg", filename: "p.jpg", posterFor: `video/other-trip/abc.webm` });
  ok(bad.status === 400, "can't place a still frame in another trip");
}

// --- phone
const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
ph.on("pageerror", (e) => console.log("pageerror:", e.message));
await ph.goto(`${BASE}/t/${T}/highlights`, { waitUntil: "networkidle" });
await ph.locator(".reel-phone").waitFor();
const n = await ph.locator(".reel-phone .reel-item").count();
ok(n >= 4, `phone feed shows every video (${n})`);
ok(/highlights/i.test(await ph.locator(".reel-item").first().locator(".reel-where").innerText()), "the film comes first");
ok((await ph.locator(".reel-hint").count()) === 1, "'Tap for sound' shown");
await ph.waitForTimeout(1200);
ok(await ph.evaluate(() => { const v = document.querySelector(".reel-item video"); return v && !v.paused && v.muted; }), "first video plays straight away, muted");
await ph.screenshot({ path: "/var/tmp/ospg/shots/feed-phone.png" });
await ph.locator(".reel-item").first().tap();
await ph.getByText("Sound on").waitFor({ timeout: 3000 });
ok(await ph.evaluate(() => !document.querySelector(".reel-item video").muted), "a tap turns the sound on");
await ph.evaluate(() => document.querySelector(".reel-scroller").scrollBy(0, window.innerHeight));
await ph.waitForTimeout(1500);
const playing = await ph.evaluate(() => [...document.querySelectorAll(".reel-item video")].map((v) => !v.paused));
ok(playing[1] === true && playing[0] === false, "swiping up plays the next video and stops the last");
ok(await ph.evaluate(() => !document.querySelectorAll(".reel-item video")[1].muted), "sound stays on as you swipe");
await ph.screenshot({ path: "/var/tmp/ospg/shots/feed-phone-2.png" });
await ph.getByRole("button", { name: "Share" }).tap();
await ph.getByText("Share this video").waitFor();
ok((await ph.getByText("#golf #golftrip").count()) === 1 && (await ph.getByRole("button", { name: "Share a link" }).count()) === 1, "share sheet with a ready caption");
ok(/download=/.test(await ph.getByRole("link", { name: "Save the video" }).getAttribute("href")), "save the video downloads the file");
await ph.screenshot({ path: "/var/tmp/ospg/shots/feed-share.png" });
await ph.getByRole("button", { name: "Close" }).tap();
await ph.getByRole("button", { name: "Vote" }).tap();
await ph.getByRole("button", { name: /Shot of the trip/ }).tap();
await ph.getByRole("button", { name: /Your shot of the trip vote \(1\)/ }).waitFor({ timeout: 8000 });
ok(true, "vote from the feed");
await ph.getByRole("button", { name: "Close" }).tap();
ok(!(await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scrolling");

// --- laptop
const lp = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
lp.on("pageerror", (e) => console.log("pageerror:", e.message));
await lp.goto(`${BASE}/t/${T}/highlights`, { waitUntil: "networkidle" });
await lp.locator(".reel-stage").waitFor();
await lp.waitForTimeout(1500);
ok((await lp.locator(".device-phone").count()) === 1, "laptop: the portrait film plays in a phone frame");
await lp.screenshot({ path: "/var/tmp/ospg/shots/feed-laptop-phone.png" });
// find a landscape clip
let found = false;
for (let k = 0; k < n; k++) {
  await lp.keyboard.press("ArrowDown");
  await lp.waitForTimeout(900);
  if (await lp.locator(".device-cinema").count()) { found = true; break; }
}
ok(found, "laptop: a landscape clip switches to the cinema frame");
await lp.screenshot({ path: "/var/tmp/ospg/shots/feed-laptop-cinema.png" });
ok(/of \d+/.test(await lp.locator(".reel-count").innerText()), "position shown beside the frame");
await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
