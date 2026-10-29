// Four phones, one group: anyone in the group enters any score. Each phone saves only what it changed, so nobody
// wipes anyone else's; the others' scores show up on every phone; "by Neil" under a score someone else entered; the
// two buttons on every phone once the hole is in; picked up (the P tile); markers; no signal on one phone; Add detail
// on two phones at once; handing in the card and each player's one-tap check. Screenshots go to /var/tmp/ospg/shots.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium, devices } from "playwright";
import { BASE, agent, browserCookie, codeOf, mails, signInAsPlayer } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};
const SHOTS = "/var/tmp/ospg/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
const card9 = Array.from({ length: 9 }, (_, i) => ({ par: [4, 4, 3, 5, 4, 4, 3, 4, 5][i], si: i + 1 }));

// ---- a trip: four friends in one group, Stableford, playing today
const org = agent();
const email = "orla.group@example.ie";
const made = await org("/api/tournaments", {
  email,
  ownerPin: "1234",
  wizard: {
    who: "individuals",
    name: "Four Phones Open",
    win: "stableford",
    rounds: [{ courseName: "Seaview Links", manualCard: card9, holeSet: "all", format: "stableford", date: today }],
    players: [{ name: "Orla Organiser" }, { name: "Neil Byrne" }, { name: "Paddy Ward" }, { name: "Sean Kelly" }],
    organiserPlays: true,
    draw: "random",
    prizes: [],
    extras: { ai: true, feed: true, video: true },
    theme: "spring",
  },
});
ok(made.status === 200, `the trip is made (${made.status})`);
const slug = made.j.slug;
const m = await waitFor(() => mails().filter((x) => x.to.join().toLowerCase() === email && codeOf(x)).pop());
await org("/api/account", { action: "code", email, code: codeOf(m) });
const tid = sql(`select id from tournaments where slug='${slug}'`);
const rid = sql(`select id from rounds where tournament_id='${tid}' and number=1`);
const pid = (name) => sql(`select id from players where tournament_id='${tid}' and name='${name}'`);
const game = JSON.parse(sql(`select games::text from rounds where id='${rid}'`))[0];
ok(game.sides.length === 4, "one group of four");
sql(`update rounds set status='live' where id='${rid}'`);

const names = ["Orla Organiser", "Neil Byrne", "Paddy Ward", "Sean Kelly"];
const calls = { "Orla Organiser": org };
for (const n of names.slice(1)) {
  calls[n] = agent();
  await signInAsPlayer(org, calls[n], slug, pid(n));
}

// ---- four phones on the scorecard
const browser = await chromium.launch();
const phones = {};
for (const n of names) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addCookies([browserCookie(calls[n])]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/t/${slug}/score`);
  phones[n] = { ctx, page };
}
for (const n of names) await phones[n].page.getByRole("button", { name: /Hole 1\. Tap to choose/ }).waitFor({ timeout: 20000 });
ok(true, "all four phones open the scorecard (nobody had to be chosen as scorer)");
ok((await phones["Neil Byrne"].page.locator(".pscore.entry").count()) === 4, "Neil's phone can enter all four scores");

async function setScore(pg, who, n) {
  const s = pg.locator(".pscore.entry").filter({ has: pg.locator(".pname", { hasText: who }) }).locator(".score-step");
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
const refresh = (n) => phones[n].page.evaluate(() => window.dispatchEvent(new Event("focus")));
const entry = (h) => JSON.parse(sql(`select coalesce((select scores::text from hole_entries where round_id='${rid}' and hole=${h}), '{}')`));

// ---- hole 1: everyone does their own, all at once
const h1 = { "Orla Organiser": 5, "Neil Byrne": 3, "Paddy Ward": 4, "Sean Kelly": 6 };
await Promise.all(names.map((n) => setScore(phones[n].page, n.split(" ")[0], h1[n])));
const all4 = await waitFor(() => {
  const e = entry(1);
  return names.every((n) => e[pid(n)]?.gross === h1[n]) ? e : null;
});
ok(!!all4, "four phones at once: all four scores saved, none wiped");
ok(all4 && names.every((n) => all4[pid(n)]?.by === n), "each score says who entered it");
// Every phone shows the others' scores
await sleep(800);
for (const n of names) await refresh(n);
const seen = await waitFor(async () => {
  for (const n of names) {
    const vals = await phones[n].page.locator(".pscore.entry .score-step").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
    if (vals.some((v) => v === "")) return false;
  }
  return true;
}, 60);
ok(!!seen, "every phone shows all four scores");
const row = (pg, who) => pg.locator(".pscore.entry").filter({ has: pg.locator(".pname", { hasText: who }) });
const by = await row(phones["Orla Organiser"].page, "Neil").locator(".score-by").innerText().catch(() => "");
ok(by === "by Neil Byrne", `a score someone else entered says who (${by})`);
ok((await row(phones["Orla Organiser"].page, "Orla").locator(".score-by").count()) === 0, "your own doesn't");
for (const n of names) await phones[n].page.locator(".after-hole").waitFor({ timeout: 10000 });
ok(true, "the two buttons are on every phone once the hole is in");
const labels = await phones["Paddy Ward"].page.locator(".after-hole .btn").allInnerTexts();
ok(/Add detail\s*Neil birdie/.test(labels[0]) && /On to hole 2/.test(labels[1]), `a good hole changes only the label (${labels.map((l) => l.replace(/\n/g, " ")).join(" | ")})`);
await phones["Paddy Ward"].page.screenshot({ path: `${SHOTS}/group-after-hole.png` });

// ---- hole 2: markers (Neil enters Paddy's, Paddy enters Neil's), and Orla picks up
for (const n of names) await phones[n].page.locator(".after-hole .btn", { hasText: "On to hole 2" }).click();
for (const n of names) await phones[n].page.getByRole("button", { name: /Hole 2\. Tap to choose/ }).waitFor();
await Promise.all([setScore(phones["Neil Byrne"].page, "Paddy", 5), setScore(phones["Paddy Ward"].page, "Neil", 4)]);
const pTile = row(phones["Orla Organiser"].page, "Orla").locator(".pu-tile");
const pSize = await pTile.evaluate((e) => Math.round(e.getBoundingClientRect().height));
ok(pSize >= 60, `Stableford: picked up is a full-size P tile beside the score (${pSize}px)`);
await pTile.click();
await setScore(phones["Sean Kelly"].page, "Sean", 4);
const h2 = await waitFor(() => {
  const e = entry(2);
  return e[pid("Paddy Ward")]?.gross === 5 && e[pid("Neil Byrne")]?.gross === 4 && e[pid("Orla Organiser")]?.pickedUp && e[pid("Sean Kelly")]?.gross === 4 ? e : null;
});
ok(!!h2, "markers and a pick-up: all four in, Paddy's entered by Neil and Neil's by Paddy");
if (!h2) console.log("     hole 2:", JSON.stringify(entry(2)));
ok(h2 && h2[pid("Paddy Ward")].by === "Neil Byrne" && h2[pid("Neil Byrne")].by === "Paddy Ward", "and each says who entered it");
// (No live updates in this test set-up: the phone looks again, as it does when it's brought back to the front)
await refresh("Orla Organiser");
await phones["Orla Organiser"].page.locator(".after-hole").waitFor({ timeout: 10000 });
ok((await phones["Orla Organiser"].page.locator(".gave-up-row", { hasText: "Picked up" }).count()) === 1, "Orla's score shows as picked up");

// ---- two phones change the same score: the later one stands, nothing else changes
await refresh("Sean Kelly");
await sleep(1500);
await setScore(phones["Sean Kelly"].page, "Paddy", 6);
await sleep(1500);
await refresh("Neil Byrne");
await sleep(1500);
await setScore(phones["Neil Byrne"].page, "Paddy", 7);
const later = await waitFor(() => (entry(2)[pid("Paddy Ward")]?.gross === 7 ? entry(2) : null));
ok(!!later && later[pid("Neil Byrne")].gross === 4 && later[pid("Sean Kelly")].gross === 4 && later[pid("Orla Organiser")].pickedUp, "two phones change Paddy's: the later stands, everyone else's untouched");
ok(Number(sql(`select count(*) from score_changes where round_id='${rid}'`)) === 0, "(ordinary changes during the round aren't corrections)");

// ---- no signal on one phone: its score waits, then lands without wiping the others'
for (const n of names) await refresh(n);
for (const n of names) await phones[n].page.locator(".after-hole .btn", { hasText: "On to hole 3" }).click({ timeout: 15000 });
for (const n of names) await phones[n].page.getByRole("button", { name: /Hole 3\. Tap to choose/ }).waitFor();
await phones["Sean Kelly"].ctx.setOffline(true);
await setScore(phones["Sean Kelly"].page, "Sean", 3);
await phones["Sean Kelly"].page.getByText(/Saved on this phone/).waitFor({ timeout: 10000 });
await Promise.all(["Orla Organiser", "Neil Byrne", "Paddy Ward"].map((n) => setScore(phones[n].page, n.split(" ")[0], 3)));
await waitFor(() => ["Orla Organiser", "Neil Byrne", "Paddy Ward"].every((n) => entry(3)[pid(n)]?.gross === 3));
await phones["Sean Kelly"].ctx.setOffline(false);
await phones["Sean Kelly"].page.evaluate(() => window.dispatchEvent(new Event("online")));
const h3 = await waitFor(() => (names.every((n) => entry(3)[pid(n)]?.gross === 3) ? entry(3) : null));
ok(!!h3, "a phone with no signal sends its score when it's back, and the other three are still there");

// ---- Add detail on two phones at once, different players
await refresh("Neil Byrne");
await phones["Neil Byrne"].page.locator(".after-hole").waitFor({ timeout: 15000 });
await refresh("Paddy Ward");
await phones["Paddy Ward"].page.locator(".after-hole").waitFor({ timeout: 15000 });
await phones["Neil Byrne"].page.locator(".after-hole .btn", { hasText: "Add detail" }).click();
await phones["Paddy Ward"].page.locator(".after-hole .btn", { hasText: "Add detail" }).click();
const nAd = phones["Neil Byrne"].page.locator(".dtl");
const pAd = phones["Paddy Ward"].page.locator(".dtl");
await nAd.waitFor();
await pAd.waitFor();
await nAd.locator(".dtl-tab", { hasText: "Neil" }).click();
await pAd.locator(".dtl-tab", { hasText: "Sean" }).click();
await nAd.locator(".dtl-shot").first().locator(".dtl-card-main").click();
await pAd.locator(".dtl-shot").first().locator(".dtl-card-main").click();
// A par 3, 1 stroke past par: the tee shot's club by the hole's length
await Promise.all([nAd.locator(".dtl-tile").first().click(), pAd.locator(".dtl-tile").nth(1).click()]);
await Promise.all([nAd.getByRole("button", { name: "On the green", exact: true }).click(), pAd.getByRole("button", { name: "Short", exact: true }).click()]);
const both = await waitFor(() => {
  const r = sql(`select string_agg(player_id||':'||kind||':'||coalesce(club,'')||':'||outcome, ' / ' order by player_id) from shots where round_id='${rid}' and hole=3`);
  return (r.match(/tee:/g) ?? []).length === 2 ? r : null;
});
ok(!!both && both.includes(`${pid("Neil Byrne")}:tee:`) && both.includes(`${pid("Sean Kelly")}:tee:`) && /On the green/.test(both) && /Short/.test(both), `two phones tell two players' shots at once: both kept (${both})`);
await phones["Neil Byrne"].page.screenshot({ path: `${SHOTS}/group-add-detail.png` });
for (const n of ["Neil Byrne", "Paddy Ward"]) await phones[n].page.locator(".dtl .dtl-back").click();

// ---- holes 4 to 8 from the phones' own saves, then the last hole on the screens
for (let h = 4; h <= 8; h++)
  for (const n of names) {
    const r = await calls[n]("/api/score", { t: slug, roundId: rid, game: game.id, hole: h, scores: { [pid(n)]: { gross: card9[h - 1].par } }, final: true });
    if (r.status !== 200) ok(false, `hole ${h} ${n}: ${r.status} ${r.j.error}`);
  }
for (const n of names) await phones[n].page.goto(`${BASE}/t/${slug}/score`);
const p9 = phones["Neil Byrne"].page;
await p9.getByRole("button", { name: /Tap to choose/ }).first().waitFor();
await p9.getByRole("button", { name: /Tap to choose/ }).first().click();
await p9.locator(".hole-sheet .grid button", { hasText: /^9/ }).click();
await p9.getByRole("button", { name: /Hole 9\. Tap to choose/ }).waitFor();
for (const n of names) await setScore(p9, n.split(" ")[0], 5);
await p9.locator(".after-hole").waitFor();
ok((await p9.locator(".after-hole .btn").nth(1).innerText()).includes("Hand in the card"), "on the last hole the right-hand button says Hand in the card");
await p9.locator(".after-hole .btn", { hasText: "Hand in the card" }).click();
await p9.locator(".cp").waitFor({ timeout: 10000 });
await p9.locator(".cp-foot").getByRole("button", { name: "Hand in the card" }).click();
await p9.locator(".sf-sheet").getByRole("button", { name: "Hand in the card" }).click();
const fin = await waitFor(() => sql(`select status from cards where round_id='${rid}'`) === "final");
ok(!!fin, "Neil hands in the card (anyone in the group can): final straight away");

// ---- each player's one-tap check, on their own phone
const pp = phones["Paddy Ward"].page;
await pp.goto(`${BASE}/t/${slug}`);
await pp.locator(".sign-prompt", { hasText: "Your card for round 1 is in. Is it right?" }).waitFor({ timeout: 15000 });
ok(true, "every page on Paddy's phone: your card is in, is it right?");
await pp.locator(".sign-prompt").getByRole("link", { name: "Check it" }).click();
const check = pp.locator(".my-check");
await check.waitFor({ timeout: 15000 }).catch(async (e) => {
  await pp.screenshot({ path: `${SHOTS}/dbg-check.png` });
  console.log((await pp.locator("main, body").first().innerText()).slice(0, 800));
  throw e;
});
const pts = (await check.locator("p").innerText()).trim();
ok(/^Your round: \d+ points\. Right\?$/.test(pts), `Paddy's phone: "${pts}"`);
await pp.screenshot({ path: `${SHOTS}/group-card-check.png` });
await check.getByRole("button", { name: "That's right" }).click();
await pp.locator(".my-check.done").waitFor();
ok(sql(`select count(*) from card_signatures where round_id='${rid}' and player_id='${pid("Paddy Ward")}'`) === "1", "That's right: his check is kept");
const sp = phones["Sean Kelly"].page;
await sp.goto(`${BASE}/t/${slug}/card?round=1&game=${encodeURIComponent(game.id)}`);
await sp.locator(".my-check").waitFor({ timeout: 15000 });
await sp.locator(".my-check").getByRole("button", { name: "Something's wrong" }).click();
await sp.locator(".my-check textarea").fill("I had a 4 on the 7th");
await sp.locator(".my-check").getByRole("button", { name: "Send" }).click();
const flag = await waitFor(() => sql(`select coalesce(flag_by,'')||'|'||coalesce(flag_note,'') from cards where round_id='${rid}'`).startsWith("Sean"));
ok(!!flag, "Something's wrong: the organiser is told who and why");
ok(sql(`select status from cards where round_id='${rid}'`) === "final", "nothing was held up: the card stays final for the organiser to correct");
await pp.goto(`${BASE}/t/${slug}`);
await pp.locator("main").first().waitFor();
await sleep(800);
ok((await pp.locator(".sign-prompt").count()) === 0, "once checked, the prompt goes");
const np2 = phones["Neil Byrne"].page;
await np2.goto(`${BASE}/t/${slug}`);
await np2.locator("main").first().waitFor();
await sleep(800);
ok((await np2.locator(".sign-prompt").count()) === 0, "whoever handed it in isn't asked again");

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
