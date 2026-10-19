import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3100", T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${BASE}/t/${T}/login`);
await page.getByRole("button", { name: "Organiser" }).click();
await page.getByLabel("PIN").fill("1234");
await page.getByRole("button", { name: "Log in" }).click();
await page.waitForTimeout(1200);
await page.goto(`${BASE}/t/${T}/admin#film`, { waitUntil: "networkidle" });
await page.getByLabel("Length").selectOption("60");
await page.getByRole("button", { name: "Write the plan" }).click();
await page.getByText("Plan ready").waitFor({ timeout: 60000 });

// 1. A render that fails says so, at the top of the plan
await fetch("http://127.0.0.1:54321/__failnext");
await page.getByRole("button", { name: "Render the film" }).click();
await page.locator("#film-result.is-rendering").waitFor({ timeout: 30000 });
ok(true, "rendering box shown");
await page.locator("#film-result.is-failed").waitFor({ timeout: 60000 });
const failText = await page.locator("#film-result").innerText();
ok(/didn't render/.test(failText) && /Asset could not be downloaded/.test(failText), "failure box gives the reason");
await page.locator("#film-result").screenshot({ path: "/var/tmp/ospg/shots/film-failed.png" });

// 2. Render, leave the page straight away, come back: the film is finished and posted
await page.getByLabel("Film title").fill("Saturday test film");
await page.getByRole("button", { name: "Render the film" }).click();
await page.locator("#film-result.is-rendering").waitFor({ timeout: 30000 });
await page.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.goto(`${BASE}/t/${T}/admin#film`, { waitUntil: "networkidle" });
// opening the film page checks the renderer; a second visit finds it done
await page.waitForTimeout(1500);
await page.reload({ waitUntil: "networkidle" });
await page.locator("#film-result.is-done").waitFor({ timeout: 60000 });
const doneText = await page.locator("#film-result").innerText();
ok(/Your film is ready/.test(doneText) && (await page.locator("#film-result video").count()) === 1, "coming back shows the finished film with a player");
await page.locator("#film-result").screenshot({ path: "/var/tmp/ospg/shots/film-done.png" });
await page.goto(`${BASE}/t/${T}/highlights`, { waitUntil: "networkidle" });
ok((await page.getByText(/Saturday test film/).count()) >= 1, "film is on the Highlights page");
await b.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
