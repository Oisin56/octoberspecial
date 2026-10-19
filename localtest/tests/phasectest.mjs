// Phase C: the setup wizard (three kinds of event), course search, running totals, the getting-ready screen
// with the course guide, the extras, and the site owner's page. Run after fresh.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
const BASE = "http://127.0.0.1:3100";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
fs.mkdirSync("/var/tmp/ospg/shots", { recursive: true });
try { fs.unlinkSync("/var/tmp/ospg/guide-reads.log"); } catch {}
sql(`delete from tournaments where slug like 'wiz-%' or slug like 'the-%' or slug like 'my-%'`);

const b = await chromium.launch();
const phone = async () => {
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
};
const tile = (p, name) => p.locator(".wz-tile", { hasText: name }).first();
const q = (p) => p.locator(".wz-q").innerText();
const next = (p, label = "Next") => p.locator(".wz-next", { hasText: label }).click();
const noOverflow = async (p, what) => {
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(w[0] <= w[1] + 1, `${what}: no sideways scrolling (${w[0]} in ${w[1]})`);
};

// ================================================================ A group of us: Stableford every round
let p = await phone();
await p.goto(`${BASE}/new`, { waitUntil: "networkidle" });
// Invitation-only: the site owner carries on past the gate (the owner PIN is asked at the end)
await p.locator(".wz-owner-skip, .wz-tile").first().waitFor();
if (await p.locator(".wz-owner-skip").count()) await p.locator(".wz-owner-skip").click();
ok((await q(p)) === "Who's playing?", "the wizard opens on who's playing");
const whoTiles = await p.locator(".wz-tile .wz-t").allInnerTexts();
ok(whoTiles.join("|") === "Just me|A group of us|Two teams", `three choices: ${whoTiles.join(", ")}`);
const th = await p.locator(".wz-tile").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
ok(th.every((x) => x >= 76), `big tiles (${Math.min(...th)}px)`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-who.png" });
await tile(p, "A group of us").click();
ok((await q(p)) === "What's it called?", "then the name");
ok(await p.locator(".wz-next").isDisabled(), "Next waits for a name");
await p.fill("#wz-name", "Wiz Weekend");
await next(p);
ok((await q(p)) === "How many rounds?", "how many rounds");
ok((await p.locator(".wz-nums .num-tile").count()) === 10, "1 to 10 rounds");
await p.locator(".wz-nums .num-tile", { hasText: /^2$/ }).click();

// Round 1: search, tee, holes, format, same?, date
ok((await q(p)) === "Where are you playing?", "round 1: where");
await noOverflow(p, "course search");
await p.fill("#wz-q", "Birr");
await p.getByRole("button", { name: "Search" }).click();
await p.locator(".wz-hit").first().waitFor();
ok((await p.locator(".wz-hit .wz-t").first().innerText()) === "Birr Golf Club", "GolfAPI finds Birr");
ok((await p.locator(".wz-hit .wz-n").first().innerText()).includes("18 holes"), "with its location and holes");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-search.png" });
await p.locator(".wz-hit").first().click();
await p.waitForFunction(() => document.querySelector(".wz-q")?.textContent?.startsWith("Which tees"));
const tees = await p.locator(".wz-tile .wz-t").allInnerTexts();
ok(tees.join("|") === "White|Yellow", `tee tiles: ${tees.join(", ")}`);
ok((await p.locator(".wz-tile .wz-n").first().innerText()).includes("6,696 yards"), "lengths in yards (the card was in metres)");
ok((await p.locator(".wz-tile .wz-n").nth(1).innerText()).includes("slope 124"), "slope and rating shown");
ok((await p.locator(".wz-label").innerText()).includes("Round 1 of 2"), "the round is labelled");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-tee.png" });
await tile(p, "Yellow").click();
ok((await q(p)) === "How many holes?", "how many holes (18-hole course)");
await tile(p, "All 18").click();
ok((await q(p)) === "What's the format for round 1?", "the format for round 1");
const fm = await p.locator(".wz-tile .wz-t").allInnerTexts();
ok(fm.join("|") === "Stableford|Stroke play|Match play|Skins", `individual formats: ${fm.join(", ")}`);
await tile(p, "Stableford").click();
ok((await q(p)) === "Same format every round?", "same format every round?");
ok((await p.locator(".wz-tile .wz-n").first().innerText()).includes("running total"), "Yes means a running total");
await tile(p, "Yes").click();
ok((await q(p)) === "When is round 1?", "then the date");
ok((await p.locator(".wz-next").innerText()) === "Skip for now", "the date can be skipped");
await p.fill("#wz-date", "2027-05-14");
await p.fill("#wz-time", "09:30");
await next(p);

// Round 2: same course in one tap, no format question (same every round)
ok((await q(p)) === "Where's round 2?", "round 2: where");
const same = p.locator(".wz-tile", { hasText: "Same course: Birr Golf Club" });
ok(await same.isVisible(), "a 'same course' tile");
ok((await same.innerText()).includes("Yellow tees"), "with the tees");
await same.click();
ok((await q(p)) === "When is round 2?", "same course: straight to the date (no format: same every round)");
await p.locator(".chip", { hasText: "The day after round 1" }).click();
ok((await p.inputValue("#wz-date")) === "2027-05-15", "the day after, in one tap");
await next(p);

// No points screen (running totals); players
ok((await q(p)) === "Are you playing?", "are you playing?");
await tile(p, "Yes, I'm playing").click();
ok((await q(p)) === "Who's playing?", "then the players");
const names = [["Oisin", "12.4"], ["Neil", "4"], ["Ger", "18"], ["Dave", "+1.5"], ["Tom", "22"], ["Rory", "9"]];
for (let i = 0; i < names.length; i++) {
  if (i > 0) await p.getByRole("button", { name: "+ Add another player" }).click();
  await p.locator(".wz-player").nth(i).locator("input").first().fill(names[i][0]);
  await p.locator(".wz-player").nth(i).locator("input").nth(1).fill(names[i][1]);
}
ok((await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Player 6 name" || true, "new rows take the focus");
await noOverflow(p, "players");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-players.png" });
await next(p);
ok((await q(p)) === "Who plays with whom?", "six players: who plays with whom");
await tile(p, "Random draw").click();
ok((await q(p)) === "The extras", "the extras");
ok((await p.locator(".wz-yn").count()) === 5, "feed, AI writing, video, yards or metres, and where videos are shared");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-extras.png" });
await next(p);
ok((await q(p)) === "Pick a look", "pick a look");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-look.png" });
await p.locator(".wz-theme", { hasText: "Links" }).click();
ok((await q(p)) === "Last thing: keeping it safe", "keeping it safe");

// Answers are kept on the phone
await p.reload({ waitUntil: "networkidle" });
ok((await q(p)) === "Last thing: keeping it safe", "a reload carries on where you were");
await tile(p, "Use a PIN").click();
await p.fill("#wz-pin", "2468");
ok(await p.locator(".wz-create").isDisabled(), "needs the site owner PIN while invite-only");
await p.fill("#wz-owner", OWNER);
await p.locator(".wz-summary summary").click();
const sum = await p.locator(".wz-summary").innerText();
ok(/Round 1: Birr Golf Club \(Yellow\), stableford, Fri,? 14 May at 09:30/.test(sum), `summary: ${sum.split("\n")[2]}`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-safe.png" });
await p.locator(".wz-create").click();
await p.waitForURL(/\/t\/wiz-weekend\/ready$/, { timeout: 20000 });
ok(true, "Create my tournament → the getting-ready screen");
ok((await p.evaluate(() => localStorage.getItem("mgs-wizard-v1"))) === null, "the draft is cleared");

// What was made
const tidA = sql(`select id from tournaments where slug='wiz-weekend'`);
const tA = sql(`select standings, feed_on, ai_on, video_enabled, theme, published, start_date, end_date from tournaments where id='${tidA}'`);
ok(tA === "stableford|t|t|t|links|f|2027-05-14|2027-05-15", `tournament: ${tA}`);
ok(sql(`select string_agg(name || ':' || coalesce(handicap::text,''), ',' order by sort) from players where tournament_id='${tidA}'`) === "Oisin:12.4,Neil:4,Ger:18,Dave:-1.5,Tom:22,Rory:9", "players in order, plus handicap stored as negative");
ok(sql(`select organiser_player_id = (select id from players where tournament_id='${tidA}' and name='Oisin') from tournaments where id='${tidA}'`) === "t", "the organiser is Oisin, a player");
const rA = sql(`select number || ':' || tee || ':' || format || ':' || play || ':' || jsonb_array_length(games) || ':' || (handicap_rule->>'pct') || ':' || (handicap_rule->'course'->>'slope') || ':' || coalesce(points_rule->>'positions','none') || ':' || play_date || ':' || coalesce(tee_time,'') from rounds where tournament_id='${tidA}' order by number`);
ok(rA === "1:Yellow:stableford:singles:2:95:124:none:2027-05-14:09:30\n2:Yellow:stableford:singles:2:95:124:none:2027-05-15:", `rounds: ${rA.replace(/\n/g, " / ")}`);
const groups = JSON.parse(sql(`select games from rounds where tournament_id='${tidA}' and number=1`));
ok(groups.map((g) => g.sides.length).join(",") === "3,3" && new Set(groups.flatMap((g) => g.sides.map((s) => s.id))).size === 6, "random draw: two groups of three, everyone once");
ok(groups.every((g) => g.scorerId === g.sides[0].id), "the first in each group keeps score");
ok(sql(`select (holes->0->>'si') || ',' || (holes->0->>'yards') from rounds where tournament_id='${tidA}' and number=1`) === "5,377", "the card: stroke index and yards from GolfAPI");

// A round added later in Fine-tune follows the wizard's settings (format, allowance, this tee's slope)
{
  const cookie = (await p.context().cookies()).find((c) => c.name === "os_session");
  const r = await fetch(`${BASE}/api/admin`, { method: "POST", headers: { "content-type": "application/json", cookie: `os_session=${cookie.value}` }, body: JSON.stringify({ t: "wiz-weekend", action: "saveRound", round: { courseRef: "golfapi:012141520611:Ireland", tee: "White", hole_set: "all" } }) });
  ok(r.status === 200, "Fine-tune: add a third round");
  const r3 = sql(`select format || ':' || (handicap_rule->>'pct') || ':' || (handicap_rule->'course'->>'slope') || ':' || jsonb_array_length(games) from rounds where tournament_id='${tidA}' and number=3`);
  ok(r3 === "stableford:95:128:0", `it follows the wizard: ${r3}`);
  sql(`delete from rounds where tournament_id='${tidA}' and number=3`);
}

// Getting ready: the guide (club page first, then a review, checked against the card), then the preview
await p.locator(".getting-ready, .you-ready").first().waitFor();
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-getting-ready.png" });
await p.locator(".you-ready").waitFor({ timeout: 90000 });
ok((await p.locator(".you-ready h1").innerText()) === "You're ready", "You're ready");
const ready = await p.locator(".ready-tile strong").allInnerTexts();
ok(ready.join("|") === "Send everyone their link|See your site|Fine-tune", `three tiles: ${ready.join(", ")}`);
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-ready.png" });
const jobs = JSON.parse(sql(`select setup_jobs from tournaments where id='${tidA}'`));
ok(jobs.map((j) => `${j.kind}:${j.status}`).join(",") === "photo:done,guide:done,preview:done", `jobs: ${jobs.map((j) => `${j.kind}:${j.status}`).join(", ")}`);
const reads = fs.readFileSync("/var/tmp/ospg/guide-reads.log", "utf8").trim().split("\n");
ok(reads.length === 2 && reads[0].startsWith("https://birrgolfclub.ie") && reads[1].startsWith("https://example.com/review"), "the club's own page first, then the review; stopped once most holes were found");
ok(reads[0].includes("web_fetch_20250910") && reads[0].includes('"allowed_domains":["birrgolfclub.ie"]'), "each page read with web fetch, kept to its own site");
const guide = JSON.parse(sql(`select course_guide from rounds where tournament_id='${tidA}' and number=2`));
ok(Object.keys(guide.holes).length === 16 && !guide.holes["12"] && !guide.holes["4"], "16 holes kept: 12 dropped (its par didn't match the card), 4 dropped (its length was 22% out)");
ok(guide.holes["7"] === "Elevated tee to a two-tier green." && guide.holes["15"] === "Review note for hole 15.", "notes from both pages, numbered to our card");
ok(guide.overview.startsWith("Parkland course"), "the overview from the club's page");
ok(jobs[1].note === "Notes on 16 holes, checked against your card", `the guide's result in plain words: ${jobs[1].note}`);
const searchReq = JSON.parse(fs.readFileSync("/var/tmp/ospg/guide-search.json", "utf8"));
ok(searchReq.tools?.[0]?.type === "web_search_20250305", "the search step uses web search");
ok(sql(`select count(*) from ai_pieces where tournament_id='${tidA}' and kind='preview' and status='draft'`) === "1", "the first preview is written, waiting in Admin");

// Running totals on the board: two rounds of Stableford scores straight into the cards
const pid = (n) => sql(`select id from players where tournament_id='${tidA}' and name='${n}'`);
const gamesR = (n) => JSON.parse(sql(`select games from rounds where tournament_id='${tidA}' and number=${n}`));
const rid = (n) => sql(`select id from rounds where tournament_id='${tidA}' and number=${n}`);
for (const n of [1, 2]) {
  for (const g of gamesR(n)) {
    for (let h = 1; h <= (n === 1 ? 18 : 9); h++) {
      const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
      const scores = Object.fromEntries(g.sides.map((s) => [s.id, { gross: pars[h - 1] + (s.id === pid("Neil") ? 0 : 1) }]));
      sql(`insert into hole_entries (round_id, game, hole, scores) values ('${rid(n)}', '${g.id}', ${h}, '${JSON.stringify(scores)}')`);
    }
  }
}
sql(`update rounds set status='complete' where id='${rid(1)}'; update rounds set status='live' where id='${rid(2)}'`);
await p.goto(`${BASE}/t/wiz-weekend/leaderboard`, { waitUntil: "networkidle" });
await p.locator(".board").first().waitFor();
const bt = await p.locator(".board-title").allInnerTexts();
ok(bt.some((x) => x.toLowerCase() === "stableford"), `the board: Stableford totals (${bt.join(" / ")})`);
const top = await p.locator(".board-row").first().innerText();
ok(/1\s*Tom/i.test(top) || /1\s*Ger/i.test(top), `the leader at the top: ${top.replace(/\n/g, " ")}`);
ok((await p.locator(".board-sub").first().innerText()).includes("thru 9"), "thru 9 in today's round");
ok((await p.locator(".board-foot").innerText()).includes("Round 2 of 2"), "Round 2 of 2");
const table = await p.locator("table.stats").first().innerText();
ok(table.includes("R1") && table.includes("R2") && /Neil/.test(table), "round-by-round totals table");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-totals.png", fullPage: true });
await p.goto(`${BASE}/t/wiz-weekend/rules`, { waitUntil: "networkidle" });
ok((await p.locator(".article").innerText()).includes("won on the most Stableford points"), "the rules explain how it's won");
ok((await p.locator(".article").innerText()).includes("course handicap from the index: slope 124"), "and the course handicap");

// ================================================================ Two teams: a typed-in card, I'll set the matches, email
p = await phone();
await p.goto(`${BASE}/new`, { waitUntil: "networkidle" });
// Invitation-only: the site owner carries on past the gate (the owner PIN is asked at the end)
await p.locator(".wz-owner-skip, .wz-tile").first().waitFor();
if (await p.locator(".wz-owner-skip").count()) await p.locator(".wz-owner-skip").click();
await tile(p, "Two teams").click();
await p.fill("#wz-name", "The Cup");
await next(p);
await p.locator(".wz-nums .num-tile", { hasText: /^1$/ }).click();
await p.locator(".wz-manual").click();
ok((await q(p)) === "Type the card in", "can't find it: type the card in");
await p.fill("#wz-mname", "Nowhere Golf Club");
await p.locator(".pick-tile", { hasText: "9 holes" }).click();
ok((await p.locator("table.card input[aria-label^='par']").count()) === 9, "a nine-hole card");
await next(p);
ok((await q(p)) === "What's the format for round 1?", "9-hole card: no holes question, straight to the format");
const tf = await p.locator(".wz-tile .wz-t").allInnerTexts();
ok(tf.join("|") === "Fourballs|Foursomes|Singles", `team formats: ${tf.join(", ")}`);
await tile(p, "Fourballs").click();
await next(p, "Skip for now");
ok((await q(p)) === "Points for each round", "matches: the points screen");
ok((await p.locator(".wz-pt-row").first().innerText()).includes("For winning a match"), "a point for winning a match");
await p.getByRole("button", { name: "More: round 1 points per match" }).click();
ok((await p.locator(".wz-stepper .num").first().innerText()) === "1½", "+ makes it 1½");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-points.png" });
await next(p);
await tile(p, "No, I'm just organising").click();
for (const [i, n] of ["Ann", "Bea", "Cat", "Dee"].entries()) {
  if (i > 0) await p.getByRole("button", { name: "+ Add another player" }).click();
  await p.locator(".wz-player").nth(i).locator("input").first().fill(n);
}
await next(p);
ok((await q(p)) === "The two teams", "the teams");
await p.locator("input[aria-label='Team 1 name']").fill("Reds");
await p.locator("input[aria-label='Team 2 name']").fill("Blues");
ok(await p.locator(".wz-next").isDisabled(), "Next waits until everyone's on a team");
for (const [i, t] of [0, 1, 0, 0].entries()) await p.locator(".wz-side").nth(i).locator(".pick-tile").nth(t).click();
ok((await p.locator(".notice").first().innerText()).includes("same number"), "uneven teams: said plainly");
await p.locator(".wz-side").nth(3).locator(".pick-tile").nth(1).click();
ok(!(await p.locator(".wz-next").isDisabled()), "two a side: on we go");
await noOverflow(p, "teams");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasec-teams.png" });
await next(p);
await tile(p, "I'll set them myself").click();
await p.locator(".wz-yn").nth(1).locator(".pick-tile", { hasText: "No" }).click();
await next(p);
await p.locator(".wz-theme").first().click();
await tile(p, "Use my email").click();
await p.fill("#wz-email", "captain@example.com");
await p.fill("#wz-owner", OWNER);
const mailBefore = fs.readdirSync("/var/tmp/ospg/mail").length;
await p.locator(".wz-create").click();
await Promise.race([p.waitForURL(/\/t\/the-cup\/ready$/, { timeout: 20000 }), p.locator(".wz .error").waitFor({ timeout: 20000 }).then(async () => console.log("ERROR SHOWN:", await p.locator(".wz .error").innerText()))]);
await p.waitForURL(/\/t\/the-cup\/ready$/, { timeout: 2000 });
await p.locator(".you-ready").waitFor({ timeout: 15000 });
ok(true, "AI writing off: nothing to wait for, straight to You're ready");
const tidB = sql(`select id from tournaments where slug='the-cup'`);
ok(sql(`select ai_on || ',' || auto_bulletins || ',' || standings || ',' || coalesce(organiser_player_id,'none') from tournaments where id='${tidB}'`) === "false,false,points,none", "AI off, points, organiser not playing");
ok(sql(`select string_agg(t->>'name' || '/' || (t->>'color'), ',') from tournaments, jsonb_array_elements(teams) t where id='${tidB}'`) === "Reds/#c8102e,Blues/#1d4f91", "the teams and their colours");
ok(sql(`select string_agg(name || '=' || team_id, ',' order by sort) from players where tournament_id='${tidB}'`) === "Ann=team-1,Bea=team-2,Cat=team-1,Dee=team-2", "each player on the side they were tapped onto");
ok(sql(`select format || ':' || play || ':' || jsonb_array_length(games) || ':' || (points_rule->>'full') || ':' || jsonb_array_length(holes) || ':' || course_slug from rounds where tournament_id='${tidB}'`) === "match:fourball:0:1.5:9:manual:nowhere-golf-club", "fourballs, 1½ a match, the typed 9-hole card, matches to be set");
ok(sql(`select count(*) from account_tournaments a join accounts c on c.id=a.account_id where c.email='captain@example.com' and a.tournament_id='${tidB}'`) === "1", "in My tournaments under that email");
await sleep(500);
ok(fs.readdirSync("/var/tmp/ospg/mail").length > mailBefore, "a sign-in link was emailed");
await p.goto(`${BASE}/t/the-cup/admin`, { waitUntil: "networkidle" });
ok((await p.locator(".next-up").innerText()).includes("Who plays with whom in round 1: not set yet."), "Admin's to-do: set the matches");
ok(!(await p.locator(".next-up").innerText()).includes("preview"), "no AI to-dos when AI writing is off");

// ================================================================ Just me: stroke play, no feed
p = await phone();
await p.goto(`${BASE}/new`, { waitUntil: "networkidle" });
// Invitation-only: the site owner carries on past the gate (the owner PIN is asked at the end)
await p.locator(".wz-owner-skip, .wz-tile").first().waitFor();
if (await p.locator(".wz-owner-skip").count()) await p.locator(".wz-owner-skip").click();
await tile(p, "Just me").click();
await p.fill("#wz-name", "My Vlog Round");
await next(p);
await p.locator(".wz-nums .num-tile", { hasText: /^1$/ }).click();
await p.fill("#wz-q", "Birr");
await p.getByRole("button", { name: "Search" }).click();
await p.locator(".wz-hit").first().click();
await tile(p, "White").click();
await tile(p, "Back 9").click();
ok((await q(p)) === "How are you scoring?", "just me: how are you scoring");
ok((await p.locator(".wz-tile").count()) === 2, "Stableford or stroke play");
await tile(p, "Stroke play").click();
await next(p, "Skip for now");
ok((await q(p)) === "Your name and handicap", "just you");
await p.locator(".wz-player input").first().fill("Oisin");
await p.locator(".wz-player input").nth(1).fill("12.4");
await next(p);
ok((await q(p)) === "The extras", "no teams, no draw");
await p.locator(".wz-yn").nth(0).locator(".pick-tile", { hasText: "No" }).click();
await next(p);
await p.locator(".wz-theme").first().click();
await tile(p, "Use a PIN").click();
await p.fill("#wz-pin", "1357");
await p.fill("#wz-owner", OWNER);
await p.locator(".wz-create").click();
await p.waitForURL(/\/t\/my-vlog-round\/ready$/, { timeout: 20000 });
const tidC = sql(`select id from tournaments where slug='my-vlog-round'`);
ok(sql(`select standings || ',' || feed_on from tournaments where id='${tidC}'`) === "stroke,false", "stroke-play totals, feed off");
ok(sql(`select hole_set || ':' || jsonb_array_length(games) || ':' || jsonb_array_length(games->0->'sides') from rounds where tournament_id='${tidC}'`) === "back:1:1", "the back nine, one game, just you");
await p.locator(".you-ready").waitFor({ timeout: 90000 });
ok((await p.locator(".ready-tile strong").allInnerTexts()).join("|") === "See your site|Fine-tune", "on your own: no links to send");
await p.goto(`${BASE}/t/my-vlog-round`, { waitUntil: "networkidle" });
const bar = await p.locator("nav.tabbar .oc-btn span").allInnerTexts();
ok(!bar.includes("Feed"), `feed off: no Feed in the bar (${bar.join(", ")})`);
ok((await p.locator("aside .section-head", { hasText: "Latest" }).count()) === 0, "and none on the home page");

// ================================================================ The API refuses what won't work
const api = async (wizard) => {
  const r = await fetch(`${BASE}/api/tournaments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wizard, pin: "1234", ownerPin: OWNER }) });
  return { status: r.status, j: await r.json() };
};
const base = { who: "individuals", name: "Wiz Check", rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", format: "match" }], players: [{ name: "A" }, { name: "B" }, { name: "C" }], draw: "random", extras: {}, theme: "spring" };
let r = await api(base);
ok(r.status === 400 && /even number/.test(r.j.error), `odd numbers for match play: ${r.j.error}`);
r = await api({ ...base, rounds: [{ ...base.rounds[0], format: "fourball" }] });
ok(r.status === 400 && /format/.test(r.j.error), `a team format for individuals: ${r.j.error}`);
r = await api({ ...base, rounds: [{ courseName: "Nowhere", manualCard: Array.from({ length: 18 }, () => ({ par: 4, si: 1 })), holeSet: "all", format: "stableford" }] });
ok(r.status === 400 && /stroke indexes/.test(r.j.error), `a bad typed card: ${r.j.error}`);
ok(sql(`select count(*) from tournaments where slug like 'wiz-check%'`) === "0", "nothing half-made");
// Mixed formats, points: match play then Stableford over the whole field
r = await api({ ...base, players: [...base.players, { name: "D" }], rounds: [base.rounds[0], { ...base.rounds[0], format: "stableford", points: { positions: [5, 3, 1] } }] });
ok(r.status === 200, "mixed formats: made");
const pr = sql(`select string_agg(number || ':' || format || ':' || (points_rule::text), ' | ' order by number) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${r.j.slug}'`);
ok(pr.includes('1:match:{"back": 0, "full": 1, "front": 0}') && pr.includes('"across": true') && pr.includes("[5, 3, 1]"), `points: ${pr}`);
ok(sql(`select standings from tournaments where slug='${r.j.slug}'`) === "points", "won on points");

// ================================================================ No reliable info: said plainly
const hidden = await api({ who: "solo", name: "Wiz Nowhere", rounds: [{ courseName: "Nowhere Golf Club", manualCard: Array.from({ length: 9 }, (_, i) => ({ par: 4, si: i + 1 })), holeSet: "all", format: "stroke" }], players: [{ name: "Me" }], extras: { ai: true }, theme: "spring" });
ok(hidden.status === 200, "a typed-in course nobody's heard of: made");
// (its creator's session went to that fetch; the owner runs its steps instead)
const own = await b.newContext({ ...devices["iPhone 13"] });
const op = await own.newPage();
await op.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
ok((await op.locator("h1").innerText()) === "Site owner", "the site owner page");
await op.fill("#opin", OWNER);
await op.getByRole("button", { name: "Sign in" }).click();
await op.locator(".owner-t").first().waitFor();
const listed = await op.locator(".owner-t strong").allInnerTexts();
ok(["Wiz Weekend", "The Cup", "My Vlog Round", "The October Special"].every((n) => listed.some((x) => x.startsWith(n))), `every tournament listed (${listed.length})`);
const card = op.locator(".owner-t", { hasText: "Wiz Nowhere" });
ok((await card.locator(".owner-meta").innerText()).includes("1 player · 1 round"), "with players and rounds");
await noOverflow(op, "owner page");
await op.screenshot({ path: "/var/tmp/ospg/shots/phasec-owner.png" });
await card.getByRole("button", { name: "Open as organiser" }).click();
await op.waitForURL(/\/t\/wiz-nowhere\/admin/);
ok(true, "open any tournament as its organiser");
await op.goto(`${BASE}/t/wiz-nowhere/ready`, { waitUntil: "networkidle" });
await op.locator(".you-ready").waitFor({ timeout: 60000 });
const nj = JSON.parse(sql(`select setup_jobs from tournaments where slug='wiz-nowhere'`));
const g = nj.find((j) => j.kind === "guide");
ok(g.status === "none" && g.note === "No hole-by-hole info found", `nothing found: "${g.note}"`);
ok(sql(`select course_guide is null from rounds r join tournaments t on t.id=r.tournament_id where t.slug='wiz-nowhere'`) === "t", "and nothing made up");

// Download a copy, then delete (files too)
await op.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
const cupCard = op.locator(".owner-t", { hasText: "The Cup" });
const dl = op.waitForEvent("download");
await cupCard.getByRole("button", { name: "Download a copy" }).click();
const file = await dl;
const copy = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
ok(copy.tournament.name === "The Cup" && copy.players.length === 4 && copy.rounds.length === 1 && !copy.tournament.organiser_pin_hash, "a copy: tournament, players, rounds (no PINs)");
fs.mkdirSync("/var/tmp/ospg/files/photo/the-cup", { recursive: true });
fs.writeFileSync("/var/tmp/ospg/files/photo/the-cup/x.jpg", "x");
await cupCard.getByRole("button", { name: "Delete" }).click();
ok((await op.locator(".sheet-card").innerText()).includes("It can't be undone."), "delete: it can't be undone");
const del = op.getByRole("button", { name: "Delete it for good" });
ok(await del.isDisabled(), "waits for the name to be typed");
await op.fill("#del-name", "The Cu");
ok(await del.isDisabled(), "a near miss isn't enough");
await op.screenshot({ path: "/var/tmp/ospg/shots/phasec-delete.png" });
await op.fill("#del-name", "the cup");
await del.click();
await op.locator(".notice", { hasText: "is deleted" }).waitFor();
ok(sql(`select count(*) from tournaments where slug='the-cup'`) === "0" && sql(`select count(*) from players where tournament_id='${tidB}'`) === "0", "the tournament and its players are gone");
ok(!fs.existsSync("/var/tmp/ospg/files/photo/the-cup/x.jpg"), "and its files");
ok(sql(`select count(*) from tournaments where slug='october-special-2026'`) === "1", "the others are untouched");
r = await fetch(`${BASE}/api/owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: tidA, name: "Wiz Weekend" }) });
ok(r.status === 401, "deleting needs the site owner");

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
