import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3100", T = "october-special-2026", MAIL = "/var/tmp/ospg/mail";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtA -c "${sql}"`).toString().trim();
const reset = () => { fs.rmSync(MAIL, { recursive: true, force: true }); fs.mkdirSync(MAIL, { recursive: true }); };
const mails = () => fs.readdirSync(MAIL).sort().map((f) => JSON.parse(fs.readFileSync(`${MAIL}/${f}`, "utf8")));

let cookie = "";
const post = async (path, body) => { const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return { status: r.status, j: await r.json().catch(() => ({})) }; };
await post("/api/login", { mode: "organiser", pin: "1234" });
q("update tournaments set hero_path='photo/october-special-2026/hero.jpg' where slug='october-special-2026'");
q("update rounds set photo_path='photo/october-special-2026/hero.jpg', play_date=current_date, tee_time='10:30' where number=1");
q("update rounds set photo_path='photo/october-special-2026/0000aaaa-1111-2222-3333-444455556666.jpg', play_date=current_date+1, tee_time='09:40' where number=2");

const st = (await post("/api/admin", { action: "state" })).j.state;
const r1 = st.rounds.find((r) => r.number === 1), r2 = st.rounds.find((r) => r.number === 2);
// Round 1 played in full: Oisin ahead
const pars = r1.holes.map((h) => h.par);
for (let h = 1; h <= 18; h++) {
  const p = pars[h - 1];
  await post("/api/score", { roundId: r1.id, hole: h, scores: { oisin: { gross: h === 3 ? 2 : h % 4 === 0 ? p + 1 : p, gir: h % 2 === 1 }, neil: { gross: p + (h % 3 === 0 ? 0 : 1), gir: h === 4 } }, ctpWinner: p === 3 ? (h === 11 ? "neil" : "oisin") : null, ldWinner: p === 5 ? (h === 4 ? "neil" : "oisin") : null });
}
// A highlight clip on R1
await post("/api/login", { mode: "player", playerId: "neil", pin: "2468" });
const up = await post("/api/upload-url", { filename: "c.mp4", contentType: "video/mp4" });
await post("/api/posts", { roundId: r1.id, hole: 14, body: "Quarry hole, stiffed to three feet", playerIds: ["oisin"], kind: "video", mediaPath: up.j.path });
await post("/api/login", { mode: "organiser", pin: "1234" });

const LONG = `The Opening Salvo

Druids Heath has a habit of humbling the confident, and on a bright, breezy morning in Wicklow it duly did its work on Neil, who arrived on the first tee with a new driver and left the eighteenth green wondering why he'd bothered.

Oisin, by contrast, played the kind of tidy, unfussy golf that wins Stableford days. Pars came in clusters, the greens were found with a regularity that bordered on rude, and the short third, with water creeping down the left, yielded a birdie two that set the tone.

The Quarry Hole

If there was a moment the round tipped, it came at the fourteenth, the little par three played into the old rock quarry. Oisin's tee shot finished three feet away and the putt never looked like missing; Neil found the gorse, then the rock, then his patience.

By the turn the front nine belonged to Oisin, ten points banked and a twenty-four point Stableford total that Neil could only admire. The back nine followed the same script, with only the fourth and eleventh offering Neil any comfort in the side games.

What It Means

Forty points from the first day is a commanding start in a 360-point week, and the leaderboard now reads like a warning. Neil has six rounds to find an answer, starting tomorrow at Wicklow, where the cliffs and the wind take no prisoners.

The gap is big, but this is golf, and October in Ireland has a way of rearranging everything.`;

reset();
const rep = await post("/api/admin", { action: "aiGenerate", kind: "report", roundId: r1.id });
await post("/api/admin", { action: "aiUpdate", id: rep.j.piece.id, title: "Oisin conquers the Heath as Neil's new driver fails the test", body: LONG });
await post("/api/admin", { action: "emailPiece", id: rep.j.piece.id, test: true });
const prev = await post("/api/admin", { action: "aiGenerate", kind: "preview", roundId: r2.id });
await post("/api/admin", { action: "aiUpdate", id: prev.j.piece.id, title: "Cliffs, wind and a forty-point deficit", body: "Wicklow awaits\n\nThe second round takes the October Special to the cliffs above Wicklow town, where the sixth hole asks for a drive over the sea.\n\nNeil needs a big day. Oisin needs only to avoid the cliffs.\n\nThe forecast promises wind, which suits nobody." });
await post("/api/admin", { action: "emailPiece", id: prev.j.piece.id, test: true });
await sleep(500);
const [mr, mp] = mails();
ok(!!mr && !!mp, "report and preview test emails sent");
const h = mr.html;
ok(/Issue 1/.test(h) && /Match report · Round 1/.test(h), "masthead with issue number, label");
ok(h.includes("Oisin conquers the Heath"), "headline in the hero");
ok(/leads by/.test(h) && /wins it/.test(h), "scoreboard strip with lead tag and tug-of-war");
ok(/Closest to the pin/.test(h) && /Greens in regulation/.test(h), "side-game tiles");
ok(/nl-drop/.test(h) && /&ldquo;/.test(h), "drop cap and pull quote");
ok(/Round 1 results/.test(h) && /Front 9/.test(h) && /18 holes/.test(h) && /Birdies/.test(h), "results table from the scoring engine");
ok(/Round 1 at a glance/.test(h) && /Played/.test(h) && /Hole to watch/.test(mp.html), "round card; signature hole in previews");
ok(/Watch the highlight/.test(h) && /Quarry hole/.test(h) && /highlights\?round=1/.test(h), "highlight clip card");
ok(/Full scorecard/.test(h) && /Leaderboard/.test(h) && /Run your own golf event with MyGolfBroadcast/.test(h) && /Unsubscribe/.test(h), "buttons and footer");
ok(!/__UNSUB__/.test(h) && !/__UNSUB__/.test(mr.text), "unsubscribe links filled in");
ok(/OVERALL POINTS|Overall points/.test(mr.text) && /THE QUARRY HOLE/.test(mr.text), "plain-text version readable");
ok(/Preview · Round 2/.test(mp.html) && /Tee time/.test(mp.html) && !/Round 2 results/.test(mp.html), "preview has round card, no results");
fs.writeFileSync("/var/tmp/ospg/shots/news-report.html", mr.html);
fs.writeFileSync("/var/tmp/ospg/shots/news-preview.html", mp.html);

const b = await chromium.launch();
for (const [name, w] of [["phone", 390], ["desk", 760]]) {
  const pg = await (await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 })).newPage();
  for (const f of ["report", "preview"]) {
    await pg.goto(`file:///var/tmp/ospg/shots/news-${f}.html`);
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: `/var/tmp/ospg/shots/news-${f}-${name}.png`, fullPage: true });
    const over = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!over, `${f} fits a ${w}px screen`);
  }
}
await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
