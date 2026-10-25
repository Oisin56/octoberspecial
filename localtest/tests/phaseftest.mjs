// Phase F: the front page and the way in. The three tiles, tournaments on this phone, finding a tournament,
// requesting and using an invite, the invitation-only gate, the example tournament (read-only), the sandbox
// scorecard, privacy and the link preview. Run after fresh + e2e, with the stub up.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
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

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
const mails = () => fs.readdirSync("/var/tmp/ospg/mail").sort().map((f) => JSON.parse(fs.readFileSync(`/var/tmp/ospg/mail/${f}`, "utf8")));
fs.mkdirSync("/var/tmp/ospg/shots", { recursive: true });
sql(`delete from invite_requests; delete from site_settings where key='demo'; update tournaments set published=true where slug='${T}'`);
sql(`delete from tournaments where slug like 'invited-%'`);

const b = await chromium.launch();
const phone = async (extra = {}) => {
  const ctx = await b.newContext({ ...devices["iPhone 13"], ...extra });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  return p;
};
const call = (p, path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [path, body]);

// ================================================================ The front page, first visit
let p = await phone();
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
ok((await p.locator(".bx-mark").innerText()).replace(/\s/g, "") === "MyGolfBroadcast", "the new name in the header");
ok((await p.locator("h1").innerText()).replace(/\s+/g, " ") === "Every round, covered like a major.", "the new line at the top");
const cta = p.locator("#bx-top-cta");
ok((await cta.innerText()).trim() === "Request an invite" && (await cta.getAttribute("href")) === "/invite", "one big button: Request an invite");
const ctaBox = await cta.boundingBox();
ok(ctaBox.height >= 48 && ctaBox.y < 844, `big, on the first screen (${Math.round(ctaBox.height)}px tall, ${Math.round(ctaBox.y)}px down)`);
ok((await p.locator(".bx-bar-link").innerText()).trim() === "Sign in", "a new phone: Sign in at the top");
ok((await p.locator(".bx-step h3").count()) === 5, "on the course: five screens, filming among them");
ok((await p.locator(".dv-status .dv-time").first().innerText()) === "9:41", "the phones have a status bar");
const wide = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
ok(wide[0] <= wide[1] + 1, `no sideways scrolling (${wide[0]} in ${wide[1]})`);
ok(/nothing is charged/.test(await p.locator("main").innerText()), "prices are marked as planned");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasef-front.png" });
ok((await p.locator("footer a", { hasText: "Privacy" }).count()) === 1, "privacy in the footer");
ok((await p.locator("footer a", { hasText: "Join my tournament" }).getAttribute("href")) === "/join", "and the way into a tournament");
ok((await fetch(`${BASE}/preview`, { redirect: "manual" })).status === 307, "the old preview address goes to the front page");

// Link preview
const og = await p.request.get(`${BASE}/opengraph-image`);
ok(og.ok() && og.headers()["content-type"] === "image/png", "a link preview image for WhatsApp and the rest");
ok((await p.locator('meta[property="og:image"]').count()) >= 1, "the page points to it");

// ================================================================ Tournaments on this phone
await p.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
await sleep(800);
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(500);
ok((await p.locator(".bx-bar-link").innerText()).trim() === "Sign in", "the header stays Sign in, even for a phone that has opened a tournament");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasef-recent.png" });

// ================================================================ Join my tournament: no search, by design
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.locator("footer a", { hasText: "Join my tournament" }).click();
await p.waitForURL(/\/join$/);
ok((await p.locator("#fr-q, input[type=search]").count()) === 0, "no search box: tournaments are seen only by people given the link");
await p.getByText(/Tap the link your organiser sent you/).waitFor();
ok(/October Special/.test(await p.locator(".fr-recent-item").first().innerText()), "the tournaments this phone has opened are still one tap away");
ok(/Ask your organiser to send it again/.test(await p.locator("main").innerText()), "lost the link: ask the organiser to resend it");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasef-join.png" });
const listing = await fetch(`${BASE}/api/tournaments`);
ok(listing.status === 405, `the tournament list can't be fetched (${listing.status})`);
const robots = await (await fetch(`${BASE}/t/${T}`)).text();
ok(/<meta name="robots" content="noindex, nofollow"/.test(robots), "tournament pages tell search engines to stay out");

// ================================================================ The invitation-only gate, and requesting an invite
p = await phone();
await p.goto(`${BASE}/new`, { waitUntil: "networkidle" });
await p.getByText("It's invitation-only for now").waitFor({ timeout: 8000 });
ok(true, "the wizard: invitation-only, before any questions");
await p.locator("a", { hasText: "Request an invite" }).click();
await p.waitForURL(/\/invite$/);
const before = mails().length;
await p.fill("#iv-name", "Siobhan Test");
await p.fill("#iv-email", "siobhan@example.com");
await p.fill("#iv-about", "Twelve of us, two rounds in Kerry in May");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasef-invite.png" });
await p.getByRole("button", { name: "Request my invite" }).click();
await p.getByText("Thanks, Siobhan").waitFor({ timeout: 8000 });
ok(true, "request sent: thanks, with when to expect the email");
ok(sql(`select name || '|' || email || '|' || status from invite_requests`) === "Siobhan Test|siobhan@example.com|new", "the request is kept");
await sleep(800);
const toOwner = mails().slice(before).find((m) => /Invite request: Siobhan/.test(m.subject));
ok(!!toOwner && /Kerry/.test(toOwner.text) && /\/owner/.test(toOwner.text), "the site owner gets an email about it");
// Asking twice doesn't make two
await call(p, "/api/invites", { action: "request", name: "Siobhan Test", email: "siobhan@example.com" });
ok(sql(`select count(*) from invite_requests`) === "1", "asking again while waiting doesn't add another");
const badEmail = await call(p, "/api/invites", { action: "request", name: "X", email: "nope" });
ok(badEmail.status === 400, "a bad email is refused");

// ================================================================ The owner approves; the link opens the wizard
const o = await phone();
await o.goto(`${BASE}/owner`);
await call(o, "/api/owner", { action: "signin", pin: OWNER });
await o.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
await o.locator(".owner-invites .owner-t").first().waitFor();
ok(/1 waiting/.test(await o.locator(".owner-invites h2").innerText()), "the owner page shows the request waiting");
await o.screenshot({ path: "/var/tmp/ospg/shots/phasef-owner-invites.png" });
const m0 = mails().length;
await o.getByRole("button", { name: "Approve and email the link" }).click();
await o.getByText("Invite emailed to siobhan@example.com").waitFor({ timeout: 8000 });
const inviteMail = mails().slice(m0).find((m) => (m.to ?? []).includes("siobhan@example.com"));
const link = inviteMail?.text.match(/https?:\/\/\S+\/new\?invite=[\w-]+/)?.[0];
ok(!!link && /You're invited/.test(inviteMail.subject), `she gets an email with a link to set up (${inviteMail?.subject})`);
const token = link.split("invite=")[1];
const s = await phone();
await s.goto(`${BASE}${new URL(link).pathname}${new URL(link).search}`, { waitUntil: "networkidle" });
await s.locator(".wz-tile").first().waitFor({ timeout: 8000 });
ok((await s.getByText("It's invitation-only for now").count()) === 0, "the invite link goes straight into the wizard");
// The API: the invite makes one tournament, then it's used up
const wizard = { who: "individuals", name: "Invited Weekend", win: "stableford", rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", format: "stableford" }], players: [{ name: "Siobhan", index: 14 }, { name: "Aine", index: 20 }], organiserPlays: true, draw: "random", prizes: [], extras: {}, theme: "spring" };
const made = await call(s, "/api/tournaments", { wizard, email: "siobhan@example.com", invite: token });
ok(made.status === 200 && /^invited-weekend/.test(made.j.slug ?? ""), `with the invite, the tournament is made without the owner PIN (${made.status})`);
ok(sql(`select (used_at is not null)::text || '|' || (tournament_id is not null)::text from invite_requests`) === "true|true", "the invite is marked as used, with its tournament");
const again = await call(s, "/api/tournaments", { wizard: { ...wizard, name: "Invited Again" }, email: "siobhan@example.com", invite: token });
ok(again.status === 410, `a second tournament from the same link is refused (${again.status})`);
const stranger = await phone();
await stranger.goto(`${BASE}/privacy`);
const noInvite = await call(stranger, "/api/tournaments", { wizard, email: "x@example.com" });
ok(noInvite.status === 401, "and nobody can make one without an invite or the owner PIN");

// ================================================================ The example tournament
await o.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
await o.locator(".owner-t", { hasText: "The October Special" }).getByRole("button", { name: "Use as the front page example" }).click();
await o.getByText("Front page example").first().waitFor({ timeout: 8000 });
ok(sql(`select value->>'slug' from site_settings where key='demo'`) === T, "the owner picks the example tournament");
p = await phone();
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
await p.waitForURL(new RegExp(`/t/${T}$`));
await p.locator(".demo-banner").waitFor();
ok(/This is an example tournament/.test(await p.locator(".demo-banner").innerText()), "a banner says it's an example");
await p.screenshot({ path: "/var/tmp/ospg/shots/phasef-demo.png" });
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(500);
ok((await p.locator(".bx-bar-link").innerText()).trim() === "Sign in", "looking at the example doesn't put it in 'your tournaments'");
await p.goto(`${BASE}/t/${T}/login`, { waitUntil: "networkidle" });
ok((await p.getByText("This is an example").count()) >= 1, "the sign-in page says nobody can sign in here");
const login = await call(p, "/api/login", { t: T, mode: "organiser", pin: "1234" });
ok(login.status === 403 && /example/.test(login.j.error), `logging in is refused (${login.status})`);
const postId = sql(`select id from posts where tournament_id=(select id from tournaments where slug='${T}') limit 1`);
const like = await call(p, "/api/likes", { t: T, postId });
ok(like.status === 403, `liking is refused (${like.status})`);
const sub = await call(p, "/api/subscribe", { t: T, email: "x@example.com", name: "X" });
ok(sub.status === 403, `following by email is refused (${sub.status})`);
// The site owner can still change it
const tidT = sql(`select id from tournaments where slug='${T}'`);
await call(o, "/api/owner", { action: "open", id: tidT });
const ownerEdit = await call(o, "/api/admin", { t: T, action: "state" });
ok(ownerEdit.status === 200, "the site owner can still run it");
sql(`delete from site_settings where key='demo'`);

// ================================================================ The sample round (its own test: sampletest.mjs)
p = await phone();
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.getByRole("link", { name: "Try a sample round" }).first().click();
await p.waitForURL(/\/try$/);
await p.locator(".sr-bar").waitFor({ timeout: 15000 });
ok(true, "Try it opens the sample round");

// ================================================================ Privacy
await p.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
const priv = await p.locator(".fr-prose").innerText();
ok(/16 or over/.test(priv) && /Data Protection Commission/.test(priv) && /Only the ones that keep you signed in/.test(priv), "a plain privacy page: age, rights, cookies");

await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
