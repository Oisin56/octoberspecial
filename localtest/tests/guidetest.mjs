import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";
// fresh guides for rounds without scores (the seed is safe to rerun)
execSync("psql -h 127.0.0.1 -p 5433 -U postgres -q -f /home/claude/october-special/supabase/seed.sql");

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const H = { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` };
const rest = async (q) => (await fetch(`http://127.0.0.1:54321/rest/v1/${q}`, { headers: H })).json();
const latestPrompt = () => {
  const f = fs.readdirSync("/var/tmp/ospg").filter((x) => /^prompt-\d+\.txt$/.test(x)).sort((a, b) => fs.statSync(`/var/tmp/ospg/${b}`).mtimeMs - fs.statSync(`/var/tmp/ospg/${a}`).mtimeMs)[0];
  return fs.readFileSync(`/var/tmp/ospg/${f}`, "utf8");
};

let cookie = "";
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
await post("/api/login", { mode: "organiser", pin: "1234" });
const tid = (await rest(`public_tournaments?slug=eq.${T}&select=id`))[0].id;
const rounds = await rest(`rounds?tournament_id=eq.${tid}&select=id,number,course_guide&order=number`);
const r1 = rounds[0], r2 = rounds[1];

// --- the seed carries the researched guides
ok(rounds.slice(1).every((r) => r.course_guide?.overview), "rounds 2–7 have course guides from the seed");
ok(Object.keys(rounds[2].course_guide.holes).length === 18, "Macreddin has notes for all 18 holes");

// --- preview: the whole guide goes to the writer, with the rule
let r = await post("/api/admin", { action: "aiGenerate", kind: "preview", roundId: r2.id });
ok(r.status === 200, "preview written");
let p = latestPrompt();
ok(p.includes("COURSE GUIDE (background, not events)") && p.includes("Pebble Beach") && p.includes("Dunbur"), "preview prompt includes the Wicklow guide");
ok(/Never say a player hit a shot, found a hazard/.test(p), "writer told the guide is background, not events");
ok(/holes from the course guide likely to decide things/.test(p), "preview task asks for the holes likely to decide it");

// --- bulletin: only the hole just played and the next two (R1 has 18 holes in: falls back to the local Druids Heath guide)
r = await post("/api/admin", { action: "aiGenerate", kind: "bulletin", roundId: r1.id });
ok(r.status === 200, "bulletin written");
p = latestPrompt();
const notes = [...p.matchAll(/^- H(\d+) \(par/gm)].map((m) => +m[1]);
ok(notes.join() === "18", `bulletin after the 18th gets only that hole's note (got ${notes.join() || "none"})`);
ok(p.includes("Pat Ruddy"), "round 1 uses the Druids Heath guide even before the seed is rerun");

// --- report: full guide
r = await post("/api/admin", { action: "aiGenerate", kind: "report", roundId: r1.id });
p = latestPrompt();
ok([...p.matchAll(/^- H(\d+) \(par/gm)].length === 18 && p.includes("quarry hole"), "report gets all the Druids Heath hole notes");

// --- draft for a course with no guide
r = await post("/api/admin", { action: "draftGuide", roundId: r2.id });
ok(r.status === 200, "draft returned");
const req = JSON.parse(fs.readFileSync("/var/tmp/ospg/guide-req.json", "utf8"));
ok(req.tools?.[0]?.type === "web_search_20250305", "draft uses web search");
ok(r.j.guide?.holes?.["6"] === "Drive over the cliffs." && !r.j.guide.holes["19"] && !("7" in r.j.guide.holes), "draft cleaned (no hole 19, no empty notes)");
ok(r.j.sources?.join() === "https://example.com/course-guide", "only real links kept as sources");
ok((await rest(`rounds?id=eq.${r2.id}&select=course_guide`))[0].course_guide.overview.includes("Dunbur"), "drafting doesn't overwrite anything until saved");
const anon = await fetch(BASE + "/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: T, action: "draftGuide", roundId: r2.id }) });
ok(anon.status === 401 || anon.status === 403, "drafting is organiser-only");

// --- admin editor and public page
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await page.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /Rounds and courses/ }).click();
const card2 = page.locator("section").filter({ hasText: "Wicklow Golf Club" }).first();
await card2.getByRole("button", { name: /Edit/ }).first().click();
await card2.getByRole("button", { name: /Course guide for the AI writer \(5 hole notes\)/ }).click();
const h9 = card2.getByLabel("Hole 9 · par 3");
await h9.fill("Short par 3 to a green on the cliff edge (organiser's note).");
await page.screenshot({ path: "/var/tmp/ospg/shots/guide-admin.png", fullPage: false });
await card2.getByRole("button", { name: "Save round 2" }).click();
await page.waitForTimeout(1500);
const g2 = (await rest(`rounds?id=eq.${r2.id}&select=course_guide`))[0].course_guide;
ok(g2.holes["9"]?.includes("organiser's note") && g2.holes["6"]?.includes("Pebble Beach"), "organiser's edit saved alongside the researched notes");

// Draft button in the UI
page.once("dialog", (d) => d.accept());
await card2.getByRole("button", { name: "Draft it for me" }).click();
await card2.getByText(/Check it, then save the round/).waitFor({ timeout: 30000 });
ok((await card2.getByLabel("Hole 6 · par 4").inputValue()) === "Drive over the cliffs.", "draft fills the editor for checking");
ok((await card2.getByText("example.com").count()) === 1, "sources shown");

await page.goto(`${BASE}/t/${T}/rounds/1`, { waitUntil: "networkidle" });
await page.getByText("Course guide", { exact: true }).click();
ok((await page.getByText(/quarry hole/).count()) >= 1, "public round page shows the course guide");
await page.locator(".course-guide").screenshot({ path: "/var/tmp/ospg/shots/guide-public.png" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!overflow, "no sideways scrolling on a phone");

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
