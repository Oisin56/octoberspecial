import { execSync } from "node:child_process";
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);

for (const f of fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-") || f === "tts.log" || f === "veo.log")) fs.rmSync(`/var/tmp/ospg/${f}`);

const browser = await chromium.launch();
{
  // two real short clips on R1 (recorded from a page), posted by a caddie
  let cookie = "";
  const call = async (path, body) => {
    const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ t: T, ...body }) });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json() };
  };
  await call("/api/login", { mode: "player", playerId: "neil", pin: "2468" });
  const r1 = (await (await fetch(`http://127.0.0.1:54321/rest/v1/rounds?select=id&number=eq.1`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json())[0];
  // real, seekable clips: two landscape and one filmed upright
  const { execSync } = await import("node:child_process");
  const clipsSpec = [
    { size: "640x360", t: 7, hole: 2, body: "Oisin's drive on 2", tags: [], player: "oisin" },
    { size: "640x360", t: 6, hole: 5, body: "Oisin's approach on 5", tags: [], player: "oisin" },
    { size: "640x360", t: 7, hole: 5, body: "Neil chips in on 5!", tags: ["chip-in"], player: "neil" },
    { size: "360x640", t: 3, hole: 6, body: "", tags: [], player: "oisin" },
  ];
  for (const [i, c] of clipsSpec.entries()) {
    const out = `/var/tmp/ospg/vid/clip-${i}.webm`;
    fs.mkdirSync("/var/tmp/ospg/vid", { recursive: true });
    execSync(`ffmpeg -y -loglevel error -f lavfi -i testsrc=size=${c.size}:rate=25 -t ${c.t} -c:v libvpx -b:v 300k ${out}`);
    const up = await call("/api/upload-url", { filename: "clip.webm", contentType: "video/webm" });
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", new Blob([fs.readFileSync(out)], { type: "video/webm" }), "clip.webm");
    await fetch(up.j.signedUrl, { method: "PUT", body: fd });
    await call("/api/posts", { roundId: r1.id, hole: c.hole, body: c.body, tags: c.tags, playerIds: [c.player], kind: "video", mediaPath: up.j.path });
  }
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(`${BASE}/t/${T}/login`);
await page.getByRole("button", { name: "Organiser" }).click();
await page.getByLabel("PIN").fill("1234");
await page.getByRole("button", { name: "Log in" }).click();
await page.waitForTimeout(1200);
await page.goto(`${BASE}/t/${T}/admin`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /Highlights film/ }).click();
await page.getByText("AI director").first().waitFor();

ok((await page.getByText("✓ Plan writer").count()) === 1, "plan writer shows as connected");
ok((await page.getByText(/✓ Renderer/).count()) === 1, "renderer shows as connected");

// Music upload (any audio file works for the test)
fs.rmSync("/var/tmp/ospg/music.log", { force: true });

// Brief: whole tournament, 1 minute, voice + Veo
await page.getByLabel("Length").selectOption("60");
await page.getByText("Suggest cinematic AI shots").click();
ok((await page.getByLabel("Commentary style").count()) === 1 && (await page.getByLabel("How much talking").count()) === 1, "commentary style and amount offered in the brief");
await page.getByLabel("Commentary style").selectOption("dry");
ok((await page.getByText("Understated, deadpan, quietly cutting").count()) === 1, "the chosen style is explained");
await page.locator("#dir-brief-voice").selectOption("commentator01");
fs.rmSync("/var/tmp/ospg/plan-retry.txt", { force: true });
await fetch("http://127.0.0.1:54321/__badplan"); // the first reply comes back broken
await page.getByRole("button", { name: "Write the plan" }).click();
try {
  await page.getByText("Plan ready").waitFor({ timeout: 60000 });
} catch (e) {
  await page.screenshot({ path: "/var/tmp/ospg/shots/director-fail.png", fullPage: true });
  console.log("msg:", await page.locator("[aria-live=polite]").allInnerTexts());
  throw e;
}
ok(fs.existsSync("/var/tmp/ospg/plan-retry.txt") && /ONLY the JSON/.test(fs.readFileSync("/var/tmp/ospg/plan-retry.txt", "utf8")), "a broken reply from the director is retried, not turned into an empty plan");
const items = await page.locator(".director-list > li").count();
ok(items >= 5, `plan has ${items} segments`);
ok((await page.getByText("Title card").count()) === 1, "title card present");
ok((await page.getByText(/Clip · R1 H/).count()) >= 2, "R1 clips present");
ok((await page.getByText("Round result").count()) >= 1, "round result card present");
ok((await page.getByText(/From the scoreboard: Oisin 40 · Neil 0/).count()) >= 1, "result card numbers come from the scoreboard (Oisin 40, Neil 0)");
ok((await page.getByText("AI shot (Veo)").count()) === 1, "Veo shot suggested");
const imgs = JSON.parse(fs.readFileSync("/var/tmp/ospg/plan-images.json", "utf8"));
ok(imgs.images >= 6 && imgs.labels.length === 4, `the director was shown stills from each clip (${imgs.images} stills, ${imgs.labels.length} clips)`);
const planPrompt = fs.readFileSync(fs.readdirSync("/var/tmp/ospg").filter((f) => /^prompt-\d+\.txt$/.test(f)).map((f) => `/var/tmp/ospg/${f}`).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], "utf8");
ok(/PLAYERS:/.test(planPrompt) && /COURSES AND CONDITIONS/.test(planPrompt) && /statusBefore/.test(planPrompt) && /holeNote/.test(planPrompt), "brief includes players, courses, and the match before and after each clip");
ok(/bone-dry, understated commentator/.test(planPrompt) && !/seasoned TV golf/.test(planPrompt), "the chosen commentary style reaches the director");
ok( /commentary for every chosen clip/.test(planPrompt) && /delivery tag/.test(planPrompt), "commentator brief: a line for every clip, delivery tags allowed");
ok(/set it up, go quiet for the stroke, then react/.test(planPrompt) && /NEVER say or hint at the result/.test(planPrompt), "commentary split into a set-up (no spoilers) and a payoff");
ok(/"shape":"portrait"/.test(planPrompt) && /"seconds":7/.test(planPrompt) && /"seconds":3/.test(planPrompt), "clip shape and length passed to the director");
ok(/portrait/.test(await page.locator("h3", { hasText: "Edit plan" }).innerText()), "mixed footage (2 landscape, 1 upright) makes a portrait film for phones");
ok((await page.locator("#dir-voice").inputValue()) === "commentator01", "the voice picked in the brief carries into the plan");
ok((await page.getByText(/Commentary: \d+ lines to record/).count()) === 1, "commentary shows as not yet recorded");

// Music: composed for this film by default
ok((await page.getByLabel("Music", { exact: true }).inputValue()) === "made", "music defaults to 'Made for this film'");
ok((await page.getByLabel("Mood").inputValue()) === "epic", "a mood is picked");
await page.getByRole("button", { name: "Compose music" }).click();
await page.getByText("Music ready. Have a listen.").waitFor({ timeout: 30000 });
let mlog = fs.readFileSync("/var/tmp/ospg/music.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(mlog.length === 1 && mlog[0].body.force_instrumental === true && /orchestral/.test(mlog[0].body.prompt) && mlog[0].body.music_length_ms % 1000 === 0 && mlog[0].body.music_length_ms >= 10000, `composed an instrumental epic track of ${mlog[0].body.music_length_ms / 1000}s`);
ok((await page.locator(".music-choice audio").count()) === 1 && (await page.getByRole("button", { name: "Try another" }).count()) === 1, "player and 'Try another' shown");
await page.locator(".music-choice").screenshot({ path: "/var/tmp/ospg/shots/music-choice.png" });
await page.getByLabel("Mood").selectOption("celtic");
ok((await page.getByRole("button", { name: "Compose music" }).count()) === 1, "changing the mood clears the old track");

// Score panels on the review screen
await page.waitForFunction(() => [...document.querySelectorAll('img[alt^="Score panel"]')].length >= 3 && [...document.querySelectorAll('img[alt^="Score panel"]')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => null);
const panelImgs = await page.locator('img[alt^="Score panel"]').evaluateAll((els) => els.map((i) => ({ alt: i.alt, w: i.naturalWidth })));
console.log("     panels on review screen:", JSON.stringify(panelImgs));
ok(panelImgs.length >= 2 && panelImgs.every((i) => i.w === 1080), "score panel previews shown for the clips (portrait film)");
ok(panelImgs.some((i) => i.alt === "Score panel after the hole"), "the chip-in clip gets an 'after the hole' panel");
const bugTexts = await page.locator(".bug-text").allInnerTexts();
console.log("     " + bugTexts.join("\n     "));
ok(bugTexts.some((t) => /R1 · Hole 5 · Par/.test(t) && /thru 4/.test(t)), "panel for hole 5 shows the score through 4 holes");
await page.locator(".director-list li").filter({ hasText: "Clip · R1 H5" }).first().screenshot({ path: "/var/tmp/ospg/shots/review-panel.png" });

// Edit a caption and save
const cap = page.getByLabel("Caption").first();
await cap.fill("Hole 1 · Fionn's camera");
await page.getByRole("button", { name: "Save changes" }).click();
await page.getByText("Saved", { exact: true }).waitFor();
ok(true, "edited caption saved");

// Generate the Veo shot
await fetch("http://127.0.0.1:54321/__veofetchfail");
await page.getByRole("button", { name: "Generate this shot" }).click();
await page.getByText("Generating (1–5 minutes)…").waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Fetch it again (no charge)" }).waitFor({ timeout: 60000 });
ok((await page.getByText(/Google made the shot but it couldn't be downloaded/).count()) === 1, "a failed download says the shot was made and offers a free re-fetch");
await page.getByRole("button", { name: "Fetch it again (no charge)" }).click();
await page.getByRole("button", { name: "Make a new one" }).waitFor({ timeout: 60000 });
ok(fs.readFileSync("/var/tmp/ospg/veo.log", "utf8").trim().split("\n").length === 1, "re-fetching didn't ask Google for a new shot");
ok(true, "Veo shot generated and stored");

// Record the commentary: two at a time, retrying when the voice service says it's busy
fs.rmSync("/var/tmp/ospg/tts.log", { force: true });
fs.rmSync("/var/tmp/ospg/tts429.log", { force: true });
await fetch("http://127.0.0.1:54321/__tts429?n=2");
ok((await page.getByText("Set-up (before the shot)").count()) >= 3 && (await page.getByText("Payoff (as the result shows)").count()) >= 3, "each clip has a set-up line and a payoff line");
ok((await page.getByText(/too long: it'll be shortened automatically/).count()) >= 1, "an over-long line is flagged before recording");
fs.rmSync("/var/tmp/ospg/tighten.log", { force: true });
fs.rmSync("/var/tmp/ospg/sfx.log", { force: true });
await page.getByRole("button", { name: "Record commentary" }).click();
await page.getByText(/Commentary recorded: all \d+ lines/).waitFor({ timeout: 90000 });
const h6 = page.locator(".director-list li").filter({ hasText: "Clip · R1 H6" }).first();
ok((await h6.locator("textarea").nth(0).inputValue()) === "" && (await h6.locator("textarea").nth(1).inputValue()) !== "", "a clip under 4 seconds keeps just one line (the payoff)");
ok(fs.existsSync("/var/tmp/ospg/tighten.log"), "lines that ran long were sent back to be shortened");
ok((await page.getByText(/shortened to fit/).count()) >= 1, "shortened lines are marked in the editor");
ok((await page.getByText(/Downhill, twelve feet, left to right/).count()) === 0 && (await page.locator(".director-list textarea").evaluateAll((els) => els.some((e) => e.value === "Downhill, twelve."))), "the long set-up was rewritten shorter, with no manual edit");
await page.locator(".director-list li").filter({ hasText: "Clip · R1 H3" }).first().screenshot({ path: "/var/tmp/ospg/shots/setup-payoff.png" });
const peak = Number(await (await fetch("http://127.0.0.1:54321/__ttspeak")).text());
ok(peak <= 2, `never more than 2 lines recorded at once (peak ${peak})`);
ok(fs.existsSync("/var/tmp/ospg/tts429.log"), "busy replies were retried, not dropped");
const recordedPlayers = await page.locator(".director-list audio").count();
ok(recordedPlayers >= 3, `each recorded line can be played back (${recordedPlayers})`);
const firstRecord = fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").length;
// Change one line: only that one is recorded again
const lineBox = page.locator(".director-list li").filter({ hasText: "Round result" }).first().locator("textarea");
const oldLine = (await lineBox.inputValue()).trim();
await lineBox.fill("And that, as they say, is that.");
ok((await page.getByText("Not recorded yet").count()) === 1, "an edited line shows as not recorded");
await page.screenshot({ path: "/var/tmp/ospg/shots/commentary.png", fullPage: true });

const lineCount = await page.locator(".director-list .field textarea").evaluateAll((els) => els.filter((e) => e.value.trim()).length);
// Render
await page.getByRole("button", { name: "Render the film" }).click();
await page.getByText(/Film ready/).waitFor({ timeout: 90000 });
ok(true, "film rendered and published");
await page.screenshot({ path: "/var/tmp/ospg/shots/director.png", fullPage: true });

// Inspect what was sent to the renderer
const editFile = fs.readdirSync("/var/tmp/ospg").find((f) => f.startsWith("edit-"));
const edit = JSON.parse(fs.readFileSync(`/var/tmp/ospg/${editFile}`, "utf8"));
const main = edit.timeline.tracks.find((t) => t.clips.some((c) => c.asset.type === "video"));
const specOf = (c) => (c.asset.src?.includes("/api/director/card") ? JSON.parse(Buffer.from(new URL(c.asset.src).searchParams.get("d"), "base64url").toString()) : null);
const isSting = (c) => specOf(c)?.k === "sting";
const kinds = main.clips.map((c) => (c.asset.src.includes("/api/director/card") ? "card" : c.asset.src.includes("veo-") ? "veo" : "clip"));
console.log("     timeline:", kinds.join(" → "));
ok(kinds[0] === "veo" && kinds[1] === "card", "opens with the Veo shot then the title card");
let prevEnd = 0, contiguous = true;
for (const c of main.clips) {
  if (Math.abs(c.start - prevEnd) > 0.02) contiguous = false;
  prevEnd = c.start + c.length;
}
ok(contiguous, "main track clips are back-to-back with no gaps");
ok(edit.timeline.tracks.filter((t) => t !== main).every((t) => t.clips.every((c) => c.asset.type === "audio" || c.filter === "blur" || c.fit === "contain" || c.opacity === 0 || (c.fit === "none" && isSting(c)))), "score panels and captions scale to the frame");
mlog = fs.readFileSync("/var/tmp/ospg/music.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(mlog.length === 2 && /tin whistle/.test(mlog[1].body.prompt), "render composed the Celtic track (mood changed, Veo shot added)");
ok(!!edit.timeline.soundtrack?.src?.includes("/music-") && edit.timeline.soundtrack.effect === "fadeIn", "composed music on the soundtrack, fading in only so the ending lands");
const filmLen = Math.max(...edit.timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)));
ok(Math.abs(mlog[1].body.music_length_ms / 1000 - Math.ceil(filmLen)) <= 2, `music length ${mlog[1].body.music_length_ms / 1000}s matches the film (${filmLen.toFixed(1)}s)`);
ok(edit.output.aspectRatio === "9:16" && edit.output.resolution === "1080" && edit.output.format === "mp4", "output portrait 1080x1920 mp4");
const ttsAll = fs.readFileSync("/var/tmp/ospg/tts.log", "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(ttsAll.length - firstRecord === 1 && ttsAll.at(-1).text === "And that, as they say, is that.", "render recorded only the changed line, reusing the rest");
// One entry per line (busy replies were retried); the edited line's old words aren't in the film
const tts = [...new Map(ttsAll.map((x) => [x.text, x])).values()].filter((x) => x.text !== oldLine);
ok(tts.every((x) => x.model === "eleven_v3" && x.voice === "commentator01") && tts.some((x) => x.text.startsWith("[whispers]")), "commentary recorded with Eleven v3, delivery tags kept, chosen voice");
const fillTrack = edit.timeline.tracks.find((t) => t.clips.every((c) => c.filter === "blur"));
const clipStarts = main.clips.filter((c) => c.asset.type === "video" && !c.asset.src.includes("veo-")).map((c) => c.start);
const cardClips = main.clips.filter((c) => c.asset.src.includes("/api/director/card"));
const cardCount = cardClips.length;
const realStarts = main.clips.filter((c) => c.asset.type === "video" && !c.asset.src.includes("veo-") && !c.asset.speed && c.asset.volume !== 0.3).map((c) => c.start);
const fillOnClips = fillTrack ? fillTrack.clips.filter((f) => f.asset.type === "video" && realStarts.some((s) => Math.abs(s - f.start) < 0.05)).length : 0;
const cardFills = fillTrack ? fillTrack.clips.filter((f) => cardClips.some((c) => Math.abs(c.start - f.start) < 0.05)) : [];
ok(cardFills.length === cardCount && cardFills.every((f) => f.asset.type === "image" && /\.jpg$/.test(f.asset.src) && f.effect === "zoomInSlow"), "behind every card: a blurred, slowly drifting still, never moving footage (nothing plays twice)");
ok(cardClips.every((c) => JSON.parse(Buffer.from(new URL(c.asset.src).searchParams.get("d"), "base64url").toString()).v === 6), "card addresses carry the design version, so old cached cards can't come back");
ok(!!fillTrack && fillOnClips === 3, "the three sideways clips and the cards get a blurred fill behind them (bottom track), the upright clip doesn't");
ok(tts.length >= 3 && tts.some((t) => t.text.includes("Seven rounds")), `voice-over recorded ${tts.length} lines`);
const voiceTrack = edit.timeline.tracks.find((t) => t.clips.every((c) => c.asset.type === "audio"));
ok(voiceTrack && voiceTrack.clips.length === lineCount, `every narration line placed on the timeline (${lineCount})`);
const vs = [...voiceTrack.clips].sort((a, b) => a.start - b.start);
ok(vs.every((c, i) => i === 0 || c.start >= vs[i - 1].start + vs[i - 1].length - 0.001), "no two lines of commentary ever overlap");
ok(vs.every((c) => Math.abs(c.length - 0.1 - Math.round((c.length - 0.1) * 100) / 100) < 0.01 && c.length > 0.6), "each line is placed for its measured length");
// Payoffs land at the end of their clip, once the result is on screen
const savedPlan = JSON.parse(execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtA -c "select plan from reels order by updated_at desc limit 1"`).toString());
// Where each clip's own footage sits on the film (the first, real-speed piece of that clip)
const realOf = (sg) => main.clips.find((c) => c.asset.src === sg.src && !c.asset.speed && Math.abs(c.asset.trim - sg.in) < 0.01);
const payoffs = savedPlan.segments.filter((sg) => sg.kind === "clip" && sg.payoffSrc).map((sg) => ({ sg, a: voiceTrack.clips.find((c) => c.asset.src === sg.payoffSrc), r: realOf(sg) }));
ok(payoffs.length >= 3 && payoffs.every(({ a, r }) => a && r && a.start + a.length - 0.1 >= r.start + r.length - 0.05 && a.start + a.length - 0.1 <= r.start + r.length + 0.55), `every payoff lands as the footage ends and the result shows, not before (${payoffs.map(({ a, r }) => `${(a.start + a.length - 0.1 - r.start - r.length).toFixed(2)}s`).join(", ")} after the footage)`);
const setups = savedPlan.segments.filter((sg) => sg.kind === "clip" && sg.voiceSrc).map((sg) => ({ sg, a: voiceTrack.clips.find((c) => c.asset.src === sg.voiceSrc), r: realOf(sg) }));
ok(setups.length >= 2 && setups.every(({ a, r }) => a && r && a.start >= r.start + 0.79), "every set-up waits a beat after the cut, so the picture lands first");
// The result is held before moving on: more footage, or the last moments at half speed
const holds = payoffs.map(({ r }) => main.clips[main.clips.indexOf(r) + 1]);
ok(holds.every((h, k) => h && h.asset.src === payoffs[k].sg.src && Math.abs(h.length - 1.4) < 0.01 && Math.abs(h.start - (payoffs[k].r.start + payoffs[k].r.length)) < 0.01 && (h.asset.speed === 0.5 || h.asset.volume === 0.3)), "each result is held for 1.4s before the next scene (slow motion when the clip has no more footage)");
// Cutting: hard cut between shots on the same hole, the branded swipe for everything else
const stingA = edit.timeline.tracks.find((t) => t.clips.every((c) => isSting(c) && specOf(c).layer === "a"));
const sceneStarts = [];
let prevSg = null;
for (const sg of savedPlan.segments) {
  const first = sg.kind === "clip" ? realOf(sg) : main.clips.find((c) => (sg.kind === "veo" ? c.asset.src === sg.src : specOf(c)?.h === sg.heading));
  if (!first) continue;
  const same = prevSg?.kind === "clip" && sg.kind === "clip" && !prevSg.replay && prevSg.round === sg.round && prevSg.hole === sg.hole;
  if (prevSg) sceneStarts.push({ at: first.start, swipe: !same });
  prevSg = sg;
}
const swipedAt = (T) => stingA.clips.some((c) => Math.abs(c.start + c.length / 2 - T) < 0.02);
ok(!!stingA && sceneStarts.length >= 6 && sceneStarts.some((x) => !x.swipe) && sceneStarts.every(({ at, swipe }) => swipedAt(at) === swipe), `the swipe covers every change of scene and no same-hole cut (${sceneStarts.map((x) => (x.swipe ? "swipe" : "cut")).join(", ")})`);
ok(stingA.clips.every((c) => c.offset?.x?.length === 2 && c.offset.x[0].from === -1.35 && c.offset.x[1].to === 1.35 && c.offset.x[0].easing === "easeOutCubic" && c.fit === "none"), "the swipe slams in, holds and clears, eased");
ok(["b", "c"].every((l) => edit.timeline.tracks.some((t) => t.clips.length === stingA.clips.length && t.clips.every((c) => isSting(c) && specOf(c).layer === l))), "three layers to the swipe: main band, lighter band and gold edges");
ok(main.clips.filter((c) => c.transition).length === 2 && main.clips[0].transition.in === "fade" && main.clips.at(-1).transition.out === "fadeSlow", "no dips to black between scenes: only the film's opening and ending fade");
const sfxTrack = edit.timeline.tracks.find((t) => t.clips.length && t.clips.every((c) => c.asset.type === "audio" && /whoosh/.test(c.asset.src)));
ok(!!sfxTrack && sfxTrack.clips.length === stingA.clips.length && (!fs.existsSync("/var/tmp/ospg/sfx.log") || fs.readFileSync("/var/tmp/ospg/sfx.log", "utf8").trim().split("\n").length === 1), "a whoosh under every swipe, made once and reused");
// New hole: player-and-hole strap
const ovTrack = edit.timeline.tracks.find((t) => t.clips.some((c) => specOf(c)?.k === "strap"));
const straps = ovTrack ? ovTrack.clips.filter((c) => specOf(c)?.k === "strap") : [];
ok(straps.length >= 2 && straps.every((c) => /^\d+$/.test(specOf(c).e) && specOf(c).h && /Par \d/.test(specOf(c).s) && c.offset?.x?.[0]?.easing === "easeOutCubic"), `new holes open with a player-and-hole strap that glides in (${straps.map((c) => `${specOf(c).h} · ${specOf(c).e}`).join(", ")})`);
// Replay of the big moment
const rp = savedPlan.segments.find((sg) => sg.kind === "clip" && sg.replay);
const rr = rp && realOf(rp);
const rpiece = rr && main.clips[main.clips.indexOf(rr) + 2];
ok(!!rpiece && rpiece.asset.speed === 0.5 && rpiece.asset.src === rp.src && Math.abs(rpiece.length - 2 * Math.min(3, rr.length)) < 0.01, "the chip-in gets a half-speed replay after the hold");
ok(swipedAt(rpiece.start) && ovTrack.clips.some((c) => specOf(c)?.k === "replay" && c.start > rpiece.start && c.start < rpiece.start + 1) && voiceTrack.clips.some((c) => c.asset.src === rp.replaySrc && c.start >= rpiece.start + 0.79), "the replay is swiped in, tagged REPLAY, with its own quiet line");
// The clip's own sound: down under the voice, back up for the shot
const nat = edit.timeline.tracks.find((t) => t.clips.every((c) => c.opacity === 0));
const talkClips = main.clips.filter((c) => c.asset.type === "video" && !c.asset.src.includes("veo-") && c.asset.volume === 0 && !c.asset.speed);
ok(!!nat && talkClips.length >= 3 && talkClips.every((c) => {
  const pieces = nat.clips.filter((n) => n.start >= c.start - 0.01 && n.start < c.start + c.length - 0.01);
  const covered = pieces.reduce((x, n) => x + n.length, 0);
  return Math.abs(covered - c.length) < 0.05 && pieces.some((n) => n.asset.volume === 1) && pieces.some((n) => n.asset.volume < 0.5);
}), "under commentary the clip's own sound drops, and comes back up for the shot itself");
const veo = JSON.parse(fs.readFileSync("/var/tmp/ospg/veo.log", "utf8").trim().split("\n")[0]);
ok(veo.body.parameters.aspectRatio === "9:16" && /no people/i.test(veo.body.instances[0].prompt), "Veo asked for 9:16, no people");

// Save one title card and one caption image to look at
const titleSrc = main.clips[1].asset.src;
fs.writeFileSync("/var/tmp/ospg/shots/card-title.png", Buffer.from(await (await fetch(titleSrc)).arrayBuffer()));
const resultClip = main.clips.find((c) => c.asset.src.includes("/api/director/card") && Buffer.from(new URL(c.asset.src).searchParams.get("d"), "base64url").toString().includes('"result"'));
fs.writeFileSync("/var/tmp/ospg/shots/card-result.png", Buffer.from(await (await fetch(resultClip.asset.src)).arrayBuffer()));
const isKind = (c, k) => c.asset.src?.includes("/api/director/card") && JSON.parse(Buffer.from(new URL(c.asset.src).searchParams.get("d"), "base64url").toString()).k === k;
const capTrack = edit.timeline.tracks.find((t) => t.clips.some((c) => isKind(c, "caption")));
const bugTrack = edit.timeline.tracks.find((t) => t.clips.some((c) => isKind(c, "bug")));
ok(!!bugTrack && edit.timeline.tracks.indexOf(bugTrack) === 3 && edit.timeline.tracks.slice(0, 3).every((t) => t.clips.every(isSting)), "score panels sit just under the swipe, above everything else");
const bugSpecs = bugTrack.clips.map((c) => ({ c, spec: JSON.parse(Buffer.from(new URL(c.asset.src).searchParams.get("d"), "base64url").toString()) }));
console.log("     panels:", bugSpecs.map(({ c, spec }) => `H${spec.b.hole} ${spec.b.mode} thru ${spec.b.thru} [${spec.b.rows.map((r) => r.name + " " + r.value).join(", ")}]${spec.b.flash ? " " + spec.b.flash : ""} @${c.start}+${c.length}`).join(" | "));
const h5 = bugSpecs.filter(({ spec }) => spec.b.hole === 5).slice(-2); // the chip-in: before and after
ok(h5.length === 2 && h5[1].spec.b.thru === h5[0].spec.b.thru + 1, "hole 5 panel flips to the updated score at the end of the clip");
ok(Math.abs(h5[0].c.start + h5[0].c.length - h5[1].c.start) < 0.31, "the update follows straight on");
const clipSeg = main.clips.find((c) => !c.asset.src.includes("/api/director/card") && !c.asset.src.includes("veo-") && !c.asset.speed && c.start <= h5[0].c.start && c.start + c.length > h5[0].c.start);
const after = clipSeg && main.clips[main.clips.indexOf(clipSeg) + 1];
ok(!!clipSeg && h5[1].c.start + h5[1].c.length <= clipSeg.start + clipSeg.length + (after?.asset.src === clipSeg.asset.src ? after.length : 0) + 0.01, "panel stays within its clip (and its hold)");
fs.writeFileSync("/var/tmp/ospg/shots/card-bug-before.png", Buffer.from(await (await fetch(h5[0].c.asset.src)).arrayBuffer()));
fs.writeFileSync("/var/tmp/ospg/shots/card-bug-after.png", Buffer.from(await (await fetch(h5[1].c.asset.src)).arrayBuffer()));
fs.writeFileSync("/var/tmp/ospg/shots/card-caption.png", Buffer.from(await (await fetch(capTrack.clips[0].asset.src)).arrayBuffer()));
const tampered = titleSrc.replace(/sig=[^&]+/, "sig=forged");
ok((await fetch(tampered)).status === 403, "card URLs can't be forged");

// The film is in Highlights for followers
const posts = await (await fetch(`http://127.0.0.1:54321/rest/v1/posts?author_name=eq.AI%20director&select=body,media_path`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();
ok(posts.length === 1 && posts[0].media_path.startsWith("video/october-special-2026/reel-"), "film copied to storage and posted to Highlights");

// Non-organisers can't use the director
const anon = await fetch(`${BASE}/api/director`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: T, action: "list" }) });
ok(anon.status === 403, "director is organiser-only");


// Your own track instead (same film, rendered again)
await page.getByLabel("Music", { exact: true }).selectOption("upload");
await page.locator(".music-choice input[type=file]").setInputFiles({ name: "track.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3fake-music") });
await page.getByText("Music saved for this tournament").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Render again" }).click();
await page.getByText(/Film ready/).waitFor({ timeout: 90000 });
{
  const newest = fs.readdirSync("/var/tmp/ospg").filter((f) => f.startsWith("edit-")).sort((x, y) => fs.statSync(`/var/tmp/ospg/${y}`).mtimeMs - fs.statSync(`/var/tmp/ospg/${x}`).mtimeMs)[0];
  const e2 = JSON.parse(fs.readFileSync(`/var/tmp/ospg/${newest}`, "utf8"));
  ok(!!e2.timeline.soundtrack?.src && !e2.timeline.soundtrack.src.includes("/music-") && e2.timeline.soundtrack.effect === "fadeInFadeOut", "'Your own track' uses the uploaded file, with fades");
  ok(fs.readFileSync("/var/tmp/ospg/music.log", "utf8").trim().split("\n").length === 2, "no music composed for the own-track film");
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
await browser.close();
process.exit(fails ? 1 : 0);
