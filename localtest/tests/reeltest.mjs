import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
const browser = await chromium.launch();

// 1. Make two short real videos by recording a page
const clips = [];
for (const [i, color] of ["#1f3d2b", "#c8102e"].entries()) {
  const ctx = await browser.newContext({ recordVideo: { dir: "/var/tmp/ospg/vid", size: { width: 640, height: 360 } }, viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;background:${color};color:#fff;font:60px sans-serif;display:grid;place-items:center;height:100vh">Clip ${i + 1}</body>`);
  await p.waitForTimeout(2200);
  const v = p.video();
  await ctx.close();
  clips.push(await v.path());
}
console.log("recorded", clips.map((c) => `${c} ${fs.statSync(c).size}B`));

// 2. Post them as a caddie
let cookie = "";
const call = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, j: await r.json() };
};
await call("/api/login", { mode: "contributor", name: "Fionn", pin: "5555" });
const st = await (await fetch(`http://127.0.0.1:54321/rest/v1/rounds?select=id,number&number=eq.1`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();
for (const [i, c] of clips.entries()) {
  const up = await call("/api/upload-url", { filename: "clip.webm", contentType: "video/webm" });
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([fs.readFileSync(c)], { type: "video/webm" }), "clip.webm");
  await fetch(up.j.signedUrl, { method: "PUT", body: fd });
  const r = await call("/api/posts", { roundId: st[0].id, hole: i === 0 ? 3 : 1, body: `Test clip ${i + 1}`, kind: "video", mediaPath: up.j.path });
  console.log("posted", r.status);
}

// 3. Organiser builds the reel in the browser
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${BASE}/t/${T}/login`);
await page.getByRole("button", { name: "Organiser" }).click();
await page.getByLabel("PIN").fill("1234");
await page.getByRole("button", { name: "Log in" }).click();
await page.waitForTimeout(1200);
await page.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /Highlights film/ }).click();
await page.getByRole("button", { name: "Build reel" }).click();
const t0 = Date.now();
await page.getByText(/Reel ready|went wrong|couldn't|failed/i).waitFor({ timeout: 240000 });
console.log("status:", await page.locator("[aria-live=polite]").innerText(), `(${Math.round((Date.now() - t0) / 1000)}s)`);
if (await page.locator("details").count()) { await page.locator("details summary").click(); console.log("details:\n" + await page.locator("details pre").innerText()); }
await page.screenshot({ path: "/var/tmp/ospg/shots/reel.png", fullPage: true });
// Publish it
const pub = page.getByRole("button", { name: "Publish to the feed" });
if (await pub.count()) {
  await pub.click();
  await page.getByText(/published to the feed|failed|Couldn't/i).waitFor({ timeout: 60000 });
  console.log("publish:", await page.locator("[aria-live=polite]").innerText());
}
await browser.close();
