// The sample film's sound: off until tapped; then the four lines and the music are lined up with the picture.
import { chromium, devices } from "playwright";
const BASE = "http://127.0.0.1:3100"; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const b = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required"] });
const ctx = await b.newContext({ ...devices["iPhone 13"] });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.addInitScript(() => {
  window.__starts = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset) { window.__starts.push({ when: (when ?? 0) - this.context.currentTime, offset: offset ?? 0, dur: this.buffer?.duration ?? 0 }); return orig.apply(this, arguments); };
});
// Straight to the film: a finished round
await p.goto(`${BASE}/try`, { waitUntil: "networkidle" });
await p.locator(".score-step").first().waitFor({ timeout: 15000 });
for (let h = 1; h <= 3; h++) {
  await p.locator(".pscore.entry", { hasText: "You" }).locator(".ss-val").click();
  await p.locator(".next-hole").click(); await p.locator(".shotcard").waitFor();
  await p.locator(".shotcard").getByText(h < 3 ? `On to hole ${h + 1}` : "See what everyone at home saw").click();
  if (h < 3) await p.locator(".score-step").first().waitFor();
}
await p.locator(".fm-film").waitFor();
await sleep(600);
ok((await p.evaluate(() => window.__starts.length)) === 0, "no sound until asked");
ok(await p.locator(".fm-hint", { hasText: "Tap for sound" }).isVisible(), "Tap for sound");
ok(await p.evaluate(() => document.fonts.check('600 12px "Inter Film"')), "the film's body face is loaded");
await p.getByRole("button", { name: "Sound on" }).click();
await sleep(1500);
const s = await p.evaluate(() => window.__starts.filter((x) => x.dur > 0.5));
console.log(JSON.stringify(s.map((x) => ({ w: +x.when.toFixed(2), o: +x.offset.toFixed(2), d: +x.dur.toFixed(2) }))));
const lines = s.filter((x) => x.dur < 5); // the lines are a few seconds each; the music runs far longer
ok(lines.length === 4, `four lines lined up (${lines.length})`);
ok(s.some((x) => x.dur > 5), "the music under them");
const vid = await p.evaluate(() => ({ muted: document.querySelector(".fm-video").muted }));
ok(!vid.muted, "the clip's own sound on too");
// Sound off: everything stops; pause and play line it up again
await p.getByRole("button", { name: "Sound off" }).click();
await sleep(300);
ok(await p.evaluate(() => document.querySelector(".fm-video").muted), "sound off mutes the clip");
await p.getByRole("button", { name: "Sound on" }).click();
await sleep(400);
const after = await p.evaluate(() => window.__starts.length);
ok(after > s.length, "sound back on: lined up again from where the film is");
// to the end
await p.locator(".fm-end").waitFor({ timeout: 25000 });
ok(await p.getByRole("button", { name: "Watch again" }).isVisible(), "at the end: Watch again");
await p.getByRole("button", { name: "Watch again" }).click();
await sleep(500);
const tWatch = Date.now();
ok(!(await p.locator(".fm-end").count()), "Watch again plays it from the start");
ok(await p.getByRole("button", { name: "Sound off" }).isVisible(), "and with sound (it was a tap)");
// Away from the page (once the clip is rolling): the picture waits too
await sleep(Math.max(0, 4000 - (Date.now() - tWatch)));
await p.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await sleep(300);
ok(await p.evaluate(() => document.querySelector(".fm-video").paused), "another tab: the clip pauses");
await p.evaluate(() => { Object.defineProperty(document, "hidden", { value: false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await sleep(800);
ok(!(await p.evaluate(() => document.querySelector(".fm-video").paused)), "back again: it carries on");
ok(errs.length === 0, `no errors (${errs.slice(0, 3).join(" | ")})`);
await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
