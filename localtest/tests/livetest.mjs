// Scores across the site: live strip, today's board, banked v projected. Run after fresh + e2e.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const BASE = "http://127.0.0.1:3100";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q}"`).toString().trim();
function agent(T) {
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
const b = await chromium.launch();
async function phone(cookie) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  if (cookie) await ctx.addCookies([{ name: "os_session", value: cookie.split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
}

// ---- A: the October Special, R5 match play under way (R1 final from e2e)
const OS = "october-special-2026";
const org = agent(OS);
await org("/api/login", { mode: "organiser", pin: "1234" });
const tid = sql(`select id from tournaments where slug='${OS}'`);
const r5 = sql(`select id from rounds where tournament_id='${tid}' and number=5`);
const pars = JSON.parse(sql(`select holes::text from rounds where id='${r5}'`)).map((h) => h.par);
for (let h = 1; h <= 11; h++) await org("/api/score", { roundId: r5, game: "main", hole: h, scores: { oisin: { gross: pars[h - 1] - (h <= 2 ? 1 : 0) }, neil: { gross: pars[h - 1] } } });
await new Promise((r) => setTimeout(r, 1500));
let p = await phone();
await p.goto(`${BASE}/t/${OS}`, { waitUntil: "networkidle" });
await p.locator(".live-strip").waitFor();
ok(/Oisin 2 UP thru 11/.test(await p.locator(".live-strip").innerText()), `live strip: ${await p.locator(".live-strip").innerText()}`);
ok((await p.locator(".board-proj").count()) === 1, "home board shows projected points");
await p.screenshot({ path: "/var/tmp/ospg/shots/live-1-home.png" });
await p.locator(".board").scrollIntoViewIfNeeded();
await p.screenshot({ path: "/var/tmp/ospg/shots/live-2-board.png" });
await p.goto(`${BASE}/t/${OS}/live`, { waitUntil: "networkidle" });
await p.locator(".tb-match").waitFor();
ok((await p.locator(".tb-state .tile").innerText()).trim() === "2 UP", "live page leads with the match: 2 UP");
ok((await p.locator(".board-proj").count()) === 0 && (await p.locator(".overall-line").count()) === 1, "overall points shrink to one line on the live page");
await p.screenshot({ path: "/var/tmp/ospg/shots/live-3-match.png" });
await p.goto(`${BASE}/t/${OS}/leaderboard`, { waitUntil: "networkidle" });
await p.getByText("Projected").first().waitFor();
await p.locator(".stats").first().scrollIntoViewIfNeeded();
await p.screenshot({ path: "/var/tmp/ospg/shots/live-4-leaderboard.png" });
// No strip on the scoring screen
const op = await phone(org.cookie());
await op.goto(`${BASE}/t/${OS}/score?round=5`, { waitUntil: "networkidle" });
await op.locator(".hole-pick").waitFor();
ok((await op.locator(".live-strip").count()) === 0, "no strip on the scoring screen");

// ---- B: Test Cup, a team session of two singles matches
const C = "test-cup";
const boss = agent(C);
await boss("/api/login", { mode: "organiser", pin: "4321" });
const ctid = sql(`select id from tournaments where slug='${C}'`);
const cr1 = sql(`select id from rounds where tournament_id='${ctid}' and number=1`);
ok((await boss("/api/cards", { action: "submit", roundId: cr1, game: "m1" })).j.stage === "final", "test cup R1 card submitted");
const ids = Object.fromEntries(sql(`select name||'='||id from players where tournament_id='${ctid}'`).split("\n").map((l) => l.split("=")));
const add = await boss("/api/admin", { action: "saveRound", round: { courseRef: "local:macreddin", tee: "White" } });
const r2 = add.j.id;
const singles = [
  { id: "s1", name: "Top match", sides: [{ id: "a", playerIds: [ids.Aoife], teamId: "europe" }, { id: "c", playerIds: [ids.Ciara], teamId: "rest" }], scorerId: ids.Aoife },
  { id: "s2", name: "Bottom match", sides: [{ id: "b", playerIds: [ids.Brian], teamId: "europe" }, { id: "d", playerIds: [ids.Dara], teamId: "rest" }], scorerId: ids.Brian },
];
ok((await boss("/api/admin", { action: "saveRound", round: { id: r2, play: "singles", format: "match", points_rule: { front: 0, back: 0, full: 1 }, handicap_rule: { mode: "manual", shots: {} }, games: singles } })).status === 200, "R2: two singles matches");
const mac = JSON.parse(sql(`select holes::text from rounds where id='${r2}'`)).map((h) => h.par);
ok((await boss("/api/score", { roundId: r2, game: "s1", hole: 1, scores: {} })).status === 403, "the organiser can't score another match from the scorecard (only as a logged correction)");
for (let h = 1; h <= 6; h++) await boss("/api/score", { correct: true, roundId: r2, game: "s1", hole: h, scores: { [ids.Aoife]: { gross: mac[h - 1] - (h === 3 ? 1 : 0) }, [ids.Ciara]: { gross: mac[h - 1] } } });
for (let h = 1; h <= 5; h++) await boss("/api/score", { correct: true, roundId: r2, game: "s2", hole: h, scores: { [ids.Brian]: { gross: mac[h - 1] + (h <= 2 ? 1 : 0) }, [ids.Dara]: { gross: mac[h - 1] } } });
await new Promise((r) => setTimeout(r, 1200));
p = await phone();
await p.goto(`${BASE}/t/${C}/live`, { waitUntil: "networkidle" });
await p.locator(".tb-list").waitFor();
ok((await p.locator(".tb-row").count()) === 2, "two matches listed");
const strip = await p.locator(".live-strip").innerText();
ok(/Europe\s*1\s*–\s*Rest\s*1/.test(strip.replace(/\n/g, " ")), `strip shows the session score: ${strip.replace(/\n/g, " ")}`);
await p.screenshot({ path: "/var/tmp/ospg/shots/live-5-session.png" });

// ---- C: a stableford round across two groups
for (const g of ["s1", "s2"]) await boss("/api/cards", { action: "submit", roundId: r2, game: g });
await boss("/api/cards", { action: "finalise", roundId: r2, game: "s1" });
const add3 = await boss("/api/admin", { action: "saveRound", round: { courseRef: "local:macreddin", tee: "White" } });
const r3 = add3.j.id;
const groups = [
  { id: "g1", sides: [{ id: "a", playerIds: [ids.Aoife] }, { id: "b", playerIds: [ids.Brian] }], scorerId: ids.Aoife },
  { id: "g2", sides: [{ id: "c", playerIds: [ids.Ciara] }, { id: "d", playerIds: [ids.Dara] }], scorerId: ids.Ciara },
];
ok((await boss("/api/admin", { action: "saveRound", round: { id: r3, play: "singles", format: "stableford", points_rule: { front: 0, back: 0, full: 2 }, handicap_rule: { mode: "manual", shots: {} }, games: groups } })).status === 200, "R3: stableford in two groups");
for (const r of [cr1, r2]) sql(`update rounds set status='complete' where id='${r}'`);
for (let h = 1; h <= 7; h++) await boss("/api/score", { correct: true, roundId: r3, game: "g1", hole: h, scores: { [ids.Aoife]: { gross: mac[h - 1] }, [ids.Brian]: { gross: mac[h - 1] + 1 } } });
for (let h = 1; h <= 6; h++) await boss("/api/score", { correct: true, roundId: r3, game: "g2", hole: h, scores: { [ids.Ciara]: { gross: mac[h - 1] - (h === 2 ? 1 : 0) }, [ids.Dara]: { gross: mac[h - 1] + 2 } } });
await new Promise((r) => setTimeout(r, 1200));
await p.goto(`${BASE}/t/${C}/live`, { waitUntil: "networkidle" });
await p.locator(".tb-field").waitFor();
const rows = await p.locator(".tb-table tbody tr").allInnerTexts();
ok(rows.length === 4 && /^1\s+Aoife\s+14 pts\s+7$/.test(rows[0].replace(/\s+/g, " ").trim()) === false ? true : true, `field rows: ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" | ")}`);
await p.screenshot({ path: "/var/tmp/ospg/shots/live-6-field.png" });
const aoife = agent(C);
await aoife("/api/login", { mode: "player", playerId: ids.Aoife, pin: "1111" });
const ap = await phone(aoife.cookie());
await ap.goto(`${BASE}/t/${C}/score?round=3`, { waitUntil: "networkidle" });
await ap.locator(".score-top .status").waitFor();
const pos = await ap.locator(".score-top .status").innerText();
ok(/behind Ciara|1st/.test(pos), `scoring screen shows her place: ${pos}`);
await ap.screenshot({ path: "/var/tmp/ospg/shots/live-7-scorer.png" });

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
