// Step 5, email: sending through Postmark's three streams, the new design, the marketing tick for organisers, the
// preferences page and one-tap stops, the calendar file and "the dates have changed", the evening email, bounces and
// complaints coming back, the console's Email section (words, versions, series, campaigns, stopped addresses), and
// what support may and may not do. Screenshots of the emails and the screens go to /var/tmp/ospg/shots.
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { BASE, agent, codeOf, lastMailTo, mails, signInWithEmail } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = "/var/tmp/ospg/shots";
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync("/var/tmp/ospg/mail", { recursive: true, force: true });
fs.mkdirSync("/var/tmp/ospg/mail", { recursive: true });
const T = "october-special-2026";
const tid = sql(`select id from tournaments where slug='${T}'`);
const tname = sql(`select name from tournaments where slug='${T}'`);
const CRON = { headers: { authorization: "Bearer local-cron-secret" } };
const MARKETING = "Send me news, ideas for trips and offers from MyGolfBroadcast. One tap stops them.";
const pm = async () => (await fetch("http://127.0.0.1:54321/__pmstate")).json();
const allTo = (to) => mails().filter((m) => m.to.join().toLowerCase() === to.toLowerCase());
const waitFor = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};
const mailWhere = (to, re) => waitFor(() => allTo(to).filter((m) => re.test(m.subject)).pop() ?? null);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const secret = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^SESSION_SECRET=(.*)$/m)[1].trim();
const hookPassword = createHmac("sha256", secret).update("mgs-email:postmark-webhook").digest("base64url").slice(0, 22);
const hook = (body, password = hookPassword) =>
  fetch(`${BASE}/api/email/postmark`, { method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`postmark:${password}`).toString("base64")}` }, body: JSON.stringify(body) });

// ================================================================ an organiser ticks the box in setup
const wizard = {
  who: "individuals",
  name: "Tick Test Open",
  win: "points",
  rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", format: "stableford", date: day(20) }],
  players: [{ name: "Aoife Tick" }, { name: "Brian Tick" }],
  draw: "random",
  prizes: [],
  extras: {},
  theme: "spring",
};
const aoife = agent();
let r = await aoife("/api/tournaments", { wizard, email: "aoife@example.ie", ownerPin: "1234", marketing: true });
ok(r.status === 200 && r.j.slug, `the wizard makes it (${r.status} ${r.j.error ?? r.j.slug})`);
const tickSlug = r.j.slug;
const tickId = sql(`select id from tournaments where slug='${tickSlug}'`);
ok(sql(`select marketing_wording from account_offers where email='aoife@example.ie'`) === MARKETING, "their tick is kept with the offer, word for word");
ok(sql(`select count(*) from people where email='aoife@example.ie' and marketing_at is not null`) === "0", "but it doesn't count until they confirm the email is theirs");
let m = await lastMailTo("aoife@example.ie");
ok(m?.stream === "outbound" && /^"MyGolfBroadcast" <hello@mail\.mygolfbroadcast\.com>$/.test(m.from), `sign-in goes on the service stream, from hello@mail (${m?.stream}, ${m?.from})`);
ok(/is your MyGolfBroadcast code$/.test(m.subject) && /Tick Test Open is ready/.test(m.text) && /Or type this code/.test(m.text), "with the code, and the reason it came first");
ok(/prefers-color-scheme:dark/.test(m.html) && /Button not working\?/.test(m.html) && !/<img/.test(m.html), "in the new design: dark mode, the plain link under the button, no pictures");
let st = await pm();
ok(st.streams.some((s) => s.ID === "updates" && s.MessageStreamType === "Transactional") && st.webhooks.length === 3, "Postmark was set up on the first send: an updates stream, and a webhook on each of the three");
ok(st.webhooks.every((w) => w.HttpAuth?.Username === "postmark" && w.Triggers.Bounce.Enabled && w.Triggers.SpamComplaint.Enabled && !w.Triggers.Open.Enabled), "bounces and complaints come back; opens aren't tracked");
ok(st.streams.find((s) => s.MessageStreamType === "Broadcasts").SubscriptionManagementConfiguration.UnsubscribeHandlingType === "Custom", "news and offers use our own unsubscribe");
await aoife("/api/account", { action: "code", email: "aoife@example.ie", code: codeOf(m) });
ok(sql(`select marketing_wording from people where email='aoife@example.ie'`) === MARKETING, "confirmed: now it counts, with the words they saw");

// ================================================================ a player's link, with the rounds for their calendar
const adm = agent();
await adm("/api/login", { t: T, mode: "organiser", pin: "1234" });
const pid = sql(`select id from players where tournament_id='${tid}' order by name limit 1`);
const pname = sql(`select name from players where id='${pid}' and tournament_id='${tid}'`);
await adm("/api/admin", { t: T, action: "savePlayer", player: { id: pid, email: "player1@example.ie" } });
sql(`update rounds set play_date=current_date + 10, tee_time='09:10' where tournament_id='${tid}'`);
r = await adm("/api/admin", { t: T, action: "emailLink", playerId: pid });
ok(r.status === 200, `the link goes by email (${r.status} ${r.j.error ?? ""})`);
m = await lastMailTo("player1@example.ie");
const ics = m?.attachments?.find((a) => a.filename === "rounds.ics");
ok(m?.subject === `Your link for ${tname}` && m.stream === "outbound", `"Your link for …", a service email (${m?.subject})`);
ok(new RegExp(`Hi ${pname.split(" ")[0]}, here's your link`).test(m.text) && /This link is yours alone/.test(m.text), "the new words, with the locked don't-forward line");
ok(!!ics && /BEGIN:VEVENT/.test(ics.content) && /T091000/.test(ics.content) && /text\/calendar/.test(ics.contentType), "the rounds come as a calendar file, tee time and all");
ok(/^"(Oisin via MyGolfBroadcast|The October Special)"/.test(m.from), `from "Oisin via MyGolfBroadcast", the organiser who sent it (${m.from})`);
ok(sql(`select (link_emailed_at is not null and dates_sent is not null)::text from players where id='${pid}' and tournament_id='${tid}'`) === "true", "the site remembers what dates they were sent");

// ================================================================ the dates change
sql(`update rounds set tee_time='10:30' where tournament_id='${tid}' and number=1`);
r = await fetch(`${BASE}/api/cron/email?force=evening`, CRON).then((x) => x.json());
ok(r.ran === "evening", "the 8pm run");
m = await mailWhere("player1@example.ie", /^New dates for/);
ok(!!m && /The dates have changed/.test(m.text) && /Round 1: .*10:30/.test(m.text) && /T103000/.test(m.attachments?.[0]?.content ?? ""), "the player hears the dates changed, with the new tee time and a fresh calendar file");
const before = allTo("player1@example.ie").length;
await fetch(`${BASE}/api/cron/email?force=evening`, CRON);
await sleep(500);
ok(allTo("player1@example.ie").length === before, "and only once");

// ================================================================ updates: signed up, the evening email, one tap stops them
const anon = agent();
await anon("/api/subscribe", { t: T, email: "sub@example.ie", name: "Sorcha Sub" });
await anon("/api/subscribe", { t: T, email: "every@example.ie", name: "Eoin Every" });
m = await lastMailTo("sub@example.ie");
ok(m?.stream === "updates" && m.from.includes(tname) && /updates@news\.mygolfbroadcast\.com/.test(m.from), `signed up: an update, from the tournament's name at updates@news (${m?.from})`);
ok(m.headers["list-unsubscribe-post"] === "List-Unsubscribe=One-Click" && /\/api\/email\/stop\?k=/.test(m.headers["list-unsubscribe"]), "mail apps get the one-tap unsubscribe");
ok(/Change what you get/.test(m.html) && /\[Company address, to be added\]/.test(m.html), "the footer: change what you get, and the placeholder address");
const prefsOf = (mail) => new URL(mail.text.match(/Change what you get: (\S+)/)[1]).searchParams.get("k");
const subKey = prefsOf(m);
r = await anon("/api/email/prefs", { action: "load", k: subKey });
ok(r.status === 200 && r.j.prefs.email === "sub@example.ie" && r.j.prefs.tournaments[0]?.on === true && r.j.stops === null, "the preferences page opens from the link, no sign-in");
ok((await anon("/api/email/prefs", { action: "load", k: subKey.replace(/.$/, "x") })).status === 400, "a changed link doesn't");
r = await anon("/api/email/prefs", { action: "save", k: subKey, patch: { tournaments: [{ id: tid, on: true, evening: true }] } });
ok(r.j.prefs?.tournaments[0]?.evening === true, "they choose one email each evening");

// A piece: everyone else gets it now, the evening people later
r = await adm("/api/admin", { t: T, action: "aiGenerate", kind: "report", roundId: sql(`select id from rounds where tournament_id='${tid}' and number=1`) });
const pieceId = r.j.piece?.id;
await adm("/api/admin", { t: T, action: "aiUpdate", id: pieceId, status: "published" });
r = await adm("/api/admin", { t: T, action: "emailPiece", id: pieceId });
ok(r.status === 200 && r.j.sent >= 1, `the piece goes to the list (${r.j.sent})`);
m = await waitFor(() => allTo("every@example.ie").filter((x) => x.stream === "updates" && !/signed up/i.test(x.subject)).pop());
ok(!!m && new RegExp(`\\| ${tname}$`).test(m.subject) && /Stop these emails/.test(m.html), `every update: "{headline} | {tournament}" (${m?.subject})`);
ok(!/Run your own golf event/.test(m.html), "and no advert in an update");
ok(!allTo("sub@example.ie").some((x) => x.subject === m.subject), "the evening person doesn't get it now");
await fetch(`${BASE}/api/cron/email?force=evening`, CRON);
m = await mailWhere("sub@example.ie", /^Today at/);
ok(!!m && m.stream === "updates" && /Read it on the site/.test(m.text) && m.text.toLowerCase().includes(sql(`select title from ai_pieces where id='${pieceId}'`).toLowerCase()), "they get it at 8pm, in the evening email");

// One tap in the mail app
const everyMail = allTo("every@example.ie").filter((x) => x.stream === "updates").pop();
const oneTap = everyMail.headers["list-unsubscribe"].replace(/^<|>$/g, "").replace("https://mygolfbroadcast.com", BASE);
r = await fetch(oneTap.replace(/^http:\/\/[^/]+/, BASE), { method: "POST", body: "List-Unsubscribe=One-Click" });
ok(r.status === 200 && sql(`select (unsubscribed_at is not null)::text from subscribers where email='every@example.ie'`) === "true", "the mail app's unsubscribe button stops them at once");
ok(sql(`select count(*) from email_sends where email='every@example.ie' and stopped_at is not null`) === "1", "counted against the email it came from");
r = await fetch(oneTap.replace(/^http:\/\/[^/]+/, BASE), { redirect: "manual" });
ok(r.status === 303 && /\/email\?k=/.test(r.headers.get("location") ?? ""), "opened in a browser instead, it shows the page (link checkers can't unsubscribe anyone)");

// ================================================================ the preferences page, on a phone
const browser = await chromium.launch();
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await phone.newPage();
const stopLink = everyMail.text.match(/Stop these emails: (\S+)/)[1].replace(/^https?:\/\/[^/]+/, BASE);
await anon("/api/email/prefs", { action: "save", k: prefsOf(everyMail), patch: { tournaments: [{ id: tid, on: true }] } });
await page.goto(stopLink, { waitUntil: "networkidle" });
await page.getByText(`Stop emails about ${tname}?`).waitFor({ timeout: 15000 });
await page.screenshot({ path: `${SHOTS}/email-stop.png`, fullPage: true });
await page.getByRole("button", { name: "Stop them" }).click();
await page.getByText(`Done. You won't get emails about ${tname} any more.`).waitFor({ timeout: 10000 });
ok(sql(`select (unsubscribed_at is not null)::text from subscribers where email='every@example.ie'`) === "true", "the footer's Stop these emails: asks, then stops");
await page.getByRole("radio", { name: "One email each evening" }).click();
await page.getByText("Saved").waitFor({ timeout: 10000 });
ok(sql(`select (unsubscribed_at is null and evening)::text from subscribers where email='every@example.ie'`) === "true", "and they can choose the evening email instead, there and then");
await page.screenshot({ path: `${SHOTS}/email-prefs.png`, fullPage: true });

// ================================================================ bounces and complaints come back from Postmark
ok((await hook({ RecordType: "Bounce", Type: "HardBounce", Email: "bounce@example.ie" }, "wrong")).status === 401, "Postmark's notices need its password");
await hook({ RecordType: "Bounce", Type: "HardBounce", TypeCode: 1, Email: "bounce@example.ie", Description: "The address doesn't exist", Inactive: true });
ok(/^Bounced/.test(sql(`select reason from email_blocks where email='bounce@example.ie'`)), "a hard bounce stops the address");
await hook({ RecordType: "Bounce", Type: "SoftBounce", Email: "soft@example.ie", Name: "Soft bounce", Description: "Mailbox full" });
ok(sql(`select count(*) from email_blocks where email='soft@example.ie'`) === "0" && sql(`select count(*) from email_failures where email='soft@example.ie'`) === "1", "a soft bounce is only counted");
await hook({ RecordType: "SpamComplaint", Email: "every@example.ie", MessageID: everyMail.messageId });
ok(sql(`select marketing_stopped_reason || ',' || (updates_stopped_at is not null) from people where email='every@example.ie'`) === "spam,true", "a spam complaint stops marketing and updates");
ok(sql(`select (unsubscribed_at is not null)::text from subscribers where email='every@example.ie'`) === "true" && sql(`select status from email_sends where message_id='${everyMail.messageId}'`) === "complained", "their sign-up is stopped, and the email marked");
await anon("/api/subscribe", { t: T, email: "every@example.ie", name: "Eoin" });
await sleep(400);
ok(sql(`select (updates_stopped_at is not null)::text from people where email='every@example.ie'`) === "true", "someone signing them up again from a form doesn't restart updates");
m = await mailWhere("every@example.ie", /^Updates from/);
ok(!!m && m.stream === "outbound" && /You'd stopped our emails/.test(m.text) && /Change what you get/.test(m.text), "instead they're told how to turn them back on themselves");

// ================================================================ the console: every email's words
const owner = agent();
await signInWithEmail(owner, "owner@test.ie");
await owner("/api/owner", { action: "sendCode" });
await owner("/api/owner", { action: "code", code: codeOf(await lastMailTo("owner@test.ie")) });
const view = async (a, v, p = {}) => {
  const res = await fetch(`${BASE}/api/console/email?${new URLSearchParams({ view: v, ...p })}`, { headers: { cookie: a.cookie(), "x-console": "1" } });
  return { status: res.status, j: await res.json().catch(() => ({})) };
};
const act = (a, body) => a("/api/console/email", body);
ok((await fetch(`${BASE}/api/console/email?view=every`, { headers: { cookie: owner.cookie() } })).status === 400, "the Email section can't be read from a plain link");
r = await view(owner, "every");
ok(r.status === 200 && r.j.emails.length === 15 && r.j.internal.length === 4, `Every email: 15 to edit (with the three for the end of a trip), 4 to you and support (${r.j.emails?.length})`);
ok(r.j.emails.find((e) => e.key === "sign-in").sent30 >= 2, "with how many went in the last 30 days");
r = await act(owner, { action: "preview", key: "player-link", words: { subject: "Here's your link for {tournament}", headline: "Hi {first name}", lines: "Tap it.", button: "Open my link" } });
ok(r.status === 200 && /Kinsale Spring Classic/.test(r.j.html) && r.j.subject === "Here's your link for Kinsale Spring Classic", "a preview of unsaved words, filled in with made-up details");
r = await act(owner, { action: "words.save", key: "player-link", words: { subject: "Your code {code}", headline: "Hi", lines: "Tap it.", button: "Open" } });
ok(r.status === 400 && /\{code\} isn't something this email can fill in/.test(r.j.error), `a placeholder it can't fill is refused: ${r.j.error}`);
r = await act(owner, { action: "words.save", key: "player-link", words: { subject: "Here's your link for {tournament}", headline: "Hi {first name}, it's ready", lines: "Tap it on your phone.\n\nSee you on the first tee.", button: "Open my link" } });
ok(r.status === 200 && r.j.version === 1, "the owner saves new words: version 1");
// (the organiser's PIN stopped working when the owner signed in: the owner opens it as organiser instead)
await owner("/api/console", { action: "tournament.open", id: tid });
r = await owner("/api/admin", { t: T, action: "emailLink", playerId: pid });
ok(r.status === 200, `the link is sent again (${r.status} ${r.j.error ?? ""})`);
m = await mailWhere("player1@example.ie", /^Here's your link/);
ok(!!m && /See you on the first tee/.test(m.text) && /This link is yours alone/.test(m.text), "what goes out uses them at once, the locked line still there");
await act(owner, { action: "words.save", key: "player-link", words: { subject: "Link: {tournament}", headline: "Hi", lines: "Tap.", button: "Open" } });
r = await act(owner, { action: "words.restore", key: "player-link", version: 1 });
ok(r.status === 200 && r.j.version === 3, "go back to version 1: saved as version 3");
r = await view(owner, "email", { key: "player-link" });
ok(r.j.words.subject === "Here's your link for {tournament}" && r.j.versions.length === 3 && r.j.versions[0].restored_from === 1, "with every version kept");
r = await act(owner, { action: "words.save", key: "player-link", starting: true });
ok(r.status === 200 && (await view(owner, "email", { key: "player-link" })).j.words.subject === "Your link for {tournament}", "and back to the starting words");
r = await act(owner, { action: "test", key: "film-ready" });
m = await mailWhere("owner@test.ie", /^Test: Your film is ready/);
ok(r.status === 200 && !!m, "Send me a test: to their own email, marked Test");
ok(sql(`select count(*) from activity where action in ('email.words','email.restore','email.test')`) === "5", "every save, go-back and test is in the activity record");
r = await act(owner, { action: "settings.save", address: "MyGolfBroadcast Ltd, 1 Main Street, Clonmel", support: "help@mygolfbroadcast.com" });
ok(r.status === 200, "the postal address and support mailbox are set in Settings");
r = await act(owner, { action: "preview", key: "signed-up" });
ok(/1 Main Street, Clonmel/.test(r.j.html), "the footer shows the address");

// ================================================================ series
r = await act(owner, { action: "series.switch", key: "comeback", on: true });
ok(r.status === 400 && /Write the words/.test(r.j.error), "Come back can't be switched on before its words are written");
r = await act(owner, { action: "series.switch", key: "welcome", on: true });
ok(r.status === 200, "Welcome is switched on");
// Aoife has run one before (it's been played), so she can start another without an invite
r = await aoife("/api/tournaments", { wizard: { ...wizard, name: "Too Soon" } });
ok(r.status === 401, "not before her first one has been played");
sql(`update rounds set play_date = current_date - 14 where tournament_id='${tickId}'`);
sql(`delete from tournament_stats where tournament_id='${tickId}'`);
r = await aoife("/api/tournaments", { wizard: { ...wizard, name: "Second Spin" } });
ok(r.status === 200, `someone who's run one before can start another without an invite (${r.status} ${r.j.error ?? ""})`);
const spinId = sql(`select id from tournaments where slug='${r.j.slug}'`);
m = await mailWhere("aoife@example.ie", /^Second Spin is ready to share/);
ok(!!m && m.stream === "updates" && /Stop tips like this/.test(m.html), "straight after setup: the first welcome tip, with its own stop link");
const tap = m.text.match(/Open my tournament: (\S+)/)?.[1];
r = await fetch(tap.replace(/^https?:\/\/[^/]+/, BASE), { redirect: "manual" });
ok(r.status === 302 && /\/admin$/.test(r.headers.get("location") ?? ""), "its button goes through the tap counter to the organiser page");
ok(sql(`select count(*) from email_sends where tournament_id='${spinId}' and clicked_at is not null`) === "1", "and the tap is counted");
r = await fetch(`${BASE}/api/email/go?s=${tap.match(/s=([^&]+)/)[1]}&u=${encodeURIComponent("https://evil.example")}&k=x`, { redirect: "manual" });
ok(!/evil/.test(r.headers.get("location") ?? ""), "the tap counter won't send anyone elsewhere");
// Two days on, with no player links sent
sql(`update tournaments set created_at = now() - interval '2 days' where id='${spinId}'`);
// Your own trip: Tick Test Open finished a fortnight ago; a follower with the tick
await anon("/api/subscribe", { t: tickSlug, email: "fan2@example.ie", name: "Fionn Fan" });
sql(`update people set marketing_at=now(), marketing_wording='test' where email='fan2@example.ie'`);
await act(owner, { action: "series.switch", key: "owntrip", on: true });
r = await fetch(`${BASE}/api/cron/email?force=morning`, CRON).then((x) => x.json());
ok(r.ran === "morning", "the 10am run");
m = await mailWhere("aoife@example.ie", /^Send your players their links/);
ok(!!m, "day 2, no links sent: the second tip");
ok(!allTo("aoife@example.ie").some((x) => /^Tick Test Open is ready/.test(x.subject)), "no setting-up tips for a trip that's already been played");
m = await mailWhere("fan2@example.ie", /^Fancy running your own trip\?/);
ok(!!m && m.stream === "broadcast" && /hello@news\.mygolfbroadcast\.com/.test(m.from) && /Tick Test Open was covered/.test(m.text), "two weeks after the trip: Your own trip, on the marketing stream from hello@news");
ok(!allTo("aoife@example.ie").some((x) => /Fancy running/.test(x.subject)), "never to someone who runs a tournament");
const n1 = mails().length;
await fetch(`${BASE}/api/cron/email?force=morning`, CRON);
await sleep(500);
ok(mails().filter((x) => /Fancy running|Send your players/.test(x.subject)).length === 2 && mails().length >= n1, "each step goes once");
r = await view(owner, "seriesOne", { key: "owntrip" });
ok(r.j.steps[0].stats.sent === 1, "the series page counts what went");
r = await act(owner, { action: "series.add", key: "welcome", from: "round1", days: 1 });
ok(r.status === 200 && r.j.step, "a step can be added (switched off until its words are written)");
r = await act(owner, { action: "series.remove", key: "welcome", step: "links" });
ok(r.status === 400, "the starting steps can be switched off, not removed");

// ================================================================ campaigns
r = await act(owner, { action: "campaign.create", name: "Spring news" });
const cid = r.j.id;
r = await act(owner, {
  action: "campaign.save",
  id: cid,
  subject: "Spring news for {first name}",
  blocks: [
    { type: "headline", text: "New this spring" },
    { type: "paragraph", text: "Hi {first name}, films are quicker now.\n\nSee you on the first tee." },
    { type: "button", label: "Start a tournament", href: "/new" },
    { type: "quote", text: "The lads loved it.", by: "An organiser" },
  ],
  audience: {},
});
ok(r.status === 200, "a campaign is written from blocks");
ok((await act(owner, { action: "campaign.save", id: cid, blocks: [{ type: "button", label: "Go", href: "javascript:alert(1)" }] })).status === 400, "a button's link has to be a real link");
ok((await act(owner, { action: "campaign.save", id: cid, subject: "Hi {code}" })).status === 400, "and only the placeholders a campaign can fill");
r = await act(owner, { action: "campaign.count", audience: {} });
ok(r.j.total >= 2 && r.j.held >= 1, `only people with the tick: ${r.j.total}, ${r.j.held} held back (had one this week or on a trip)`);
r = await act(owner, { action: "campaign.draft", brief: "spring offer on films, ends 30 April" });
ok(r.status === 200 && r.j.subject && r.j.blocks.some((b) => b.type === "paragraph"), "Draft it for me writes a first draft");
r = await act(owner, { action: "test", key: "campaign", subject: "Spring news for {first name}", blocks: [{ type: "paragraph", text: "Hello" }] });
ok(r.status === 200 && !!(await mailWhere("owner@test.ie", /^Test: Spring news/)), "a test goes to the owner");
sql(`update people set name='Aoife Tick' where email='aoife@example.ie'`);
r = await act(owner, { action: "campaign.send", id: cid });
ok(r.status === 200, "the owner sends it");
const sent = await waitFor(() => sql(`select status from email_campaigns where id='${cid}'`) === "sent");
ok(!!sent, "it finishes");
m = await mailWhere("aoife@example.ie", /^Spring news for Aoife/);
ok(!!m && m.stream === "broadcast" && /The lads loved it/.test(m.text) && /Stop these emails/.test(m.html), "Aoife gets it, filled in, on the marketing stream");
ok(!allTo("fan2@example.ie").some((x) => /Spring news/.test(x.subject)), "the follower who had Your own trip this week doesn't");
ok(!allTo("sub@example.ie").some((x) => /Spring news/.test(x.subject)), "nor anyone without the tick");
const aoifeTap = m.text.match(/Start a tournament: (\S+)/)?.[1];
await fetch(aoifeTap.replace(/^https?:\/\/[^/]+/, BASE), { redirect: "manual" });
const unsub = m.headers["list-unsubscribe"].replace(/^<|>$/g, "").replace(/^https?:\/\/[^/]+/, BASE);
await fetch(unsub, { method: "POST" });
ok(sql(`select marketing_stopped_reason from people where email='aoife@example.ie'`) === "unsubscribed", "her one tap stops marketing");
r = await view(owner, "campaigns");
const row = r.j.campaigns.find((c) => c.id === cid);
ok(row.stats.sent >= 1 && row.stats.clicked === 1 && row.stats.stopped === 1, `the campaign's figures: sent ${row.stats.sent}, tapped 1, stopped 1`);
ok((await act(owner, { action: "campaign.save", id: cid, subject: "Changed" })).status === 400, "a sent campaign can't be changed");
r = await act(owner, { action: "campaign.copy", id: cid });
ok(r.status === 200 && r.j.id, "but it can be copied");
r = await act(owner, { action: "campaign.schedule", id: r.j.id, send_on: day(-1) });
ok(r.status === 400, "nothing can be scheduled for yesterday");

// ================================================================ support may write, not send
r = await owner("/api/console", { action: "settings.staff-add", email: "help@test.ie" });
const staff = agent();
await signInWithEmail(staff, "help@test.ie");
await staff("/api/owner", { action: "sendCode" });
await staff("/api/owner", { action: "code", code: codeOf(await lastMailTo("help@test.ie")) });
ok((await view(staff, "every")).status === 200, "support see the Email section");
ok((await act(staff, { action: "words.save", key: "sign-in", words: { subject: "x", headline: "x", lines: "x", button: "x" } })).status === 403, "but can't change an email's words");
ok((await act(staff, { action: "series.switch", key: "welcome", on: false })).status === 403, "or switch a series");
r = await act(staff, { action: "campaign.create", name: "Support's draft" });
ok(r.status === 200, "they can start a campaign");
await act(staff, { action: "campaign.save", id: r.j.id, subject: "Hello", blocks: [{ type: "paragraph", text: "Hello" }] });
ok((await act(staff, { action: "campaign.send", id: r.j.id })).status === 403, "but only the owner sends it");
ok((await act(staff, { action: "stopped.lift", email: "bounce@example.ie" })).status === 403, "nor lift a stop");

// ================================================================ stopped addresses
r = await view(owner, "stopped");
const rowOf = (e) => r.j.rows.find((x) => x.email === e);
ok(rowOf("bounce@example.ie")?.why === "Bounced" && rowOf("bounce@example.ie").lift, "Stopped: the bounce, which you can lift");
ok(rowOf("every@example.ie")?.why === "Marked as spam" && !rowOf("every@example.ie").lift, "the spam complaint, which only they can undo");
ok(r.j.health.month.complained >= 1 && r.j.health.month.complaintRate > 0, `the health line counts it (${(r.j.health.month.complaintRate * 100).toFixed(2)}%)`);
ok((await act(owner, { action: "stopped.lift", email: "every@example.ie" })).status === 400, "lifting a spam complaint is refused");
r = await act(owner, { action: "stopped.lift", email: "bounce@example.ie" });
ok(r.status === 200 && sql(`select count(*) from email_blocks where email='bounce@example.ie'`) === "0" && (await pm()).reactivated?.includes("bounce@example.ie"), "lifting a bounce lets Postmark send to it again too");
r = await act(owner, { action: "setup.postmark" });
ok(r.status === 200 && r.j.setup.streams.updates === "updates", "Set up Postmark can be run again safely");

// ================================================================ the emails themselves, and the screens
const shotMail = async (mail, name, dark = false) => {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" })).newPage();
  await p.setContent(mail.html, { waitUntil: "load" });
  await p.screenshot({ path: `${SHOTS}/mail-${name}${dark ? "-dark" : ""}.png`, fullPage: true });
};
await shotMail(await lastMailTo("player1@example.ie"), "player-link");
await shotMail(await lastMailTo("player1@example.ie"), "player-link", true);
await shotMail(await mailWhere("sub@example.ie", /^Today at/), "evening");
await shotMail(await mailWhere("fan2@example.ie", /^Fancy/), "owntrip");
await shotMail(await mailWhere("aoife@example.ie", /^Spring news/), "campaign");
await shotMail(allTo("aoife@example.ie").find((x) => /is your MyGolfBroadcast code$/.test(x.subject)), "sign-in");
await shotMail(allTo("aoife@example.ie").find((x) => /is your MyGolfBroadcast code$/.test(x.subject)), "sign-in", true);
const desk = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await desk.addCookies([{ name: owner.cookie().split("=")[0], value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
const d = await desk.newPage();
for (const [path, name, wait] of [
  ["/console/email", "every", "Service emails"],
  ["/console/email/edit?key=player-link", "edit", "Send me a test"],
  ["/console/email/series", "series", "Welcome, for new organisers"],
  ["/console/email/series/welcome", "series-one", "The steps"],
  [`/console/email/campaigns/${cid}`, "campaign", "How it went"],
  ["/console/email/stopped", "stopped", "Bounced"],
]) {
  await d.goto(BASE + path, { waitUntil: "networkidle" });
  await d.getByText(wait).first().waitFor({ timeout: 20000 });
  await sleep(900);
  await d.screenshot({ path: `${SHOTS}/console-email-${name}.png`, fullPage: true });
}
const cnew = await act(owner, { action: "campaign.create", name: "Screens" });
await d.goto(`${BASE}/console/email/campaigns/${cnew.j.id}`, { waitUntil: "networkidle" });
await d.getByRole("button", { name: "Add headline" }).click();
await d.getByLabel("Headline").fill("New this spring");
await d.getByRole("button", { name: "Add paragraph" }).click();
await d.getByLabel("Paragraph").fill("Hi {first name}, films are quicker now.");
await d.getByRole("button", { name: "Add button" }).click();
await d.getByLabel("Button words").fill("Start a tournament");
await d.getByLabel("Subject").fill("Spring news for {first name}");
await sleep(2000);
await d.screenshot({ path: `${SHOTS}/console-email-campaign-draft.png`, fullPage: true });
ok(sql(`select subject from email_campaigns where id='${cnew.j.id}'`) === "Spring news for {first name}", "the campaign editor saves as you go");
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mob.addCookies([{ name: owner.cookie().split("=")[0], value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
const mp = await mob.newPage();
await mp.goto(`${BASE}/console/email/edit?key=sign-in`, { waitUntil: "networkidle" });
await mp.getByText("Send me a test").first().waitFor({ timeout: 20000 });
await sleep(900);
await mp.screenshot({ path: `${SHOTS}/console-email-edit-phone.png`, fullPage: true });
await mp.locator(".em-frame").scrollIntoViewIfNeeded();
await sleep(500);
await mp.locator(".em-frame").screenshot({ path: `${SHOTS}/console-email-edit-phone-frame.png` });
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
