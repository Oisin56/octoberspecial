// The grid: every piece written from it (the grid, the figures, the moments, the running order), the fact check on a
// real piece (one line put right, one left out), the storylines a piece leaves for the next, and the Fact check panel
// on the console's Health page, on a laptop and a phone.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { BASE, agent, codeOf, lastMailTo, signInWithEmail } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const SHOTS = "/var/tmp/ospg/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const T = "october-special-2026";
const tid = sql(`select id from tournaments where slug='${T}'`);
const view = async (a, v, p = {}) => {
  const r = await fetch(`${BASE}/api/console?${new URLSearchParams({ view: v, ...p })}`, { headers: { cookie: a.cookie(), "x-console": "1" } });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
// Prompts from earlier runs (the stand-in numbers them from 1 each time it starts)
for (const f of fs.readdirSync("/var/tmp/ospg").filter((x) => /^(prompt|check)-\d+\.txt$/.test(x))) fs.unlinkSync(`/var/tmp/ospg/${f}`);
const prompts = () =>
  fs
    .readdirSync("/var/tmp/ospg")
    .filter((f) => /^prompt-\d+\.txt$/.test(f))
    .map((f) => ({ n: Number(f.match(/\d+/)[0]), text: fs.readFileSync(`/var/tmp/ospg/${f}`, "utf8") }))
    .sort((a, b) => a.n - b.n);
const lastN = () => prompts().at(-1)?.n ?? 0;
const since = (n) => prompts().filter((p) => p.n > n);

// ================================================================ the site owner, in the console and the tournament
const owner = agent();
await signInWithEmail(owner, "owner@test.ie");
await owner("/api/owner", { action: "sendCode" });
await owner("/api/owner", { action: "code", code: codeOf(await lastMailTo("owner@test.ie")) });
ok((await view(owner, "me")).j.user?.role === "owner", "the owner is in the console");
await owner("/api/owner", { action: "open", id: tid });
const r1 = sql(`select id from rounds where tournament_id='${tid}' and number=1`);

// ================================================================ a report, from the grid
let mark = lastN();
let r = await owner("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r1, extra: "FACTTEST" });
const piece = r.j.piece;
ok(r.status === 200 && !!piece?.id, `the report is written (${r.status} ${r.j.error ?? ""})`);
const p1 = since(mark).find((p) => p.text.includes("THE GRID, ROUND 1"))?.text ?? "";
ok(!!p1, "from the grid");
ok(/THE FIGURES \(worked out by the app/.test(p1) && /THE MOMENTS WORTH TELLING/.test(p1), "with the figures and the moments");
ok(/SHAPE: [A-Z][a-z ]+\. Open with/.test(p1) && /Length: /.test(p1) && /How much was told: /.test(p1), "a running order, and a length from how much was told");
ok(/RULES FOR THE GRID/.test(p1) && /"a round to remember"/.test(p1), "and the guard rails, with the tired phrases");
ok(!/HOLE-BY-HOLE|SHOTS LOGGED ON THE COURSE/.test(p1), "and nothing of today's writer: one way only");

// ---- the fact check: one line put right, one left out
ok(piece && /Neil holed a 40-footer on the 3rd\./.test(piece.body) && !/WRONGFACT/.test(piece.body), "a line that didn't match was put right on the retry");
ok(piece && !/STUBBORN|eagle on the 9th/.test(piece.body) && /Second paragraph with more detail\./.test(piece.body), "a line still wrong after the retry was left out, the rest kept");
const fc = sql(`select what||'|'||checked||'|'||first_problems||'|'||fixed||'|'||dropped from fact_checks where ref_id='${piece?.id}'`);
ok(/^piece\|\d+\|2\|1\|1$/.test(fc), `the check is written down: ${fc}`);
ok(sql(`select storylines::text from ai_pieces where id='${piece?.id}'`).includes("Neil's driver"), "the piece leaves its storylines for the next one");

// ---- the next piece picks up the threads
const checksBefore = Number(sql(`select count(*) from fact_checks where what='piece'`));
await owner("/api/admin", { t: T, action: "aiUpdate", id: piece?.id, status: "published" });
mark = lastN();
r = await owner("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r1 });
const p2 = since(mark).find((p) => p.text.includes("THE GRID, ROUND 1"))?.text ?? "";
ok(/THE STORY SO FAR[^\n]*\n(From .*\n)*From the report, Round 1: Neil's driver; Paddy's lead let slip/.test(p2), "the next piece picks up the threads the first one left");
ok(/HOW EARLIER PIECES OPENED[^\n]*\n(- .*\n)*- First paragraph of the [a-z]+\.\n/.test(p2), "and is told how the first one opened, so it opens differently");
ok(r.status === 200 && Number(sql(`select count(*) from fact_checks where what='piece'`)) === checksBefore + 1, "every piece is checked");

// ---- a bulletin: about the hole just played
mark = lastN();
r = await owner("/api/admin", { t: T, action: "aiGenerate", kind: "bulletin", roundId: r1 });
ok(r.status === 200 && since(mark).some((p) => /Write a LIVE BULLETIN/.test(p.text) && /THE GRID, ROUND 1/.test(p.text)), "a bulletin is written from the grid too");

// ================================================================ the Fact check panel
r = await view(owner, "health");
const f = r.j.factCheck;
ok(f && f.pieces >= 3 && f.dropped >= 1 && f.fixed >= 1, `Health: the Fact check panel counts (${f?.pieces} pieces, ${f?.fixed} fixed, ${f?.dropped} left out)`);
ok(f?.list?.some((l) => /STUBBORN/.test(l.text) && l.why && l.tournament && l.piece), "and lists the line left out: the sentence, why, the trip and the piece");
ok(f?.amber === f.dropped * 20 > f.lines, `amber only when more than one line in twenty is left out (${f?.dropped} of ${f?.lines}: ${f?.amber ? "amber" : "calm"})`);
sql(`update fact_checks set dropped = 5, checked = 6 where ref_id='${piece?.id}'`);
ok((await view(owner, "health")).j.factCheck?.amber === true, "and it turns amber when it is");
ok((await view(owner, "writing")).status === 400, "no writing switch or test page: one writer, always on");

const browser = await chromium.launch();
for (const [w, h, tag] of [
  [1280, 900, "laptop"],
  [390, 844, "phone"],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "os_session", value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/console/health`, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Fact check");
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!wide, `${tag} health: nothing wider than the screen`);
  const panel = p.locator("section[aria-labelledby='h-facts']");
  await panel.screenshot({ path: `${SHOTS}/factcheck-${tag}.png` });
  ok((await panel.textContent()).includes("Lines left out"), `${tag}: the Fact check panel`);
  ok((await p.locator("nav >> text=Writing").count()) === 0, `${tag}: no Writing page in the menu`);
  await ctx.close();
}
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
