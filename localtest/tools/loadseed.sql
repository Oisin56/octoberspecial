-- The console's size test: 10,000 made-up tournaments and 100,000 made-up people (run on the local test database only).
\timing on
insert into tournaments (slug, name, created_at, privacy)
select 'load-' || g, 'Load Trip ' || g, now() - (g % 400) * interval '1 day', case when g % 5 = 0 then 'private' else 'friends' end
from generate_series(1, 10000) g;

insert into rounds (tournament_id, number, course_slug, course_name, format, holes, status, play_date)
select t.id, r, 'local:load', 'Load Links', 'stableford', '[]'::jsonb,
       case when g % 97 = 0 and r = 1 then 'live' else 'upcoming' end,
       (current_date + ((g % 120) - 60 + r)::int)
from (select id, row_number() over (order by slug) g from tournaments where slug like 'load-%') t, generate_series(1, 2) r;

-- Ten players each, every one with an email: 100,000 people
insert into players (id, tournament_id, name, email, sort)
select 'p' || t.g || '-' || p, t.id, 'Player ' || t.g || '-' || p, 'player' || t.g || '-' || p || '@load.test', p
from (select id, row_number() over (order by slug) g from tournaments where slug like 'load-%') t, generate_series(1, 10) p;

insert into fans (tournament_id, name, email, how_known, status, verified_at, created_at, marketing_at, marketing_wording)
select t.id, 'Fan ' || t.g || '-' || f, 'fan' || t.g || '-' || f || '@load.test', 'A friend', 'approved', now(), now() - (t.g % 90) * interval '1 day',
       case when f = 1 then now() - (t.g % 90) * interval '1 day' end, case when f = 1 then 'Yes, send me news' end
from (select id, row_number() over (order by slug) g from tournaments where slug like 'load-%') t, generate_series(1, 5) f;

insert into posts (tournament_id, author_name, kind, body, created_at)
select t.id, 'Player', case when p % 4 = 0 then 'video' else 'note' end, 'Load post ' || p, now() - (p % 30) * interval '1 hour'
from (select id from tournaments where slug like 'load-%') t, generate_series(1, 20) p;

insert into comments (tournament_id, author_name, body)
select t.id, 'Fan', 'Load comment ' || c from (select id from tournaments where slug like 'load-%') t, generate_series(1, 10) c;

insert into usage (service, what, tournament_id, ok, cents, at)
select (array['writing','voices','films','courses','email'])[1 + (g % 5)], 'load', t.id, g % 50 <> 0, (g % 7) * 0.9, now() - (g % 300) * interval '1 day'
from (select id from tournaments where slug like 'load-%') t, generate_series(1, 20) g;

insert into activity (actor, actor_role, action, tournament_id, tournament_name, at)
select 'owner@test.ie', 'owner', 'tournament.open', t.id, t.name, now() - interval '1 hour' from tournaments t where slug like 'load-%' limit 50000;

insert into queue (kind, subject, title, created_at)
select 'film', 'load-film-' || g, 'A film failed', now() - g * interval '1 minute' from generate_series(1, 300) g;

analyze;
select refresh_tournament_stats();
