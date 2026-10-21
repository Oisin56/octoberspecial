import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
/**
 * The set-up redesign, end to end on a phone, for every kind of tournament: the wizard, a change in Tournament
 * setup, scores in, then what followers see (Home's board, the Leaderboard, the rules) and the organiser's side.
 */
const B = "http://127.0.0.1:3100";
const SHOTS = "/var/tmp/ospg/shots/setupwalk";
execSync(`mkdir -p ${SHOTS}`);
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${sql.replace(/"/g, '\\"')}"`).toString().trim();
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const b = await chromium.launch();
const only = process.argv[2];

/** Drive the wizard: the scenario answers the first questions, then this answers the rest from `a`. */
async function wizard(name, first, a = {}) {
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${B}/new`, { waitUntil: "networkidle" });
  await p.evaluate(() => localStorage.clear());
  await p.goto(`${B}/new`, { waitUntil: "networkidle" });
  await p.getByText("I have the site owner's PIN").click();
  const h1 = async () => (await p.locator("h1").first().textContent()).trim();
  const next = () => p.getByRole("button", { name: /^(Next|Skip for now|Skip|No prizes)$/ }).click();
  const W = {
    p,
    next,
    h1,
    async players(list, playing = true) {
      await p.getByText(playing ? "Yes, I'm playing" : "No, I'm just organising").click();
      for (let i = 0; i < list.length; i++) {
        if (i) await p.getByText("+ Add another player").click();
        const row = p.locator(".wz-player").nth(i);
        await row.locator("input").nth(0).fill(list[i][0]);
        await row.locator("input").nth(1).fill(String(list[i][1]));
      }
      await next();
    },
  };
  await first(W);
  let formatAt = 0;
  for (let guard = 0; guard < 60; guard++) {
    const h = await h1();
    if (/^Last thing/.test(h)) break;
    if (/^Where are you playing|^Where's round/.test(h)) {
      if (await p.getByText("Same course").count()) await p.getByText("Same course").first().click();
      else {
        await p.fill("#wz-q", "Birr");
        await p.getByRole("button", { name: "Search" }).click();
        await p.locator(".wz-hit").first().click();
      }
    } else if (/^Which tees/.test(h) || /^How many holes/.test(h)) await p.locator(".wz-tile").first().click();
    else if (/^What's round|^How are you scoring/.test(h)) {
      const want = a.formats?.[formatAt++];
      await (want ? p.locator(".wz-tile", { hasText: want }).first() : p.locator(".wz-tile[aria-pressed=true]").first()).click();
    } else if (/^Who plays with whom/.test(h)) await p.getByText(a.draw ?? "Random").first().click();
    else if (/^Any prizes/.test(h)) {
      for (const pr of a.prizes ?? []) await p.locator(".wz-prize-t", { hasText: pr }).click();
      await next();
    } else if (/^Pick a look/.test(h)) await p.locator(".wz-theme").first().click();
    else await next();
    await p.waitForTimeout(150);
  }
  await p.getByText("Use a PIN").click();
  await p.fill("#wz-pin", "4321");
  await p.fill("#wz-owner", "1234");
  await p.getByRole("button", { name: "Create my tournament" }).click();
  await p.waitForURL(/ready/, { timeout: 30000 }).catch(() => {});
  const slug = p.url().match(/\/t\/([^/]+)\/ready/)?.[1] ?? null;
  ok(!!slug, `${name}: made through the wizard${slug ? ` (${slug})` : ""}`);
  if (errs.length) ok(false, `${name}: no page errors (${errs.join("; ")})`);
  await ctx.close();
  return slug;
}

/** A logged-in phone for a tournament (organiser) or a follower's phone. */
async function phone(slug, organiser) {
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    try {
      localStorage.setItem("mgb-a2hs", "1");
    } catch {}
  });
  if (organiser) await p.request.post(`${B}/api/login`, { data: { t: slug, mode: "organiser", pin: "4321" } });
  return { p, close: () => ctx.close() };
}

/** Scores for every group in a round, from the API (a fixed pattern, so results don't change run to run). */
async function score(slug, n, upto = 18) {
  let cookie = "";
  const call = async (path, body) => {
    const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ t: slug, ...body }) });
    const c = r.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    return r.status;
  };
  await call("/api/login", { mode: "organiser", pin: "4321" });
  const row = JSON.parse(q(`select row_to_json(r) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and r.number=${n}`));
  let seed = 11;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  let bad = 0;
  for (const g of row.games ?? []) {
    const oneBall = ["foursomes", "greensomes", "scramble"].includes(row.play);
    const balls = oneBall ? g.sides.map((s) => s.id) : g.sides.flatMap((s) => s.playerIds);
    for (const h of row.holes.slice(0, upto)) {
      const scores = Object.fromEntries(balls.map((x) => [x, { gross: h.par + Math.floor(rnd() * 4) - 1 }]));
      if ((await call("/api/score", { roundId: row.id, game: g.id, hole: h.number, scores, correct: true })) !== 200) bad++;
    }
  }
  ok(!bad, `${slug}: round ${n} scored`);
  await new Promise((r) => setTimeout(r, 1500));
}

/** What a follower sees: Home's board title, a heading on the Leaderboard, a sentence in the rules. */
async function follower(slug, { board, leaderboard, rules, prizes }) {
  const { p, close } = await phone(slug, false);
  await p.goto(`${B}/t/${slug}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const title = (await p.locator(".board .board-title").first().innerText().catch(() => "")).trim();
  ok(board.test(title), `${slug}: Home board says "${title}"`);
  if (prizes) ok(new RegExp(prizes).test(await p.locator(".prizes").first().innerText().catch(() => "")), `${slug}: prizes panel shows ${prizes}`);
  await p.screenshot({ path: `${SHOTS}/${slug}-home.png`, fullPage: true });
  await p.goto(`${B}/t/${slug}/leaderboard`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const hs = (await p.locator("main h2").allTextContents()).join(" | ");
  ok(leaderboard.test(hs), `${slug}: Leaderboard has ${leaderboard} (${hs})`);
  await p.screenshot({ path: `${SHOTS}/${slug}-leaderboard.png`, fullPage: true });
  await p.goto(`${B}/t/${slug}/rules`, { waitUntil: "networkidle" });
  const r = await p.locator("article p").first().innerText().catch(() => "");
  ok(rules.test(r), `${slug}: rules say ${rules}`);
  await close();
}

const run = async (name, fn) => {
  if (!only || only.split(",").includes(name)) await fn();
};

// ------------------------------------------------------------ on your own
await run("solo", async () => {
  const slug = await wizard(
    "solo",
    async (W) => {
      await W.p.getByText("Just me").click();
      await W.p.fill("#wz-name", "My Round");
      await W.next();
      await W.p.locator(".wz-player input").nth(0).fill("Oisin");
      await W.p.locator(".wz-player input").nth(1).fill("8");
      await W.next();
      await W.p.locator(".num-tile", { hasText: /^2$/ }).click();
    },
    { formats: ["Stroke play"] },
  );
  if (!slug) return;
  ok(q(`select win->>'kind' from tournaments where slug='${slug}'`) === "stroke", "solo: won on the stroke total (the format played)");
  // Tournament setup: add a round, then take it away again
  const { p, close } = await phone(slug, true);
  await p.goto(`${B}/t/${slug}/setup`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "+ Add a round" }).click();
  await p.getByText(/^Same course/).first().click();
  for (let i = 0; i < 4 && !/When is round/.test(await p.locator("h1").first().innerText()); i++) {
    await p.locator(".wz-tile").first().click();
    await p.waitForTimeout(200);
  }
  await p.getByRole("button", { name: "Add this round" }).click();
  await p.waitForSelector("text=Round 3", { timeout: 15000 });
  ok(q(`select count(*) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "3", "solo: Tournament setup adds a round");
  await p.getByText("Remove this round").click();
  await p.getByRole("button", { name: "Yes, remove it" }).click();
  await p.waitForSelector(".su-list");
  ok(q(`select count(*) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "2", "solo: and removes it");
  await close();
  await score(slug, 1);
  await follower(slug, { board: /Stroke play/i, leaderboard: /Net to par/, rules: /lowest net total/ });
});

// ------------------------------------------------------------ a group, each for themselves
await run("stableford", async () => {
  const slug = await wizard(
    "stableford",
    async (W) => {
      await W.p.getByText("A group of us").click();
      await W.p.fill("#wz-name", "Spring Society");
      await W.next();
      await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10], ["Ronan", "+1.2"]]);
      await W.p.getByText("Most Stableford points").click();
      await W.p.locator(".num-tile", { hasText: /^1$/ }).click();
    },
    { draw: "Balanced by handicap", prizes: ["Most birdies", "Front 9 and back 9"] },
  );
  if (!slug) return;
  ok(q(`select handicap from players p join tournaments t on t.id=p.tournament_id where t.slug='${slug}' and p.name='Ronan'`) === "-1.2", "stableford: a plus handicap is kept as plus");
  ok(q(`select jsonb_array_length(games) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "2", "stableford: six players in two groups");
  // Tournament setup: the name, saved as you type
  const { p, close } = await phone(slug, true);
  await p.goto(`${B}/t/${slug}/setup`, { waitUntil: "networkidle" });
  await p.locator(".su-row", { hasText: "Name" }).first().click();
  await p.fill("#wz-name", "Spring Society 2027");
  await p.waitForSelector(".su-status.su-saved", { timeout: 15000 });
  ok(q(`select name from tournaments where slug='${slug}'`) === "Spring Society 2027", "stableford: a change saves as you type");
  await close();
  await score(slug, 1);
  await follower(slug, { board: /Stableford/i, leaderboard: /Stableford points/, rules: /most Stableford points/, prizes: "Most birdies" });
});

await run("stroke", async () => {
  const slug = await wizard("stroke", async (W) => {
    await W.p.getByText("A group of us").click();
    await W.p.fill("#wz-name", "Medal Day");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18]]);
    await W.p.getByText("Lowest total score").click();
    await W.p.locator(".num-tile", { hasText: /^1$/ }).click();
  });
  if (!slug) return;
  ok(q(`select handicap_rule->>'pct' from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "95", "stroke: 95% handicap allowance");
  await score(slug, 1);
  await follower(slug, { board: /Stroke play/i, leaderboard: /Net to par/, rules: /lowest net total/ });
});

await run("points", async () => {
  const slug = await wizard(
    "points",
    async (W) => {
      await W.p.getByText("A group of us").click();
      await W.p.fill("#wz-name", "Two Man Special");
      await W.next();
      await W.players([["Oisin", 8], ["Neil", 12]]);
      await W.p.getByText("A points race").click();
      await W.p.locator(".num-tile", { hasText: /^2$/ }).click();
    },
    { formats: ["Stableford", "Match play"] },
  );
  if (!slug) return;
  ok(q(`select points_rule->>'positions' from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and number=1`) === "[1]", "points: two players, the winner only scores");
  await score(slug, 1);
  await follower(slug, { board: /points/i, leaderboard: /Points by round/, rules: /points race/ });
});

// ------------------------------------------------------------ teams
await run("teams", async () => {
  const slug = await wizard("teams", async (W) => {
    await W.p.getByText("Teams").first().click();
    await W.p.fill("#wz-name", "Team Weekend");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10], ["Ronan", 22], ["Fionn", 14], ["Kevin", 6]]);
    await W.p.getByRole("button", { name: "Balance by handicap" }).click();
    await W.next();
    await W.p.getByText("Matches won").click();
    await W.p.locator(".num-tile", { hasText: /^2$/ }).click();
  });
  if (!slug) return;
  ok(q(`select string_agg(play, ',' order by number) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "fourball,singles", "teams: fourballs first, singles last");
  ok(q(`select handicap_rule->>'pct' from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and number=1`) === "90", "teams: fourballs at 90%");
  // The organiser's side
  const { p, close } = await phone(slug, true);
  await p.goto(`${B}/t/${slug}/admin`, { waitUntil: "networkidle" });
  await p.getByRole("heading", { name: "Next up" }).waitFor();
  const tiles = await p.locator(".org-tile strong").allTextContents();
  ok(tiles[0] === "Tournament setup" && !tiles.includes("Rounds and courses") && !tiles.includes("Side games"), `teams: organiser home starts with Tournament setup (${tiles.join(" | ")})`);
  ok((await p.locator(".tabbar, nav").last().innerText()).includes("Organiser"), "teams: the tab says Organiser");
  ok(!/\bAdmin\b|Fine-tune/.test(await p.locator("body").innerText()), "teams: no Admin or Fine-tune anywhere on it");
  // Groups drawn again from Tournament setup
  const before = q(`select games::text from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and number=2`);
  await p.goto(`${B}/t/${slug}/setup`, { waitUntil: "networkidle" });
  await p.locator(".su-row", { hasText: "Who plays with whom" }).click();
  await p.locator(".wz-tile", { hasText: "Random" }).click();
  await p.waitForSelector(".su-list", { timeout: 15000 });
  const after = q(`select games::text from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and number=2`);
  ok(after !== before && JSON.parse(after).length === 4, "teams: the singles are drawn again, still four matches");
  await close();
  await score(slug, 1);
  await follower(slug, { board: /Team points|Final standings/i, leaderboard: /Points by round/, rules: /Matches won/ });
});

await run("threeteams", async () => {
  const slug = await wizard("threeteams", async (W) => {
    await W.p.getByText("Teams").first().click();
    await W.p.fill("#wz-name", "Society Day");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10], ["Ronan", 22], ["Fionn", 14], ["Kevin", 6], ["Ger", 28]]);
    await W.p.getByRole("button", { name: "More: number of teams" }).click();
    await W.p.getByRole("button", { name: "Shuffle them" }).click();
    await W.next();
    await W.p.locator(".wz-tile", { hasText: /^Team score/ }).click();
    await W.p.getByRole("button", { name: "Best 2" }).click();
    await W.p.locator(".num-tile", { hasText: /^1$/ }).click();
  });
  if (!slug) return;
  ok(q(`select handicap_rule->>'pct' from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "85", "three teams: team score at 85%");
  await score(slug, 1);
  await follower(slug, { board: /Team score/i, leaderboard: /Each player/, rules: /best 2 Stableford/ });
});

await run("knockout", async () => {
  const slug = await wizard("knockout", async (W) => {
    await W.p.getByText("A group of us").click();
    await W.p.fill("#wz-name", "Club Knockout");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10], ["Ronan", 22]]);
    await W.p.getByText("Match play knockout").click();
    await W.p.getByRole("button", { name: "Seeded" }).click();
    await W.next();
  });
  if (!slug) return;
  ok(q(`select count(*) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "3", "knockout: six players, three rounds");
  await score(slug, 1);
  const r2 = q(`select jsonb_array_length(games) from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}' and number=2`);
  ok(Number(r2) >= 2, `knockout: the semi-finals fill in from round 1 (${r2} games)`);
  await follower(slug, { board: /The draw|Champion/i, leaderboard: /The draw/, rules: /knockout/ });
});

await run("skins", async () => {
  const slug = await wizard("skins", async (W) => {
    await W.p.getByText("A group of us").click();
    await W.p.fill("#wz-name", "Skins Game");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10]]);
    await W.p.getByText("Most skins").click();
    await W.p.getByText("Carries over").click();
    await W.p.locator(".num-tile", { hasText: /^1$/ }).click();
  });
  if (!slug) return;
  await score(slug, 1);
  await follower(slug, { board: /Most skins/i, leaderboard: /hole by hole/, rules: /carries to the next hole/ });
});

await run("scramble", async () => {
  const slug = await wizard("scramble", async (W) => {
    await W.p.getByText("Teams").first().click();
    await W.p.fill("#wz-name", "Scramble Day");
    await W.next();
    await W.players([["Oisin", 8], ["Neil", 12], ["Declan", 4], ["Marcus", 18], ["Shane", 10], ["Ronan", 22], ["Fionn", 14], ["Kevin", 6]]);
    await W.p.getByRole("button", { name: "Shuffle them" }).click();
    await W.next();
    await W.p.getByText("Texas scramble").click();
    await W.p.locator(".num-tile", { hasText: /^1$/ }).click();
  });
  if (!slug) return;
  ok(q(`select play from rounds r join tournaments t on t.id=r.tournament_id where t.slug='${slug}'`) === "scramble", "scramble: one ball per team");
  await score(slug, 1);
  await follower(slug, { board: /Texas scramble/i, leaderboard: /Team scores/, rules: /one ball/ });
});

await b.close();
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
