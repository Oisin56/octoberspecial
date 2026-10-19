// Render the film graphics for both shapes and lay them over a frame: checks nothing covers anything else.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
const secret = fs.readFileSync("/home/claude/october-special/.env.local", "utf8").match(/^SESSION_SECRET=(.*)$/m)[1].trim();
const sign = (d) => createHmac("sha256", secret).update(`card:${d}`).digest("base64url").slice(0, 24);
const url = (spec) => {
  const d = Buffer.from(JSON.stringify({ ...spec, v: 5 })).toString("base64url");
  return `http://127.0.0.1:3100/api/director/card?d=${d}&sig=${sign(d)}`;
};
const field = { round: 2, course: "Macreddin", hole: 14, par: 4, yards: 402, mode: "field", scoring: "stroke", thru: 13, rows: [
  { pos: "1", name: "Ciara", value: "−3", thru: 13, onCamera: false, lead: true, dots: 0 },
  { pos: "T2", name: "Aoife", value: "−2", thru: 14, onCamera: false, lead: false, dots: 0 },
  { pos: "T2", name: "Brian", value: "−2", thru: 13, onCamera: false, lead: false, dots: 0 },
  { pos: "4", name: "Dara", value: "−1", thru: 12, onCamera: false, lead: false, dots: 0 },
  { pos: "5", name: "Fionn", value: "E", thru: 13, onCamera: false, lead: false, dots: 0 },
  { pos: "9", name: "Oisin", value: "+4", thru: 13, onCamera: true, lead: false, gap: true, dots: 1 },
], flash: "BIRDIE" };
const match = { round: 5, course: "Concra Wood", hole: 12, par: 3, yards: 168, mode: "match", scoring: "match", thru: 11, rows: [], match: { sides: [ { name: "Oisin", color: null, lead: true, dots: 0 }, { name: "Neil", color: null, lead: false, dots: 1 } ], big: "2 UP", small: "thru 11" }, status: "DORMIE" };
const base = { theme: "clubhouse" };
const shapes = { land: [1920, 1080, "/var/tmp/ospg/social/clip1.mp4"], port: [1080, 1920, "/var/tmp/ospg/social/clip2.mp4"] };
for (const [name, [w, ht, vid]] of Object.entries(shapes)) {
  execSync(`ffmpeg -v error -y -ss 2 -i ${vid} -frames:v 1 -vf "scale=${w}:${ht}:force_original_aspect_ratio=increase,crop=${w}:${ht}" /var/tmp/ospg/gfx/${name}-bg.png`);
  const get = async (spec, f) => fs.writeFileSync(`/var/tmp/ospg/gfx/${name}-${f}.png`, Buffer.from(await (await fetch(url({ ...base, ...spec, w, ht }))).arrayBuffer()));
  await get({ k: "bug", h: "", b: field }, "field");
  await get({ k: "bug", h: "", b: match }, "match");
  await get({ k: "strap", h: "Oisin", e: "14", s: "Par 4 · 402 yds" }, "strap");
  await get({ k: "caption", h: "Out of the trap and two feet from the pin", s: "Sand wedge" }, "caption");
  await get({ k: "replay", h: "REPLAY" }, "replay");
  const g = (f) => `/var/tmp/ospg/gfx/${name}-${f}.png`;
  execSync(`convert ${g("bg")} ${g("field")} -composite ${g("strap")} -composite ${g("replay")} -composite -resize 50% /var/tmp/ospg/shots/gfx-${name}-field.png`);
  execSync(`convert ${g("bg")} ${g("match")} -composite ${g("caption")} -composite ${g("replay")} -composite -resize 50% /var/tmp/ospg/shots/gfx-${name}-match.png`);
}
console.log("done");
