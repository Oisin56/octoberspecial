import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
const MAIL = "/var/tmp/ospg/mail";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(MAIL, { recursive: true, force: true });
fs.mkdirSync(MAIL, { recursive: true });
const mails = () => fs.readdirSync(MAIL).sort().map((f) => JSON.parse(fs.readFileSync(`${MAIL}/${f}`, "utf8")));
const H = { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` };
const SH = { apikey: process.env.SERVICE, authorization: `Bearer ${process.env.SERVICE}` };

function agent(ip) {
  let cookie = "";
  return async (path, body) => {
    const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
}
const org = agent("10.0.0.1");
const anon = agent("10.0.0.2");
await org("/api/login", { mode: "organiser", pin: "1234" });

// ---- follower signs up on the home page
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Get the previews and reports by email" }).waitFor();
await page.getByLabel("Name").fill("Clodagh");
await page.getByLabel("Email").fill("Clodagh@Example.ie");
await page.locator(".email-signup").screenshot({ path: "/var/tmp/ospg/shots/email-signup.png" });
await page.getByRole("button", { name: "Sign me up" }).click();
await page.getByText("You're on the list").waitFor({ timeout: 15000 });
ok(true, "follower signs up on the home page");
await sleep(500);
let m = mails();
ok(m.length === 1 && m[0].to.join() === "clodagh@example.ie" && /You're signed up/.test(m[0].subject), "welcome email sent");
ok(/unsubscribe\?token=[0-9a-f-]{36}/.test(m[0].html) && m[0].from.includes("The October Special"), "welcome has unsubscribe link, from the tournament name");

ok((await anon("/api/subscribe", { email: "clodagh@example.ie", name: "C" })).j.already === true, "signing up twice is harmless");
ok((await anon("/api/subscribe", { email: "not-an-email" })).status === 400, "bad address rejected");
await anon("/api/subscribe", { email: "bot@spam.com", website: "http://spam" });
const rows = await (await fetch(`http://127.0.0.1:54321/rest/v1/subscribers?select=email`, { headers: SH })).json();
ok(!rows.some((r) => r.email === "bot@spam.com"), "bots (hidden field) ignored");
const flood = agent("10.0.0.9");
let last;
for (let i = 0; i < 6; i++) last = await flood("/api/subscribe", { email: `f${i}@flood.ie` });
ok(last.status === 429, "sign-up flooding is limited");

// ---- the list is private
const pub = await fetch(`http://127.0.0.1:54321/rest/v1/subscribers?select=email`, { headers: H });
const pj = await pub.json().catch(() => null);
ok(!Array.isArray(pj) || pj.length === 0, "the public can't read the email list");
ok((await anon("/api/admin", { action: "subscribers" })).status >= 401, "non-organisers can't see the list");

// ---- organiser adds people
const add = await org("/api/admin", { action: "addSubscribers", text: "Fionn <fionn@example.ie>\nnonsense\nkev@example.ie" });
ok(add.j.added === 2 && add.j.invalid.join() === "nonsense", "organiser adds two, flags one bad line");
await fetch(`http://127.0.0.1:54321/rest/v1/subscribers?email=like.*flood.ie`, { method: "DELETE", headers: SH });

// ---- preview: publish and email
const r1 = (await (await fetch(`http://127.0.0.1:54321/rest/v1/rounds?number=eq.1&select=id`, { headers: H })).json())[0];
const pv = await org("/api/admin", { action: "aiGenerate", kind: "preview", roundId: r1.id });
fs.rmSync(MAIL, { recursive: true, force: true });
fs.mkdirSync(MAIL, { recursive: true });
let res = await org("/api/admin", { action: "aiUpdate", id: pv.j.piece.id, status: "published", email: true, title: "Heath and heartache", body: "The Opening Shots\nOisin and Neil tee it up at Druids Heath.\n\nThe quarry hole waits & bites." });
ok(res.j.emailed === 3, `published and emailed to ${res.j.emailed} (3 subscribed)`);
await sleep(300);
m = mails();
ok(m.length === 3 && new Set(m.flatMap((x) => x.to)).size === 3, "one email each, nobody sees the others' addresses");
const e0 = m.find((x) => x.to[0] === "fionn@example.ie");
ok(e0.subject === "Heath and heartache | The October Special", "subject is the headline and tournament");
ok(e0.html.includes("Preview · Round 1") && e0.html.includes("The Opening Shots</h2>") && e0.html.includes("waits &amp; bites"), "article in full, subheading styled, text escaped");
ok(/\/t\/october-special-2026\/rounds\/1/.test(e0.html), "button links to the round page");
console.log("     list headers:", Object.keys(e0.headers).filter((k) => k.startsWith("list")).join(", "));
ok(/unsubscribe\?token=/.test(JSON.stringify(e0.headers.list ?? e0.headers["list-unsubscribe"] ?? "")) && /One-Click/.test(JSON.stringify(e0.headers.list ?? "")), "one-click unsubscribe headers for mail apps");
fs.writeFileSync("/var/tmp/ospg/shots/email.html", e0.html);
res = await org("/api/admin", { action: "emailPiece", id: pv.j.piece.id, test: true });
await sleep(300);
ok(res.j.test && mails().length === 4 && mails()[3].to.join() === "me@test.ie", "test email goes only to you");
res = await org("/api/admin", { action: "aiUpdate", id: pv.j.piece.id, status: "published", email: true });
await sleep(300);
ok(mails().length === 4, "re-publishing doesn't email everyone twice");

// ---- unsubscribe
const link = e0.html.match(/href="([^"]*unsubscribe\?token=[^"]+)"/)[1].replace(/^https?:\/\/[^/]+/, BASE);
await page.goto(link);
ok((await page.getByText("You're unsubscribed from The October Special.").count()) === 1, "unsubscribe link works");
const bul = await org("/api/admin", { action: "aiGenerate", kind: "bulletin", roundId: r1.id });
res = await org("/api/admin", { action: "aiUpdate", id: bul.j.piece.id, status: "published", email: true });
ok(res.j.emailed == null, "bulletins are never emailed");
const tp = await org("/api/admin", { action: "aiGenerate", kind: "preview", roundId: null });
fs.rmSync(MAIL, { recursive: true, force: true });
fs.mkdirSync(MAIL, { recursive: true });
res = await org("/api/admin", { action: "aiUpdate", id: tp.j.piece.id, status: "published", email: true });
await sleep(300);
ok(res.j.emailed === 2 && !mails().some((x) => x.to[0] === "fionn@example.ie"), "unsubscribed people get nothing more");
ok(mails()[0].html.includes("Tournament preview"), "tournament preview labelled");

// ---- admin UI
await page.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
await page.goto(`${BASE}/t/${T}/login`, { waitUntil: "networkidle" });
await page.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /Email list/ }).click();
await page.getByText(/Email list · 2 subscribed/).waitFor({ timeout: 10000 });
ok((await page.getByText("unsubscribed", { exact: false }).count()) >= 1, "list shows who unsubscribed");
await page.screenshot({ path: "/var/tmp/ospg/shots/email-admin.png", fullPage: true });
await page.getByRole("button", { name: "Organiser home" }).click();
await page.getByRole("link", { name: /Write and publish/ }).click();
await page.getByRole("radio", { name: /Round report/ }).click();
await page.getByRole("button", { name: "Write it" }).click();
await page.getByText("Written. Have a read, then publish it.").waitFor({ timeout: 30000 });
const draft = page.locator("article.piece").first();
ok((await draft.getByRole("button", { name: "Publish and email" }).count()) === 1, "draft offers Publish and email");
fs.rmSync(MAIL, { recursive: true, force: true });
fs.mkdirSync(MAIL, { recursive: true });
await draft.getByRole("button", { name: "Publish and email" }).click();
await page.getByText(/Published and emailed to 2/).waitFor({ timeout: 30000 });
await sleep(300);
ok(mails().length === 2, "Publish and email from the admin screen");
await browser.close();

// render the email as a mail app would
const b2 = await chromium.launch();
const p2 = await (await b2.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await p2.goto("file:///var/tmp/ospg/shots/email.html");
await p2.screenshot({ path: "/var/tmp/ospg/shots/email.png", fullPage: true });
await b2.close();

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
