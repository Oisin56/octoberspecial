// Cards: concession, submit, signing, flags, organiser override and the change log. Run after fresh + e2e.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
async function setScore(pg, who, n) {
  const s = pg.locator(".pscore.entry", { hasText: who }).locator(".score-step");
  for (let i = 0; i < 20; i++) {
    const v = await s.getAttribute("data-value");
    const par = Number(await s.getAttribute("data-par"));
    const cur = v === "" ? null : Number(v);
    if (cur === n) return;
    if (cur === null && n === par) await s.locator(".ss-val").click();
    else await s.locator((cur ?? par) < n ? ".ss-plus" : ".ss-minus").click();
  }
  throw new Error(`couldn't set ${who} to ${n}`);
}
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const tid = sql(`select id from tournaments where slug='${T}'`);
const r5 = sql(`select id from rounds where tournament_id='${tid}' and number=5`);
const org = agent(), neil = agent();
await org("/api/login", { mode: "organiser", pin: "1234" });
{
  // Neil signs in with his own link ("I'm Neil")
  const u = (await org("/api/admin", { action: "playerLink", playerId: "neil", reset: true })).j.url;
  await neil("/api/login", { mode: "link", code: u.split("/in/")[1], step: "confirm" });
}
const pars = JSON.parse(sql(`select holes::text from rounds where id='${r5}'`)).map((h) => h.par);

// --- concession in the engine and API
ok((await org("/api/admin", { action: "updateTournament", patch: { require_attestation: true } })).status === 200, "organiser turns on signing");
for (let h = 1; h <= 14; h++) {
  const body = { roundId: r5, game: "main", hole: h, scores: { oisin: { gross: pars[h - 1] - (h <= 4 && h !== 2 ? 1 : 0) }, neil: { gross: pars[h - 1] } } };
  if (h === 2) Object.assign(body, { scores: { oisin: { gross: pars[1] }, neil: { gross: null, pickedUp: true } }, conceded: "neil" });
  const r = await org("/api/score", body);
  if (r.status !== 200) ok(false, `hole ${h} saved (${JSON.stringify(r.j)})`);
}
ok(sql(`select conceded from hole_entries where round_id='${r5}' and hole=2`) === "neil", "concession saved on hole 2");
ok((await org("/api/score", { roundId: r5, game: "main", hole: 3, scores: { oisin: { gross: 3 }, neil: { gross: 4 } }, conceded: "nobody" })).status === 200 && sql(`select coalesce(conceded,'-') from hole_entries where round_id='${r5}' and hole=3`) === "-", "an unknown side can't concede");
ok((await org("/api/cards", { action: "submit", roundId: r5, game: "main" })).status === 400, "can't submit before the match is over");

// --- the phone: concede on screen, then finish the match and submit
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addCookies([{ name: "os_session", value: org.cookie().split("=").slice(1).join("="), url: BASE }]);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.goto(`${BASE}/t/${T}/score?round=5`, { waitUntil: "networkidle" });
await p.locator(".hole-pick .n").waitFor();
ok((await p.locator(".hole-pick .n").innerText()).trim() === "15", "opens at the first hole not entered (15)");
const neilConcede = p.locator(".pscore", { hasText: "Neil" }).getByRole("button", { name: "Neil concedes the hole" });
await neilConcede.tap();
await p.getByText("Neil concedes. Oisin wins the hole").waitFor();
ok((await neilConcede.getAttribute("aria-pressed")) === "true", "Neil concedes hole 15 with one tap");
await p.screenshot({ path: "/var/tmp/ospg/shots/card-1-concede.png" });
await neilConcede.tap(); // undo
ok((await p.getByText("Neil concedes").count()) === 0, "tap again to undo the concession");
// halve 15: Oisin 4 up with 3 to play (one tap each on par)
for (const who of ["Oisin", "Neil"]) await setScore(p, who, pars[14]);
await p.getByText("Hole halved").waitFor();
await p.locator(".after-hole .btn", { hasText: "Hand in the card" }).waitFor({ timeout: 8000 });
ok(true, "the match is over: the right-hand button says Hand in the card");
await p.screenshot({ path: "/var/tmp/ospg/shots/card-2-over.png" });
await p.locator(".after-hole .btn", { hasText: "Hand in the card" }).tap();
await p.locator(".cp").waitFor();
ok(/won 4&3/.test(await p.locator(".cp-result").innerText()), `card shows the result (${await p.locator(".cp-result").innerText()})`);
ok(/Provisional/.test(await p.locator(".cp-stage").innerText()), "provisional until submitted");
ok((await p.locator(".cp-card .sc", { hasText: "C" }).count()) === 1, "conceded hole marked C on the card");
await p.waitForTimeout(300);
await p.screenshot({ path: "/var/tmp/ospg/shots/card-3-review.png", fullPage: true });
await p.locator(".cp-foot").getByRole("button", { name: "Hand in the card" }).tap();
await p.waitForTimeout(400);
await p.screenshot({ path: "/var/tmp/ospg/shots/card-4-confirm.png" });
await p.locator(".sf-sheet").getByRole("button", { name: "Hand in the card" }).tap();
await p.locator(".cp-signer").first().waitFor();
ok((await p.locator(".cp-signer.done", { hasText: "Oisin" }).count()) === 1, "handing it in signs it for whoever handed it in");
await p.screenshot({ path: "/var/tmp/ospg/shots/card-5-signing.png" });

// Neil's phone shows the prompt
const np = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await np.context().addCookies([{ name: "os_session", value: neil.cookie().split("=").slice(1).join("="), url: BASE }]);
await np.goto(`${BASE}/t/${T}/`, { waitUntil: "networkidle" });
await np.locator(".sign-prompt").waitFor({ timeout: 8000 });
ok(true, "Neil sees 'Your card is ready for you to sign' on his own phone");

// Pass the phone: Neil signs on the scorer's phone with a tap (no PIN)
await p.locator(".cp-signer", { hasText: "Neil" }).getByRole("button", { name: "Sign" }).tap();
ok((await p.locator(".cp-pin").count()) === 0, "no PIN to type on the scorer's phone");
await p.waitForTimeout(300);
await p.screenshot({ path: "/var/tmp/ospg/shots/card-6-sign.png" });
await p.getByRole("button", { name: "Sign for Neil" }).tap();
await p.locator(".cp-stage.final").waitFor({ timeout: 8000 });
ok(/Final, signed by Oisin and Neil/.test(await p.locator(".cp-stage").innerText()), "everyone signed: final");
await p.screenshot({ path: "/var/tmp/ospg/shots/card-7-final.png" });
ok(sql(`select status from cards where round_id='${r5}'`) === "final", "card final in the database");

// --- after final: the organiser's change is logged and the card marked amended
const ch = await org("/api/score", { roundId: r5, game: "main", hole: 5, scores: { oisin: { gross: pars[4] }, neil: { gross: pars[4] + 1 } } });
ok(ch.status === 200, "organiser can still change a final card");
ok(sql(`select amended from cards where round_id='${r5}'`) === "t", "card marked amended");
ok(Number(sql(`select count(*) from score_changes where round_id='${r5}'`)) === 1, "the change is logged");
const log = await org("/api/admin", { action: "scoreChanges" });
ok(log.j.changes?.[0]?.hole === 5, "change log readable by the organiser");
ok((await fetch(`http://127.0.0.1:54321/rest/v1/score_changes?select=id`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } }).then((r) => r.json()).then((j) => Array.isArray(j) && j.length > 0)) === false, "the public can't read the change log");

// --- reopen, submit again, Neil says something's wrong, a change clears the signatures
ok((await neil("/api/cards", { action: "reopen", roundId: r5, game: "main" })).status === 403, "a player can't reopen a final card");
ok((await org("/api/cards", { action: "reopen", roundId: r5, game: "main" })).j.stage === "finished", "organiser reopens");
await org("/api/cards", { action: "submit", roundId: r5, game: "main" });
const fl = await neil("/api/cards", { action: "flag", roundId: r5, game: "main", playerId: "neil", note: "I had a 5 on the 7th" });
ok(fl.status === 200 && sql(`select flag_by from cards where round_id='${r5}'`) === "Neil", "Neil flags the card from his own phone");
await p.goto(`${BASE}/t/${T}/score?round=5`, { waitUntil: "networkidle" });
await p.locator(".cp-flag").waitFor();
ok(/I had a 5 on the 7th/.test(await p.locator(".cp-flag").innerText()), "the scorer sees what's wrong");
await p.screenshot({ path: "/var/tmp/ospg/shots/card-8-flag.png" });
await p.getByRole("button", { name: "Fix the card" }).tap();
await p.locator(".hole-pick").waitFor();
ok(sql(`select count(*) from cards where round_id='${r5}'`) === "0" && sql(`select count(*) from card_signatures where round_id='${r5}'`) === "0", "taking the card back clears it and the signatures");

// --- organiser makes it final without every signature
await org("/api/cards", { action: "submit", roundId: r5, game: "main" });
ok((await neil("/api/cards", { action: "finalise", roundId: r5, game: "main" })).status === 403, "only the organiser can skip the signatures");
ok((await org("/api/cards", { action: "finalise", roundId: r5, game: "main" })).j.stage === "final", "organiser makes it final");
await sleep(1500);
ok(sql(`select status from rounds where id='${r5}'`) === "complete", "every card final: round complete");

// admin view
await p.goto(`${BASE}/t/${T}/admin#cards`, { waitUntil: "networkidle" });
await p.getByText("Score corrections").waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: "/var/tmp/ospg/shots/card-9-admin.png", fullPage: true });
await org("/api/admin", { action: "updateTournament", patch: { require_attestation: false } });
await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
