// Stage 2, who can watch: Private and Friends and family. A phone that isn't let in tries every page, data read,
// file and API; followers ask to follow (email confirmed with a code) and are let in, declined or removed; files move
// to the locked store and back; the daily reminder; Who's following; the screens.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { BASE, agent, codeOf, lastMailTo, mails, signInWithEmail, playerLink } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const SHOTS = "/var/tmp/ospg/shots";
const FILES = "/var/tmp/ospg/files";
const ANON = fs.readFileSync("/var/tmp/ospg/keys.env", "utf8").match(/^ANON=(.*)$/m)[1].trim();
const rest = async (q) => {
  const r = await fetch(`http://127.0.0.1:54321/rest/v1/${q}`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
  return { status: r.status, j: await r.json().catch(() => null) };
};

// ================================================================ the owner makes a private tournament
const owner = agent();
await signInWithEmail(owner, "owner@test.ie");
await owner("/api/owner", { action: "sendCode" });
await owner("/api/owner", { action: "code", code: codeOf(await lastMailTo("owner@test.ie")) });
const wizard = {
  who: "individuals",
  name: "Hush Cup",
  win: "stableford",
  organiserPlays: false,
  rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", format: "stableford" }],
  players: [{ name: "Ann Hush" }, { name: "Bea Quiet" }, { name: "Cat Still" }, { name: "Dee Calm" }],
  draw: "random",
  prizes: [],
  extras: {},
  theme: "spring",
  privacy: "private",
};
let r = await owner("/api/tournaments", { wizard });
ok(r.status === 200, `a private tournament made with the wizard ${r.j.error ?? ""}`);
const T = r.j.slug;
const tid = sql(`select id from tournaments where slug='${T}'`);
ok(sql(`select privacy from tournaments where id='${tid}'`) === "private", "it's private");
const st = (await owner(`/api/state?t=${T}`)).j.state;
const players = st.players;
const pid = (n) => players.find((p) => p.name === n).id;
const round = st.rounds[0];

// ================================================================ the database, read from a browser that isn't let in
ok((await rest(`open_tournaments?slug=eq.${T}`)).j?.length === 0, "the browser's view of tournaments doesn't show it");
ok((await rest(`open_tournaments?slug=eq.october-special-2026`)).j?.length === 1, "but shows Friends and family ones");
ok((await rest(`public_tournaments?select=slug`)).status >= 400, "the server's own view can't be read from a browser");
ok((await rest(`open_players?tournament_id=eq.${tid}`)).j?.length === 0, "no players");
ok((await rest(`rounds?tournament_id=eq.${tid}`)).j?.length === 0, "no rounds");
const os = sql(`select id from tournaments where slug='october-special-2026'`);
ok((await rest(`rounds?tournament_id=eq.${os}`)).j?.length > 0, "(Friends and family rounds still readable)");

// ================================================================ the site, for a phone that isn't let in
const anon = agent();
r = await anon(`/api/state?t=${T}`);
ok(r.status === 403 && r.j.private === true && r.j.status === "none" && !JSON.stringify(r.j).includes("Hush"), "the server: private, nothing more");
ok((await anon(`/api/login?t=${T}`)).j.session === null, "no session");
for (const [path, body] of [
  ["/api/comments", { t: T, postId: "x", body: "hi" }],
  ["/api/likes", { t: T, postId: "x", device: "dev-12345678" }],
  ["/api/subscribe", { t: T, email: "x@example.ie", name: "X" }],
  ["/api/posts", { t: T, body: "hi" }],
  ["/api/score", { t: T, roundId: round.id, hole: 1, scores: {} }],
  ["/api/upload-url", { t: T, contentType: "image/jpeg", filename: "a.jpg" }],
  ["/api/viewed", { t: T, device: "dev-12345678" }],
]) {
  const x = await anon(path, body);
  ok(x.status === 404 || (path === "/api/upload-url" && x.status === 401) || (path === "/api/viewed" && x.status === 200), `${path}: refused for someone not let in (${x.status})`);
}
ok(Number(sql(`select count(*) from viewers where tournament_id='${tid}'`)) === 0, "and they aren't counted as watching");
const man = await (await fetch(`${BASE}/t/${T}/app.webmanifest`)).json();
ok(!/Hush/.test(JSON.stringify(man)) && man.description === "A private tournament", `the home-screen app's name isn't given away (${man.name})`);
const html = await (await fetch(`${BASE}/t/${T}`)).text();
ok(!/Hush Cup|Ann Hush/.test(html), "the page's HTML (what WhatsApp reads for a preview) has no name or players");

// ================================================================ players get in with their links
const ann = agent();
const aurl = await playerLink(owner, T, pid("Ann Hush"));
r = await ann("/api/login", { t: T, mode: "link", code: aurl.split("/in/")[1] });
ok(r.j.privacy === "private" && r.j.needEmail === false, "Ann's link: says it's private");
await ann("/api/login", { t: T, mode: "link", code: aurl.split("/in/")[1], step: "confirm" });
r = await ann(`/api/state?t=${T}`);
ok(r.status === 200 && r.j.state.players.length === 4 && !("pin_hash" in r.j.state.players[0]) && !("email" in r.j.state.players[0]), "signed in with her link, Ann sees it all (no PINs or emails)");

// ================================================================ files: the locked store
const up = await ann("/api/upload-url", { t: T, contentType: "image/jpeg", filename: "p.jpg" });
ok(up.status === 200 && /media-private/.test(up.j.signedUrl) && !!up.j.readUrl, "Ann's photo goes to the locked store, with a link to show it");
const fd = new FormData();
fd.append("", new Blob([fs.readFileSync("/var/tmp/ospg/hero.jpg")], { type: "image/jpeg" }), "p.jpg");
await fetch(up.j.signedUrl.startsWith("http") ? up.j.signedUrl : `http://127.0.0.1:54321/storage/v1${up.j.signedUrl}`, { method: "PUT", body: fd });
const photo = up.j.path;
ok((await ann("/api/posts", { t: T, kind: "photo", mediaPath: photo, body: "Quiet one" })).status === 200, "Ann posts it");
ok((await fetch(`http://127.0.0.1:54321/storage/v1/object/public/media/${photo}`)).status === 404, "it can't be opened at the public address");
r = await ann(`/api/state?t=${T}`);
const link = r.j.media[photo];
ok(!!link && (await fetch(link)).status === 200, "the link in the state opens it");
ok((await fetch(link.replace(/token=[^&]+/, "token=forged"))).status >= 400, "a made-up link doesn't");
ok((await rest(`posts?tournament_id=eq.${tid}`)).j?.length === 0, "the post can't be read from a browser not let in");

// ================================================================ asking to follow
const mum = agent();
r = await mum("/api/fans", { t: T, action: "ask", name: "Ann's Mum", how: "Ann's mother", email: "mum@example.ie", over16: true });
ok(r.status === 200, "Ann's mum asks to follow");
ok((await mum(`/api/state?t=${T}`)).j.status === "confirm", "she's asked to confirm her email first");
let list = (await ann("/api/fans", { t: T, action: "list" })).j;
ok(list.asking.length === 0, "the players don't see the request until her email's confirmed");
const mm = await lastMailTo("mum@example.ie");
ok(/ask to follow, confirm/.test(mm.text) && !/Hush Cup/.test(mm.text + mm.subject) && !!codeOf(mm), "she gets a code (the email doesn't name the tournament)");
// Someone else types an email that's still waiting for its code: the first request stands
const ghost = agent();
await ghost("/api/fans", { t: T, action: "ask", name: "Gary", how: "Bea's friend", email: "gary@example.ie", over16: true });
r = await agent()("/api/fans", { t: T, action: "ask", name: "Not Gary", how: "x", email: "gary@example.ie", over16: true });
ok(r.status === 409 && sql(`select name from fans where email='gary@example.ie'`) === "Gary", "someone else typing an email still waiting for its code can't take it over");
await mum("/api/account", { action: "code", email: "mum@example.ie", code: codeOf(mm) });
ok((await mum(`/api/state?t=${T}`)).j.status === "asking", "confirmed: waiting for approval");
list = (await ann("/api/fans", { t: T, action: "list" })).j;
ok(list.asking.length === 1 && list.asking[0].name === "Ann's Mum" && list.asking[0].how === "Ann's mother", "Ann sees: Ann's Mum, Ann's mother, asking");
// A stranger types her email before she confirms? (here: after) They get nothing
const stranger = agent();
await stranger("/api/fans", { t: T, action: "ask", name: "Not Mum", how: "x", email: "mum@example.ie", over16: true });
ok((await stranger(`/api/state?t=${T}`)).status === 403, "someone typing her (confirmed) email gets nothing");
// Ann lets her in
const before = mails().length;
r = await ann("/api/fans", { t: T, action: "decide", fanId: list.asking[0].id, decision: "approve" });
ok(r.status === 200 && r.j.following.some((f) => f.name === "Ann's Mum"), "Ann lets her in");
const yes = mails().slice(before).find((x) => x.to.includes("mum@example.ie"));
ok(!!yes && /You're in/.test(yes.subject), `she's emailed: ${yes?.subject}`);
r = await mum(`/api/state?t=${T}`);
ok(r.status === 200 && r.j.state.posts.some((p) => p.body === "Quiet one"), "and now she sees it");
// On another phone she signs in with her email
const mum2 = agent();
await signInWithEmail(mum2, "mum@example.ie");
ok((await mum2(`/api/state?t=${T}`)).status === 200, "on another phone, her email gets her in");
ok((await mum2("/api/account")).j.following.some((x) => x.slug === T), "it's under Following in her My golf");
// Declined: told nothing
const nosy = agent();
await nosy("/api/fans", { t: T, action: "ask", name: "Nosy Ned", how: "Lives nearby", email: "ned@example.ie", over16: true });
await nosy("/api/account", { action: "code", email: "ned@example.ie", code: codeOf(await lastMailTo("ned@example.ie")) });
list = (await owner("/api/fans", { t: T, action: "list" })).j;
const ned = list.asking.find((f) => f.name === "Nosy Ned");
const b2 = mails().length;
await owner("/api/fans", { t: T, action: "decide", fanId: ned.id, decision: "decline" });
ok(!mails().slice(b2).some((x) => x.to.includes("ned@example.ie")), "declined: no email");
r = await nosy(`/api/state?t=${T}`);
ok(r.status === 403 && r.j.status === "asking", "and he just sees: waiting for approval");
await nosy("/api/fans", { t: T, action: "ask", name: "Nosy Ned", how: "Lives nearby, honest", email: "ned@example.ie", over16: true });
await nosy("/api/account", { action: "code", email: "ned@example.ie", code: codeOf(await lastMailTo("ned@example.ie")) });
list = (await owner("/api/fans", { t: T, action: "list" })).j;
ok(!list.asking.some((f) => f.name === "Nosy Ned") && sql(`select status from fans where id='${ned.id}'`) === "declined", "asking again after being turned down changes nothing");
// Removed: back to nothing
list = (await owner("/api/fans", { t: T, action: "list" })).j;
await owner("/api/fans", { t: T, action: "decide", fanId: list.following.find((f) => f.name === "Ann's Mum").id, decision: "remove" });
ok((await mum(`/api/state?t=${T}`)).status === 403 && (await mum2(`/api/state?t=${T}`)).status === 403, "removed: neither of her phones can see it");
ok((await ann("/api/fans", { t: T, action: "decide", fanId: ned.id, decision: "remove" })).status === 403, "only organisers can remove");

// ================================================================ the daily reminder
const late = agent();
await late("/api/fans", { t: T, action: "ask", name: "Late Larry", how: "Bea's cousin", email: "larry@example.ie", over16: true });
await late("/api/account", { action: "code", email: "larry@example.ie", code: codeOf(await lastMailTo("larry@example.ie")) });
sql(`update fans set created_at = now() - interval '13 hours' where email='larry@example.ie'`);
const b3 = mails().length;
ok((await fetch(`${BASE}/api/cron/daily`)).status === 401, "the daily jobs don't run for anyone without the secret");
const CRON = { headers: { authorization: "Bearer local-cron-secret" } };
r = await (await fetch(`${BASE}/api/cron/daily`, CRON)).json();
const rem = mails().slice(b3).find((x) => x.to.includes("owner@test.ie"));
ok(r.sent >= 1 && !!rem && /Larry is waiting to follow Hush Cup/.test(rem.text), `the organiser hears after 12 hours (${rem?.subject})`);
const b4 = mails().length;
await fetch(`${BASE}/api/cron/daily`, CRON);
ok(mails().length === b4, "once only");
// A photo that reached the open store anyway (an upload link from before it went private) is moved by the daily job
const stray = `photo/${T}/stray-${Date.now()}.jpg`;
fs.mkdirSync(`${FILES}/photo/${T}`, { recursive: true });
fs.copyFileSync("/var/tmp/ospg/hero.jpg", `${FILES}/${stray}`);
await fetch(`${BASE}/api/cron/daily`, CRON);
ok(!fs.existsSync(`${FILES}/${stray}`) && fs.existsSync(`${FILES}/__private__/${stray}`), "a stray photo in the open store is moved to the locked one each day");
const health = await (await fetch(`${BASE}/api/health`)).text();
ok(!health.includes(T) && !/hush/i.test(health), "the setup check doesn't list tournaments");

// ================================================================ players sign in with their email too
sql(`update tournaments set players_need_email = true where id='${tid}'`);
const bea = agent();
const burl = await playerLink(owner, T, pid("Bea Quiet"));
r = await bea("/api/login", { t: T, mode: "link", code: burl.split("/in/")[1] });
ok(r.j.needEmail === true, "Bea's link: she needs to sign in with her email too");
ok((await bea("/api/login", { t: T, mode: "link", code: burl.split("/in/")[1], step: "confirm" })).status === 403, "her link alone isn't enough");
await signInWithEmail(bea, "bea@example.ie");
r = await bea("/api/login", { t: T, mode: "link", code: burl.split("/in/")[1], step: "confirm", join: true });
ok(r.status === 200 && (await bea(`/api/state?t=${T}`)).status === 200, "signed in with her email, and her link: she's in");
ok((await ann(`/api/state?t=${T}`)).status === 403, "Ann (link only, from before) is asked to sign in with her email too");
sql(`update tournaments set players_need_email = false where id='${tid}'`);

// ================================================================ Friends and family: a follower's first comment
const OS = "october-special-2026";
const fan = agent();
const ostate = (await fetch(`${BASE}/api/state?t=${OS}`).then((x) => x.json())).state;
const post = ostate.posts[0];
ok(!!post, "(a post on the October Special)");
ok((await fan("/api/fans", { t: OS, action: "profile", name: "Sorcha", how: "Oisin's cousin", over16: true })).status === 200, "a follower gives her name and how she knows the group");
ok((await fan("/api/comments", { t: OS, postId: post.id, body: "Go on Oisin" })).status === 200, "and comments straight away (no email needed)");
await anon("/api/viewed", { t: OS, device: "anon-device-1" });
// The site owner opens it as its organiser
await owner("/api/owner", { action: "open", id: os });
list = (await owner("/api/fans", { t: OS, action: "list" })).j;
ok(list.following?.some((f) => f.name === "Sorcha" && f.how === "Oisin's cousin") && list.others >= 1, `Who's following: Sorcha, Oisin's cousin, and ${list.others} other watching`);

// ================================================================ a Friends and family tournament becomes private: its files move
// A photo on it first (the organiser posts one)
const oup = await owner("/api/upload-url", { t: OS, contentType: "image/jpeg", filename: "o.jpg" });
const ofd = new FormData();
ofd.append("", new Blob([fs.readFileSync("/var/tmp/ospg/hero.jpg")], { type: "image/jpeg" }), "o.jpg");
await fetch(oup.j.signedUrl.startsWith("http") ? oup.j.signedUrl : `http://127.0.0.1:54321/storage/v1${oup.j.signedUrl}`, { method: "PUT", body: ofd });
await owner("/api/posts", { t: OS, kind: "photo", mediaPath: oup.j.path, body: "Clubhouse" });
const file = oup.j.path ?? null;
// The screens (and moving the files) through Tournament setup
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "os_session", value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
const p = await ctx.newPage();
await p.goto(`${BASE}/t/${OS}/setup`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /Who can watch/ }).click();
await p.getByRole("heading", { name: "Who can watch?" }).waitFor();
await p.screenshot({ path: `${SHOTS}/privacy-1-watch.png` });
await p.locator(".wz-tile", { hasText: "Private" }).click();
await p.getByRole("button", { name: /^(Done|Save|Next)$/ }).first().click();
await p.waitForTimeout(2500);
ok(sql(`select privacy from tournaments where slug='${OS}'`) === "private", "Tournament setup: the October Special is private now");
if (file) {
  ok(fs.existsSync(`${FILES}/__private__/${file}`) && !fs.existsSync(`${FILES}/${file}`), "its photos moved to the locked store");
  ok((await fetch(`http://127.0.0.1:54321/storage/v1/object/public/media/${file}`)).status === 404, "and the old public address stops working");
} else ok(false, "(no photo on the October Special to check)");
ok((await rest(`rounds?tournament_id=eq.${os}`)).j?.length === 0, "its rounds are no longer readable from a browser");
await p.screenshot({ path: `${SHOTS}/privacy-2-setup.png`, fullPage: true });
// Followers from before weren't let in by anyone: now they ask, and the players decide
r = await fan(`/api/state?t=${OS}`);
ok(r.status === 403 && r.j.status === "asking", "a follower from before it went private has to be let in");
list = (await owner("/api/fans", { t: OS, action: "list" })).j;
const clo = list.asking?.find((f) => f.name === "Sorcha" && f.how === "Oisin's cousin");
ok(!!clo, "the organiser sees her asking");
// Email subscribers from before get nothing, unless they're let in
sql(`update fans set email='sorcha@example.ie', verified_at=now() where id='${clo?.id}'`);
sql(`insert into subscribers (tournament_id, email) values ('${os}', 'outsider@example.ie'), ('${os}', 'sorcha@example.ie') on conflict do nothing`);
const pieceId = sql(`select id from ai_pieces where tournament_id='${os}' and status='published' limit 1`);
if (pieceId) {
  const b5 = mails().length;
  await owner("/api/admin", { t: OS, action: "emailPiece", id: pieceId });
  ok(!mails().slice(b5).some((x) => x.to.includes("outsider@example.ie") || x.to.includes("sorcha@example.ie")), "a report emailed now doesn't go to subscribers who aren't let in");
  await owner("/api/fans", { t: OS, action: "decide", fanId: clo.id, decision: "approve" });
  const b6 = mails().length;
  await owner("/api/admin", { t: OS, action: "emailPiece", id: pieceId });
  ok(mails().slice(b6).some((x) => x.to.includes("sorcha@example.ie")) && !mails().slice(b6).some((x) => x.to.includes("outsider@example.ie")), "once she's let in, she gets it (the outsider still doesn't)");
} else {
  ok(false, "(no published piece on the October Special)");
  await owner("/api/fans", { t: OS, action: "decide", fanId: clo.id, decision: "approve" });
}
r = await fan(`/api/state?t=${OS}`);
ok(r.status === 200, `let in: she sees it again (${r.status} ${JSON.stringify(r.j).slice(0, 120)})`);
// Back again
await p.goto(`${BASE}/t/${OS}/setup`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /Who can watch/ }).click();
await p.locator(".wz-tile", { hasText: "Friends and family" }).click();
await p.getByRole("button", { name: /^(Done|Save|Next)$/ }).first().click();
await p.waitForTimeout(2500);
ok(sql(`select privacy from tournaments where slug='${OS}'`) === "friends", "and back to Friends and family");
if (file) ok(fs.existsSync(`${FILES}/${file}`) && (await fetch(`http://127.0.0.1:54321/storage/v1/object/public/media/${file}`)).status === 200, "its photos back at their public address");

// ================================================================ the gate, on a phone that isn't let in
const gp = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
for (const path of ["", "/leaderboard", "/feed", "/players", "/highlights", "/rounds"]) {
  await gp.goto(`${BASE}/t/${T}${path}`, { waitUntil: "networkidle" });
  await gp.getByRole("heading", { name: "This tournament is private" }).waitFor({ timeout: 10000 });
  const text = await gp.locator("body").innerText();
  ok(!/Hush Cup|Ann Hush|Bea Quiet|Quiet one/.test(text), `${path || "/"}: only the private notice, no names`);
}
await gp.screenshot({ path: `${SHOTS}/privacy-3-gate.png`, fullPage: true });
await gp.getByLabel("Your name").fill("Gran");
await gp.getByLabel("How do you know the group?").fill("Cat's granny");
await gp.getByLabel("Your email").fill("gran@example.ie");
await gp.getByRole("switch", { name: /16 or over/ }).click();
await gp.getByRole("button", { name: "Ask to follow" }).click();
await gp.getByRole("heading", { name: "Check your email" }).waitFor();
await gp.screenshot({ path: `${SHOTS}/privacy-4-code.png` });
await gp.getByLabel("The code from the email").fill(codeOf(await lastMailTo("gran@example.ie")));
await gp.getByRole("button", { name: "Send my request" }).click();
await gp.getByRole("heading", { name: "Waiting for approval" }).waitFor({ timeout: 15000 });
await gp.screenshot({ path: `${SHOTS}/privacy-5-waiting.png` });
// Cat's phone: Who's following, Let in
const cat = agent();
const curl = await playerLink(owner, T, pid("Cat Still"));
await cat("/api/login", { t: T, mode: "link", code: curl.split("/in/")[1], step: "confirm" });
const cp = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await cp.context().addCookies([{ name: "os_session", value: cat.cookie().split("=").slice(1).join("="), url: BASE }]);
await cp.goto(`${BASE}/t/${T}/following`, { waitUntil: "networkidle" });
await cp.getByText("Cat's granny").waitFor();
await cp.screenshot({ path: `${SHOTS}/privacy-6-following.png`, fullPage: true });
await cp.locator("li", { hasText: "Gran" }).getByRole("button", { name: "Let in" }).click();
await cp.waitForTimeout(800);
// Gran's page opens by itself
await gp.getByText("Hush Cup").first().waitFor({ timeout: 20000 });
ok(true, "Gran's waiting page opens by itself when she's let in");
await gp.screenshot({ path: `${SHOTS}/privacy-7-in.png` });
// The photo shows for her, from the locked store
await gp.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
const img = await gp.locator(".sf-card img").first().getAttribute("src").catch(() => null);
ok(!!img && /object\/sign\/media-private/.test(img), `the photo comes from the locked store with a link (${img?.slice(0, 80)})`);
// The wizard's screen
const wz = await ctx.newPage();
await wz.goto(`${BASE}/new`, { waitUntil: "networkidle" });
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
