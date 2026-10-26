// Stage 3, the console: who can open it (the owner, support staff), what each sees, Needs you and its buttons, money
// and budgets, the activity record (and that nobody can change it), exports, signing someone out everywhere, the
// daily jobs, and the screens on a laptop and a phone.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import { BASE, agent, codeOf, lastMailTo, mails, signInWithEmail } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const SHOTS = "/var/tmp/ospg/shots";
const T = "october-special-2026";
const tid = sql(`select id from tournaments where slug='${T}'`);
const view = (a, v, p = {}) => a(`/api/console?${new URLSearchParams({ view: v, ...p })}`);
const raw = (a, path) => fetch(BASE + path, { headers: { cookie: a.cookie() } });

// ================================================================ the owner gets in
const owner = agent();
let r = await view(owner, "me");
ok(r.j.user === null && r.j.allowed === false, "signed out: no way in");
await signInWithEmail(owner, "owner@test.ie");
r = await view(owner, "me");
ok(r.j.user === null && r.j.allowed === true, "the owner's email, before the second check: not in yet");
ok((await view(owner, "overview")).status === 401, "and no figures until the check");
await owner("/api/owner", { action: "sendCode" });
const check = await lastMailTo("owner@test.ie");
ok(/console/.test(check.text) && /\/console\?check=/.test(check.text), "the check email talks about the console and links to it");
await owner("/api/owner", { action: "code", code: codeOf(check) });
r = await view(owner, "me");
ok(r.j.user?.role === "owner", "through the check: the owner");
ok(sql(`select count(*) from activity where action='console.signin'`) === "1", "the sign-in is in the activity record");

// ================================================================ the front page and the lists
r = await view(owner, "overview");
ok(r.status === 200 && r.j.figures.length === 6, "six figures on the front page");
ok(r.j.figures.find((f) => f.key === "spend").value > 0, `spend this month is recorded (${r.j.figures.find((f) => f.key === "spend").value} cents)`);
ok(Array.isArray(r.j.live) && Array.isArray(r.j.coming) && r.j.growth.length === 12, "live now, coming up and 12 weeks of growth");
ok(["green", "amber", "red"].includes(r.j.health.light), `the health line: ${r.j.health.words}`);
r = await view(owner, "tournaments", { q: "october" });
ok(r.j.rows.some((t) => t.slug === T), "Tournaments: search by name");
r = await view(owner, "tournaments", { sort: "players", dir: "desc" });
ok(r.j.rows.length >= 1 && r.j.total >= 1, "and sort by players");
r = await view(owner, "tournament", { id: tid });
ok(r.j.tournament?.slug === T && r.j.people.length > 0 && r.j.timeline.length > 0 && !!r.j.money, "a tournament's page: summary, people, timeline, money");
r = await view(owner, "search", { q: "octo" });
ok(r.j.tournaments.some((t) => t.slug === T), "the search box finds it");

// People: everyone with an email, one line each
const fan = agent();
await fan("/api/fans", { t: T, action: "profile", name: "Maeve Byrne", how: "Neil's sister", email: "maeve@example.ie", marketing: true, over16: true });
await fan("/api/account", { action: "code", email: "maeve@example.ie", code: codeOf(await lastMailTo("maeve@example.ie")) });
r = await view(owner, "people", { q: "maeve" });
ok(r.j.rows.length === 1 && r.j.rows[0].roles.includes("follower") && !!r.j.rows[0].marketing_at, "People: a follower who gave an email, with marketing ticked");
r = await view(owner, "person", { email: "maeve@example.ie" });
ok(r.j.consent?.wording && r.j.consent.tournament && r.j.tournaments.some((t) => t.role === "Follower"), "her page: the exact words she saw, where, and her tournaments");
ok(sql(`select count(*) from activity where action='person.view' and person='maeve@example.ie'`) === "1", "looking at her page is recorded");

// ================================================================ exports
let res = await raw(owner, "/api/console/export?what=marketing");
const csv = await res.text();
ok(res.status === 200 && /maeve@example.ie/.test(csv) && /The words they saw/.test(csv), "the marketing list exports, with the words they saw");
ok(sql(`select count(*) from activity where action='export.marketing'`) === "1", "and the export is recorded");
sql(`update people set name = '=HYPERLINK(1)' where email='maeve@example.ie'`);
ok(/'=HYPERLINK/.test(await (await raw(owner, "/api/console/export?what=people&q=maeve")).text()), "a name typed as a formula exports as text");
sql(`update people set name = 'Maeve Byrne' where email='maeve@example.ie'`);

// ================================================================ Needs you
// A post reported twice
const post = sql(`select id from posts where tournament_id='${tid}' and hidden=false order by created_at limit 1`);
// (one report already in, from someone else)
sql(`insert into reports (tournament_id, post_id, reporter) values ('${tid}', '${post}', 'someone-else')`);
await agent()("/api/reports", { t: T, postId: post });
r = await view(owner, "needs", { kind: "report" });
const rep = r.j.items.find((i) => i.subject === post);
ok(!!rep, "a post reported twice is in Needs you");
r = await owner("/api/console", { action: "needs.hide", id: rep.id });
ok(r.status === 200 && sql(`select hidden from posts where id='${post}'`) === "t", "Hide it: hidden");
ok(sql(`select resolved_by from queue where id='${rep.id}'`) === "owner@test.ie", "cleared, by the owner");
// An invite request
await agent()("/api/invites", { action: "request", name: "Rory Walsh", email: "rory@example.ie", about: "A trip to Kerry" });
r = await view(owner, "needs", { kind: "invite" });
const inv = r.j.items[0];
ok(inv?.title === "Invite request: Rory Walsh", "an invite request is in Needs you");
ok(/Rory Walsh/.test((await lastMailTo("owner@test.ie")).subject), "and the console's address is told");
r = await owner("/api/console", { action: "needs.approve", id: inv.id });
ok(r.status === 200 && /invited/.test((await lastMailTo("rory@example.ie"))?.subject ?? ""), "Approve: Rory gets his invite");
// A data request from My golf
await fan("/api/account", { action: "data", kind: "copy" });
r = await view(owner, "needs", { kind: "data_request" });
const dr = r.j.items[0];
ok(dr && dr.dueAt && Date.parse(dr.dueAt) - Date.now() > 29 * 864e5, "a request for her data: in Needs you with a month to do it");
const before = mails().length;
r = await owner("/api/console", { action: "needs.sendcopy", id: dr.id });
const copy = mails()
  .slice(before)
  .find((m) => m.to.includes("maeve@example.ie"));
ok(r.status === 200 && !!copy && /Your data/.test(copy.subject), `she's emailed her copy (${copy?.subject})`);
const file = copy?.attachments?.find((a) => a.filename === "my-data.json");
ok(!!file && /maeve@example.ie/.test(file.content) && /Neil's sister/.test(file.content), "with the file attached: everything held about her");
// Snooze
const post2 = sql(`select id from posts where tournament_id='${tid}' and hidden=false order by created_at limit 1`);
sql(`insert into reports (tournament_id, post_id, reporter) values ('${tid}', '${post2}', 'someone-else')`);
await agent()("/api/reports", { t: T, postId: post2 });
r = await view(owner, "needs");
const any = r.j.items[0];
await owner("/api/console", { action: "needs.snooze", id: any.id });
r = await view(owner, "needs");
ok(!r.j.items.some((i) => i.id === any.id) && r.j.snoozed >= 1, "Snooze: out of the list until tomorrow");

// ================================================================ money: budgets stop spending
r = await view(owner, "money");
ok(r.status === 200 && r.j.services.length === 5 && r.j.services.some((s) => s.spent > 0), "Money: this month by service");
r = await owner("/api/console", { action: "money.budgets", budgets: { writing: 0.01 } });
ok(r.status === 200, "a tiny writing budget");
sql(`insert into usage (service, what, cents) values ('writing', 'test', 50)`);
const b4 = mails().length;
sql(`insert into usage (service, what, cents, tournament_id) values ('writing', 'test', 1, '${tid}')`);
// the next real call checks the budget (and an over-budget site writes nothing)
await owner("/api/owner", { action: "open", id: tid });
const gen = await owner("/api/admin", { t: T, action: "aiGenerate", kind: "bulletin", roundId: sql(`select id from rounds where tournament_id='${tid}' order by number limit 1`) });
ok(gen.status >= 400 && /budget/.test(gen.j.error ?? ""), `writing stops at the budget: "${gen.j.error}"`);
await owner("/api/console", { action: "money.budgets", budgets: { writing: 50 } });
r = await owner("/api/console", { action: "money.bill", month: "2026-09", service: "writing", dollars: 12.5 });
ok(r.status === 200 && (await view(owner, "money")).j.bills["2026-09"].writing === 1250, "a supplier's real bill, typed in");
void b4;

// ================================================================ support staff
r = await owner("/api/console", { action: "settings.staff-add", email: "help@test.ie" });
ok(r.status === 200, "the owner adds help@test.ie as support");
const staff = agent();
await signInWithEmail(staff, "help@test.ie");
ok((await view(staff, "me")).j.allowed === true, "their email may open the console");
await staff("/api/owner", { action: "sendCode" });
await staff("/api/owner", { action: "code", code: codeOf(await lastMailTo("help@test.ie")) });
r = await view(staff, "me");
ok(r.j.user?.role === "support", "through the check: support");
ok((await view(staff, "overview")).status === 200, "they see the front page");
ok((await view(staff, "money")).status === 403, "but not Money");
ok((await view(staff, "tournament", { id: tid })).j.money === null, "nor a tournament's costs");
ok((await raw(staff, "/api/console/export?what=people")).status === 403, "nor export people's details");
ok((await raw(staff, "/api/console/export?what=tournaments")).status === 200, "they can export tournaments");
ok((await staff("/api/console", { action: "settings.staff-add", email: "x@test.ie" })).status === 403, "nor change settings");
ok((await staff("/api/owner", { action: "delete", id: tid, name: "x" })).status === 401, "nor delete a tournament");
r = await staff("/api/console", { action: "tournament.open", id: tid });
ok(r.status === 200 && (await staff("/api/admin", { t: T, action: "state" })).status === 200, "they can open a tournament as its organiser, to help");
r = await owner("/api/admin", { t: T, action: "state" });
ok(!!r.j.supportVisit, "and the organiser is told support looked in");
await owner("/api/console", { action: "settings.staff-remove", email: "help@test.ie" });
ok((await view(staff, "overview")).status === 401, "removed: out on their next click");
ok((await staff("/api/admin", { t: T, action: "state" })).status === 403, "and out of the tournament they opened");

// ================================================================ sign someone out everywhere
const phone2 = agent();
await signInWithEmail(phone2, "maeve@example.ie");
ok((await phone2("/api/account")).j.account?.email === "maeve@example.ie", "Maeve signed in on another phone");
await new Promise((x) => setTimeout(x, 20));
r = await owner("/api/console", { action: "person.signout", email: "maeve@example.ie" });
ok(r.status === 200, "the owner signs her out everywhere");
ok((await phone2("/api/account")).j.account === null && (await fan("/api/account")).j.account === null, "both her phones are signed out");

// ================================================================ the activity record can't be changed
let refused = false;
try {
  sql(`update activity set actor='someone else'`);
} catch {
  refused = true;
}
ok(refused, "the activity record can't be edited, even in the database");
refused = false;
try {
  sql(`delete from activity`);
} catch {
  refused = true;
}
ok(refused, "nor deleted");
r = await view(owner, "activity", { who: "support" });
ok(r.j.rows.some((x) => x.action === "tournament.open"), "Activity: support's visit, filtered");

// ================================================================ the daily jobs
const CRON = { headers: { authorization: "Bearer local-cron-secret" } };
r = await (await fetch(`${BASE}/api/cron/daily`, CRON)).json();
ok(Array.isArray(r.console) && r.console.some((d) => /tournament figures/.test(d)) && r.console.some((d) => /snapshot/.test(d)), `the daily jobs ran: ${r.console?.join("; ")}`);
ok(sql(`select count(*) from daily_stats`) === "1", "today's snapshot for the growth chart");
r = await view(owner, "health");
ok(!!r.j.cron?.at && r.j.lights.length === 6, "Health: the jobs' last run and six service lights");

// ================================================================ the screens
const browser = await chromium.launch();
const shots = async (w, h, tag, pages) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "os_session", value: owner.cookie().split("=").slice(1).join("="), url: BASE }]);
  const p = await ctx.newPage();
  for (const [name, path] of pages) {
    await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!wide, `${tag} ${name}: nothing wider than the screen`);
    await p.screenshot({ path: `${SHOTS}/console-${tag}-${name}.png`, fullPage: true });
  }
  return { ctx, p };
};
const PAGES = [
  ["overview", "/console"],
  ["needs", "/console/needs"],
  ["tournaments", "/console/tournaments"],
  ["tournament", `/console/tournaments/${tid}`],
  ["people", "/console/people"],
  ["money", "/console/money"],
  ["health", "/console/health"],
  ["activity", "/console/activity"],
  ["settings", "/console/settings"],
];
const lap = await shots(1440, 900, "laptop", PAGES);
await lap.p.goto(`${BASE}/console`, { waitUntil: "networkidle" });
ok((await lap.p.getByRole("heading", { name: "Overview" }).count()) === 1, "the front page opens");
await lap.p.getByRole("combobox", { name: /Find a tournament/ }).fill("octo");
await lap.p.getByRole("option").first().waitFor();
await lap.p.keyboard.press("Enter");
await lap.p.waitForURL(/\/console\/tournaments\/.+/);
ok(true, "the search box: type, Enter, and you're on the tournament");
await lap.ctx.close();
const ph = await shots(390, 844, "phone", PAGES.slice(0, 4));
await ph.p.goto(`${BASE}/console`, { waitUntil: "networkidle" });
await ph.p.getByRole("button", { name: "More" }).click();
await ph.p.getByRole("link", { name: "Health" }).click();
await ph.p.waitForURL(/\/console\/health/);
ok(true, "on a phone: More, then Health");
await ph.ctx.close();
// The old owner page lands in the console
const old = await fetch(`${BASE}/owner?next=/new`, { redirect: "manual" });
ok(old.status >= 300 && old.status < 400 && /\/console\?next=/.test(old.headers.get("location") ?? ""), "the old owner page goes to the console");
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
