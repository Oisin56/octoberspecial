// The social feed: run after a fresh reset + e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q}"`).toString().trim();

function agent() {
  let cookie = "";
  const call = async (path, body) => {
    const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  call.cookie = () => cookie;
  call.setCookie = (c) => (cookie = c);
  return call;
}
async function upload(a, file, type, extra = {}) {
  const up = await a("/api/upload-url", { filename: file.split("/").pop(), contentType: type, ...extra });
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([fs.readFileSync(file)], { type }), file.split("/").pop());
  await fetch(up.j.signedUrl, { method: "PUT", body: fd });
  return up.j.path;
}

const tid = sql(`select id from tournaments where slug='${T}'`);
const r1 = sql(`select id from rounds where tournament_id='${tid}' and number=1`);
const neil = agent(), caddie = agent(), org = agent();
await org("/api/login", { mode: "organiser", pin: "1234" });
{
  // Neil signs in with his own link; the caddie posts from a phone signed in as Neil too
  const u1 = (await org("/api/admin", { action: "playerLink", playerId: "neil", reset: true })).j.url;
  await caddie("/api/login", { mode: "link", code: u1.split("/in/")[1], step: "confirm" });
  neil.setCookie(caddie.cookie());
}

// Seed: a portrait clip, a photo, a trimmed landscape clip, a film-only clip, a note
const v2 = await upload(neil, "/var/tmp/ospg/social/clip2.webm", "video/webm");
const frame = execSync(`ffmpeg -v error -ss 1 -i /var/tmp/ospg/social/clip2.webm -frames:v 1 -f image2 -c:v mjpeg -`, { maxBuffer: 5e6 });
fs.writeFileSync("/var/tmp/ospg/social/p2.jpg", frame);
await upload(neil, "/var/tmp/ospg/social/p2.jpg", "image/jpeg", { posterFor: v2 });
const pClip = await neil("/api/posts", { roundId: r1, hole: 7, body: "Out of the trap and two feet from the pin", kind: "video", mediaPath: v2, playerIds: ["neil"] });
const photo = await upload(org, "/var/tmp/ospg/hero.jpg", "image/jpeg");
await org("/api/posts", { roundId: r1, hole: 1, body: "Not a bad spot for it. First tee, 8am.", kind: "photo", mediaPath: photo });
const v1 = await upload(caddie, "/var/tmp/ospg/social/clip1.webm", "video/webm");
await caddie("/api/posts", { roundId: r1, hole: 12, body: "Oisin's drive on 12", kind: "video", mediaPath: v1, trimIn: 1, trimOut: 5 });
const hidden = await neil("/api/posts", { roundId: r1, hole: 13, body: "FILM ONLY clip", kind: "video", mediaPath: v1, visibility: "report" });
ok(hidden.status === 200 && hidden.j.post.visibility === "report", "film-only clip saved");
await caddie("/api/posts", { roundId: r1, hole: 14, body: "Rain's coming in sideways. Nobody is talking.", kind: "note" });
await caddie("/api/comments", { postId: pClip.j.post.id, body: "Best shot of the day so far" });
await org("/api/comments", { postId: pClip.j.post.id, body: "Lucky. Very lucky." });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const ph = await ctx.newPage();
ph.on("pageerror", (e) => console.log("pageerror:", e.message));
await ph.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
await ph.locator(".sf-card").first().waitFor();
ok(await ph.getByText("What's happening?").isVisible(), "composer asks 'What's happening?'");
ok((await ph.getByText("FILM ONLY clip").count()) === 0, "film-only clip is not in the feed");
ok((await ph.getByText("Up the Special!").count()) === 1, "fan post in the same feed");
ok((await ph.locator(".sf-label.fan").count()) >= 1 && (await ph.locator(".sf-label.player").count()) >= 1, "Player and Fan labels");
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-1-top.png" });

// the clip plays muted once it's on screen
const clipCard = ph.locator(".sf-card", { hasText: "two feet from the pin" });
await clipCard.scrollIntoViewIfNeeded();
await ph.waitForTimeout(1500);
const vs = await clipCard.evaluate((el) => { const v = el.querySelector("video"); return v ? { paused: v.paused, muted: v.muted, rs: v.readyState, err: v.error?.code, src: v.currentSrc } : null; });
ok(vs && !vs.paused && vs.muted, `clip autoplays muted in view ${JSON.stringify(vs)}`);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-2-clip.png" });

// like
const likeBtn = clipCard.locator(".sf-act.like");
await likeBtn.tap();
ok((await likeBtn.getAttribute("aria-pressed")) === "true" && (await likeBtn.innerText()).trim() === "1", "like shows straight away");
await ph.waitForTimeout(1200);
await ph.reload({ waitUntil: "networkidle" });
await ph.locator(".sf-card").first().waitFor();
const likeAgain = ph.locator(".sf-card", { hasText: "two feet from the pin" }).locator(".sf-act.like");
ok((await likeAgain.getAttribute("aria-pressed")) === "true", "still liked after reload (this phone)");

// comments sheet
await ph.locator(".sf-card", { hasText: "two feet from the pin" }).locator(".sf-peek").tap();
await ph.locator(".sf-sheet").waitFor();
const nc = await ph.locator(".sf-comment").count();
ok(nc === 2, `comments sheet lists the post's comments (${nc})`);
await ph.waitForTimeout(400);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-3-comments.png" });
await ph.getByRole("button", { name: "Join to comment" }).tap();
await ph.getByLabel("Join the conversation").waitFor();
await ph.waitForTimeout(400);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-4-join.png" });
await ph.getByLabel("Your name").fill("Aoife Walsh");
await ph.getByLabel("Your email").fill("aoife@example.com");
await ph.getByRole("button", { name: "Email me a link" }).tap();
ok(await ph.getByText("Tick both boxes to join").isVisible(), "must tick 16+ and agree");
await ph.getByRole("switch", { name: /16 or over/ }).tap();
await ph.getByRole("switch", { name: /I agree/ }).tap();
await ph.getByRole("button", { name: "Email me a link" }).tap();
await ph.getByText("Check your email").waitFor();
await ph.waitForTimeout(400);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-5-sent.png" });
await ph.getByRole("button", { name: "Done" }).tap();

// the emailed link
const tok = sql(`select token from fans where email='aoife@example.com'`);
await ph.goto(`${BASE}/t/${T}/join?token=${tok}`);
await ph.waitForURL(/\/feed$/);
await ph.locator(".sf-toast").waitFor();
ok(/You're in, Aoife/.test(await ph.locator(".sf-toast").innerText()), "link signs the fan in and welcomes them");
ok((await ph.locator(".sf-tool").count()) === 0 && (await ph.locator(".sf-compose textarea").count()) === 0, "fans share photos (no clips, no text-only posts)");
await ph.locator(".sf-share-photo input").setInputFiles("/var/tmp/ospg/hero.jpg");
await ph.locator(".sf-compose textarea").fill("Watching from Galway. Come on Neil!");
await ph.getByRole("button", { name: "Post", exact: true }).tap();
await ph.locator(".sf-card", { hasText: "Watching from Galway" }).waitFor();
ok((await ph.locator(".sf-card").first().innerText()).includes("Watching from Galway"), "fan's post goes to the top");
ok((await ph.locator(".sf-card").first().locator(".sf-label.fan").count()) === 1, "labelled Fan");
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-6-fan-posted.png" });

// fan comments
await ph.locator(".sf-card", { hasText: "two feet from the pin" }).locator(".sf-act").nth(1).tap();
await ph.locator(".sf-reply textarea").fill("Pure class");
await ph.getByRole("button", { name: "Send" }).tap();
await ph.locator(".sf-comment", { hasText: "Pure class" }).waitFor();
ok(true, "fan comments in the sheet");
await ph.waitForTimeout(400);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-7-commented.png" });
await ph.getByRole("button", { name: "Close", exact: true }).first().tap();

// report someone else's post
const noteCard = ph.locator(".sf-card", { hasText: "Rain's coming in sideways" });
await noteCard.locator(".sf-more").tap();
await ph.getByRole("button", { name: "Report it" }).tap();
await ph.waitForTimeout(400);
await ph.screenshot({ path: "/var/tmp/ospg/shots/sf-8-report.png" });
await ph.getByRole("button", { name: "Report it" }).tap();
await ph.locator(".sf-toast", { hasText: "organiser" }).waitFor();
ok((await ph.locator(".sf-card", { hasText: "Rain's coming in sideways" }).count()) === 0, "reported post hidden for the reporter");
ok(sql(`select count(*) from reports`) !== "0", "report saved");

// own post: delete is offered
await ph.locator(".sf-card", { hasText: "Watching from Galway" }).locator(".sf-more").tap();
ok(await ph.getByRole("button", { name: "Delete my post" }).isVisible(), "own post can be deleted");
await ph.getByRole("button", { name: "Cancel" }).tap();

// tap a clip: full-screen player
await ph.locator(".sf-card", { hasText: "two feet from the pin" }).locator(".sf-media").tap();
await ph.waitForURL(/highlights\?v=/);
ok(true, "tapping a clip opens it full screen");

// crew: photo or video button
const crew = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await crew.addCookies([{ name: "os_session", value: caddie.cookie().split("=").slice(1).join("="), url: BASE }]);
const cp = await crew.newPage();
await cp.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
await cp.locator(".sf-tool").waitFor();
ok(true, "the group gets 'Photo or video'");
await cp.screenshot({ path: "/var/tmp/ospg/shots/sf-9-crew.png" });

// desktop
const dp = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await dp.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
await dp.locator(".sf-card").first().waitFor();
await dp.waitForTimeout(800);
await dp.screenshot({ path: "/var/tmp/ospg/shots/sf-10-desktop.png" });

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
