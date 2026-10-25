import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:3100", T = "october-special-2026", MAIL = "/var/tmp/ospg/mail";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtA -c "${sql}"`).toString().trim();
const latestPrompt = () => {
  const f = fs.readdirSync("/var/tmp/ospg").filter((x) => /^prompt-\d+\.txt$/.test(x)).sort((a, b) => fs.statSync(`/var/tmp/ospg/${b}`).mtimeMs - fs.statSync(`/var/tmp/ospg/${a}`).mtimeMs)[0];
  return fs.readFileSync(`/var/tmp/ospg/${f}`, "utf8");
};
const resetMail = () => { fs.rmSync(MAIL, { recursive: true, force: true }); fs.mkdirSync(MAIL, { recursive: true }); };
const mails = () => fs.readdirSync(MAIL).length;
q("delete from ai_pieces; delete from subscribers");
q("update rounds set play_date=current_date+3, tee_time='10:30', status='upcoming'");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("dialog", (d) => d.accept());
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

await page.request.post(`${BASE}/api/login`, { data: { t: T, mode: "organiser", pin: "1234" } });
// one follower so the email buttons appear
await page.evaluate(async (t) => fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, action: "addSubscribers", text: "Fionn <fionn@example.ie>" }) }), T);

await page.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Next up" }).waitFor();
const tiles = await page.locator(".org-tile strong").allTextContents();
ok(tiles.length === 12 && tiles[0] === "Tournament setup" && tiles.includes("Organisers") && tiles[1] === "Rounds and courses" && tiles.includes("Scorecards") && tiles.includes("Write and publish"), `twelve tiles, Tournament setup first (${tiles.join(" | ")})`);
ok(/tees off in 3 days/.test(await page.locator(".org-when").innerText()), "countdown to the next round");
const nu = await page.locator(".next-up li").allInnerTexts();
ok(nu.length >= 1 && /No preview yet for round 1/.test(nu[0]), `next up suggests the round 1 preview (${nu.map((x) => x.split("\n")[0]).join(" / ")})`);
ok(!(await overflow()), "home fits a phone");
await page.screenshot({ path: "/var/tmp/ospg/shots/org-home.png", fullPage: true });

// tile → section → back
await page.getByRole("link", { name: /Rounds and courses/ }).click();
await page.getByRole("heading", { name: "Rounds and courses", level: 1 }).waitFor();
ok(page.url().endsWith("#rounds"), "tile opens its page (#rounds)");
await page.screenshot({ path: "/var/tmp/ospg/shots/org-rounds.png" });
await page.goBack();
await page.getByRole("heading", { name: "Next up" }).waitFor({ timeout: 5000 });
ok(true, "phone back button returns to organiser home");
await page.getByRole("link", { name: /Share and invite/ }).click();
await page.getByRole("button", { name: "Organiser home" }).click();
await page.getByRole("heading", { name: "Next up" }).waitFor({ timeout: 5000 });
ok(true, "big back button returns home");

// next-up shortcut lands in the writer with preview + round 1 chosen
await page.locator(".next-up li").first().getByRole("link").click();
await page.getByRole("heading", { name: "Write something new" }).waitFor();
ok((await page.getByRole("radio", { name: /Round preview/ }).getAttribute("aria-checked")) === "true", "shortcut preselects Round preview");
ok(/Round 1/.test(await page.getByLabel("Round").first().locator("option:checked").innerText()), "and round 1");
await page.getByLabel("Tone").selectOption("tabloid");
await page.getByRole("button", { name: "Short", exact: true }).click();
await page.getByLabel("Anything to mention? (optional)").fill("Neil's new driver");
await page.getByRole("button", { name: "Write it" }).click();
await page.getByText("Written. Have a read, then publish it.").waitFor({ timeout: 30000 });
let p = latestPrompt();
ok(/about half the usual length/.test(p) && /Neil's new driver/.test(p), "short length and steer reach the writer");
ok(q("select tone from ai_pieces") === "tabloid", "tone stored with the piece");
const card = page.locator("article.piece").first();
ok((await card.locator(".piece-kind").innerText()) === "Round 1 preview" && /Draft/.test(await card.locator(".piece-status").innerText()), "card says what it is and that it's a draft");
const original = q("select body from ai_pieces");

// rewrite with steering
await card.getByRole("button", { name: "Rewrite" }).click();
await card.getByLabel("What should change?").fill("More about the quarry hole");
await card.getByLabel("Tone").selectOption("dry");
await page.screenshot({ path: "/var/tmp/ospg/shots/org-rewrite.png", fullPage: false });
await card.getByRole("button", { name: "Rewrite it" }).click();
await card.getByText("Rewritten.").waitFor({ timeout: 30000 });
p = latestPrompt();
ok(/More about the quarry hole/.test(p), "instruction reaches the writer");
ok(q("select tone from ai_pieces") === "dry" && q("select prev_body from ai_pieces") === original, "new tone kept, old version saved");
await card.getByRole("button", { name: "Undo", exact: true }).click();
await card.getByText("Back to the earlier version").waitFor();
ok(q("select body from ai_pieces") === original, "undo restores the earlier text");

// shorter via the rewrite panel
await card.getByRole("button", { name: "Rewrite" }).click();
await card.getByRole("button", { name: "Shorter" }).click();
await card.getByText("Made shorter.").waitFor({ timeout: 30000 });
ok(/shorter/i.test(latestPrompt()), "shorter asks for a shorter version");

// edit by hand
await card.getByRole("button", { name: "Edit" }).click();
await card.getByLabel("Headline").fill("Quarry beckons");
await card.getByRole("button", { name: "Save" }).click();
await card.getByText("Saved").waitFor();
ok(q("select title from ai_pieces") === "Quarry beckons", "hand edit saved");

// publish and email, then email again
resetMail();
await card.getByRole("button", { name: "Publish and email" }).click();
await card.locator(".piece-msg").getByText(/Published and emailed to 1/).waitFor({ timeout: 30000 });
await page.waitForTimeout(400);
ok(mails() === 1, "publish and email sends it");
await page.waitForTimeout(800);
ok(/Emailed to 1 on/.test(await card.locator(".piece-status").innerText()), "card shows who it went to and when");
await card.locator("summary", { hasText: "More" }).click();
await page.screenshot({ path: "/var/tmp/ospg/shots/org-writer.png", fullPage: false });
const items = await card.locator(".more-menu button").allInnerTexts();
ok(items.includes("Email it again") && items.includes("Send me a test email") && items.includes("Delete"), `More menu (${items.join(" | ")})`);
await card.getByRole("button", { name: "Email it again" }).click();
await card.locator(".piece-msg", { hasText: /^Emailed to 1$/ }).waitFor({ timeout: 30000 });
await page.waitForTimeout(400);
ok(mails() === 2, "email again sends a second time (after confirming)");
ok(!(await overflow()), "writer fits a phone");

// filters and delete
await page.getByRole("button", { name: "Drafts", exact: true }).click();
ok((await page.locator("article.piece").count()) === 0, "drafts filter hides the published piece");
await page.getByRole("button", { name: "All", exact: true }).click();
await card.locator("summary", { hasText: "More" }).click();
await card.getByRole("button", { name: "Delete" }).click();
await page.waitForTimeout(1500);
ok(q("select count(*) from ai_pieces") === "0", "delete removes it");

// desktop view of the home page
const d = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
await d.context().addCookies(await ctx.cookies());
await d.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await d.getByRole("heading", { name: "Next up" }).waitFor();
await d.screenshot({ path: "/var/tmp/ospg/shots/org-home-desk.png", fullPage: true });
await d.goto(`${BASE}/t/${T}/admin#write`, { waitUntil: "networkidle" });
await d.getByRole("heading", { name: "Write something new" }).waitFor();
await d.getByRole("radio", { name: /Round report/ }).click();
await d.screenshot({ path: "/var/tmp/ospg/shots/org-writer-desk.png", fullPage: true });

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
