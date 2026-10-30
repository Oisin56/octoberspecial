// The grid: the writing test in the console (a piece written both ways, A and B, picked blind), the switch, the fact
// check on a real piece (one line put right, one left out), the Fact check panel on Health, a film script both ways,
// and the screens on a laptop and a phone.
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
const prompts = () =>
  fs
    .readdirSync("/var/tmp/ospg")
    .filter((f) => /^prompt-\d+\.txt$/.test(f))
    .map((f) => ({ n: Number(f.match(/\d+/)[0]), text: fs.readFileSync(`/var/tmp/ospg/${f}`, "utf8") }))
    .sort((a, b) => a.n - b.n);
const since = (n) => prompts().filter((p) => p.n > n);
const lastN = () => prompts().at(-1)?.n ?? 0;
try {
  fs.unlinkSync("/var/tmp/ospg/factchecks.log");
} catch {}
// Prompts from earlier runs (the stand-in numbers them from 1 each time it starts)
for (const f of fs.readdirSync("/var/tmp/ospg").filter((x) => /^prompt-\d+\.txt$/.test(x))) fs.unlinkSync(`/var/tmp/ospg/${f}`);

// ================================================================ the owner, in the console
const owner = agent();
await signInWithEmail(owner, "owner@test.ie");
await owner("/api/owner", { action: "sendCode" });
await owner("/api/owner", { action: "code", code: codeOf(await lastMailTo("owner@test.ie")) });
ok((await view(owner, "me")).j.user?.role === "owner", "the owner is in the console");

let r = await view(owner, "writing");
ok(r.status === 200 && r.j.on === false, "the new writer starts switched off");
ok(r.j.sources[0]?.id === "made-up:every" && r.j.sources.length >= 4, `rounds to write about: the made-up ones and the site's (${r.j.sources.length})`);
const real = r.j.sources.find((s) => s.id.startsWith("round:"));
ok(!!real, `a real round: ${real?.label}`);

// ---- a report on the made-up round, both ways
let mark = lastN();
r = await owner("/api/console", { action: "writing.run", source: "made-up:every", kind: "report" });
ok(r.status === 200 && !!r.j.id, `written both ways (${r.status} ${r.j.error ?? ""})`);
let ps = since(mark).map((p) => p.text);
const gridP = ps.find((t) => t.includes("THE GRID, ROUND 1"));
const oldP = ps.find((t) => t.includes("HOLE-BY-HOLE") && t.includes("Write the REPORT"));
ok(!!gridP && !!oldP, "one writer got the grid, the other today's scorecard");
ok(gridP && /THE MOMENTS WORTH TELLING[\s\S]*1\. \[decided it\] Neil beat Paddy 1 up on the last/.test(gridP), "the grid writer gets the moments, best first");
ok(gridP && /SHAPE: Won on the last\. Open with the scene on the last tee/.test(gridP), "and the running order for a round won on the last");
ok(gridP && /Length: 500–650 words/.test(gridP) && /most holes in detail/.test(gridP), "and the full length, since it was told in detail");
ok(gridP && /RULES FOR THE GRID/.test(gridP) && /"a round to remember"/.test(gridP), "and the guard rails, with the tired phrases");
ok(gridP && /fairways: \d+ of the 14 told/.test(gridP) && !/\d+%/.test(gridP.split("TASK")[0]), "figures say what they're out of, never a percentage");
const checks = fs.readFileSync("/var/tmp/ospg/factchecks.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(checks.length >= 2, `both first drafts were fact-checked (${checks.length})`);

r = await view(owner, "writing");
let t0 = r.j.tests[0];
ok(t0.id && t0.a.title && t0.b.title && t0.reveal === null, "A and B, with which is which hidden");
r = await owner("/api/console", { action: "writing.pick", id: t0.id, pick: "a", note: "B got the 17th wrong" });
ok(r.status === 200, "a pick is saved");
r = await view(owner, "writing");
t0 = r.j.tests.find((t) => t.id === t0.id);
ok(["a", "b"].includes(t0.reveal?.newIs) && t0.note === "B got the 17th wrong", `once picked, which was which (A was ${t0.reveal?.newIs === "a" ? "new" : "today's"})`);
const sum = r.j.summary.find((x) => x.kind === "report");
ok(sum?.tests === 1 && sum.picked === 1 && sum.newBetter + sum.oldBetter === 1, "So far: one report, read and picked");

// ---- a bulletin about the round's biggest moment, and a review of a round told by scores only
mark = lastN();
r = await owner("/api/console", { action: "writing.run", source: "made-up:every", kind: "bulletin" });
ok(r.status === 200, "a bulletin both ways");
ps = since(mark).map((p) => p.text);
ok(ps.some((t) => /What just happened: Neil beat Paddy 1 up on the last/.test(t) && /THE GRID/.test(t)) && ps.some((t) => /What just happened: Neil beat Paddy/.test(t) && !/THE GRID/.test(t)), "both told what just happened: the round's biggest moment");
mark = lastN();
r = await owner("/api/console", { action: "writing.run", source: "made-up:scores", kind: "tournament" });
ok(r.status === 200, "a review of a round told by scores only");
ps = since(mark).map((p) => p.text);
ok(ps.some((t) => /How much was told: scores only/.test(t) && /Length: 300–420 words/.test(t)), "short and crisp, with nothing to pad it");
ok(ps.some((t) => /THE MOMENTS OF THE TRIP/.test(t) && /call-back\] Before the trip Neil said/.test(t)), "the review calls back the pre-trip quote");

// ---- a real round
r = await owner("/api/console", { action: "writing.run", source: real.id, kind: "report" });
ok(r.status === 200, `a report on a real round, both ways (${r.j.error ?? "ok"})`);

// ================================================================ the switch, and the fact check on a real piece
r = await owner("/api/console", { action: "writing.switch", on: true });
ok(r.status === 200 && (await view(owner, "writing")).j.on === true, "switched on for everyone");
ok(sql(`select count(*) from activity where action='writing.on'`) === "1", "and that's in the activity record");

// The site owner opens the tournament, as its organiser
await owner("/api/owner", { action: "open", id: tid });
const adm = owner;
const r1 = sql(`select id from rounds where tournament_id='${tid}' and number=1`);
mark = lastN();
r = await adm("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r1, extra: "FACTTEST" });
const piece = r.j.piece;
ok(r.status === 200 && !!piece?.id, `the organiser's report, the new way (${r.status} ${r.j.error ?? ""})`);
ok(since(mark).some((p) => p.text.includes("THE GRID, ROUND 1")), "written from the grid");
ok(piece && /Neil holed a 40-footer on the 3rd\./.test(piece.body) && !/WRONGFACT/.test(piece.body), "a line that didn't match was put right on the retry");
ok(piece && !/STUBBORN|eagle on the 9th/.test(piece.body) && /Second paragraph with more detail\./.test(piece.body), "a line still wrong after the retry was left out, the rest kept");
const fc = sql(`select what||'|'||checked||'|'||first_problems||'|'||fixed||'|'||dropped from fact_checks where ref_id='${piece?.id}'`);
ok(/^piece\|\d+\|2\|1\|1$/.test(fc), `the check is written down: ${fc}`);
ok(sql(`select storylines::text from ai_pieces where id='${piece?.id}'`).includes("Neil's driver"), "the piece leaves its storylines for the next one");
await adm("/api/admin", { t: T, action: "aiUpdate", id: piece?.id, status: "published" });
mark = lastN();
r = await adm("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r1 });
const nextP = since(mark).find((p) => p.text.includes("THE GRID, ROUND 1"))?.text ?? "";
ok(/THE STORY SO FAR[^\n]*\n(From .*\n)*From the report, Round 1: Neil's driver; Paddy's lead let slip/.test(nextP), "the next piece picks up the threads the first one left");
ok(/HOW EARLIER PIECES OPENED[^\n]*\n(- .*\n)*- First paragraph of the [a-z]+\.\n/.test(nextP), "and is told how the first one opened, so it opens differently");

r = await view(owner, "health");
const f = r.j.factCheck;
ok(f && f.pieces >= 1 && f.dropped >= 1 && f.fixed >= 1, `Health: the Fact check panel counts (${f?.pieces} pieces, ${f?.fixed} fixed, ${f?.dropped} left out)`);
ok(f?.list?.some((l) => /STUBBORN/.test(l.text) && l.why && l.tournament && l.piece), "and lists the line left out: the sentence, why, the trip and the piece");
ok(f?.amber === true, "more than one line in twenty left out: it turns amber");
ok(!sql(`select string_agg(what, ',') from fact_checks`).includes("test") || f.pieces === Number(sql(`select count(*) from fact_checks where what='piece'`)), "the writing test's checks aren't counted there");

// ---- a film script both ways (when the site has a round with clips)
r = await view(owner, "writing");
const filmSrc = r.j.sources.find((s) => s.film);
if (filmSrc) {
  mark = lastN();
  r = await owner("/api/console", { action: "writing.run", source: filmSrc.id, kind: "film" });
  ok(r.status === 200, `a film script both ways (${r.j.error ?? "ok"})`);
  ps = since(mark).map((p) => p.text);
  ok(ps.some((t) => /AVAILABLE CLIPS \(JSON\)\. seconds = clip length; card = /.test(t)) && ps.some((t) => /holeLog is how the player/.test(t)), "one director got clip cards, the other today's facts");
  ok(ps.some((t) => /THE SENTENCES\n1\. \[over the title card\]/.test(t) && /\[clip of Round \d+, hole \d+, setup, said before the result\]/.test(t) && /THE GRID FOR THE FILMED HOLES/.test(t)), "the new script was checked line by line against the grid before any voice");
} else ok(true, "(no round with clips on this site: film script skipped)");

// ================================================================ off again: today's writer
await owner("/api/console", { action: "writing.switch", on: false });
mark = lastN();
const before = sql(`select count(*) from fact_checks where what='piece'`);
r = await adm("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: r1 });
ok(r.status === 200 && since(mark).some((p) => p.text.includes("HOLE-BY-HOLE")) && !since(mark).some((p) => p.text.includes("THE GRID")), "switched off: today's writer again");
ok(sql(`select count(*) from fact_checks where what='piece'`) === before, "and no check");

// ================================================================ the screens
const browser = await chromium.launch();
for (const [w, h, tag] of [
  [1280, 900, "laptop"],
  [390, 844, "phone"],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "os_session", value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/console/writing`, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Write one both ways");
  if (tag === "phone") {
    await p.selectOption("#w-src", "made-up:some");
    await p.click("text=Write both");
    await p.waitForSelector("[role=status]", { state: "detached", timeout: 60000 });
    await p.waitForSelector("text=Which reads more like a real report", { timeout: 10000 });
    ok((await p.locator("#w-ab").textContent()).includes("tee shots only"), "phone: the one just written is open");
    ok(await p.isVisible("text=Version A") || (await p.locator("article[aria-label='Version A']").count()) === 1, "phone: A and B to read");
    await p.click("text=B reads better");
    await p.fill("#w-note", "Both fine");
    await p.click("text=Save my pick");
    await p.waitForSelector("text=You picked B", { timeout: 15000 });
    ok(true, "phone: picked B and saved");
  }
  let wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!wide, `${tag} writing: nothing wider than the screen`);
  await p.screenshot({ path: `${SHOTS}/writing-${tag}.png`, fullPage: true });
  await p.goto(`${BASE}/console/health`, { waitUntil: "networkidle" });
  await p.waitForSelector("text=Fact check");
  wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!wide, `${tag} health: nothing wider than the screen`);
  const panel = p.locator("section[aria-labelledby='h-facts']");
  await panel.screenshot({ path: `${SHOTS}/factcheck-${tag}.png` });
  ok((await panel.textContent()).includes("Lines left out"), `${tag}: the Fact check panel`);
  await ctx.close();
}
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
