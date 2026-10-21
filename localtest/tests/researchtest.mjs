import { execSync } from "node:child_process";
// Course research in the background: started when a course is picked, carried on by itself, kept in the library
const BASE = "http://127.0.0.1:3100";
const q = (sql) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -qtAc "${sql.replace(/"/g, '\\"')}"`).toString().trim();
let fails = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || fails++);
const post = async (body) => (await fetch(`${BASE}/api/research`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const wait = async (ref) => {
  for (let i = 0; i < 60; i++) {
    if (q(`select status from course_library where ref='${ref}'`) !== "researching") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
};
const BIRR = "golfapi:012141520611:Ireland";
q(`delete from course_library where ref='${BIRR}' or ref like 'manual:nowhere%'`);

const s = await post({ action: "start", ref: BIRR });
ok(s.ok && s.ref === BIRR, "starts for a course from the search");
await wait(BIRR);
ok(q(`select status from course_library where ref='${BIRR}'`) === "done", "finishes by itself");
const holes = Number(q(`select count(*) from course_library, jsonb_object_keys(guide->'holes') where ref='${BIRR}'`));
ok(holes === 18, `every hole has a note (${holes}): the club's hole pages, then a review for the one missing`);
ok(q(`select guide->>'history' from course_library where ref='${BIRR}'`).startsWith("Founded"), "the club's history page is read");
const log = q(`select work->>'log' from course_library where ref='${BIRR}'`);
ok(/didn't match the card/.test(log), "a page about a different course is left out");
ok(Number(q(`select count(*) from rounds where course_slug='${BIRR}' and course_guide is null`)) === 0, "rounds at the course get the guide");

// Picked again: nothing more to do
await post({ action: "start", ref: BIRR });
ok(q(`select status from course_library where ref='${BIRR}'`) === "done", "a course already researched isn't searched again");

// A typed-in card nothing can be found for
const card = Array.from({ length: 18 }, (_, i) => ({ par: [4, 4, 3, 5][i % 4] }));
const n = await post({ action: "start", manual: { name: "Nowhere Golf Club", card } });
await wait(n.ref);
ok(n.ref === "manual:nowhere-golf-club" && q(`select status from course_library where ref='${n.ref}'`) === "none", "nothing found: marked so, briefly");
const st = await post({ action: "status", ref: n.ref });
ok(st.status === "none" && st.found === false, "status says nothing was found");

process.exit(fails ? 1 : 0);
