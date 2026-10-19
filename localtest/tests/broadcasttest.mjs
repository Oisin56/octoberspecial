// Broadcast clips: made when the hole is finished, kept in our storage, played by the feed, shared as a file.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^SESSION_SECRET=(.*)$/m)[1].trim();
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
async function upload(a, file, type) {
  const up = await a("/api/upload-url", { filename: file.split("/").pop(), contentType: type });
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([fs.readFileSync(file)], { type }), file.split("/").pop());
  await fetch(up.j.signedUrl, { method: "PUT", body: fd });
  return up.j.path;
}
const org = agent();
await org("/api/login", { mode: "organiser", pin: "1234" });
const tid = sql(`select id from tournaments where slug='${T}'`);
const r2 = sql(`select id from rounds where tournament_id='${tid}' and number=2`);
const pars = JSON.parse(sql(`select holes::text from rounds where id='${r2}'`)).map((h) => h.par);

let sp = await org("/api/broadcast", { action: "spend" });
ok(sp.status === 200 && sp.j.on === true && sp.j.capCents === 1000 && sp.j.configured, `on by default, $10 a month (${JSON.stringify(sp.j)})`);
const startClips = sp.j.clips;

// A birdie putt on hole 1, posted before the hole is scored
const v = await upload(org, "/var/tmp/ospg/social/clip2.webm", "video/webm");
const p1 = (await org("/api/posts", { roundId: r2, hole: 1, body: "Neil rolls in the birdie putt", kind: "video", mediaPath: v, playerIds: ["neil"], tags: ["birdie"], details: { shot: "Putt", result: "Holed", club: "Putter", dur: 6, shape: "portrait" } })).j.post;
// film only, and a note: never made
const p2 = (await org("/api/posts", { roundId: r2, hole: 1, body: "FILM ONLY", kind: "video", mediaPath: v, playerIds: ["neil"], visibility: "report", details: { dur: 6 } })).j.post;
await sleep(1500);
ok(sql(`select coalesce(broadcast_status,'-') from posts where id='${p1.id}'`) === "-", "not made while the hole is still being played");

// The hole is scored: the clip goes off to be made
await org("/api/score", { roundId: r2, game: "main", hole: 1, scores: { oisin: { gross: pars[0] }, neil: { gross: pars[0] - 1 } } });
let st = "-";
for (let i = 0; i < 20 && st !== "rendering"; i++) { await sleep(500); st = sql(`select coalesce(broadcast_status,'-') from posts where id='${p1.id}'`); }
ok(st === "rendering", "hole finished: the broadcast clip is being made");
ok(sql(`select coalesce(broadcast_status,'-') from posts where id='${p2.id}'`) === "-", "film-only clips are never made");
let rid = "";
for (let i = 0; i < 40 && !rid; i++) { await sleep(500); rid = sql(`select coalesce(broadcast_render,'') from posts where id='${p1.id}'`); }
const edit = JSON.parse(fs.readFileSync(`/var/tmp/ospg/edit-${rid}.json`, "utf8"));
const srcs = edit.timeline.tracks.flatMap((t) => t.clips.map((c) => c.asset.src ?? ""));
const cards = srcs.filter((s) => s.includes("/api/director/card")).map((s) => JSON.parse(Buffer.from(new URL(s).searchParams.get("d"), "base64url").toString()));
ok(edit.output.aspectRatio === "9:16", "upright 9:16");
ok(cards.some((c) => c.k === "strap" && c.h === "Neil" && c.e === "1"), "the player and hole");
ok(cards.some((c) => c.k === "caption" && /birdie putt/.test(c.h)), "the caption from the post");
ok(cards.some((c) => c.k === "bug" && c.b?.mode === "field"), "the score graphic (round leaderboard)");
ok(cards.some((c) => c.k === "replay"), "slow-motion replay for the birdie");
ok(cards.some((c) => c.k === "title" && c.h === "The October Special"), "branded end card");
ok(edit.timeline.tracks.some((t) => t.clips.some((c) => c.asset.speed === 0.5)), "replay at half speed");
ok(typeof edit.callback === "string" && edit.callback.includes(`post=${p1.id}`), "Shotstack calls back when it's done");
const secs = Number(sql(`select broadcast_seconds from posts where id='${p1.id}'`));
console.log(`      length ${secs}s, about ${(secs / 60 * 20).toFixed(1)} cents`);

// Shotstack's call back (the stub says done on the second look)
const sig = createHmac("sha256", secret).update(`bc:${p1.id}`).digest("base64url").slice(0, 24);
const cb = async () => (await fetch(`${BASE}/api/broadcast?post=${p1.id}&sig=${sig}`, { method: "POST", body: "{}" })).json();
ok((await fetch(`${BASE}/api/broadcast?post=${p1.id}&sig=wrong`, { method: "POST", body: "{}" })).status === 403, "a call back with a bad signature is refused");
let res = await cb();
if (res.status !== "done") res = await cb();
ok(res.status === "done", "finished video collected");
const path = sql(`select broadcast_path from posts where id='${p1.id}'`);
ok(path === `video/${T}/bc-${p1.id}.mp4`, "kept in our storage");
sp = await org("/api/broadcast", { action: "spend" });
ok(sp.j.clips === startClips + 1 && sp.j.cents > 0, `spend this month: ${sp.j.cents} cents for ${sp.j.clips} clips`);

// The feed plays it, and Share sends the file with the caption copied
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  window.__shared = null;
  window.__copied = null;
  navigator.canShare = (d) => !!(d && d.files);
  navigator.share = async (d) => { window.__shared = { name: d.files?.[0]?.name, type: d.files?.[0]?.type, size: d.files?.[0]?.size, text: d.text }; };
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } } });
});
const pg = await ctx.newPage();
pg.on("pageerror", (e) => console.log("pageerror:", e.message));
await pg.goto(`${BASE}/t/${T}/feed`, { waitUntil: "networkidle" });
const card = pg.locator(".sf-card", { hasText: "birdie putt" });
await card.scrollIntoViewIfNeeded();
ok(/bc-/.test(await card.locator("video").getAttribute("src")), "the feed plays the broadcast version");
await pg.waitForTimeout(4000); // on screen: the file is fetched
await card.locator(".sf-act.share").tap();
await pg.waitForTimeout(500);
const shared = await pg.evaluate(() => window.__shared);
const copied = await pg.evaluate(() => window.__copied);
ok(shared && /\.mp4$/.test(shared.name) && shared.size > 1000, `shared the video file (${JSON.stringify(shared)})`);
ok(copied && /birdie putt/.test(copied) && /The October Special/.test(copied), "the caption is copied to paste in");
await pg.screenshot({ path: "/var/tmp/ospg/shots/bc-1-feed.png" });

// No hole: made a minute after posting
const p3 = (await org("/api/posts", { body: "Range session", kind: "video", mediaPath: v, details: { dur: 6, shape: "portrait" } })).j.post;
await sleep(1500);
ok(sql(`select coalesce(broadcast_status,'-') from posts where id='${p3.id}'`) === "-", "no hole: waits a minute");
sql(`update posts set created_at = now() - interval '2 minutes' where id='${p3.id}'`);
await new Promise((r) => setTimeout(r, 9000));
await org("/api/broadcast", { action: "sweep" });
st = "-";
for (let i = 0; i < 20 && st !== "rendering"; i++) { await sleep(500); st = sql(`select coalesce(broadcast_status,'-') from posts where id='${p3.id}'`); }
ok(st === "rendering", "...then it's made");

// The monthly limit
await org("/api/broadcast", { action: "settings", capCents: 0 });
await org("/api/score", { roundId: r2, game: "main", hole: 2, scores: { oisin: { gross: pars[1] }, neil: { gross: pars[1] } } });
const p4 = (await org("/api/posts", { roundId: r2, hole: 2, body: "Over the limit", kind: "video", mediaPath: v, playerIds: ["oisin"], details: { dur: 6 } })).j.post;
st = "-";
for (let i = 0; i < 20 && st === "-"; i++) { await sleep(500); st = sql(`select coalesce(broadcast_status,'-') from posts where id='${p4.id}'`); }
ok(st === "capped", "over the monthly limit: shown as filmed");
await org("/api/broadcast", { action: "settings", capCents: 1000 });
ok(sql(`select coalesce(broadcast_status,'-') from posts where id='${p4.id}'`) === "-", "raising the limit lets it go again");

// The organiser's panel
const actx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await actx.addCookies([{ name: "os_session", value: org.cookie().split("=").slice(1).join("="), url: BASE }]);
const ap = await actx.newPage();
await ap.goto(`${BASE}/t/${T}/admin#film`, { waitUntil: "networkidle" });
await ap.getByText("Broadcast clips").first().waitFor();
await ap.waitForTimeout(500);
await ap.locator(".panel", { hasText: "Broadcast clips" }).first().screenshot({ path: "/var/tmp/ospg/shots/bc-2-settings.png" });
await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
