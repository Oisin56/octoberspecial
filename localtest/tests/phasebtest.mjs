// Phase B: three roles, the badge, the bar at the foot, where each person lands, player links,
// organiser email sign-in (My tournaments), the live score pinned to the feed. Run after fresh + e2e.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function agent() {
  let cookie = "";
  const call = async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify({ t: T, ...body }) : undefined });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  call.cookie = () => cookie;
  return call;
}
const tid = sql(`select id from tournaments where slug='${T}'`);
const setLive = (n) => {
  sql(`update rounds set status='upcoming' where tournament_id='${tid}' and status='live'`);
  if (n) sql(`update rounds set status='live' where tournament_id='${tid}' and number=${n}`);
};
setLive(0);

const b = await chromium.launch();
const phone = async (cookie) => {
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  if (cookie) await ctx.addCookies([{ name: "os_session", value: cookie.split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
};
const barLabels = (p) => p.locator("nav.tabbar .oc-btn span").allInnerTexts();

// ---- Visitors: the bar, and where they land
let p = await phone();
await p.goto(`${BASE}/t/${T}/go`);
await p.waitForURL(/\/leaderboard$/, { timeout: 15000 });
ok(true, "a visitor opening the app with no round on lands on the leaderboard");
await p.locator("nav.tabbar").waitFor();
ok((await barLabels(p)).join(",") === "Home,Live,Feed,Leaderboard,More", `visitor's bar: ${(await barLabels(p)).join(", ")}`);
const h = await p.locator("nav.tabbar .oc-btn").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(h.every((x) => x >= 60), `big buttons (${Math.min(...h)}px)`);
ok(!(await p.locator(".site-head .tabs").isVisible()), "on a phone the top tabs give way to the bar");
ok((await p.locator(".role-badge").innerText()).trim() === "Log in", "the badge says Log in");
await p.getByRole("button", { name: "More" }).click();
await p.locator(".who-sheet").waitFor();
const more = await p.locator(".more-link").allInnerTexts();
ok(["Home", "Live", "Leaderboard", "Rounds", "Feed", "Highlights", "Players", "Rules"].every((x) => more.includes(x)), "More: every page");
ok((await p.locator(".more-link.strong").count()) === 0, "no Admin for visitors");
await p.screenshot({ path: "/var/tmp/ospg/shots/phaseb-more-visitor.png" });
await p.getByRole("button", { name: "Close" }).click();

// ---- The log-in page: three choices, then big name tiles
await p.goto(`${BASE}/t/${T}/login`, { waitUntil: "networkidle" });
const tiles = await p.locator(".login-tile .lt-h").allInnerTexts();
ok(tiles.join("|") === "I'm playing|I'm the organiser|I'm following", `three big choices (${tiles.join(", ")})`);
ok(/Caddies, friends and family/.test(await p.locator(".login-tile", { hasText: "following" }).innerText()), "caddies and friends are followers");
await p.screenshot({ path: "/var/tmp/ospg/shots/phaseb-login.png" });
await p.getByRole("button", { name: /I'm playing/ }).click();
const names = await p.locator(".name-tile").allInnerTexts();
ok(names.includes("Neil") && names.includes("Oisin"), `players as big name tiles (${names.join(", ")})`);
await p.locator(".name-tile", { hasText: "Neil" }).click();
await p.getByLabel("Your PIN").fill("2468");
await p.screenshot({ path: "/var/tmp/ospg/shots/phaseb-login-pin.png" });
await p.getByRole("button", { name: "Log in", exact: true }).click();
await p.waitForURL(new RegExp(`/t/${T}$`), { timeout: 15000 });
ok(true, "a player logs in and lands on the tournament home (no round on)");
await p.locator(".role-badge.player").waitFor();
ok((await p.locator(".role-badge").innerText()).replace(/\s+/g, " ").trim() === "Neil Player", "the badge: Neil, Player");
await p.locator(".role-badge").click();
const can = await p.locator(".who-can li").allInnerTexts();
ok(can.includes("Film and note what happened") && can.includes("Sign your card"), `tap the badge: what you can do (${can.join("; ")})`);
ok((await p.getByRole("button", { name: "Not Neil? Log out" }).count()) === 1, "and Not Neil? Log out");
await p.screenshot({ path: "/var/tmp/ospg/shots/phaseb-badge-player.png" });
await p.getByRole("button", { name: "Not Neil? Log out" }).click();
await p.locator(".role-badge.none").waitFor();
ok(true, "logging out from the badge works");

// ---- The organiser
const org = agent();
await org("/api/login", { mode: "organiser", pin: "1234" });
const op = await phone(org.cookie());
await op.goto(`${BASE}/t/${T}/go`);
await op.waitForURL(/\/admin$/, { timeout: 15000 });
ok(true, "the organiser opening the app lands on organiser home");
await op.locator("nav.tabbar").waitFor();
ok((await barLabels(op)).join(",") === "Home,Live,Feed,Admin,More", `organiser's bar: ${(await barLabels(op)).join(", ")}`);
ok(/Organiser/.test(await op.locator(".role-badge").innerText()) && (await op.locator(".role-badge.organiser").count()) === 1, `organiser badge (${(await op.locator(".role-badge").innerText()).replace(/\s+/g, " ")})`);
await op.screenshot({ path: "/var/tmp/ospg/shots/phaseb-organiser-home.png" });

// ---- A live round: the on-course bar, Score for the scorer, Card for everyone else
setLive(2);
await op.goto(`${BASE}/t/${T}/go`);
await op.waitForURL(/\/score$/, { timeout: 15000 });
ok(true, "the organiser who's scoring the live round lands on the scorecard");
ok((await barLabels(op)).join(",") === "Score,Record,Note,Live,More", `on the course: ${(await barLabels(op)).join(", ")}`);
const neil = agent();
await neil("/api/login", { mode: "player", playerId: "neil", pin: "2468" });
const np = await phone(neil.cookie());
await np.goto(`${BASE}/t/${T}/go`);
await np.waitForURL(/\/score$/, { timeout: 15000 });
ok((await barLabels(np)).join(",") === "Card,Record,Note,Live,More", `Neil isn't scoring: Card instead of Score (${(await barLabels(np)).join(", ")})`);
// On the scorecard (full screen) who you are is under More
await np.getByRole("button", { name: "More" }).click();
await np.locator(".who-card").waitFor();
ok(/Neil/.test(await np.locator(".who-name").innerText()) && (await np.locator(".who-role").innerText()) === "Player", "More shows who you are on the course too");
await np.screenshot({ path: "/var/tmp/ospg/shots/phaseb-more-live.png" });
await np.getByRole("button", { name: "Close" }).click();

// Followers during the round: the live page, the score pinned to the feed
const vp = await phone();
await vp.goto(`${BASE}/t/${T}/go`);
await vp.waitForURL(/\/live$/, { timeout: 15000 });
ok(true, "a follower lands on the live page during a round");
ok((await barLabels(vp)).join(",") === "Home,Live,Feed,Leaderboard,More", "followers get no Score, Record or Note");
ok((await vp.getByRole("link", { name: "See the clips" }).count()) === 1, "the live page links to the clips");
await vp.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
await vp.locator(".sf-live").waitFor();
ok(/Live now · R2/.test(await vp.locator(".sf-live-h").innerText()), "the feed has the live score pinned at the top");
ok((await vp.locator(".sf-live").getAttribute("href")).endsWith("/live"), "one tap to the live card");
await vp.screenshot({ path: "/var/tmp/ospg/shots/phaseb-feed-live.png" });
setLive(0);

// ---- Fans: photos and comments
const fan = agent();
await fan("/api/fans", { name: "Aisling", email: "aisling@example.com", over16: true, consent: true });
const ftok = sql(`select token from fans where lower(email)='aisling@example.com'`);
await fan("/api/fans", { action: "verify", token: ftok });
const fpage = await phone(fan.cookie());
await fpage.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
await fpage.locator(".sf-share-photo").waitFor();
ok((await fpage.locator(".sf-compose textarea").count()) === 0, "a fan's feed: Share a photo (no text box until there's a photo)");
ok((await fpage.locator(".role-badge.fan").innerText()).includes("Fan"), "the fan's badge says Fan");
await fpage.screenshot({ path: "/var/tmp/ospg/shots/phaseb-fan-feed.png" });
await fpage.goto(`${BASE}/t/${T}/shots?round=2&hole=1`, { waitUntil: "networkidle" });
ok((await fpage.locator(".shotcard").count()) === 0, "a fan can't open the shot log");
ok((await fan("/api/shots", { clientId: "y".repeat(20), roundId: "x", hole: 1 })).status === 401, "and the server agrees");

// ---- Player links
const link1 = await org("/api/admin", { action: "playerLink", playerId: "neil" });
ok(link1.status === 200 && new RegExp(`/t/${T}/in/[\\w-]{16,}$`).test(link1.j.url), "the organiser gets Neil's personal link");
ok((await org("/api/admin", { action: "playerLink", playerId: "neil" })).j.url === link1.j.url, "the same link every time until it's replaced");
ok((await neil("/api/admin", { action: "playerLink", playerId: "neil" })).status !== 200, "only the organiser can get links");
const lp = await phone();
await lp.goto(link1.j.url.replace(/^https?:\/\/[^/]+/, BASE));
await lp.getByText("Welcome, Neil").waitFor({ timeout: 15000 });
await lp.screenshot({ path: "/var/tmp/ospg/shots/phaseb-link-welcome.png" });
await lp.waitForURL(new RegExp(`/t/${T}$`), { timeout: 15000 });
await lp.locator(".role-badge.player").waitFor();
ok(true, "tapping the link logs Neil in (no PIN) and takes him to his page");
const link2 = await org("/api/admin", { action: "playerLink", playerId: "neil", reset: true });
ok(link2.j.url !== link1.j.url, "New link makes a new one");
const lp2 = await phone();
await lp2.goto(link1.j.url.replace(/^https?:\/\/[^/]+/, BASE));
await lp2.getByText("That link didn't work").waitFor({ timeout: 15000 });
ok(/doesn't work any more/.test(await lp2.locator(".link-in").innerText()), "the old link stops working, with a way to log in instead");
// Admin, Players: Send link
const ap = await phone(org.cookie());
await ap.goto(`${BASE}/t/${T}/admin#players`, { waitUntil: "networkidle" });
await ap.evaluate(() => { navigator.share = undefined; });
await ap.locator("section", { hasText: "Neil" }).getByRole("button", { name: "Send link" }).first().click();
await ap.locator(".sheet-card").waitFor();
ok((await ap.locator(".sheet-card a", { hasText: "WhatsApp" }).getAttribute("href")).startsWith("https://wa.me/?text="), "Send link: WhatsApp, Email or copy (from the organiser's own phone)");
await ap.screenshot({ path: "/var/tmp/ospg/shots/phaseb-send-link.png" });

// ---- Organiser email sign-in: My tournaments
const before = fs.readdirSync("/var/tmp/ospg/mail").length;
const acct = agent();
ok((await acct("/api/account", { action: "send", email: "nope" })).status === 400, "a bad email is refused");
ok((await acct("/api/account", { action: "send", email: "Organiser@Example.com" })).status === 200, "sign-in link emailed");
let mail = null;
for (let i = 0; i < 20 && !mail; i++) {
  await sleep(250);
  const files = fs.readdirSync("/var/tmp/ospg/mail").sort();
  if (files.length > before) mail = JSON.parse(fs.readFileSync(`/var/tmp/ospg/mail/${files.at(-1)}`, "utf8"));
}
ok(mail?.subject === "Sign in to MyGolfBroadcast" && mail.to.includes("organiser@example.com"), "the email arrives");
const url = mail.text.match(/https?:\/\/\S+\/account\/in\?token=[\w-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
const ac = await b.newContext({ ...devices["iPhone 13"] });
const apg = await ac.newPage();
await apg.goto(url);
await apg.waitForURL(/\/account$/, { timeout: 15000 });
await apg.getByText("Signed in as organiser@example.com").waitFor();
ok(true, "the link signs the organiser in: My tournaments");
await apg.getByRole("button", { name: "Add a tournament you run" }).click();
await apg.getByLabel("Its link or name in the link").fill(`http://localhost/t/${T}`);
await apg.getByLabel("Its organiser PIN").fill("9999");
await apg.getByRole("button", { name: "Add it" }).click();
await apg.getByText("That organiser PIN isn't right").waitFor();
ok(true, "the wrong organiser PIN is refused");
await apg.getByLabel("Its organiser PIN").fill("1234");
await apg.getByRole("button", { name: "Add it" }).click();
await apg.locator(".acct-t", { hasText: "The October Special" }).waitFor();
ok(true, "with the right PIN it's added to My tournaments");
await apg.screenshot({ path: "/var/tmp/ospg/shots/phaseb-my-tournaments.png" });
await apg.locator(".acct-t").first().click();
await apg.waitForURL(/\/admin$/);
await apg.locator(".role-badge.organiser").waitFor();
ok(true, "one tap into its organiser home, logged in as organiser");
const apg2 = await (await b.newContext()).newPage();
await apg2.goto(url);
await apg2.getByText(/expired or been used/).waitFor({ timeout: 15000 });
ok(true, "the emailed link works once");
// A new device: sign in again, and the tournament's there with organiser access
const before2 = fs.readdirSync("/var/tmp/ospg/mail").length;
await acct("/api/account", { action: "send", email: "organiser@example.com" });
let mail2 = null;
for (let i = 0; i < 20 && !mail2; i++) {
  await sleep(250);
  const files = fs.readdirSync("/var/tmp/ospg/mail").sort();
  if (files.length > before2) mail2 = JSON.parse(fs.readFileSync(`/var/tmp/ospg/mail/${files.at(-1)}`, "utf8"));
}
const dev2 = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
await dev2.goto(mail2.text.match(/https?:\/\/\S+\/account\/in\?token=[\w-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE));
await dev2.locator(".acct-t", { hasText: "The October Special" }).waitFor({ timeout: 15000 });
await dev2.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await dev2.locator(".role-badge.organiser").waitFor();
ok(true, "on another phone, signing in by email is enough to run the tournament");

// ---- Computers: the top tabs and the badge, no bar
const desk = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await desk.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
ok(await desk.locator(".site-head .tabs").isVisible(), "on a computer: the top tabs");
ok(!(await desk.locator("nav.tabbar").isVisible()), "and no bar at the foot");
ok(await desk.locator(".role-badge").isVisible(), "with the badge");

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
