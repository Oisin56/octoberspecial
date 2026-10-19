// End-to-end API test against the running app (port 3100).
const BASE = "http://127.0.0.1:3100";
const T = "october-special-2026";
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function agent() {
  let cookie = "";
  return async (path, opts = {}) => {
    const r = await fetch(BASE + path, {
      ...opts,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
}
const pub = async (q) =>
  (await fetch(`http://127.0.0.1:54321/rest/v1/${q}`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();

// ======================================================= PART 1: the October Special
console.log("--- October Special");
const org = agent(), neil = agent(), caddie = agent(), anon = agent();
const post = (a, path, body) => a(path, { method: "POST", body: { t: T, ...body } });

ok((await post(org, "/api/login", { mode: "organiser", pin: "9999" })).status === 401, "wrong organiser PIN rejected");
ok((await post(org, "/api/login", { mode: "organiser", pin: "1234" })).status === 200, "organiser logs in (site owner PIN)");
const me = await org(`/api/login?t=${T}`);
ok(me.j.session?.role === "organiser" && me.j.session?.playerId === "oisin", "organiser session is Oisin");
ok((await post(neil, "/api/login", { mode: "player", playerId: "neil", pin: "2468" })).status === 401, "Neil can't log in before PIN set");
ok((await post(org, "/api/admin", { action: "savePlayer", player: { id: "neil", handicap: 12, nickname: "The Hammer", weakness: "lag putting" }, pin: "2468" })).status === 200, "organiser sets Neil's PIN + profile");
ok((await post(neil, "/api/login", { mode: "player", playerId: "neil", pin: "2468" })).status === 200, "Neil logs in");
ok((await post(neil, "/api/admin", { action: "state" })).status === 403, "Neil can't use admin");
ok((await post(caddie, "/api/login", { mode: "contributor", name: "Fionn", pin: "5555" })).status === 400, "no separate caddie login any more (caddies follow as fans)");

const st = (await post(org, "/api/admin", { action: "state" })).j.state;
const r1 = st.rounds.find((r) => r.number === 1);
const r5 = st.rounds.find((r) => r.number === 5);
ok(st.rounds.length === 7, "7 rounds loaded");
ok((await post(org, "/api/admin", { action: "saveRound", round: { id: r1.id, handicap_rule: { mode: "manual", shots: { oisin: 0, neil: 3 } }, play_date: "2026-10-08", tee: "Green" } })).status === 200, "R1: handicap, date, tee");
const r1b = (await post(org, "/api/admin", { action: "state" })).j.state.rounds.find((r) => r.number === 1);
ok(r1b.handicap_rule.shots.neil === 3 && r1b.holes[0].yards === 406 && r1b.tee === "Green" && r1b.holes[0].par === 4 && r1b.holes[11].si === 1, "tee change rebuilt yardages (Green H1 = 406) on the real Druids Heath card");

ok((await post(caddie, "/api/score", { roundId: r1.id, hole: 1, scores: {} })).status === 401, "someone not logged in can't score");
ok((await post(anon, "/api/score", { roundId: r1.id, hole: 1, scores: {} })).status === 401, "anonymous can't score");
ok((await post(neil, "/api/score", { roundId: r1.id, hole: 1, scores: {} })).status === 403, "Neil can't score (Oisin is scorer)");
ok((await post(org, "/api/score", { roundId: r1.id, hole: 1, scores: { oisin: { gross: 44 } } })).status === 400, "silly score rejected");
ok((await post(org, "/api/score", { roundId: r1.id, hole: 1, scores: { stranger: { gross: 4 } } })).status === 400, "unknown player rejected");
const r3 = st.rounds.find((r) => r.number === 3);
ok((await post(org, "/api/score", { roundId: r3.id, hole: 1, scores: { oisin: { gross: 9, pickedUp: true } } })).status === 400, "pick-up refused in stroke play");

const pars = [4, 5, 3, 5, 3, 4, 4, 4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 4]; // Druids Heath (par 71)
for (let h = 1; h <= 18; h++) {
  const p = pars[h - 1];
  const o = h === 3 ? 2 : h === 9 ? 5 : p;
  const r = await post(org, "/api/score", {
    roundId: r1.id,
    hole: h,
    scores: { oisin: { gross: o, gir: h % 2 === 1 }, neil: { gross: p + 1, gir: h === 4 } },
    ctpWinner: p === 3 ? (h === 3 ? "oisin" : h === 11 ? "neil" : null) : "oisin",
    ldWinner: p === 5 ? (h === 15 ? "neil" : "oisin") : "neil",
  });
  if (r.status !== 200) ok(false, `hole ${h}: ${JSON.stringify(r.j)}`);
}
ok(true, "18 holes saved");
ok((await post(org, "/api/score", { roundId: r1.id, hole: 18, scores: { oisin: { gross: 4 }, neil: { gross: 5 } } })).status === 200, "re-save hole 18 overwrites");
ok((await post(neil, "/api/attest", { roundId: r1.id, segment: "front" })).status === 200, "Neil signs front nine");
ok((await post(caddie, "/api/attest", { roundId: r1.id, segment: "front" })).status === 401, "caddie can't sign");

const up = await post(neil, "/api/upload-url", { filename: "clip.mov", contentType: "video/quicktime" });
ok(up.status === 200 && up.j.path.startsWith(`video/${T}/`), "signed upload URL");
const fd = new FormData();
fd.append("cacheControl", "3600");
fd.append("", new Blob([Buffer.from("fake")], { type: "video/quicktime" }), "clip.mov");
ok((await fetch(up.j.signedUrl, { method: "PUT", body: fd })).ok, "upload PUT");
const vpost = await post(neil, "/api/posts", { roundId: r1.id, hole: 3, body: "Oisin stiffs it on 3!", tags: ["birdie", "nope"], kind: "video", mediaPath: up.j.path });
ok(vpost.status === 200, "a player posts a clip");
ok((await post(neil, "/api/posts", { roundId: r1.id, hole: 9, body: "Trees off 9.", visibility: "report" })).status === 200, "report-only note");
ok((await post(neil, "/api/posts", { body: "x", mediaPath: "../../etc/passwd" })).status === 400, "path traversal rejected");
ok((await post(anon, "/api/posts", { body: "spam" })).status === 401, "anonymous can't post");
// --- followers: join with name + email (16+, agree), confirmed by an emailed link; comment and post text only
ok((await post(anon, "/api/comments", { postId: vpost.j.post.id, body: "Come on!" })).status === 401, "follower must join before commenting");
ok((await post(anon, "/api/fans", { name: "Clodagh", email: "clodagh@example.com", consent: true })).status === 400, "joining needs the 16+ tick");
ok((await post(anon, "/api/fans", { name: "Clodagh", email: "clodagh@example.com", over16: true })).status === 400, "joining needs the consent tick");
const joined = await post(anon, "/api/fans", { name: "Clodagh", email: "Clodagh@Example.com", over16: true, consent: true });
ok(joined.status === 200 && joined.j.sent === true, "join emails a sign-in link");
const { execSync } = await import("node:child_process");
const fanToken = execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "select token from fans where lower(email)='clodagh@example.com'"`).toString().trim();
ok(fanToken.length > 20, "link token stored");
ok((await post(anon, "/api/fans", { action: "verify", token: "x".repeat(32) })).status === 410, "a made-up link is refused");
const ver = await post(anon, "/api/fans", { action: "verify", token: fanToken });
ok(ver.status === 200, "the emailed link signs the fan in");
const fanSess = await anon(`/api/login?t=${T}`);
ok(fanSess.j.session?.role === "fan" && fanSess.j.session?.name === "Clodagh", "fan session");
const fc = await post(anon, "/api/comments", { postId: vpost.j.post.id, body: "Come on!" });
ok(fc.status === 200 && fc.j.comment?.fan_id && fc.j.comment?.post_id === vpost.j.post.id, "fan comments on a post");
ok((await post(anon, "/api/posts", { body: "Up the Special!" })).status === 400, "fans don't post text on its own (they comment)");
ok((await post(anon, "/api/posts", { body: "Up the Special!", kind: "video", mediaPath: up.j.path, roundId: r1.id })).status === 400, "fans can't post clips");
ok((await post(anon, "/api/upload-url", { filename: "a.mov", contentType: "video/quicktime" })).status === 401, "fans can't upload clips");
const fup = await post(anon, "/api/upload-url", { filename: "a.jpg", contentType: "image/jpeg" });
ok(fup.status === 200 && fup.j.path.startsWith(`photo/${T}/`), "fans can upload a photo");
const fp = await post(anon, "/api/posts", { body: "Up the Special!", mediaPath: fup.j.path, roundId: r1.id, hole: 4 });
ok(fp.status === 200 && fp.j.post?.kind === "photo" && fp.j.post?.fan_id && !fp.j.post?.round_id && !fp.j.post?.hole, "fans post photos with a caption, not tied to the play");
ok((await post(anon, "/api/shots", { clientId: "x".repeat(20) })).status === 401, "fan can't log shots");
ok((await post(anon, "/api/score", { roundId: r1.id })).status !== 200, "fan can't score");
const pc = await post(neil, "/api/comments", { postId: vpost.j.post.id, body: "What a shot" });
ok(pc.status === 200 && pc.j.comment?.author_name === "Neil", "players comment as themselves");
ok((await post(neil, "/api/comments", { action: "delete", id: fc.j.comment.id })).status === 403, "can't delete someone else's comment");
ok((await post(anon, "/api/comments", { action: "delete", id: fc.j.comment.id })).status === 200, "fan deletes own comment");

// --- likes: anyone, one per post per phone
const like = (device, liked = true) => post(agent(), "/api/likes", { postId: vpost.j.post.id, device, like: liked });
ok((await like("phone-aaaaaaaa")).j.count === 1, "like counted");
ok((await like("phone-aaaaaaaa")).j.count === 1, "one like per phone");
ok((await like("phone-bbbbbbbb")).j.count === 2, "another phone likes");
ok((await like("phone-aaaaaaaa", false)).j.count === 1, "unlike");
ok((await pub(`likes?post_id=eq.${vpost.j.post.id}&select=liker`)).length === 1, "likes are public (hashed phone ids)");

// --- reports: three different people hide it until the organiser looks
const rep = (ip) => fetch(BASE + "/api/reports", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ t: T, postId: fp.j.post.id }) }).then(async (r) => ({ status: r.status, j: await r.json() }));
ok((await rep("10.0.0.1")).j.hidden === false, "one report: still shown");
ok((await rep("10.0.0.1")).j.hidden === false, "same person reporting twice counts once");
ok((await rep("10.0.0.2")).j.hidden === false, "two reports: still shown");
ok((await rep("10.0.0.3")).j.hidden === true, "three reports: hidden");
ok((await pub(`posts?id=eq.${fp.j.post.id}&select=id`)).length === 0, "reported post gone from the public feed");
ok((await post(org, "/api/admin", { action: "hide", table: "posts", id: fp.j.post.id, hidden: false })).status === 200, "organiser puts it back");
ok((await pub(`posts?id=eq.${fp.j.post.id}&select=id`)).length === 1, "back in the feed");
ok((await rep("10.0.0.4")).j.hidden === false, "reports were cleared when the organiser reviewed it");
const fanId = fp.j.post.fan_id;
ok((await post(org, "/api/admin", { action: "blockFan", fanId, blocked: true })).status === 200, "organiser stops a fan posting");
ok((await post(anon, "/api/posts", { body: "again" })).status === 403, "blocked fan can't post");
ok((await post(org, "/api/admin", { action: "blockFan", fanId, blocked: false })).status === 200, "and lets them back");
const voter = "voter-0000000000000001";
ok((await post(anon, "/api/votes", { award: "shot", postId: vpost.j.post.id, voter })).status === 200, "follower votes Shot of the trip");
ok((await post(anon, "/api/votes", { award: "shot", postId: vpost.j.post.id, voter })).status === 200, "re-vote is idempotent");
ok((await post(anon, "/api/votes", { award: "worst", postId: vpost.j.post.id, voter })).status === 400, "unknown award rejected");

const prev = await post(org, "/api/admin", { action: "aiGenerate", kind: "preview", roundId: r5.id, extra: "Mention the lake" });
ok(prev.status === 200 && prev.j.piece?.status === "draft", "preview drafted");
ok((await post(org, "/api/admin", { action: "aiUpdate", id: prev.j.piece.id, status: "published", body: "Edited." })).status === 200, "preview published");

await sleep(1500);
// Every score is in: the round is finished but provisional until the card is submitted
ok((await pub(`rounds?number=eq.1&select=status`))[0].status === "live", "all scores in: round stays live (provisional) until the card is in");
ok((await post(neil, "/api/cards", { action: "submit", roundId: r1.id, game: "main" })).status === 403, "only the scorer submits the card");
const sub = await post(org, "/api/cards", { action: "submit", roundId: r1.id, game: "main" });
ok(sub.status === 200 && sub.j.stage === "final", "scorer submits: final straight away (signing off by default)");
ok((await pub(`cards?round_id=eq.${r1.id}&select=status`))[0]?.status === "final", "card is public and final");
await sleep(2500);
const st3 = (await post(org, "/api/admin", { action: "state" })).j.state;
const pieces = st3.pieces.filter((p) => p.round_id === r1.id);
console.log("     R1 pieces:", pieces.map((p) => `${p.kind}:${p.trigger}:${p.status}`).join(", "));
ok(pieces.filter((p) => p.trigger === "round-complete").length === 1, "exactly one round-complete bulletin");
ok(pieces.some((p) => p.kind === "report" && p.status === "draft"), "report auto-drafted");
ok(pieces.some((p) => p.trigger === "h3"), "birdie bulletin on 3");
ok(pieces.some((p) => p.trigger === "front-complete"), "front nine bulletin");
ok(!pieces.some((p) => p.body === "(writing…)"), "no stuck placeholders");

const posts = await pub(`posts?round_id=eq.${r1.id}`);
ok(posts.length === 1 && posts[0].tags.join() === "birdie", "public sees 1 post, bad tag stripped");
ok((await pub(`ai_pieces?select=status`)).every((p) => p.status === "published"), "public can't see drafts");
ok(!Array.isArray(await pub(`players?select=id`)), "public can't read players table");
ok(!Array.isArray(await pub(`tournaments?select=organiser_pin_hash`)), "public can't read tournament PIN hashes");
const entries = await pub(`hole_entries?round_id=eq.${r1.id}&order=hole`);
ok(entries.length === 18 && entries.every((e) => e.game === "main"), "18 entries, game 'main'");
ok(entries[1].ctp_winner === null && entries[1].ld_winner === "oisin" && entries[0].ctp_winner === null && entries[0].ld_winner === null, "H2 par 5: CTP stripped, LD kept; H1 par 4: both stripped");
ok((await pub(`rounds?number=eq.1&select=status`))[0].status === "complete", "round auto-completed");

// ======================================================= PART 2: create a Ryder Cup-style event from scratch
console.log("--- New team tournament");
const boss = agent();
ok((await boss("/api/tournaments", { method: "POST", body: { name: "Test Cup", organiserPin: "4321" } })).status === 401, "creating needs the owner PIN");
const created = await boss("/api/tournaments", { method: "POST", body: { name: "Test Cup", organiserPin: "4321", ownerPin: "1234" } });
ok(created.status === 200 && created.j.slug === "test-cup", "tournament created");
const C = created.j.slug;
const cpost = (a, path, body) => a(path, { method: "POST", body: { t: C, ...body } });
ok((await cpost(boss, "/api/admin", { action: "state" })).status === 200, "creator is organiser of the new one");
ok((await post(boss, "/api/admin", { action: "state" })).status === 403, "...but not of the October Special");
ok((await cpost(org, "/api/admin", { action: "state" })).status === 403, "October organiser session doesn't carry over");

ok((await cpost(boss, "/api/admin", { action: "updateTournament", patch: { teams: [{ name: "Europe", color: "#1d4f91" }, { name: "Rest", color: "#c8102e" }], theme: "teamcup", tone: "tabloid", side_games_by: "team", side_games: [{ kind: "ctp", points: 1, enabled: true }, { kind: "birdies", points: 0, enabled: true }] } })).status === 200, "teams, theme, tone, side games");
const ids = {};
for (const [name, hcp, team] of [["Aoife", 4, "europe"], ["Brian", 18, "europe"], ["Ciara", 10, "rest"], ["Dara", 24, "rest"]]) {
  const r = await cpost(boss, "/api/admin", { action: "savePlayer", player: { name, handicap: hcp, team_id: team }, pin: "1111" });
  ids[name] = r.j.id;
}
ok(Object.values(ids).every(Boolean), "4 players added");
const search = await (await fetch(`${BASE}/api/courses?q=wick`)).json();
ok(search.hits.some((h) => h.ref === "local:wicklow"), "course search finds Wicklow");
const add = await cpost(boss, "/api/admin", { action: "saveRound", round: { courseRef: "local:macreddin", tee: "White" } });
ok(add.status === 200, "round added from course search");
const A = ids.Aoife, B = ids.Brian, Cc = ids.Ciara, D = ids.Dara;
const games = [{ id: "m1", name: "Fourball 1", sides: [{ id: "eur", playerIds: [A, B], teamId: "europe" }, { id: "rest", playerIds: [Cc, D], teamId: "rest" }], scorerId: A }];
ok((await cpost(boss, "/api/admin", { action: "saveRound", round: { id: add.j.id, play: "fourball", format: "match", points_rule: { front: 0, back: 0, full: 1 }, handicap_rule: { mode: "allowance", pct: 90, relative: true }, games } })).status === 200, "fourball match play, 90% off the low, 1 pt");
ok((await cpost(boss, "/api/admin", { action: "saveRound", round: { id: add.j.id, games: [{ id: "x", sides: [{ playerIds: [A] }] }] } })).status === 400, "match with one side rejected");

const aoife = agent();
ok((await cpost(aoife, "/api/login", { mode: "player", playerId: A, pin: "1111" })).status === 200, "Aoife logs in");
const mac = [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 4, 4, 5, 3, 5, 4, 3, 4];
for (let h = 1; h <= 18; h++) {
  const p = mac[h - 1];
  const r = await cpost(aoife, "/api/score", { roundId: add.j.id, game: "m1", hole: h, scores: { [A]: { gross: p }, [B]: { gross: p + 2 }, [Cc]: { gross: p + 1 }, [D]: { gross: p + 2 } }, ctpWinner: p === 3 ? Cc : null });
  if (r.status !== 200) ok(false, `team hole ${h}: ${JSON.stringify(r.j)}`);
}
ok(true, "Aoife scored 18 holes of the fourball");
const dara = agent();
await cpost(dara, "/api/login", { mode: "player", playerId: D, pin: "1111" });
ok((await cpost(dara, "/api/score", { roundId: add.j.id, game: "m1", hole: 1, scores: {} })).status === 403, "non-scorer player can't score");
const tEntries = await pub(`hole_entries?round_id=eq.${add.j.id}&game=eq.m1`);
ok(tEntries.length === 18, "18 entries stored under match m1");
ok((await cpost(boss, "/api/admin", { action: "updateTournament", patch: { published: true } })).status === 200, "published");
ok((await fetch(`${BASE}/api/tournaments`)).status === 405, "there's no public list of tournaments to browse");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
