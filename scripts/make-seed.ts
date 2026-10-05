/**
 * Generates supabase/seed.sql from src/data/courses.ts.
 * Run: npx tsx scripts/make-seed.ts
 */
import { writeFileSync } from "node:fs";
import { COURSES } from "../src/data/courses";

const TOURNAMENT_SLUG = "october-special-2026";

const ROUNDS: { n: number; slug: string; format: string; full: number; tee: string }[] = [
  { n: 1, slug: "druids-heath", format: "stableford", full: 20, tee: "White" },
  { n: 2, slug: "wicklow", format: "stableford", full: 20, tee: "Blue" },
  { n: 3, slug: "macreddin", format: "stroke", full: 20, tee: "White" },
  { n: 4, slug: "rathsallagh", format: "stableford", full: 20, tee: "White" },
  { n: 5, slug: "concra-wood", format: "match", full: 30, tee: "Black" },
  { n: 6, slug: "slieve-russell", format: "match", full: 30, tee: "White" },
  { n: 7, slug: "farnham-estate", format: "stroke", full: 40, tee: "White" },
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

let sql = `-- October Special 2026 — starting data
-- Paste into Supabase → SQL Editor AFTER schema.sql and run once.

insert into tournaments (slug, name, subtitle, organiser_player_id, start_date, theme, tone)
values (${q(TOURNAMENT_SLUG)}, 'The October Special', 'Seven rounds. Two men. 360 points.', 'oisin', '2026-10-08', 'clubhouse', 'broadsheet')
on conflict (slug) do nothing;

insert into players (id, tournament_id, name, sort)
select p.id, t.id, p.name, p.sort
from tournaments t,
  (values ('oisin', 'Oisin', 1), ('neil', 'Neil', 2)) as p(id, name, sort)
where t.slug = ${q(TOURNAMENT_SLUG)}
on conflict (id) do nothing;
`;

for (const r of ROUNDS) {
  const c = COURSES.find((x) => x.slug === r.slug)!;
  const yards = c.tees[r.tee] ?? Object.values(c.tees)[0];
  const holes = c.par.map((par, i) => ({ number: i + 1, par, si: c.si[i], yards: yards[i] }));
  sql += `
insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, ${r.n}, ${q('local:' + c.slug)}, ${q(c.name)}, ${q(c.location)}, ${q(c.blurb)}, ${c.lat}, ${c.lon}, ${q(r.tee)}, ${q(r.format)}, ${r.full},
  '{"oisin":0,"neil":0}'::jsonb, ${q(JSON.stringify(holes))}::jsonb, 'oisin'
from tournaments t where t.slug = ${q(TOURNAMENT_SLUG)}
on conflict (tournament_id, number) do nothing;
`;
}

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), sql);
console.log("wrote supabase/seed.sql");
