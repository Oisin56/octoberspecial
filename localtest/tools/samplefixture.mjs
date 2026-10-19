// Builds the sample round's starting data from a real tournament made by the wizard (so every field is genuine).
// Writes src/lib/sampleRound.json. Run with the app and stub up.
import { execSync } from "node:child_process";
import fs from "node:fs";
const BASE = "http://127.0.0.1:3100";
const env = fs.readFileSync("/home/claude/october-special/.env.local", "utf8");
const OWNER = env.match(/^ORGANISER_PIN=(.*)$/m)[1].trim();
const sql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
sql(`delete from tournaments where slug like 'sample-round%'`);
const wizard = {
  who: "individuals", name: "Sample round", subtitle: "Three holes. Nothing is saved.",
  rounds: [{ courseRef: "golfapi:012141520611:Ireland", courseName: "Birr", holeSet: "front", tee: "White", format: "stableford", date: "2026-10-16", time: "09:30" }],
  players: [{ name: "You", index: 14 }, { name: "Declan", index: 12.4 }, { name: "Marcus", index: 8.1 }],
  organiserPlays: true, draw: "myself", extras: { feed: true, ai: true, video: true }, theme: "clubhouse", units: "yards", share: "portrait",
};
const made = await fetch(`${BASE}/api/tournaments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wizard, pin: "1357", ownerPin: OWNER }) }).then((r) => r.json());
if (!made.slug) throw new Error(JSON.stringify(made));
const slug = made.slug;
const tid = sql(`select id from tournaments where slug='${slug}'`);
sql(`update tournaments set published=true where id='${tid}'; update rounds set status='live' where tournament_id='${tid}'`);
const rest = async (q) => (await fetch(`http://127.0.0.1:54321/rest/v1/${q}`, { headers: { apikey: process.env.ANON, authorization: `Bearer ${process.env.ANON}` } })).json();
const tournament = (await rest(`public_tournaments?slug=eq.${slug}&select=*`))[0];
const players = await rest(`public_players?tournament_id=eq.${tid}&select=*&order=sort`);
const rounds = await rest(`rounds?tournament_id=eq.${tid}&select=*&order=number`);
// the greens, as the GPS tab loads them
const login = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: slug, mode: "organiser", pin: "1357" }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const geo = (await (await fetch(`${BASE}/api/gps?t=${slug}&round=${rounds[0].id}`, { headers: { cookie } })).json()).geo;
const out = { tournament, players, rounds, geo };
fs.writeFileSync("/home/claude/october-special/src/lib/sampleRound.json", JSON.stringify(out, null, 1));
console.log("players", players.map((p) => `${p.id}:${p.name}`).join(", "));
console.log("round", rounds[0].hole_set, rounds[0].holes.length, JSON.stringify(rounds[0].games));
console.log("geo holes", geo ? Object.keys(geo).join(",") : "none");
sql(`delete from tournaments where id='${tid}'`);
