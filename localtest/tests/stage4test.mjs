// Stage 4, the end of a trip: finishing (the button, by itself, the day-before email, the locks, opening scoring again,
// the feed closing), the trip page and the round page, My golf (My rounds, Past trips), player bios and the email asks,
// films kept 12 months, deleting posts and accounts, and the emails for golfers on their own. Screenshots go to
// /var/tmp/ospg/shots.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium, devices } from "playwright";
import { BASE, agent, browserCookie, codeOf, lastMailTo, mails, signInAsPlayer, signInWithEmail } from "./signin-helpers.mjs";

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
fs.rmSync("/var/tmp/ospg/mail", { recursive: true, force: true });
fs.mkdirSync("/var/tmp/ospg/mail", { recursive: true });
const CRON = { headers: { authorization: "Bearer local-cron-secret" } };
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
const allTo = (to) => mails().filter((m) => m.to.join().toLowerCase() === to.toLowerCase());
const card9 = Array.from({ length: 9 }, (_, i) => ({ par: [4, 4, 3, 5, 4, 4, 3, 4, 5][i], si: i + 1 }));
const PAR9 = card9.map((h) => h.par);

/** A tournament made with the wizard by an organiser who confirms their email (signed in on that agent) */
async function make(org, email, wizard) {
  const r = await org("/api/tournaments", { wizard, email, ownerPin: "1234" });
  if (r.status !== 200) throw new Error(`wizard: ${r.status} ${r.j.error}`);
  const m = await waitFor(() => allTo(email).filter((x) => codeOf(x)).pop());
  await org("/api/account", { action: "code", email, code: codeOf(m) });
  const id = sql(`select id from tournaments where slug='${r.j.slug}'`);
  return { slug: r.j.slug, id };
}
const gameOf = (tid, n = 1) => JSON.parse(sql(`select games::text from rounds where tournament_id='${tid}' and number=${n}`))[0];
const roundId = (tid, n = 1) => sql(`select id from rounds where tournament_id='${tid}' and number=${n}`);
async function scoreAll(call, slug, tid, scores, n = 1) {
  const g = gameOf(tid, n);
  const rid = roundId(tid, n);
  let last;
  for (let h = 1; h <= 9; h++) {
    last = await call("/api/score", { t: slug, roundId: rid, game: g.id, hole: h, scores: Object.fromEntries(Object.entries(scores).map(([pid, f]) => [pid, { gross: f(h) }])), final: true });
    if (last.status !== 200) return last;
  }
  return last;
}

// ================================================================ a group trip
const org = agent();
const trip = await make(org, "orla@example.ie", {
  who: "individuals",
  name: "Kinsale Weekend 2027",
  win: "stroke",
  rounds: [{ courseName: "Seaview Links", manualCard: card9, holeSet: "all", format: "stroke", date: day(5) }],
  players: [{ name: "Orla Organiser" }, { name: "Neil Byrne" }, { name: "Paddy Ward" }],
  organiserPlays: true,
  draw: "random",
  prizes: [],
  extras: { ai: true, feed: true, video: true },
  theme: "spring",
});
ok(sql(`select solo::text from tournaments where id='${trip.id}'`) === "false", "a group trip isn't marked as on your own");
const pid = (name) => sql(`select id from players where tournament_id='${trip.id}' and name='${name}'`);
const neil = agent();
await signInAsPlayer(org, neil, trip.slug, pid("Neil Byrne"));

// ---- the bio, first time in
let r = await neil("/api/player", { t: trip.slug, action: "me" });
ok(r.status === 200 && r.j.bioDue === "first" && r.j.emailDue === null, `straight after "I'm Neil": the bio is asked (${r.j.bioDue}), not the email`);
r = await neil("/api/player", { t: trip.slug, action: "bio", bio: { home_club: "Birr GC", best_club: "Driver" } });
r = await neil("/api/player", { t: trip.slug, action: "bio", bio: { worst_club: "Putter", weakness: "Three-putts", nickname: "Neilo", photo_path: "photo/someone-else/x.jpg" }, done: true });
ok(sql(`select home_club || '|' || best_club || '|' || worst_club || '|' || weakness || '|' || nickname || '|' || coalesce(photo_path,'none') from players where id='${pid("Neil Byrne")}'`) === "Birr GC|Driver|Putter|Three-putts|Neilo|none", "each answer is saved; a photo from another tournament isn't taken");
r = await neil("/api/player", { t: trip.slug, action: "me" });
ok(r.j.bioDue === null, "done: not asked again");
const paddy = agent();
await signInAsPlayer(org, paddy, trip.slug, pid("Paddy Ward"));
await paddy("/api/player", { t: trip.slug, action: "later" });
ok((await paddy("/api/player", { t: trip.slug, action: "me" })).j.bioDue === null, "Later: not asked again before the first round");

// ---- the round
sql(`update rounds set play_date='${day(-1)}' where tournament_id='${trip.id}'`);
const g = gameOf(trip.id);
const scorerCall = g.scorerId === pid("Neil Byrne") ? neil : g.scorerId === pid("Paddy Ward") ? paddy : org;
const ids = { o: pid("Orla Organiser"), n: pid("Neil Byrne"), p: pid("Paddy Ward") };
r = await scoreAll(scorerCall, trip.slug, trip.id, { [ids.o]: (h) => PAR9[h - 1] + 1, [ids.n]: (h) => PAR9[h - 1] - (h <= 2 ? 1 : 0), [ids.p]: (h) => PAR9[h - 1] + 2 });
ok(r.status === 200, `nine holes in (${r.status} ${r.j.error ?? ""})`);
r = await paddy("/api/player", { t: trip.slug, action: "me" });
ok(r.j.bioDue === "again", `after the round, Later brings the bio back once (${r.j.bioDue})`);
await paddy("/api/player", { t: trip.slug, action: "seen", ask: "bioAgain" });
r = await paddy("/api/player", { t: trip.slug, action: "me" });
ok(r.j.bioDue === null && r.j.emailDue === "round1", `then their email, after the round (${r.j.emailDue})`);
await paddy("/api/player", { t: trip.slug, action: "seen", ask: "round1" });
await paddy("/api/player", { t: trip.slug, action: "notNow" });
ok((await paddy("/api/player", { t: trip.slug, action: "me" })).j.emailDue === null, "Not now: and the round 1 ask isn't shown again");

// ---- Neil adds his email: confirmed with the code, it joins his spot and his account
r = await neil("/api/player", { t: trip.slug, action: "emailStart", email: "neil@example.ie", marketing: true });
ok(r.status === 200, "the confirm email goes");
let m = await lastMailTo("neil@example.ie");
ok(!!codeOf(m) && /each round's report/.test(m.text), "with the code, saying why it came");
await neil("/api/account", { action: "code", email: "neil@example.ie", code: codeOf(m) });
r = await neil("/api/player", { t: trip.slug, action: "emailDone" });
ok(r.status === 200, `confirmed (${r.status} ${r.j.error ?? ""})`);
ok(sql(`select email from players where id='${ids.n}'`) === "neil@example.ie", "the email joins his spot");
ok(sql(`select count(*) from subscribers where tournament_id='${trip.id}' and email='neil@example.ie'`) === "1", "he gets this trip's round reports");
ok(sql(`select count(*) from account_tournaments at join accounts a on a.id=at.account_id where a.email='neil@example.ie' and at.player_id='${ids.n}'`) === "1", "and the trip is in his My golf");
ok(sql(`select bio->>'home_club' from accounts where email='neil@example.ie'`) === "Birr GC", "his bio is kept on his account");
ok(sql(`select marketing_at is not null from people where email='neil@example.ie'`) === "t", "his own tick counts");

// ---- posts, then finishing
r = await neil("/api/posts", { t: trip.slug, kind: "note", body: "What a putt on the 2nd" });
const neilPost = r.j.post?.id;
ok(!!neilPost, "players post during the trip");
let st = await org("/api/admin", { t: trip.slug, action: "state" });
ok(st.j.finish?.autoDay === day(2), `it would finish by itself 3 days after the last round (${st.j.finish?.autoDay})`);
r = await org("/api/admin", { t: trip.slug, action: "finish" });
ok(r.status === 200 && sql(`select (finished_at is not null)::text from tournaments where id='${trip.id}'`) === "true", "Finish tournament");
ok(sql(`select count(*) from rounds where tournament_id='${trip.id}' and status <> 'complete'`) === "0", "every round is closed");
ok(sql(`select (feed_until > now() + interval '29 days')::text from tournaments where id='${trip.id}'`) === "true", "the feed stays open 30 days");
const piece = await waitFor(() => sql(`select status from ai_pieces where tournament_id='${trip.id}' and kind='tournament' and trigger='auto-review'`) || null);
ok(piece === "draft", `the final report is written and waits for the organiser's OK (${piece})`);
ok(sql(`select end_piece from tournaments where id='${trip.id}'`) === "written", "and that's noted, so it isn't written twice");

// ---- the locks
r = await scorerCall("/api/score", { t: trip.slug, roundId: roundId(trip.id), game: g.id, hole: 3, scores: { [ids.n]: { gross: 2 } }, final: true });
ok(scorerCall === org || (r.status === 409 && /finished/.test(r.j.error)), `players can't change scores (${r.status} ${r.j.error ?? ""})`);
r = await org("/api/score", { t: trip.slug, roundId: roundId(trip.id), game: g.id, hole: 3, correct: true, scores: { [ids.o]: { gross: 3 }, [ids.n]: { gross: 3 }, [ids.p]: { gross: 5 } }, final: true });
ok(r.status === 409 && r.j.finished === true && r.j.error === "This tournament is finished. Change this score?", "the organiser is asked first");
r = await org("/api/score", { t: trip.slug, roundId: roundId(trip.id), game: g.id, hole: 3, correct: true, confirmFinished: true, scores: { [ids.o]: { gross: 3 }, [ids.n]: { gross: 3 }, [ids.p]: { gross: 5 } }, final: true });
ok(r.status === 200 && sql(`select count(*) from score_changes where tournament_id='${trip.id}' and action='score changed after the finish'`) === "1", "then can, and it's logged with their name");
ok((await org("/api/cards", { t: trip.slug, action: "reopen", roundId: roundId(trip.id), game: g.id })).status === 409, "cards ask first too");

// ---- the trip page
const b = await chromium.launch();
const phone = await b.newContext({ ...devices["iPhone 13"] });
await phone.addCookies([browserCookie(neil)]);
let p = await phone.newPage();
await p.goto(`${BASE}/t/${trip.slug}`, { waitUntil: "networkidle" });
await p.locator(".trip-page").waitFor();
const tripText = await p.locator(".trip-page").innerText();
ok(/Winner of Kinsale Weekend 2027/.test(tripText) && /Neil Byrne/.test(tripText), "the trip page: the winner first");
ok(/Final leaderboard/.test(tripText) && (await p.locator(".tp-board li").count()) === 3, "the final leaderboard");
ok(!/Set up next year/.test(tripText), "next year's trip is only for organisers");
ok(!/Order the book/.test(tripText), "no book (kept in reserve)");
const noOverflow = async (pg, what) => {
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(w[0] <= w[1] + 1, `${what}: no sideways scrolling (${w[0]} in ${w[1]})`);
};
await noOverflow(p, "trip page");
await p.screenshot({ path: `${SHOTS}/stage4-trip.png`, fullPage: true });
const orgPhone = await b.newContext({ ...devices["iPhone 13"] });
await orgPhone.addCookies([browserCookie(org)]);
const op = await orgPhone.newPage();
await op.goto(`${BASE}/t/${trip.slug}`, { waitUntil: "networkidle" });
await op.locator(".tp-again").waitFor();
ok(/Set up next year's trip/.test(await op.locator(".tp-again").innerText()), "the organiser sees Set up next year's trip");
r = await org(`/api/again?t=${trip.slug}`);
ok(r.status === 200 && r.j.draft.name === "Kinsale Weekend 2028" && r.j.draft.players.length === 3 && r.j.draft.rounds.length === 0, `next year: the name moves on a year, same players, new rounds (${r.j.draft?.name})`);
ok((await neil(`/api/again?t=${trip.slug}`)).status === 403, "only its organisers can start from it");
await op.goto(`${BASE}/t/${trip.slug}/admin`, { waitUntil: "networkidle" });
await op.locator(".org-home").waitFor();
ok(/Finished on/.test(await op.locator(".org-when").innerText()), "the organiser's home says it's finished");
ok(/final report is written and waiting/.test(await op.locator(".next-up").innerText()), "and that the final report is waiting");
await op.goto(`${BASE}/t/${trip.slug}/admin#settings`, { waitUntil: "networkidle" });
await op.getByRole("button", { name: "Open scoring again" }).waitFor();
ok(true, "Settings: Open scoring again");
await op.screenshot({ path: `${SHOTS}/stage4-settings.png`, fullPage: true });

// ---- the feed closes
r = await org("/api/admin", { t: trip.slug, action: "feed", open: false });
r = await neil("/api/posts", { t: trip.slug, kind: "note", body: "One more" });
ok(r.status === 403 && /feed is closed/.test(r.j.error), "the organiser closes the feed: no more posts");
ok((await neil("/api/comments", { t: trip.slug, postId: neilPost, body: "Late comment" })).status === 403, "or comments");
await org("/api/admin", { t: trip.slug, action: "feed", open: true });
ok((await neil("/api/comments", { t: trip.slug, postId: neilPost, body: "Back open" })).status === 200, "open it again for 30 days");

// ---- deleting a post: your own
r = await paddy("/api/posts", { t: trip.slug, action: "delete", id: neilPost });
ok(r.status === 403, "not someone else's");
r = await neil("/api/posts", { t: trip.slug, action: "delete", id: neilPost });
ok(r.status === 200 && sql(`select count(*) from posts where id='${neilPost}'`) === "0", "your own, gone");

// ---- open scoring again
r = await org("/api/admin", { t: trip.slug, action: "reopen" });
ok(r.status === 200 && sql(`select (finished_at is null)::text from tournaments where id='${trip.id}'`) === "true", "Open scoring again");
ok(sql(`select status from rounds where tournament_id='${trip.id}'`) === "complete" || sql(`select status from rounds where tournament_id='${trip.id}'`) === "live", "the round goes back as it was");
st = await org("/api/admin", { t: trip.slug, action: "state" });
ok(st.j.finish.autoDay === day(3), `it finishes by itself 3 days later (${st.j.finish.autoDay})`);

// ================================================================ finishing by itself, and the day before
const org2 = agent();
const due = await make(org2, "una@example.ie", {
  who: "individuals",
  name: "Due Tomorrow Cup",
  win: "stroke",
  rounds: [{ courseName: "Seaview Links", manualCard: card9, holeSet: "all", format: "stroke", date: day(5) }],
  players: [{ name: "Una One" }, { name: "Tom Two" }],
  draw: "random",
  prizes: [],
  extras: { ai: false },
  theme: "spring",
});
const gone = await make(org2, "una@example.ie", {
  who: "individuals",
  name: "Over Already Cup",
  win: "stroke",
  rounds: [{ courseName: "Seaview Links", manualCard: card9, holeSet: "all", format: "stroke", date: day(5) }],
  players: [{ name: "Una One" }, { name: "Tom Two" }],
  draw: "random",
  prizes: [],
  extras: { ai: false },
  theme: "spring",
});
sql(`update rounds set play_date='${day(-2)}' where tournament_id='${due.id}'`);
sql(`update rounds set play_date='${day(-3)}' where tournament_id='${gone.id}'`);
r = await fetch(`${BASE}/api/cron/finish?force=1`, CRON).then((x) => x.json());
ok(r.ok && r.warned >= 1, `the hourly run (${JSON.stringify(r)})`);
m = await waitFor(() => allTo("una@example.ie").filter((x) => /finishes tomorrow/.test(x.subject)).pop());
ok(!!m && m.subject === "Due Tomorrow Cup finishes tomorrow" && /Anything to fix\?/.test(m.text) && /Finish it now/.test(m.text) && /Check the scores/.test(m.text), "the day before: \"Due Tomorrow Cup finishes tomorrow. Anything to fix?\"");
ok(sql(`select finished_by from tournaments where id='${gone.id}'`) === "Finished by itself after the last round", "3 days after the last round, it finished by itself");
ok(sql(`select (finished_at is null)::text from tournaments where id='${due.id}'`) === "true", "not a day early");
const nWarn = allTo("una@example.ie").filter((x) => /finishes tomorrow/.test(x.subject)).length;
await fetch(`${BASE}/api/cron/finish?force=1`, CRON);
await sleep(400);
ok(allTo("una@example.ie").filter((x) => /finishes tomorrow/.test(x.subject)).length === nWarn, "the day-before email goes once");
ok(sql(`select (finished_at is null)::text from tournaments where id='${trip.id}'`) === "true", "a trip whose scoring was opened again waits its 3 days");

// ================================================================ on your own
const me = agent();
const solo = await make(me, "sean@example.ie", {
  who: "solo",
  name: "Saturday at Seaview",
  rounds: [{ courseName: "Seaview Links", manualCard: card9, holeSet: "all", format: "stroke", date: day(0) }],
  players: [{ name: "Seán Solo", index: 12 }],
  extras: { ai: true, feed: true, video: true },
  theme: "spring",
});
ok(sql(`select solo::text from tournaments where id='${solo.id}'`) === "true", "Just me: marked as a round on your own");
const sid = sql(`select id from players where tournament_id='${solo.id}'`);
r = await me("/api/player", { t: solo.slug, action: "me" });
ok(r.status === 200 && r.j.bioDue === "first" && r.j.emailDue === null, "the bio is offered before the first round; no email ask (they set it up with one)");
await me("/api/player", { t: solo.slug, action: "bio", bio: { home_club: "Seaview", worst_club: "Wedges" }, done: true });
r = await scoreAll(me, solo.slug, solo.id, { [sid]: (h) => PAR9[h - 1] + (h === 9 ? 1 : 0) });
ok(r.status === 200, "nine holes in");
const fin = await waitFor(() => sql(`select finished_by from tournaments where id='${solo.id}'`) || null);
ok(fin === "Finished when the last hole was saved", `the last hole finishes it (${fin})`);
const wu = await waitFor(() => sql(`select status from ai_pieces where tournament_id='${solo.id}' and kind='tournament'`) || null);
ok(wu === "published", `the write-up of the round, published straight away (${wu})`);
const prompt = fs.readdirSync("/var/tmp/ospg").filter((f) => /^prompt-\d+\.txt$/.test(f)).map((f) => fs.readFileSync(`/var/tmp/ospg/${f}`, "utf8")).filter((x) => /WRITE-UP/.test(x)).pop() ?? "";
ok(/played on their own/.test(prompt) && /never say won, winner, champion/.test(prompt) && /HOLE-BY-HOLE/.test(prompt) && !/TOURNAMENT STANDINGS/.test(prompt), "written as a round on your own, from the card, with no winner");
ok((await me("/api/score", { t: solo.slug, roundId: roundId(solo.id), game: gameOf(solo.id).id, hole: 9, scores: { [sid]: { gross: 6 } }, final: true })).status === 200, "on your own, you can still fix your card");

// the round page
const soloPhone = await b.newContext({ ...devices["iPhone 13"] });
await soloPhone.addCookies([browserCookie(me)]);
p = await soloPhone.newPage();
await p.goto(`${BASE}/t/${solo.slug}`, { waitUntil: "networkidle" });
await p.locator(".round-page").waitFor();
const rp = await p.locator(".round-page").innerText();
ok(/My round at Seaview Links/.test(rp), "the round page: My round at Seaview Links");
ok(/\b37\b/.test(rp) && /\+1/.test(rp), `the score big: 37, +1`);
ok(!/Winner|champion|Final leaderboard|Prizes/i.test(rp), "no winner, leaderboard or prizes");
ok(/Record another round/.test(rp) && /Bring your friends next time/.test(rp), "Record another round, and Bring your friends next time");
ok(/Make your film/.test(rp), "no film yet: Make your film");
await noOverflow(p, "round page");
await p.screenshot({ path: `${SHOTS}/stage4-round.png`, fullPage: true });
const visitor = await b.newContext({ ...devices["iPhone 13"] });
const vp = await visitor.newPage();
await vp.goto(`${BASE}/t/${solo.slug}`, { waitUntil: "networkidle" });
await vp.locator(".round-page").waitFor();
const vt = await vp.locator(".round-page").innerText();
ok(/Seán's round at Seaview Links/.test(vt) && !/Record another round|Make your film/.test(vt), "a visitor sees Seán's round, without his buttons");
r = await me(`/api/again?t=${solo.slug}`);
ok(r.j.draft?.who === "solo" && r.j.draft.name === "" && r.j.draft.players[0].name === "Seán Solo" && r.j.draft.players[0].index === "12", "Record another round: name and handicap filled in");

// My golf
r = await me("/api/account");
ok(r.j.rounds?.length === 1 && r.j.rounds[0].score === "37, +1" && r.j.rounds[0].course === "Seaview Links", `My rounds (${JSON.stringify(r.j.rounds?.[0] ?? null)})`);
ok(!(r.j.running ?? []).length, "a round on your own isn't under Running");
r = await neil("/api/account");
ok(r.j.playing?.length === 1 && !(r.j.past ?? []).length, "a trip still going: under Playing in, not Past trips");
await org("/api/admin", { t: trip.slug, action: "finish" });
r = await neil("/api/account");
ok(r.j.past?.length === 1 && r.j.past[0].was === "Played" && !(r.j.playing ?? []).length, "finished: it moves to Past trips, labelled Played");
p = await soloPhone.newPage();
await p.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await p.locator("h2", { hasText: "My rounds" }).waitFor();
ok((await p.locator("section[aria-label='My rounds'] .acct-t").count()) === 1 && (await p.getByRole("link", { name: "Record a round" }).count()) === 1, "My golf: My rounds, with Record a round");
await noOverflow(p, "My golf");
await p.screenshot({ path: `${SHOTS}/stage4-mygolf.png`, fullPage: true });

// the bio screens on a phone
const neilPhone = await b.newContext({ ...devices["iPhone 13"] });
await neilPhone.addCookies([browserCookie(neil)]);
p = await neilPhone.newPage();
await p.goto(`${BASE}/t/${trip.slug}/bio`, { waitUntil: "networkidle" });
await p.locator(".bio-flow h1", { hasText: "Your home club" }).waitFor();
ok((await p.locator(".bio-input").inputValue()) === "Birr GC", "the bio starts from what's there");
await p.getByRole("button", { name: "Next" }).click();
await p.locator(".bio-flow h1", { hasText: "Best club in the bag" }).waitFor();
ok((await p.locator(".bio-tile").count()) === 6 && (await p.locator(".bio-tile.on").innerText()) === "Driver", "one tap: six clubs, his answer picked");
await noOverflow(p, "bio");
await p.screenshot({ path: `${SHOTS}/stage4-bio.png` });

// ================================================================ films: 12 months
sql(`insert into reels (tournament_id, status, video_path, done_at, expires_at, brief) values ('${trip.id}', 'done', 'video/${trip.slug}/reel-x.mp4', now() - interval '11 months', now() + interval '20 days', '{}')`);
sql(`insert into posts (tournament_id, author_name, kind, body, media_path, visibility) values ('${due.id}', 'AI director', 'video', 'Highlights reel: Old one', 'video/${due.slug}/reel-old.mp4', 'public')`);
const oldPost = sql(`select id from posts where tournament_id='${due.id}' and author_name='AI director'`);
sql(`insert into reels (tournament_id, status, video_path, post_id, done_at, expires_at, brief) values ('${due.id}', 'done', 'video/${due.slug}/reel-old.mp4', '${oldPost}', now() - interval '13 months', now() - interval '1 day', '{}')`);
r = await fetch(`${BASE}/api/cron/finish?force=1`, CRON).then((x) => x.json());
ok(r.films?.removed === 1 && sql(`select count(*) from posts where id='${oldPost}'`) === "0" && sql(`select (film_removed_at is not null)::text from tournaments where id='${due.id}'`) === "true", `a film past 12 months goes from every page (${JSON.stringify(r.films)})`);
m = await waitFor(() => allTo("neil@example.ie").filter((x) => /film will be removed on/.test(x.subject)).pop());
ok(!!m && m.stream === "outbound" && /Films are kept for 12 months\. Download it to keep it for good\./.test(m.text) && /Download the film/.test(m.text), `a month before: the reminder (${m?.subject})`);
ok(!!allTo("orla@example.ie").find((x) => /film will be removed on/.test(x.subject)), "to the organiser too");
const nRem = allTo("neil@example.ie").length;
await fetch(`${BASE}/api/cron/finish?force=1`, CRON);
await sleep(400);
ok(allTo("neil@example.ie").length === nRem, "once");

// ================================================================ deleting an account
r = await org("/api/account", { action: "delete", keepPosts: false, confirm: true });
ok(r.status === 200, `an organiser whose trips are finished can delete their account (${r.status} ${r.j.error ?? ""})`);
r = await org2("/api/account", { action: "delete", keepPosts: false, confirm: true });
ok(r.status === 409 && /only organiser of Due Tomorrow Cup/.test(r.j.error), `the only organiser of a trip still going is asked to finish it first (${r.j.error})`);
await neil("/api/posts", { t: trip.slug, kind: "note", body: "My last post" });
r = await neil("/api/account", { action: "delete", keepPosts: false, confirm: true });
ok(r.status === 200, "Neil deletes his account and everything he posted");
m = await waitFor(() => allTo("neil@example.ie").find((x) => x.subject === "Your MyGolfBroadcast account has been deleted"));
ok(!!m, "a short email says it's done");
ok(sql(`select count(*) from accounts where email='neil@example.ie'`) === "0" && sql(`select count(*) from people where email='neil@example.ie'`) === "0", "the account goes");
ok(sql(`select coalesce(email,'none') || '|' || coalesce(home_club,'none') || '|' || name from players where id='${ids.n}'`) === "none|none|Neil Byrne", "his spot keeps the name and scores, not the email or bio");
ok(sql(`select count(*) from posts where author_player_id='${ids.n}'`) === "0", "his posts go");
ok(sql(`select count(*) from hole_entries where round_id='${roundId(trip.id)}'`) === "9", "the scores stay");
ok(sql(`select count(*) from deleted_emails`) === "2", "only a scrambled copy of the address is kept");
ok(sql(`select count(*) from deleted_emails where hash like '%neil%'`) === "0", "(scrambled)");

// A player without an email: Delete my details, keep my posts
await paddy("/api/posts", { t: trip.slug, kind: "note", body: "Paddy's photo caption" });
r = await paddy("/api/player", { t: trip.slug, action: "deleteDetails", keepPosts: true, confirm: true });
ok(r.status === 200 && sql(`select count(*) from posts where author_player_id='${ids.p}'`) === "1", "Delete my details, keep my posts");
ok((await paddy("/api/player", { t: trip.slug, action: "me" })).status === 403, "and the phone is signed out of his spot");

await b.close();
console.log(fails ? `FAIL ${fails} failed` : "ALL PASSED");
process.exit(fails ? 1 : 0);
