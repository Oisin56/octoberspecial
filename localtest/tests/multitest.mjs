// Several shots from one recording: one upload, a post per shot. Run after fresh + e2e.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q}"`).toString().trim();
const login = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: T, mode: "organiser", pin: "1234" }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: [] });
await ctx.addCookies([{ name: "os_session", value: cookie.split("=").slice(1).join("="), url: BASE }]);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message));
const before = Number(sql(`select count(*) from posts where kind='video'`));
await p.goto(`${BASE}/t/${T}/record?round=2&hole=3`, { waitUntil: "networkidle" });
await p.locator('input[type=file]').first().setInputFiles("/var/tmp/ospg/social/long32.webm");
await p.getByText("Trim the clip").waitFor({ timeout: 15000 });
await p.waitForFunction(() => /Keeping/.test(document.querySelector(".cd-note")?.textContent ?? ""), null, { timeout: 15000 });
// trim the first shot to roughly the first third: drag the end handle
const bar = await p.locator(".trimbar").boundingBox();
await p.mouse.move(bar.x + bar.width - 2, bar.y + bar.height / 2);
await p.mouse.down();
await p.mouse.move(bar.x + bar.width * 0.3, bar.y + bar.height / 2, { steps: 5 });
await p.mouse.up();
await p.getByRole("button", { name: "Next" }).click();
await p.getByRole("button", { name: "Oisin", exact: true }).click();
await p.locator(".cd-tile").first().click(); // shot
await p.locator(".cd-tile").first().click(); // result
if (await p.getByText("Which club?").count()) await p.getByRole("button", { name: "Skip", exact: true }).click();
await p.getByRole("button", { name: "Post the clip" }).click();
await p.getByText("Saved. Another shot in this clip?").waitFor({ timeout: 10000 });
ok(true, "after a long clip: 'Another shot in this clip?'");
await p.screenshot({ path: "/var/tmp/ospg/shots/multi-1-another.png" });
await p.getByRole("button", { name: "Cut another shot from this clip" }).click();
await p.locator(".trimbar .used").waitFor();
ok((await p.locator(".trimbar .used").count()) === 1, "the part already used is shaded");
await p.screenshot({ path: "/var/tmp/ospg/shots/multi-2-used.png" });
await p.getByRole("button", { name: "Next" }).click();
await p.getByRole("button", { name: "Neil" }).click();
await p.locator(".cd-tile").first().click();
await p.locator(".cd-tile").first().click();
if (await p.getByText("Which club?").count()) await p.getByRole("button", { name: "Skip", exact: true }).click();
await p.getByRole("button", { name: "Post the clip" }).click();
await p.getByText("Saved. Another shot in this clip?").waitFor();
await p.getByRole("button", { name: "Back to the scorecard" }).click();
await p.waitForURL(/\/score/, { timeout: 15000 });
let rows = [];
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(500);
  rows = sql(`select media_path||'|'||coalesce(trim_in::text,'-')||'|'||coalesce(trim_out::text,'-')||'|'||player_ids::text from posts where kind='video' order by created_at desc limit 2`).split("\n");
  if (Number(sql(`select count(*) from posts where kind='video'`)) >= before + 2) break;
}
console.log("     ", rows.join("  ||  "));
ok(Number(sql(`select count(*) from posts where kind='video'`)) === before + 2, "two posts, one per shot");
const paths = rows.map((r) => r.split("|")[0]);
ok(paths[0] === paths[1], "both point at the same uploaded file (uploaded once)");
ok(rows[0].split("|")[1] !== rows[1].split("|")[1], "each has its own trim");
ok(/neil/.test(rows[0]) && /oisin/.test(rows[1]), "each has its own player");
const files = execSync(`ls /var/tmp/ospg/files/media/video/${T}/ 2>/dev/null | grep -c webm$ || true`).toString().trim();
console.log("      files in storage:", files);
await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
