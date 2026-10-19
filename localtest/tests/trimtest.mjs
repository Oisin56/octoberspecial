import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
const V = "/var/tmp/ospg/testvid";
const FF = execFileSync("python3", ["-c", "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())"]).toString().trim();
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);

function probe(file) {
  let out = "";
  try {
    execFileSync(FF, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    out = e.stderr.toString();
  }
  const dur = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null;
  const v = out.match(/Video: (\w+)[^\n]*?\((\w+) \//);
  const a = out.match(/Audio: (\w+)/);
  return { seconds, vcodec: v?.[1], vtag: v?.[2], acodec: a?.[1] };
}
function clickAt(file) {
  // first moment the audio gets loud (the strike)
  let out = "";
  try {
    execFileSync(FF, ["-hide_banner", "-i", file, "-af", "silencedetect=n=-20dB:d=0.05", "-f", "null", "-"], { stdio: "pipe" });
  } catch (e) {
    out = e.stderr?.toString() ?? "";
  }
  if (!out) out = execFileSync(FF, ["-hide_banner", "-i", file, "-af", "silencedetect=n=-20dB:d=0.05", "-f", "null", "-"], { stdio: ["pipe", "pipe", "pipe"] }).toString();
  const m = out.match(/silence_end: ([\d.]+)/);
  return m ? +m[1] : null;
}
import { spawnSync } from "node:child_process";
function ffRun(file) {
  return spawnSync(FF, ["-hide_banner", "-i", file, "-af", "silencedetect=n=-20dB:d=0.05", "-f", "null", "-"], { encoding: "utf8" }).stderr;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));

// log in as Neil (a player)
const apiPost = async (path, body, cookie) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
  return { r, j: await r.json().catch(() => ({})) };
};
{
  const login = await apiPost("/api/login", { mode: "organiser", pin: "1234" });
  const c = login.r.headers.get("set-cookie").split(";")[0];
  await apiPost("/api/admin", { action: "savePlayer", player: { id: "neil" }, pin: "2468" }, c);
}
await page.goto(`${BASE}/t/${T}/login`);
await page.getByRole("button", { name: /I'm playing/ }).click();
await page.locator(".name-tile", { hasText: "Neil" }).click();
await page.getByLabel("Your PIN").fill("2468");
await page.getByRole("button", { name: "Log in", exact: true }).click();
await page.waitForTimeout(1200);

// ================= Part 1: cutting real phone formats
console.log("--- cutting real phone formats");
await page.goto(`${BASE}/t/${T}/post`, { waitUntil: "networkidle" });
await page.evaluate(() => window.__osTrim.getTrimmer());
const cases = [
  { file: "iphone-h264.mov", start: 88, end: 95, click: 90 },
  { file: "iphone-hevc.mov", start: 38, end: 44, click: 40 },
  { file: "android.mp4", start: 88.4, end: 92, click: 90 },
  { file: "long-tripod.mov", start: 500, end: 508, click: null },
];
for (const c of cases) {
  // hand the real file to the page as a File, like the phone's file picker does
  await page.evaluate(() => {
    if (!document.querySelector("#tt")) {
      const i = document.createElement("input");
      i.type = "file";
      i.id = "tt";
      i.style.display = "none";
      document.body.appendChild(i);
    }
  });
  await page.setInputFiles("#tt", `${V}/${c.file}`);
  const t0 = Date.now();
  const res = await page.evaluate(
    async ({ start, end }) => {
      const input = document.querySelector("#tt");
      const f = input.files[0];
      const blob = await window.__osTrim.cutClip(f, start, end);
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { size: blob.size, b64: btoa(bin) };
    },
    { start: c.start, end: c.end },
  ).catch((e) => ({ error: String(e) }));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.error) {
    ok(false, `${c.file}: ${res.error}`);
    await page.goto(`${BASE}/t/${T}/post`, { waitUntil: "networkidle" });
    continue;
  }
  const out = `${V}/out-${c.file}.mp4`;
  fs.writeFileSync(out, Buffer.from(res.b64, "base64"));
  const p = probe(out);
  const want = c.end - c.start;
  ok(p.seconds != null && Math.abs(p.seconds - (want + 1)) < 0.35, `${c.file}: cut is ${p.seconds?.toFixed(2)}s for a ${want.toFixed(1)}s selection + 1s padding (${(res.size / 1048576).toFixed(1)} MB, ${secs}s to cut)`);
  ok(p.vcodec === (c.file.includes("hevc") ? "hevc" : "h264") && p.acodec === "aac", `${c.file}: video ${p.vcodec}, audio ${p.acodec} copied without re-encoding`);
  if (c.file.includes("hevc")) ok(p.vtag === "hvc1", `${c.file}: tagged hvc1 so iPhones play it (got ${p.vtag})`);
  if (c.click != null) {
    let s = "";
    try { s = ffRun(out); } catch (e) { s = e.stderr?.toString() ?? ""; }
    const at = s.match(/silence_end: ([\d.]+)/)?.[1];
    // the cut starts exactly 0.5s before the mark, so the strike is at (click - start + 0.5)
    const expected = c.click - c.start + 0.5;
    ok(at != null && Math.abs(+at - expected) < 0.15, `${c.file}: strike lands at ${(+at).toFixed(2)}s in the cut (expected ${expected.toFixed(2)}s)`);
  }
  // reload between files so each starts clean
  await page.goto(`${BASE}/t/${T}/post`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.__osTrim.getTrimmer());
}

if (process.env.ONLY_FORMATS) { console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); await browser.close(); process.exit(fails ? 1 : 0); }
// ================= Part 2: the trim screen, end to end (WebM plays in this test browser)
console.log("--- trim screen");
await page.goto(`${BASE}/t/${T}/post?round=1&hole=4`, { waitUntil: "networkidle" });
await page.setInputFiles("#md", `${V}/tripod.webm`);
await page.getByRole("heading", { name: "Trim your video" }).waitFor({ timeout: 10000 });
ok(true, "picking a video opens the trim screen");
await page.waitForFunction(() => document.querySelectorAll(".thumbs img").length >= 6, null, { timeout: 30000 }).catch(() => null);
const nThumbs = await page.locator(".thumbs img").count();
ok(nThumbs >= 6, `${nThumbs} thumbnails to find the shots`);
await page.screenshot({ path: "/var/tmp/ospg/shots/trim.png", fullPage: true });

// cut 1: around the strike at 40s, Neil, hole 4 (default), tag chip-in
const setRange = async (label, v) => {
  await page.locator("details summary").first().click().catch(() => null);
  const input = page.locator(`label:has-text("${label}") input[type=range]`);
  await input.evaluate((el, val) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
};
await setRange("End", 46);
await setRange("Start", 37);
await page.getByRole("button", { name: "chip-in" }).click();
await page.getByLabel("Note (optional)").fill("Neil chips in!");
await page.getByRole("button", { name: "Add this cut" }).click();
// cut 2: around the strike at 90s, hole 5, Oisin instead of Neil
await setRange("End", 96);
await setRange("Start", 87);
await page.getByLabel("Hole").selectOption("5");
await page.getByRole("button", { name: "Neil", exact: true }).click(); // deselect Neil
await page.getByRole("button", { name: "Oisin", exact: true }).click();
await page.getByRole("button", { name: "Add this cut" }).click();
ok((await page.getByText(/2 cuts to post/).count()) === 1, "two cuts marked from one recording");
await page.screenshot({ path: "/var/tmp/ospg/shots/trim-cuts.png", fullPage: true });

// post them, the second while offline
await page.getByRole("button", { name: /Post 2 clips/ }).click();
await page.getByText("Posted ✓").first().waitFor({ timeout: 60000 }).catch(() => null);
await page.getByText(/clips? posted/).waitFor({ timeout: 90000 });
ok(true, "both cuts cut and posted");

const posts = await (await fetch(`http://127.0.0.1:54321/rest/v1/posts?kind=eq.video&clip_start=not.is.null&order=created_at&select=hole,player_ids,tags,body,clip_start,clip_end,media_path,round_id`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();
const last2 = posts.slice(-2);
ok(last2[0]?.hole === 4 && last2[0].player_ids.join() === "neil" && last2[0].tags.join() === "chip-in" && last2[0].body === "Neil chips in!", "cut 1 tagged: hole 4, Neil, chip-in, note");
ok(last2[1]?.hole === 5 && last2[1].player_ids.join() === "oisin", "cut 2 tagged: hole 5, Oisin");
ok(Math.abs(last2[0].clip_start - 37) < 0.2 && Math.abs(last2[0].clip_end - 46) < 0.2, "cut times recorded (37s–46s)");
const stored = `/var/tmp/ospg/files/${last2[0].media_path}`;
const sp = probe(stored);
ok(sp.seconds > 8.5 && sp.seconds < 11.5, `stored cut 1 is ${sp.seconds?.toFixed(1)}s (selection 9s)`);

// ================= Part 3: no signal on the course
console.log("--- offline");
await page.goto(`${BASE}/t/${T}/post?round=1&hole=6`, { waitUntil: "networkidle" });
await page.setInputFiles("#md", `${V}/tripod.webm`);
await page.getByRole("heading", { name: "Trim your video" }).waitFor();
await page.waitForFunction(() => document.querySelector("video")?.duration > 0, null, { timeout: 20000 });
await setRange("End", 20);
await setRange("Start", 12);
await page.getByRole("button", { name: "Add this cut" }).click();
await ctx.setOffline(true);
await page.getByRole("button", { name: /Post 1 clip/ }).click();
await page.getByText(/saved on this phone/).waitFor({ timeout: 60000 });
ok(true, "with no signal the cut is saved on the phone");
await page.goto(`${BASE}/t/${T}/post`).catch(() => null); // offline reload fails, that's expected
await ctx.setOffline(false);
await page.goto(`${BASE}/t/${T}/live`, { waitUntil: "networkidle" });
const banner = await page.locator(".queue-banner").innerText().catch(() => "");
console.log("     banner:", banner || "(already sent)");
await page.waitForFunction(() => !document.querySelector(".queue-banner"), null, { timeout: 60000 }).catch(() => null);
const after = await (await fetch(`http://127.0.0.1:54321/rest/v1/posts?kind=eq.video&hole=eq.6&select=id`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();
ok(after.length === 1, "back online, the saved cut sends itself");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
await browser.close();
process.exit(fails ? 1 : 0);
