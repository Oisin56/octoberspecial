// Sign-in, stage 1: one sign-in per person (email link or code), My golf, co-organisers, one-use player links,
// Send again, joining spots, organiser PINs moving to email, the site owner's second check.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { BASE, agent, codeOf, lastMailTo, linkOf, mails, signInWithEmail, playerLink } from "./signin-helpers.mjs";

let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fails++;
};
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ENV = fs.readFileSync("/home/claude/october-special/.env.local", "utf8");
const OWNER_PIN = ENV.match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
const SECRET = ENV.match(/^SESSION_SECRET=(.*)$/m)[1].trim();
const SHOTS = "/var/tmp/ospg/shots";

// ================================================================ email sign-in: link and code
const a = agent();
ok((await a("/api/account", { action: "send", email: "not an email" })).status === 400, "a bad email is refused");
let r = await a("/api/account", { action: "send", email: "Mary@Example.ie" });
ok(r.status === 200, "sign-in email sent");
let m = await lastMailTo("mary@example.ie");
ok(!!codeOf(m) && /Sign in/.test(m.html) && /\/account\/in\?token=/.test(linkOf(m)), `one email: a button and a 6-digit code (${m?.subject})`);
ok((await a("/api/account", { action: "code", email: "mary@example.ie", code: "000000" === codeOf(m) ? "111111" : "000000" })).status === 401, "a wrong code is refused");
r = await a("/api/account", { action: "code", email: "mary@example.ie", code: codeOf(m) });
ok(r.status === 200, "the right code signs you in");
ok((await a("/api/account", { action: "code", email: "mary@example.ie", code: codeOf(m) })).status === 410, "the code works once");
ok((await a("/api/account")).j.account?.email === "mary@example.ie", "signed in as mary@example.ie");
// The button in the email (on another device)
const b = agent();
await b("/api/account", { action: "send", email: "mary@example.ie" });
m = await lastMailTo("mary@example.ie");
const token = new URL(linkOf(m)).searchParams.get("token");
ok((await b("/api/account", { action: "peek", token })).j.email === "mary@example.ie", "the button's page says who it signs in first");
ok((await b("/api/account", { action: "verify", token })).status === 200, "the button signs you in on another device");
ok((await b("/api/account", { action: "verify", token })).status === 410, "the button works once");
ok((await b("/api/account", { action: "code", email: "mary@example.ie", code: codeOf(m) })).status === 410, "and its code is used up with it");
// Five wrong tries and that code is done
const c5 = agent();
await c5("/api/account", { action: "send", email: "five@example.ie" });
const m5 = await lastMailTo("five@example.ie");
const wrong = codeOf(m5) === "123456" ? "654321" : "123456";
for (let i = 0; i < 5; i++) await c5("/api/account", { action: "code", email: "five@example.ie", code: wrong });
ok((await c5("/api/account", { action: "code", email: "five@example.ie", code: codeOf(m5) })).status === 410, "after five wrong tries the code stops working");
ok((await a("/api/account", { action: "signout" })).status === 200 && !(await a("/api/account")).j.account, "sign out");
// Guessing: twenty wrong codes sent all at once still only get five tries
const g = agent();
await g("/api/account", { action: "send", email: "guess@example.ie" });
const mg = await lastMailTo("guess@example.ie");
const bad6 = codeOf(mg) === "999999" ? "888888" : "999999";
await Promise.all(Array.from({ length: 20 }, () => g("/api/account", { action: "code", email: "guess@example.ie", code: bad6 })));
ok((await g("/api/account", { action: "code", email: "guess@example.ie", code: codeOf(mg) })).status === 410, "twenty guesses at once: still only five tries, then the code is done");
ok(Number(sql(`select max(tries) from account_tokens where email='guess@example.ie'`)) === 5, "and exactly five were counted");
// Another site's form can't post to sign-in
const plain = await fetch(`${BASE}/api/account`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ action: "send", email: "x@example.ie" }) });
ok(plain.status === 403, "a post that isn't from this site's pages (plain text) is refused");
const evil = await fetch(`${BASE}/api/account`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ action: "send", email: "x@example.ie" }) });
ok(evil.status === 403, "and so is one from another site");

// ================================================================ the site owner: email, then the second check
const owner = agent();
ok((await owner("/api/owner")).j.owner === false, "not the owner before signing in");
await signInWithEmail(owner, "owner@test.ie");
let o = (await owner("/api/owner")).j;
ok(o.owner === false && o.ownerAccount === true && o.email === "owner@test.ie", "signed in with the owner's email: the second check still to do");
ok((await owner("/api/owner", { action: "sendCode" })).status === 200, "the owner asks for a code");
m = await lastMailTo("owner@test.ie");
ok(/\/owner\?check=/.test(linkOf(m)), "the check email's button goes to the owner page");
ok((await owner("/api/owner", { action: "code", code: "000000" === codeOf(m) ? "111111" : "000000" })).status === 401, "a wrong owner code is refused");
ok((await owner("/api/owner", { action: "code", code: codeOf(m) })).status === 200, "the owner's code passes the check");
o = (await owner("/api/owner")).j;
ok(o.owner === true && Array.isArray(o.tournaments), "the owner page opens");
ok((await owner("/api/account")).j.owner === true, "My golf shows The site to the owner");
ok((await agent()("/api/owner", { action: "signin", pin: OWNER_PIN })).status === 401, "the old owner PIN stops working once the owner has signed in with their email");
// Someone else signed in can't get through the check
ok((await a("/api/owner", { action: "sendCode" })).status === 401, "a non-owner can't ask for the owner's code");

// ================================================================ making a tournament: email-only
const wizard = {
  who: "individuals",
  name: "Sign Cup",
  win: "stableford",
  organiserPlays: true,
  rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "all", format: "stableford" }],
  players: [{ name: "Oisin" }, { name: "Neil Byrne" }, { name: "Aoife" }, { name: "Dara" }],
  draw: "random",
  prizes: [],
  extras: {},
  theme: "spring",
};
const org = agent();
ok((await org("/api/tournaments", { wizard })).status === 401, "nobody makes a tournament without an invite or being the owner");
// The owner's phone makes it; then a stranger with an invite-like path (the owner) and an email
r = await owner("/api/tournaments", { wizard });
ok(r.status === 200, `the owner makes one (signed in: no email needed) ${r.j.error ?? ""}`);
const T1 = r.j.slug;
ok((await owner("/api/account")).j.running?.some((x) => x.slug === T1), "it's under Running in the owner's My golf");
// Not signed in: the email is asked for, the phone runs it, and it joins My golf once the email is confirmed
const creatorPin = agent();
ok((await creatorPin("/api/owner", { action: "signin", pin: OWNER_PIN })).status === 401, "(owner PIN retired)");
// An invite to make one
const inv = await agent()("/api/invites", { action: "request", name: "Pat", email: "pat@example.ie", about: "golf" });
const invId = sql(`select id from invite_requests where email='pat@example.ie' order by created_at desc limit 1`);
await owner("/api/owner", { action: "approveInvite", inviteId: invId });
const invMail = await lastMailTo("pat@example.ie");
const invite = linkOf(invMail)?.match(/invite=([\w-]+)/)?.[1];
ok(inv.status === 200 && !!invite, "an invite is approved and emailed");
const pat = agent();
ok((await pat("/api/tournaments", { wizard: { ...wizard, name: "Pat Cup" }, invite })).status === 400, "without an email it's refused");
r = await pat("/api/tournaments", { wizard: { ...wizard, name: "Pat Cup" }, invite, email: "pat@example.ie" });
ok(r.status === 200 && r.j.emailed === true, "made with an invite and an email; a confirm email sent");
const T = r.j.slug;
const tid = sql(`select id from tournaments where slug='${T}'`);
ok(sql(`select organiser_pin_hash is null from tournaments where id='${tid}'`) === "t", "no PIN made for it");
let st = await pat("/api/admin", { t: T, action: "state" });
ok(st.status === 200 && st.j.needEmail === true, "this phone runs it, and is asked to add (confirm) an email");
m = await lastMailTo("pat@example.ie");
ok(/Pat Cup is ready/.test(m.text) && !!codeOf(m), "the email says the tournament is ready, with a code");
await pat("/api/account", { action: "code", email: "pat@example.ie", code: codeOf(m) });
st = await pat("/api/admin", { t: T, action: "state" });
ok(st.status === 200 && st.j.needEmail === false && st.j.organisers.some((x) => x.email === "pat@example.ie" && !x.pending && x.you), "confirmed: Pat is the organiser by email");
let golf = (await pat("/api/account")).j;
ok(golf.running.some((x) => x.slug === T) && !golf.offers.length, "Pat Cup is under Running, nothing asking");
// On another phone, Pat just signs in
const pat2 = agent();
await signInWithEmail(pat2, "pat@example.ie");
ok((await pat2("/api/admin", { t: T, action: "state" })).status === 200, "Pat runs it from a second phone after signing in");

// ================================================================ the You're the... line
const ses = (call, t) => call(`/api/login?t=${t}`).then((x) => x.j.session);
ok((await ses(pat2, T))?.role === "organiser", "the second phone is the organiser here");

// ================================================================ co-organisers
r = await pat("/api/admin", { t: T, action: "addOrganiser", email: "Mary@Example.ie" });
ok(r.status === 200 && r.j.organisers.some((x) => x.email === "mary@example.ie" && x.pending), "Mary added as an organiser (waiting for her to say yes)");
m = await lastMailTo("mary@example.ie");
ok(/added you as an organiser of Pat Cup/.test(m.text) && !!codeOf(m), "Mary gets an email saying why, with a sign-in code");
const mary = agent();
await mary("/api/account", { action: "code", email: "mary@example.ie", code: codeOf(m) });
golf = (await mary("/api/account")).j;
ok(golf.offers.length === 1 && golf.offers[0].role === "organiser" && golf.offers[0].slug === T, "My golf asks Mary: is this you?");
ok((await mary("/api/admin", { t: T, action: "state" })).status === 403, "not an organiser until she says yes");
golf = (await mary("/api/account", { action: "answer", offer: golf.offers[0].id, yes: true })).j;
ok(golf.running.some((x) => x.slug === T) && !golf.offers.length, "yes: it's under Running");
ok((await mary("/api/admin", { t: T, action: "state" })).status === 200, "and Mary can run it");
ok((await pat("/api/admin", { t: T, action: "addOrganiser", email: "mary@example.ie" })).status === 400, "can't add her twice");
r = await pat("/api/admin", { t: T, action: "removeOrganiser", email: "mary@example.ie" });
ok(r.status === 200 && !r.j.organisers.some((x) => x.email === "mary@example.ie"), "Pat removes Mary");
ok((await mary("/api/admin", { t: T, action: "state" })).status === 403, "Mary's phone can't run it any more");
ok((await pat("/api/admin", { t: T, action: "removeOrganiser", email: "pat@example.ie" })).status === 400, "the last organiser can't be removed");
// Someone who owns a look-alike address (an underscore is a wildcard in some database searches) gets nothing of Mary's
const lookalike = agent();
await signInWithEmail(lookalike, "m_ry@example.ie");
golf = (await lookalike("/api/account")).j;
ok(golf.account?.email === "m_ry@example.ie" && !golf.running.length && !golf.offers.length, "a look-alike email is a different person");
// A typo'd organiser email: whoever gets it says no
await pat("/api/admin", { t: T, action: "addOrganiser", email: "wrong@example.ie" });
const wrongP = agent();
m = await lastMailTo("wrong@example.ie");
await wrongP("/api/account", { action: "code", email: "wrong@example.ie", code: codeOf(m) });
golf = (await wrongP("/api/account")).j;
golf = (await wrongP("/api/account", { action: "answer", offer: golf.offers[0].id, yes: false })).j;
ok(!golf.running.length && !golf.offers.length, "saying no: nothing joins");
ok((await wrongP("/api/admin", { t: T, action: "state" })).status === 403, "and they can't run it");

// ================================================================ players: one-use links
const players = (await pat("/api/admin", { t: T, action: "state" })).j.state.players;
const pid = (n) => players.find((p) => p.name === n).id;
const NEIL = pid("Neil Byrne"), AOIFE = pid("Aoife"), DARA = pid("Dara");
const url = await playerLink(pat, T, NEIL);
const code = url.split("/in/")[1];
const neil = agent(), other = agent();
r = await neil("/api/login", { t: T, mode: "link", code });
ok(r.status === 200 && r.j.name === "Neil Byrne" && !r.j.done, "the link asks: I'm Neil?");
r = await neil("/api/login", { t: T, mode: "link", code, step: "confirm" });
ok(r.status === 200 && r.j.role === "player", "I'm Neil: signed in as Neil");
ok((await ses(neil, T))?.playerId === NEIL, "Neil's phone is Neil");
r = await other("/api/login", { t: T, mode: "link", code });
ok(r.status === 409 && /already been used/.test(r.j.error), "the link on another phone: already used");
ok((await other("/api/login", { t: T, mode: "link", code, step: "confirm" })).status === 409, "and it can't be forced");
ok((await neil("/api/login", { t: T, mode: "link", code })).j.already === true, "Neil tapping it again on his own phone: straight in");
st = (await pat("/api/admin", { t: T, action: "state" })).j;
ok(!!st.linkUsed[NEIL] && !st.linkUsed[AOIFE], "the organiser sees Neil is signed in on a phone");
// Send again: a new link, and Neil's old phone is signed out
const url2 = await playerLink(pat, T, NEIL, true);
ok(url2 !== url, "Send again makes a new link");
ok(!(await ses(neil, T)), "the old phone is signed out");
ok((await other("/api/login", { t: T, mode: "link", code })).status === 410, "the old link no longer works");
r = await other("/api/login", { t: T, mode: "link", code: url2.split("/in/")[1], step: "confirm" });
ok(r.status === 200 && (await ses(other, T))?.playerId === NEIL, "the new link works on the new phone");
ok(!(await pat("/api/admin", { t: T, action: "state" })).j.pinSet[NEIL], "no PINs");
// Someone sends Neil's phone a sign-in link for their own email: tapping it joins nothing of Neil's to them
const sneak = agent();
await sneak("/api/account", { action: "send", email: "sneak@example.ie" });
const sneakTok = new URL(linkOf(await lastMailTo("sneak@example.ie"))).searchParams.get("token");
await other("/api/account", { action: "verify", token: sneakTok });
golf = (await other("/api/account")).j;
ok(golf.account?.email === "sneak@example.ie" && !golf.playing.length && golf.here.some((h) => h.slug === T && h.as === "Neil Byrne"), "a sign-in link from someone else joins nothing by itself (it only offers Add to My golf)");
ok((await ses(other, T))?.playerId === NEIL, "and the phone is still Neil");
await other("/api/account", { action: "signout" });

// ================================================================ joining a spot to a person
// Mary is signed in on her phone and taps Aoife's link (she's Aoife's... no: she is Aoife, using her usual email)
const aurl = await playerLink(pat, T, AOIFE);
r = await mary("/api/login", { t: T, mode: "link", code: aurl.split("/in/")[1] });
ok(r.j.signedInAs === "mary@example.ie" && r.j.joined === false, "signed in already: asked if this is them");
await mary("/api/login", { t: T, mode: "link", code: aurl.split("/in/")[1], step: "confirm", join: true });
golf = (await mary("/api/account")).j;
ok(golf.playing.some((x) => x.slug === T && x.as === "Aoife"), "yes: Pat Cup under Playing in, as Aoife");
const mary2 = agent();
await signInWithEmail(mary2, "mary@example.ie");
ok((await ses(mary2, T))?.playerId === AOIFE, "on another phone, signing in with her email makes her Aoife there too");
// An email the organiser adds: never joins by itself, it asks
ok((await pat("/api/admin", { t: T, action: "savePlayer", player: { id: DARA, email: "dara@example.ie" } })).status === 200, "the organiser adds Dara's email");
const dara = agent();
await signInWithEmail(dara, "dara@example.ie");
golf = (await dara("/api/account")).j;
ok(golf.offers.length === 1 && golf.offers[0].role === "player" && golf.offers[0].player === "Dara" && !golf.playing.length, "Dara's My golf asks: is this you (as Dara)?");
golf = (await dara("/api/account", { action: "answer", offer: golf.offers[0].id, yes: true })).j;
ok(golf.playing.some((x) => x.as === "Dara") && (await ses(dara, T))?.playerId === DARA, "yes: playing as Dara, and this phone is Dara");
// The link sent by email from the site: tapping it confirms the email
ok((await pat("/api/admin", { t: T, action: "savePlayer", player: { id: pid("Oisin"), email: "oisin@example.ie" } })).status === 200, "Oisin's email added");
r = await pat("/api/admin", { t: T, action: "emailLink", playerId: NEIL });
ok(r.status === 400, "no email for Neil: can't email his link");
await pat("/api/admin", { t: T, action: "savePlayer", player: { id: NEIL, email: "neil@example.ie" } });
r = await pat("/api/admin", { t: T, action: "emailLink", playerId: NEIL });
ok(r.status === 200, "Neil's link emailed from the site");
m = await lastMailTo("neil@example.ie");
const emailed = linkOf(m);
ok(/\/in\/[\w-]+\?e=/.test(emailed) && /Your link for Pat Cup/.test(m.subject), "the email carries his link");
// Send again first (his link was used on the other phone), then email it
await playerLink(pat, T, NEIL, true);
await pat("/api/admin", { t: T, action: "emailLink", playerId: NEIL });
m = await lastMailTo("neil@example.ie");
const eu = new URL(linkOf(m));
const neil3 = agent();
r = await neil3("/api/login", { t: T, mode: "link", code: eu.pathname.split("/in/")[1], e: eu.searchParams.get("e"), step: "confirm" });
ok(r.status === 200, "Neil taps the emailed link");
golf = (await neil3("/api/account")).j;
ok(golf.account?.email === "neil@example.ie" && golf.playing.some((x) => x.as === "Neil Byrne"), "his email is confirmed: signed in, and Pat Cup is under Playing in");
// A forged proof does nothing extra
await playerLink(pat, T, AOIFE, true);
const forger = agent();
const aurl2 = await playerLink(pat, T, AOIFE);
await forger("/api/login", { t: T, mode: "link", code: aurl2.split("/in/")[1], e: "x".repeat(24), step: "confirm" });
ok(!(await forger("/api/account")).j.account, "a made-up email proof signs nobody in");
// Send again also takes the spot back from whoever joined it
ok(!(await mary("/api/account")).j.playing.some((x) => x.as === "Aoife"), "Send again on Aoife: it leaves Mary's My golf");

// ================================================================ organisers with an old PIN move to email
const hash = createHash("sha256").update(`${SECRET}:4321`).digest("hex");
sql(`update tournaments set organiser_pin_hash='${hash}' where id='${tid}'`);
const old = agent();
ok((await old("/api/login", { t: T, mode: "organiser", pin: "9999" })).status === 401, "a wrong organiser PIN is refused");
r = await old("/api/login", { t: T, mode: "organiser", pin: "4321" });
ok(r.status === 200 && r.j.needEmail === true, "the old PIN works once more, and asks for an email");
ok((await old("/api/admin", { t: T, action: "state" })).j.needEmail === true, "the organiser home asks for the email too");
const oldPin2 = agent();
await oldPin2("/api/login", { t: T, mode: "organiser", pin: "4321" });
await signInWithEmail(old, "seamus@example.ie");
ok(sql(`select organiser_pin_hash is null from tournaments where id='${tid}'`) === "f", "signing in alone doesn't move the tournament");
golf = (await old("/api/account")).j;
ok(golf.here.some((h) => h.slug === T && h.role === "organiser"), "My golf offers: Add to My golf");
ok((await old("/api/admin", { t: T, action: "state" })).j.accountEmail === "seamus@example.ie", "the organiser home offers it too");
await old("/api/account", { action: "claim", tournament: tid });
ok(sql(`select organiser_pin_hash is null from tournaments where id='${tid}'`) === "t", "added: the PIN is retired");
ok((await old("/api/admin", { t: T, action: "state" })).status === 200 && (await old("/api/account")).j.running.some((x) => x.slug === T), "and the tournament is in Seamus's My golf");
ok((await agent()("/api/login", { t: T, mode: "organiser", pin: "4321" })).status === 401, "the PIN no longer works");
ok((await oldPin2("/api/admin", { t: T, action: "state" })).status === 403, "other phones signed in with the PIN are signed out");

// ================================================================ followers who joined with an email
const fan = agent();
await fan("/api/fans", { t: T, action: "join", name: "Clodagh", email: "clodagh@example.ie", over16: true, consent: true });
m = await lastMailTo("clodagh@example.ie");
await fan("/api/fans", { t: T, action: "verify", token: new URL(linkOf(m)).searchParams.get("token") });
golf = (await fan("/api/account")).j;
ok(golf.account?.email === "clodagh@example.ie" && golf.following.some((x) => x.slug === T), "a follower who confirms their email: signed in, under Following");
ok((await ses(fan, T))?.role === "fan", "and still following on this phone");

// ================================================================ the screens
const browser = await chromium.launch();
const shot = async (page, name) => page.screenshot({ path: `${SHOTS}/signin-${name}.png`, fullPage: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await p.getByRole("heading", { name: "Sign in" }).waitFor();
await shot(p, "1-account");
await p.getByLabel("Your email").fill("rory@example.ie");
await p.getByRole("button", { name: "Email me a sign-in link" }).click();
await p.getByRole("heading", { name: "Check your email" }).waitFor();
await shot(p, "2-check-email");
m = await lastMailTo("rory@example.ie");
await p.getByLabel("The code from the email").fill(codeOf(m));
await p.getByRole("button", { name: "Sign in", exact: true }).click();
await p.getByRole("heading", { name: "My golf" }).waitFor();
ok(/Nothing here yet/.test(await p.locator("main").innerText()), "a new person's My golf: nothing yet");
// Rory is added to Pat Cup as an organiser and as Dara... as Neil's brother: organiser
await pat("/api/admin", { t: T, action: "addOrganiser", email: "rory@example.ie" });
await p.reload({ waitUntil: "networkidle" });
await p.locator(".golf-offer").waitFor();
await shot(p, "3-offer");
await p.getByRole("button", { name: "Yes, that's me" }).click();
await p.getByRole("heading", { name: "Running" }).waitFor();
await shot(p, "4-my-golf");
// The organiser's players list
await p.goto(`${BASE}/t/${T}/admin#players`, { waitUntil: "networkidle" });
await p.locator(".player-access").first().waitFor();
const lines = await p.locator(".player-access").allInnerTexts();
ok(lines.some((x) => /Signed in on 1 phone/.test(x)) && lines.some((x) => /That's you|Link sent|No link/.test(x)), `players list says who's signed in (${lines.join(" / ")})`);
await shot(p, "5-players");
ok((await p.getByRole("button", { name: "Send again" }).count()) >= 1, "Send again beside players already signed in");
await p.goto(`${BASE}/t/${T}/admin#organisers`, { waitUntil: "networkidle" });
await p.locator(".org-people li").first().waitFor();
await shot(p, "6-organisers");
// The line at the top
await p.goto(`${BASE}/t/${T}`, { waitUntil: "networkidle" });
const line = (await p.locator(".role-badge").innerText()).replace(/\s+/g, " ").trim();
ok(line === "You're the organiser", `the top of the page: You're the organiser (not named after the organiser who made it): ${line}`);
await p.locator(".site-head").screenshot({ path: `${SHOTS}/signin-7-line.png` });
// A player's link on a new phone
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const durl = await playerLink(pat, T, DARA, true);
await ph.goto(durl, { waitUntil: "networkidle" });
await ph.getByRole("button", { name: "I'm Dara" }).waitFor();
ok(/privacy policy/.test(await ph.locator(".link-in").innerText()), "I'm Dara, with the privacy line");
await shot(ph, "8-im-dara");
await ph.getByRole("button", { name: "I'm Dara" }).click();
await ph.getByRole("heading", { name: "Welcome, Dara" }).waitFor();
await shot(ph, "9-welcome");
await ph.getByRole("link", { name: "Let's go" }).click();
await ph.waitForLoadState("networkidle");
ok(/You're playing as/.test(await ph.locator(".role-badge").innerText()), "the top of the page: You're playing as Dara");
const ph2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await ph2.goto(durl, { waitUntil: "networkidle" });
await ph2.getByRole("heading", { name: "This link has already been used" }).waitFor();
await shot(ph2, "10-used");
// Sign-in page for a tournament
await ph2.goto(`${BASE}/t/${T}/login`, { waitUntil: "networkidle" });
await ph2.getByRole("button", { name: /I'm the organiser/ }).click();
await ph2.getByLabel("Your email").waitFor();
await shot(ph2, "11-organiser-signin");
// The owner page's check, with Face ID on a device that has it (passkeys need a name, not a number, for the site)
const LOCAL = BASE.replace("127.0.0.1", "localhost");
const oc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const op = await oc.newPage();
const cdp = await oc.newCDPSession(op);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await op.goto(`${LOCAL}/owner`, { waitUntil: "networkidle" });
await op.getByLabel("Your email").fill("owner@test.ie");
await op.getByRole("button", { name: "Email me a sign-in link" }).click();
await op.getByLabel("The code from the email").waitFor();
m = await lastMailTo("owner@test.ie");
await op.getByLabel("The code from the email").fill(codeOf(m));
await op.getByRole("button", { name: "Sign in", exact: true }).click();
await op.getByRole("heading", { name: "Confirm it's you" }).waitFor();
await shot(op, "12-owner-check");
const before = mails().length;
await op.getByRole("button", { name: "Email me a code" }).click();
await op.getByLabel("The code from the email").waitFor();
for (let i = 0; i < 40 && mails().length === before; i++) await new Promise((r2) => setTimeout(r2, 150));
m = await lastMailTo("owner@test.ie");
await op.getByLabel("The code from the email").fill(codeOf(m));
await op.getByRole("button", { name: "Carry on" }).click();
await op.getByRole("heading", { name: "Use Face ID next time?" }).waitFor();
await shot(op, "13-offer-face");
await op.getByRole("button", { name: "Set up Face ID" }).click();
await op.getByRole("heading", { name: "Tournaments" }).waitFor({ timeout: 15000 });
ok(sql(`select count(*) from owner_passkeys`) === "1", "Face ID set up for the owner");
// Next time: Face ID instead of a code
sql(`update site_settings set value = value where key='owner'`);
await oc.clearCookies();
await op.goto(`${LOCAL}/owner`, { waitUntil: "networkidle" });
await op.getByLabel("Your email").fill("owner@test.ie");
await op.getByRole("button", { name: "Email me a sign-in link" }).click();
await op.getByLabel("The code from the email").waitFor();
m = await lastMailTo("owner@test.ie");
await op.getByLabel("The code from the email").fill(codeOf(m));
await op.getByRole("button", { name: "Sign in", exact: true }).click();
await op.getByRole("button", { name: "Use Face ID" }).click();
await op.getByRole("heading", { name: "Tournaments" }).waitFor({ timeout: 15000 });
ok(true, "Face ID passes the owner's check");
await browser.close();

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
