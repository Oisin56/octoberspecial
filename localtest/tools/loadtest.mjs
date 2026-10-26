// Times the console's pages at size (after loadseed.sql): each view must answer in under a second.
import { agent, codeOf, lastMailTo, signInWithEmail, BASE } from "../tests/signin-helpers.mjs";
const owner = agent();
await signInWithEmail(owner, "owner@test.ie");
await owner("/api/owner", { action: "sendCode" });
await owner("/api/owner", { action: "code", code: codeOf(await lastMailTo("owner@test.ie")) });
const t = (await owner("/api/console?view=tournaments&q=Load%20Trip%20777")).j.rows[0];
const views = [
  ["overview", "view=overview"],
  ["needs", "view=needs"],
  ["tournaments", "view=tournaments"],
  ["tournaments, sorted by cost", "view=tournaments&sort=cost_cents"],
  ["tournaments, searched", "view=tournaments&q=trip%2099"],
  ["tournaments, live", "view=tournaments&status=live"],
  ["a tournament", `view=tournament&id=${t.id}`],
  ["people", "view=people"],
  ["people, searched", "view=people&q=fan12"],
  ["people, marketing", "view=people&marketing=yes"],
  ["people, page 500", "view=people&page=500"],
  ["a person", "view=person&email=player777-3%40load.test"],
  ["money", "view=money"],
  ["health", "view=health"],
  ["activity", "view=activity"],
  ["search box", "view=search&q=load%20trip%2042"],
];
let slow = 0;
for (const [name, q] of views) {
  await owner(`/api/console?${q}`); // warm
  const ms = [];
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    const r = await owner(`/api/console?${q}`);
    ms.push(performance.now() - s);
    if (r.status !== 200) console.log("  !", name, r.status, r.j.error);
  }
  const med = ms.sort((a, b) => a - b)[1];
  if (med > 1000) slow++;
  console.log(`${med > 1000 ? "SLOW" : "ok  "}  ${String(Math.round(med)).padStart(5)} ms  ${name}`);
}
const s = performance.now();
const ex = await fetch(`${BASE}/api/console/export?what=tournaments`, { headers: { cookie: owner.cookie() } });
console.log(`export of all tournaments: ${ex.status} in ${Math.round(performance.now() - s)} ms`);
console.log(slow ? `${slow} SLOW` : "ALL UNDER A SECOND");
