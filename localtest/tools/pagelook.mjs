// The front page, section by section, on a phone and a computer
import { chromium, devices } from "playwright";
const OUT = process.argv[2] || "/var/tmp/ospg/shots/page";
import fs from "node:fs"; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const [label, ctxOpts] of [["desk", { viewport: { width: 1440, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${label}-0-hero.png` });
  let i = 1;
  for (const sel of [".bx-home", ".bx-course", ".bx-setup", ".bx-film-sec", ".bx-for", ".bx-all"]) {
    const el = p.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    // let the in-view graphics play
    await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), sel);
    await p.waitForTimeout(1600);
    await el.screenshot({ path: `${OUT}/${label}-${i++}-${sel.slice(4)}.png` });
  }
  console.log(label, "errors:", errs.length ? errs : "none");
  await ctx.close();
}
await b.close();
