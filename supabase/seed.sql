-- October Special 2026 — starting data
-- Paste into Supabase → SQL Editor AFTER schema.sql and run once.

insert into tournaments (slug, name, subtitle, organiser_player_id, start_date, theme, tone)
values ('october-special-2026', 'The October Special', 'Seven rounds. Two men. 360 points.', 'oisin', '2026-10-08', 'clubhouse', 'broadsheet')
on conflict (slug) do nothing;

insert into players (id, tournament_id, name, sort)
select p.id, t.id, p.name, p.sort
from tournaments t,
  (values ('oisin', 'Oisin', 1), ('neil', 'Neil', 2)) as p(id, name, sort)
where t.slug = 'october-special-2026'
on conflict (id) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 1, 'local:druids-heath', 'Druids Heath', 'Newtownmountkennedy, Co. Wicklow', 'Druids Glen''s younger, wilder sibling: heathland and links-style holes on open ground above the Irish Sea, with views to Wicklow Head.', 53.075, -6.085, 'White', 'stableford', 20,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":5,"si":9,"yards":516},{"number":2,"par":4,"si":7,"yards":328},{"number":3,"par":5,"si":11,"yards":487},{"number":4,"par":4,"si":17,"yards":291},{"number":5,"par":4,"si":15,"yards":314},{"number":6,"par":4,"si":3,"yards":424},{"number":7,"par":3,"si":13,"yards":183},{"number":8,"par":5,"si":5,"yards":541},{"number":9,"par":4,"si":1,"yards":415},{"number":10,"par":4,"si":14,"yards":289},{"number":11,"par":3,"si":16,"yards":151},{"number":12,"par":4,"si":2,"yards":410},{"number":13,"par":5,"si":6,"yards":505},{"number":14,"par":3,"si":18,"yards":114},{"number":15,"par":4,"si":8,"yards":359},{"number":16,"par":3,"si":10,"yards":222},{"number":17,"par":4,"si":4,"yards":415},{"number":18,"par":4,"si":12,"yards":338}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 2, 'local:wicklow', 'Wicklow Golf Club', 'Wicklow Town, Co. Wicklow', 'A clifftop course above Wicklow town. Short on the card at par 71, but the wind off the sea does the defending.', 52.974, -6.031, 'Blue', 'stableford', 20,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":5,"si":8,"yards":522},{"number":2,"par":4,"si":1,"yards":401},{"number":3,"par":4,"si":18,"yards":264},{"number":4,"par":4,"si":12,"yards":302},{"number":5,"par":4,"si":16,"yards":301},{"number":6,"par":4,"si":4,"yards":406},{"number":7,"par":3,"si":10,"yards":137},{"number":8,"par":4,"si":6,"yards":396},{"number":9,"par":3,"si":15,"yards":144},{"number":10,"par":4,"si":2,"yards":363},{"number":11,"par":3,"si":17,"yards":170},{"number":12,"par":4,"si":7,"yards":397},{"number":13,"par":4,"si":5,"yards":348},{"number":14,"par":5,"si":3,"yards":545},{"number":15,"par":4,"si":9,"yards":356},{"number":16,"par":5,"si":13,"yards":474},{"number":17,"par":3,"si":11,"yards":161},{"number":18,"par":4,"si":14,"yards":348}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 3, 'local:macreddin', 'Macreddin', 'Macreddin Village, Co. Wicklow', 'A Paddy Merrigan design in a secluded valley in the Wicklow hills, over 7,000 yards from the back. Water and elevation everywhere.', 52.898, -6.348, 'White', 'stroke', 20,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":4,"si":6,"yards":363},{"number":2,"par":5,"si":8,"yards":513},{"number":3,"par":4,"si":10,"yards":396},{"number":4,"par":3,"si":16,"yards":173},{"number":5,"par":4,"si":4,"yards":402},{"number":6,"par":4,"si":18,"yards":299},{"number":7,"par":3,"si":14,"yards":177},{"number":8,"par":5,"si":12,"yards":564},{"number":9,"par":4,"si":2,"yards":412},{"number":10,"par":4,"si":13,"yards":302},{"number":11,"par":4,"si":17,"yards":292},{"number":12,"par":4,"si":1,"yards":398},{"number":13,"par":5,"si":11,"yards":499},{"number":14,"par":3,"si":15,"yards":162},{"number":15,"par":5,"si":5,"yards":514},{"number":16,"par":4,"si":3,"yards":451},{"number":17,"par":3,"si":9,"yards":165},{"number":18,"par":4,"si":7,"yards":411}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 4, 'local:rathsallagh', 'Rathsallagh', 'Dunlavin, Co. Wicklow', 'Parkland on a historic estate on the Wicklow–Kildare border, designed by Peter McEvoy and Christy O''Connor Jnr. Mature trees, water and fast greens.', 53.035, -6.689, 'White', 'stableford', 20,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":5,"si":13,"yards":506},{"number":2,"par":4,"si":2,"yards":436},{"number":3,"par":4,"si":15,"yards":367},{"number":4,"par":3,"si":11,"yards":158},{"number":5,"par":4,"si":9,"yards":373},{"number":6,"par":5,"si":6,"yards":490},{"number":7,"par":3,"si":17,"yards":177},{"number":8,"par":4,"si":4,"yards":351},{"number":9,"par":4,"si":7,"yards":370},{"number":10,"par":4,"si":1,"yards":438},{"number":11,"par":5,"si":10,"yards":510},{"number":12,"par":4,"si":12,"yards":355},{"number":13,"par":3,"si":18,"yards":134},{"number":14,"par":4,"si":14,"yards":332},{"number":15,"par":4,"si":8,"yards":374},{"number":16,"par":5,"si":5,"yards":516},{"number":17,"par":3,"si":16,"yards":170},{"number":18,"par":4,"si":3,"yards":426}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 5, 'local:concra-wood', 'Concra Wood', 'Castleblayney, Co. Monaghan', 'A Christy O''Connor Jnr design wrapped around Lough Muckno. Big drumlin country, lakeside holes and one of the best newer courses in Ulster.', 54.105, -6.74, 'Black', 'match', 30,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":5,"si":13,"yards":500},{"number":2,"par":4,"si":3,"yards":400},{"number":3,"par":4,"si":17,"yards":352},{"number":4,"par":5,"si":5,"yards":543},{"number":5,"par":4,"si":1,"yards":410},{"number":6,"par":3,"si":15,"yards":177},{"number":7,"par":4,"si":11,"yards":380},{"number":8,"par":4,"si":7,"yards":370},{"number":9,"par":3,"si":9,"yards":178},{"number":10,"par":4,"si":6,"yards":433},{"number":11,"par":4,"si":4,"yards":367},{"number":12,"par":3,"si":16,"yards":187},{"number":13,"par":5,"si":12,"yards":497},{"number":14,"par":3,"si":18,"yards":161},{"number":15,"par":5,"si":14,"yards":470},{"number":16,"par":4,"si":2,"yards":427},{"number":17,"par":4,"si":8,"yards":410},{"number":18,"par":4,"si":10,"yards":373}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 6, 'local:slieve-russell', 'Slieve Russell', 'Ballyconnell, Co. Cavan', 'A big parkland championship course in the Cavan lakelands, with lakes and water in play and a stern run of par 4s.', 54.112, -7.592, 'White', 'match', 30,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":4,"si":10,"yards":397},{"number":2,"par":4,"si":1,"yards":403},{"number":3,"par":4,"si":6,"yards":371},{"number":4,"par":3,"si":16,"yards":151},{"number":5,"par":4,"si":3,"yards":410},{"number":6,"par":5,"si":18,"yards":485},{"number":7,"par":3,"si":8,"yards":200},{"number":8,"par":4,"si":14,"yards":329},{"number":9,"par":5,"si":12,"yards":509},{"number":10,"par":4,"si":2,"yards":393},{"number":11,"par":3,"si":11,"yards":173},{"number":12,"par":4,"si":4,"yards":415},{"number":13,"par":5,"si":9,"yards":494},{"number":14,"par":4,"si":17,"yards":346},{"number":15,"par":4,"si":5,"yards":410},{"number":16,"par":3,"si":7,"yards":156},{"number":17,"par":4,"si":15,"yards":376},{"number":18,"par":5,"si":13,"yards":512}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;

insert into rounds (tournament_id, number, course_slug, course_name, course_location, course_blurb, lat, lon, tee, format, full_points, shots, holes, scorer_id)
select t.id, 7, 'local:farnham-estate', 'Farnham Estate', 'Cavan Town, Co. Cavan', 'A Jeff Howes design through 1,300 acres of ancient woodland and lakes on the Farnham Estate. A fitting place for the 40-point finale.', 54, -7.405, 'White', 'stroke', 40,
  '{"oisin":0,"neil":0}'::jsonb, '[{"number":1,"par":4,"si":15,"yards":347},{"number":2,"par":4,"si":11,"yards":356},{"number":3,"par":4,"si":5,"yards":337},{"number":4,"par":4,"si":1,"yards":399},{"number":5,"par":3,"si":7,"yards":162},{"number":6,"par":5,"si":17,"yards":509},{"number":7,"par":4,"si":9,"yards":358},{"number":8,"par":3,"si":3,"yards":182},{"number":9,"par":5,"si":13,"yards":433},{"number":10,"par":4,"si":16,"yards":318},{"number":11,"par":4,"si":12,"yards":402},{"number":12,"par":3,"si":6,"yards":171},{"number":13,"par":4,"si":2,"yards":380},{"number":14,"par":4,"si":8,"yards":261},{"number":15,"par":5,"si":18,"yards":514},{"number":16,"par":3,"si":10,"yards":153},{"number":17,"par":4,"si":4,"yards":367},{"number":18,"par":5,"si":14,"yards":452}]'::jsonb, 'oisin'
from tournaments t where t.slug = 'october-special-2026'
on conflict (tournament_id, number) do nothing;
