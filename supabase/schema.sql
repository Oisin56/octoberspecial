-- Golf tournament site — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it only creates or upgrades what's missing.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ tables

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  subtitle text,
  created_at timestamptz not null default now()
);
alter table tournaments add column if not exists start_date date;
alter table tournaments add column if not exists end_date date;
alter table tournaments add column if not exists theme text not null default 'spring';
-- Four themes now: Clubhouse is retired, its tournaments move to Spring Classic
alter table tournaments alter column theme set default 'spring';
update tournaments set theme = 'spring' where theme = 'clubhouse';
alter table tournaments add column if not exists custom_colors jsonb;
alter table tournaments add column if not exists logo_path text;
alter table tournaments add column if not exists hero_path text;
alter table tournaments add column if not exists tone text not null default 'broadsheet';
alter table tournaments add column if not exists side_games jsonb not null default
  '[{"kind":"ctp","points":10,"enabled":true},{"kind":"ld","points":10,"enabled":true},{"kind":"gir","points":20,"enabled":true},{"kind":"birdies","points":0,"enabled":true},{"kind":"eagles","points":0,"enabled":true}]'::jsonb;
alter table tournaments add column if not exists side_games_by text not null default 'player';
alter table tournaments add column if not exists teams jsonb not null default '[]'::jsonb;
alter table tournaments add column if not exists auto_bulletins boolean not null default true;
alter table tournaments add column if not exists video_enabled boolean not null default true;
alter table tournaments add column if not exists organiser_pin_hash text;
alter table tournaments add column if not exists organiser_player_id text;
alter table tournaments add column if not exists contributor_pin_hash text;
alter table tournaments add column if not exists published boolean not null default true;
alter table tournaments add column if not exists reel_music_path text;
-- Cards must be signed by every player in the match before they're final (organiser can change any time)
alter table tournaments add column if not exists require_attestation boolean not null default false;
-- Broadcast clips: each clip turned into a TV-style video; on/off and a monthly limit on the cost (cents)
alter table tournaments add column if not exists broadcast_on boolean not null default true;
alter table tournaments add column if not exists broadcast_cap_cents int not null default 1000;

create table if not exists players (
  id text primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  nickname text,
  handicap numeric,
  home_club text,
  bio text,
  best_club text,
  worst_club text,
  weakness text,
  quote text,
  photo_path text,
  pin_hash text,
  sort int not null default 0
);
alter table players add column if not exists team_id text;

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number int not null,
  course_slug text not null,
  course_name text not null,
  play_date date,
  tee_time text,
  tee text,
  format text not null,                       -- scoring: stableford | stroke | match | skins
  nine_points int not null default 10,        -- legacy (October Special); points_rule wins if set
  full_points int not null default 20,
  shots jsonb not null default '{}'::jsonb,   -- legacy manual shots
  holes jsonb not null,                       -- [{number,par,si,yards}]
  scorer_id text,
  status text not null default 'upcoming',
  unique (tournament_id, number)
);
alter table rounds drop constraint if exists rounds_format_check;
alter table rounds add constraint rounds_format_check check (format in ('stableford','stroke','match','skins'));
alter table rounds drop constraint if exists rounds_status_check;
alter table rounds add constraint rounds_status_check check (status in ('upcoming','live','complete'));
alter table rounds drop constraint if exists rounds_scorer_id_fkey;
alter table rounds add column if not exists play text not null default 'singles';
alter table rounds add column if not exists games jsonb;            -- [{id,name,sides:[{id,name,playerIds,teamId}],scorerId}]
alter table rounds add column if not exists points_rule jsonb;      -- {front,back,full,positions,skin}
alter table rounds add column if not exists handicap_rule jsonb;    -- {mode:'manual',shots} | {mode:'allowance',pct,relative}
alter table rounds add column if not exists course_location text;
alter table rounds add column if not exists course_guide jsonb;
alter table rounds add column if not exists photo_path text;   -- organiser's own course photo     -- {overview, signature, holes:{"1":note}} for the AI writer
alter table rounds add column if not exists course_blurb text;
alter table rounds add column if not exists lat double precision;
alter table rounds add column if not exists lon double precision;
-- Which holes of the card are played: the whole card, or the front or back nine of an 18
alter table rounds add column if not exists hole_set text not null default 'all';
alter table rounds drop constraint if exists rounds_hole_set_check;
alter table rounds add constraint rounds_hole_set_check check (hole_set in ('all','front','back'));

create table if not exists hole_entries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  scores jsonb not null default '{}'::jsonb,
  ctp_winner text,
  ld_winner text,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table hole_entries add column if not exists game text not null default 'main';
-- Match play: the side that conceded the hole (the other side wins it)
alter table hole_entries add column if not exists conceded text;
alter table hole_entries drop constraint if exists hole_entries_round_id_hole_key;
do $$ begin
  alter table hole_entries add constraint hole_entries_round_game_hole_key unique (round_id, game, hole);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists attestations (
  round_id uuid not null references rounds(id) on delete cascade,
  segment text not null check (segment in ('front','back')),
  player_id text not null references players(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (round_id, segment, player_id)
);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  hole int,
  author_name text not null,
  author_player_id text,
  kind text not null check (kind in ('note','photo','video')),
  body text,
  tags text[] not null default '{}',
  media_path text,
  visibility text not null default 'public' check (visibility in ('public','report')),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table posts add column if not exists player_ids text[] not null default '{}';   -- who played the shot in a clip
alter table posts add column if not exists clip_start numeric;                       -- where the cut came from in the original recording
alter table posts add column if not exists clip_end numeric;
alter table posts add column if not exists trim_in numeric;                          -- play only this part of the uploaded clip (trimmed on the phone, no cutting)
alter table posts add column if not exists trim_out numeric;
alter table posts add column if not exists details jsonb;                            -- what's in the clip: {shot, result, club}

-- Shots logged on the course: who, which hole, what kind of shot and how it finished (one row per shot)
create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  player_id text not null,
  kind text not null,          -- tee | second | approach | chip | bunker | putt | recovery
  outcome text not null,
  club text,                   -- Driver | Wood/Hybrid | Long iron | Mid iron | Short iron | Wedge | Putter
  distance text,               -- approaches: Under 100 | 100–150 | 150–200 | 200+
  author_name text not null,
  client_id text not null unique,  -- made on the phone, so a save sent twice (no signal, retry) is one shot
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists shots_round_idx on shots (round_id, hole);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) <= 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- Fans: followers who signed up (their own name and email, 16+, agreed) to comment and post text
create table if not exists fans (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  email text not null,
  token text,                       -- the sign-in link, until used
  token_expires timestamptz,
  verified_at timestamptz,
  consent_at timestamptz not null default now(),
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists fans_email_uniq on fans (tournament_id, lower(email));
alter table fans enable row level security;  -- server only

alter table posts add column if not exists fan_id uuid references fans(id) on delete set null;
alter table comments add column if not exists post_id uuid references posts(id) on delete cascade;
alter table comments add column if not exists fan_id uuid references fans(id) on delete set null;
alter table comments add column if not exists author_player_id text;

-- Likes: one per post per phone (or fan); counted in the feed
create table if not exists likes (
  post_id uuid not null references posts(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  liker text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, liker)
);

-- Reports: three from different people hide a post or comment until the organiser looks
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  comment_id uuid references comments(id) on delete cascade,
  reporter text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists reports_once on reports (coalesce(post_id, comment_id), reporter);
alter table posts add column if not exists hidden_by_reports boolean not null default false;
alter table posts add column if not exists broadcast_status text;
alter table posts add column if not exists broadcast_path text;
alter table posts add column if not exists broadcast_render text;
alter table posts add column if not exists broadcast_at timestamptz;
alter table posts add column if not exists broadcast_seconds numeric;
alter table comments add column if not exists hidden_by_reports boolean not null default false;

create table if not exists ai_pieces (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete cascade,
  kind text not null check (kind in ('preview','bulletin','report','tournament')),
  title text,
  body text not null,
  trigger text,
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  award text not null,
  post_id uuid not null references posts(id) on delete cascade,
  voter text not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, award, voter)
);

create index if not exists posts_t_idx on posts (tournament_id, created_at desc);
create index if not exists comments_t_idx on comments (tournament_id, created_at desc);
create index if not exists ai_t_idx on ai_pieces (tournament_id, created_at desc);
create index if not exists hole_entries_round_idx on hole_entries (round_id);

-- Cards: each match's scorer submits the card; it's final once signed (when signing is required)
create table if not exists cards (
  round_id uuid not null references rounds(id) on delete cascade,
  game text not null default 'main',
  status text not null check (status in ('submitted','final')),
  submitted_by text,
  submitted_at timestamptz,
  final_at timestamptz,
  finalised_by text,
  amended boolean not null default false,
  flag_by text,
  flag_note text,
  flag_at timestamptz,
  primary key (round_id, game)
);
create table if not exists card_signatures (
  round_id uuid not null references rounds(id) on delete cascade,
  game text not null default 'main',
  player_id text not null references players(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (round_id, game, player_id)
);
-- Every change to a final card: who, when, before and after (organiser only)
create table if not exists score_changes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  game text not null,
  hole int,
  action text not null,
  before jsonb,
  after jsonb,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists votes_t_idx on votes (tournament_id);
-- One automatic bulletin per moment, even if saves arrive at the same time
create unique index if not exists ai_auto_trigger_uniq on ai_pieces (round_id, kind, trigger)
  where trigger is not null and trigger not like 'manual%';

-- ------------------------------------------------------------ security
-- Followers (no login) can READ public data. All WRITES go through the
-- website's server, which checks PINs first. PIN hashes are never readable.

alter table tournaments enable row level security;
alter table players enable row level security;
alter table rounds enable row level security;
alter table hole_entries enable row level security;
alter table attestations enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table ai_pieces enable row level security;
alter table votes enable row level security;
alter table shots enable row level security;
alter table likes enable row level security;
alter table cards enable row level security;
alter table card_signatures enable row level security;
alter table score_changes enable row level security;
alter table reports enable row level security;

drop policy if exists read_all on rounds;
create policy read_all on rounds for select using (true);
drop policy if exists read_all on hole_entries;
create policy read_all on hole_entries for select using (true);
drop policy if exists read_all on attestations;
create policy read_all on attestations for select using (true);
drop policy if exists read_all on cards;
create policy read_all on cards for select using (true);
drop policy if exists read_all on card_signatures;
create policy read_all on card_signatures for select using (true);
drop policy if exists read_all on likes;
create policy read_all on likes for select using (true);
drop policy if exists read_all on shots;
create policy read_all on shots for select using (true);
drop policy if exists read_public on posts;
create policy read_public on posts for select using (not hidden and visibility = 'public');
drop policy if exists read_public on comments;
create policy read_public on comments for select using (not hidden);
drop policy if exists read_published on ai_pieces;
create policy read_published on ai_pieces for select using (status = 'published');
drop policy if exists read_all on votes;
create policy read_all on votes for select using (true);

-- tournaments + players: public reads go through views without the PIN columns
drop policy if exists read_all on tournaments;
revoke select on tournaments from anon, authenticated;
-- Stage 2 (who can watch): the view below shows these
alter table tournaments add column if not exists privacy text not null default 'friends';
alter table tournaments add column if not exists players_need_email boolean not null default false;
drop view if exists public_tournaments cascade;
-- Phase C: how it's won (points, or running Stableford / stroke-play totals), the extras switched on,
-- and what's still being got ready after the setup wizard
alter table tournaments add column if not exists standings text not null default 'points';
alter table tournaments add column if not exists feed_on boolean not null default true;
alter table tournaments add column if not exists ai_on boolean not null default true;
alter table tournaments add column if not exists setup_jobs jsonb;
-- Phase D: distances in yards or metres
alter table tournaments add column if not exists units text not null default 'yards';
-- Phase E: where the tournament's videos are mostly shared (upright for phones, wide for YouTube and TV)
alter table tournaments add column if not exists share_shape text check (share_shape in ('portrait', 'landscape'));
-- Set-up redesign: how the winner is decided (the engine's WinRule) and the prizes alongside it
alter table tournaments add column if not exists win jsonb;
alter table tournaments add column if not exists prizes jsonb;
-- Every tee of the course, and players on different tees from the round's (player id → tee name)
alter table rounds add column if not exists tees jsonb;
alter table rounds add column if not exists player_tees jsonb;
-- A knockout match level after 18 goes on to extra holes: the 19th, 20th… (played as the 1st, 2nd…)
alter table hole_entries drop constraint if exists hole_entries_hole_check;
alter table hole_entries add constraint hole_entries_hole_check check (hole between 1 and 27);
-- Stage 4 (the end of a trip): a round on your own, when it finished, and how long its feed stays open
alter table tournaments add column if not exists solo boolean not null default false;
alter table tournaments add column if not exists finished_at timestamptz;
alter table tournaments add column if not exists feed_until timestamptz;
alter table tournaments add column if not exists film_removed_at timestamptz;   -- its film reached 12 months and was removed
-- On the course: only the named scorer in each group can enter scores (otherwise anyone in the group can)
alter table tournaments add column if not exists one_scorer boolean not null default false;
create view public_tournaments with (security_invoker = false) as
  select id, slug, name, subtitle, start_date, end_date, theme, custom_colors, logo_path, hero_path, tone,
         side_games, side_games_by, teams, auto_bulletins, video_enabled, organiser_player_id, published, created_at, reel_music_path,
         require_attestation, broadcast_on, broadcast_cap_cents, standings, feed_on, ai_on, setup_jobs, units, share_shape, win, prizes,
         privacy, players_need_email, solo, finished_at, feed_until, film_removed_at, one_scorer
  from tournaments
  -- a browser never sees a private tournament here (the site's server sees them all)
  where privacy is distinct from 'private' or current_user not in ('anon', 'authenticated');
grant select on public_tournaments to anon, authenticated;

drop policy if exists read_all on players;
revoke select on players from anon, authenticated;
drop view if exists public_players cascade;
create view public_players with (security_invoker = false) as
  select id, tournament_id, name, nickname, handicap, home_club, bio, best_club,
         worst_club, weakness, quote, photo_path, sort, team_id,
         (pin_hash is not null) as has_pin
  from players
  where current_user not in ('anon', 'authenticated')
     or not exists (select 1 from tournaments t where t.id = players.tournament_id and t.privacy = 'private');
grant select on public_players to anon, authenticated;

-- ------------------------------------------------------------ realtime
do $$
begin
  begin alter publication supabase_realtime add table hole_entries; exception when others then null; end;
  begin alter publication supabase_realtime add table posts; exception when others then null; end;
  begin alter publication supabase_realtime add table comments; exception when others then null; end;
  begin alter publication supabase_realtime add table ai_pieces; exception when others then null; end;
  begin alter publication supabase_realtime add table rounds; exception when others then null; end;
  begin alter publication supabase_realtime add table votes; exception when others then null; end;
  begin alter publication supabase_realtime add table shots; exception when others then null; end;
end $$;

-- ------------------------------------------------------------ storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)  -- 50 MB per file (Supabase free plan max)
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- ------------------------------------------------------------ AI director reels

create table if not exists reels (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  brief jsonb not null default '{}'::jsonb,
  plan jsonb,
  status text not null default 'draft' check (status in ('planning','draft','rendering','done','failed')),
  render_id text,
  error text,
  video_path text,
  post_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reels_t_idx on reels (tournament_id, created_at desc);
alter table reels enable row level security;  -- organiser-only, via the server

-- ------------------------------------------------------------ email subscribers (previews and reports by email)

create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text,
  email text not null,
  token uuid not null default gen_random_uuid() unique,  -- for the unsubscribe link
  added_by text not null default 'self',                -- 'self' | 'organiser'
  ip_hash text,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
create unique index if not exists subscribers_email_uniq on subscribers (tournament_id, lower(email));
alter table subscribers enable row level security;  -- server only: nobody can read the list from the browser
alter table ai_pieces add column if not exists emailed_at timestamptz;
alter table ai_pieces add column if not exists emailed_count int;
alter table ai_pieces add column if not exists tone text;          -- style used, if not the tournament default
alter table ai_pieces add column if not exists prev_title text;    -- previous version, for "Undo"
alter table ai_pieces add column if not exists prev_body text;

-- ------------------------------------------------------------ organiser accounts (email sign-in) and player links
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_email_uniq on accounts (lower(email));
create table if not exists account_tournaments (
  account_id uuid not null references accounts(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, tournament_id)
);
create table if not exists account_tokens (
  token_hash text primary key,       -- the emailed sign-in link (only its hash is kept)
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table accounts enable row level security;            -- server only
alter table account_tournaments enable row level security;
alter table account_tokens enable row level security;
-- Each player's personal sign-in link (the organiser sends it; "New link" replaces it)
alter table players add column if not exists link_code text;
create unique index if not exists players_link_code_uniq on players (link_code) where link_code is not null;

-- Phase D: shots in stroke order, and who logged them (they can change them)
alter table shots add column if not exists seq int;
alter table shots add column if not exists author_player_id text;
-- GPS readings: taken when someone taps GPS at their ball. They're matched to the shot played from there.
create table if not exists gps_readings (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  player_id text not null,
  client_id text not null unique,
  lat double precision not null,
  lon double precision not null,
  accuracy numeric,
  to_front int, to_middle int, to_back int,    -- yards to the green
  from_tee int,                                -- yards from the tee (for the drive)
  source text not null default 'gps',          -- gps | clip
  seq int,                                     -- placed on this stroke by hand (null: placed automatically)
  ignored boolean not null default false,      -- taken off the card by hand
  author_name text,
  taken_at timestamptz not null default now()
);
create index if not exists gps_readings_round_idx on gps_readings (round_id, hole, player_id);
alter table gps_readings enable row level security;
-- Public reads leave out where people were standing
drop view if exists public_gps cascade;
create view public_gps with (security_invoker = false) as
  select id, tournament_id, round_id, hole, player_id, client_id, accuracy, to_front, to_middle, to_back, from_tee, source, seq, ignored, author_name, taken_at
  from gps_readings
  where current_user not in ('anon', 'authenticated')
     or not exists (select 1 from tournaments t where t.id = gps_readings.tournament_id and t.privacy = 'private');

-- Phase E: the end-of-tournament film, made on the server step by step (the phone can be put away)
alter table reels add column if not exists stage text;               -- plan | voices | render | rendering | done
alter table reels add column if not exists stage_at timestamptz;     -- when the current step started (a stuck step is restarted)
alter table reels add column if not exists cost_cents numeric not null default 0;  -- what the film cost (an estimate)
alter table reels add column if not exists done_at timestamptz;
alter table reels add column if not exists renders int not null default 0;  -- films finished from this plan (each counts towards the tournament's allowance)
-- Site-wide settings for the site owner: the brand pack, the music tracks, the film spending limits
create table if not exists site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;               -- server only

-- ------------------------------------------------------------ access (explicit, for projects that don't grant by default)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select on rounds, hole_entries, attestations, posts, comments, ai_pieces, votes, shots, likes, cards, card_signatures to anon, authenticated;
grant select on public_tournaments, public_players, public_gps to anon, authenticated;
revoke all on gps_readings from anon, authenticated;
revoke all on reels from anon, authenticated;
revoke all on site_settings from anon, authenticated;
revoke all on subscribers from anon, authenticated;
revoke all on fans from anon, authenticated;
revoke all on reports from anon, authenticated;
revoke all on score_changes from anon, authenticated;
revoke all on accounts, account_tournaments, account_tokens from anon, authenticated;

-- Phase F: people asking to run their own tournament, while it's invitation-only. Approving one emails them a
-- link that opens the setup wizard; it works for one tournament.
create table if not exists invite_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  about text,
  status text not null default 'new' check (status in ('new', 'approved', 'declined')),
  token_hash text,
  approved_at timestamptz,
  used_at timestamptz,
  tournament_id uuid references tournaments(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table invite_requests enable row level security;               -- server only
revoke all on invite_requests from anon, authenticated;

-- Tell the API about the new tables straight away
notify pgrst, 'reload schema';

-- Course library: a finished hole-by-hole guide is kept for the course and reused by every later tournament
-- there (keyed by the course reference, e.g. 'golfapi:123:Ireland' or 'local:birr'). Server only.
create table if not exists course_library (
  ref text primary key,
  name text not null default '',
  guide jsonb not null,
  written_by text not null default 'research' check (written_by in ('research', 'organiser')),
  sources jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table course_library enable row level security;
revoke all on course_library from anon, authenticated;
grant all on course_library to service_role;
-- Guides already found for earlier tournaments go into the library (the fullest one for each course)
insert into course_library (ref, name, guide)
select distinct on (ref) ref, course_name, course_guide
from (
  select case when position(':' in course_slug) > 0 then course_slug else 'local:' || course_slug end as ref,
         course_name, course_guide,
         (select count(*) from jsonb_object_keys(coalesce(course_guide->'holes', '{}'::jsonb))) as n
  from rounds
  where course_guide is not null and course_slug not like 'manual:%'
) g
order by ref, n desc
on conflict (ref) do nothing;
-- Course research runs in the background as soon as a course is picked: the library row tracks it
alter table course_library alter column guide drop not null;
alter table course_library add column if not exists status text not null default 'done';
alter table course_library drop constraint if exists course_library_status_check;
alter table course_library add constraint course_library_status_check check (status in ('researching', 'done', 'none'));
alter table course_library add column if not exists work jsonb;          -- the research so far (pages read, why any were left out)
alter table course_library add column if not exists step_at timestamptz; -- when the last step started (a stalled one is picked up again)
alter table course_library add column if not exists started_at timestamptz;

-- ------------------------------------------------------------ sign-in, stage 1: one sign-in per person
-- A person signs in with their email (a link and a 6-digit code, no password). What they can do depends on their
-- role in each tournament: organiser, player or follower.
alter table accounts add column if not exists name text;
alter table accounts add column if not exists last_seen_at timestamptz;
alter table account_tokens add column if not exists code_hash text;            -- the 6-digit code in the same email
alter table account_tokens add column if not exists tries int not null default 0;
alter table account_tokens add column if not exists purpose text not null default 'signin';  -- 'signin' | 'owner'
alter table account_tokens add column if not exists next text;                 -- where the link takes you after
create index if not exists account_tokens_email_idx on account_tokens (lower(email), expires_at);
-- One row per person per tournament: organiser (co-organisers too) or player, and which player spot is theirs
alter table account_tournaments add column if not exists role text not null default 'organiser';
alter table account_tournaments drop constraint if exists account_tournaments_role_check;
alter table account_tournaments add constraint account_tournaments_role_check check (role in ('organiser', 'player'));
alter table account_tournaments add column if not exists player_id text;
-- Organisers who signed in by email before this: the first one on each tournament is the organiser who made it, so
-- they keep playing as their own player (co-organisers added later are not named after them)
update account_tournaments a set player_id = t.organiser_player_id
from tournaments t
where a.tournament_id = t.id and a.role = 'organiser' and a.player_id is null and t.organiser_player_id is not null
  and not exists (select 1 from account_tournaments b where b.tournament_id = a.tournament_id and b.player_id = t.organiser_player_id)
  and a.created_at = (select min(b.created_at) from account_tournaments b where b.tournament_id = a.tournament_id and b.role = 'organiser');
-- "Is this you?": an organiser added this email to a tournament (as a co-organiser, or on a player). It joins only
-- when the person says yes, so a typo never puts the wrong person in.
create table if not exists account_offers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  email text not null,
  role text not null check (role in ('organiser', 'player')),
  player_id text,
  added_by text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  accepted boolean
);
create index if not exists account_offers_email_idx on account_offers (lower(email)) where answered_at is null;
alter table account_offers enable row level security;   -- server only
revoke all on account_offers from anon, authenticated;
grant all on account_offers to service_role;
-- Players: an email the organiser can add (to send their link by email), and the one-use link. Send again raises
-- link_gen, which signs out every phone signed in as that player.
alter table players add column if not exists email text;
alter table players add column if not exists link_used_at timestamptz;
alter table players add column if not exists link_gen int not null default 0;
-- The site owner's Face ID / Touch ID (passkeys), for the second check
create table if not exists owner_passkeys (
  id text primary key,                 -- the credential id
  account_id uuid not null references accounts(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table owner_passkeys enable row level security;   -- server only
revoke all on owner_passkeys from anon, authenticated;
grant all on owner_passkeys to service_role;
notify pgrst, 'reload schema';
-- Emails are matched exactly (lower case) from now on
update accounts set email = lower(email) where email <> lower(email);
update fans set email = lower(email) where email <> lower(email);
update subscribers set email = lower(email) where email <> lower(email);

-- ------------------------------------------------------------ stage 2: who can watch
-- Friends and family (anyone with the link) or Private (players, organisers and approved followers only).
alter table tournaments add column if not exists privacy text not null default 'friends';
alter table tournaments drop constraint if exists tournaments_privacy_check;
alter table tournaments add constraint tournaments_privacy_check check (privacy in ('friends', 'private'));
alter table tournaments add column if not exists players_need_email boolean not null default false;

create or replace function private_tournament(tid uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from tournaments where id = tid and privacy = 'private') $$;
create or replace function private_round(rid uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from rounds r join tournaments t on t.id = r.tournament_id where r.id = rid and t.privacy = 'private') $$;
grant execute on function private_tournament(uuid), private_round(uuid) to anon, authenticated, service_role;

-- What the browser can read directly: never anything from a private tournament (the site's server serves those to
-- the people let in). Live updates follow the same rules.
drop policy if exists read_all on rounds;
create policy read_all on rounds for select using (not private_tournament(tournament_id));
drop policy if exists read_all on hole_entries;
create policy read_all on hole_entries for select using (not private_round(round_id));
drop policy if exists read_all on attestations;
create policy read_all on attestations for select using (not private_round(round_id));
drop policy if exists read_all on cards;
create policy read_all on cards for select using (not private_round(round_id));
drop policy if exists read_all on card_signatures;
create policy read_all on card_signatures for select using (not private_round(round_id));
drop policy if exists read_all on likes;
create policy read_all on likes for select using (not private_tournament(tournament_id));
drop policy if exists read_all on shots;
create policy read_all on shots for select using (not private_tournament(tournament_id));
drop policy if exists read_public on posts;
create policy read_public on posts for select using (not hidden and visibility = 'public' and not private_tournament(tournament_id));
drop policy if exists read_public on comments;
create policy read_public on comments for select using (not hidden and not private_tournament(tournament_id));
drop policy if exists read_published on ai_pieces;
create policy read_published on ai_pieces for select using (status = 'published' and not private_tournament(tournament_id));
drop policy if exists read_all on votes;
create policy read_all on votes for select using (not private_tournament(tournament_id));

-- The browser's views: the same columns as the server's, without private tournaments. (The server's own views,
-- public_*, also leave private tournaments out for a browser: the site before this update still reads them.)
drop view if exists open_tournaments;
create view open_tournaments with (security_invoker = false) as
  select * from public_tournaments where not private_tournament(id);
drop view if exists open_players;
create view open_players with (security_invoker = false) as
  select * from public_players where not private_tournament(tournament_id);
drop view if exists open_gps;
create view open_gps with (security_invoker = false) as
  select * from public_gps where not private_tournament(tournament_id);
grant select on open_tournaments, open_players, open_gps to anon, authenticated;
grant select on public_tournaments, public_players, public_gps to service_role;

-- Followers: a name and how they know the group is enough (an email is optional, and confirmed before it counts).
-- In a private tournament they ask to follow, with an email, and a player or organiser approves.
alter table fans alter column email drop not null;
alter table fans add column if not exists how_known text;
alter table fans add column if not exists photo_path text;
alter table fans add column if not exists status text not null default 'approved';
alter table fans drop constraint if exists fans_status_check;
alter table fans add constraint fans_status_check check (status in ('approved', 'asking', 'declined', 'removed'));
alter table fans add column if not exists decided_by text;
alter table fans add column if not exists decided_at timestamptz;
alter table fans add column if not exists reminded_at timestamptz;     -- organisers told it's waiting
alter table fans add column if not exists marketing_at timestamptz;    -- ticked "send me news", and the words they saw
alter table fans add column if not exists marketing_wording text;

-- Phones that opened a tournament without giving a name ("and 23 others watching")
create table if not exists viewers (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  device text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (tournament_id, device)
);
alter table viewers enable row level security;   -- server only
revoke all on viewers from anon, authenticated;
grant all on viewers to service_role;

-- Private tournaments' photos, clips and films: a locked store, opened by links that expire
insert into storage.buckets (id, name, public, file_size_limit)
values ('media-private', 'media-private', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
-- Live updates. Supabase sends a deleted row's key to anyone listening, whatever tournament it was in, and the keys of
-- signed scores, cards, signatures and likes have players' names in them. So those tables aren't sent live: a change to
-- them pings its tournament instead (and a private tournament's pings are only seen by the site's server).
create table if not exists live_pings (
  tournament_id uuid primary key,
  at timestamptz not null default now()
);
alter table live_pings enable row level security;
grant select on live_pings to anon, authenticated;
grant all on live_pings to service_role;
drop policy if exists live_pings_read on live_pings;
create policy live_pings_read on live_pings for select using (not private_tournament(tournament_id));

create or replace function ping_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  tid uuid;
begin
  r := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  tid := (r ->> 'tournament_id')::uuid;
  if tid is null and r ? 'round_id' then
    select tournament_id into tid from rounds where id = (r ->> 'round_id')::uuid;
  end if;
  if tid is not null and exists (select 1 from tournaments where id = tid) then
    insert into live_pings (tournament_id, at) values (tid, now())
    on conflict (tournament_id) do update set at = excluded.at;
  end if;
  return null;
end $$;

drop trigger if exists ping_attestations on attestations;
create trigger ping_attestations after insert or update or delete on attestations for each row execute function ping_tournament();
drop trigger if exists ping_likes on likes;
create trigger ping_likes after insert or update or delete on likes for each row execute function ping_tournament();
drop trigger if exists ping_cards on cards;
create trigger ping_cards after insert or update or delete on cards for each row execute function ping_tournament();
drop trigger if exists ping_card_signatures on card_signatures;
create trigger ping_card_signatures after insert or update or delete on card_signatures for each row execute function ping_tournament();

do $$
begin
  begin alter publication supabase_realtime drop table attestations; exception when others then null; end;
  begin alter publication supabase_realtime drop table likes; exception when others then null; end;
  begin alter publication supabase_realtime drop table cards; exception when others then null; end;
  begin alter publication supabase_realtime drop table card_signatures; exception when others then null; end;
  begin alter publication supabase_realtime add table live_pings; exception when others then null; end;
end $$;

-- ------------------------------------------------------------ stage 3: the console
-- Everything here is read and written by the site's server only (nothing for browsers).
create extension if not exists pg_trgm;

-- Support staff (the owner is OWNER_EMAIL). Removing someone keeps the row, so the record shows who they were.
create table if not exists staff (
  email text primary key,
  role text not null default 'support' check (role in ('support')),
  added_by text not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);

-- The activity record: every action in the console. Nobody can change it; kept two years.
create table if not exists activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,                 -- an email, or 'system'
  actor_role text not null,            -- owner | support | system
  action text not null,                -- tournament.delete, person.view, export.people…
  tournament_id uuid,                  -- not linked: the record outlives a deleted tournament
  tournament_name text,
  person text,                         -- an email
  detail jsonb
);
create index if not exists activity_at_idx on activity (at desc);
create index if not exists activity_t_idx on activity (tournament_id, at desc);
create index if not exists activity_p_idx on activity (person, at desc);
create or replace function activity_frozen() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.at < now() - interval '2 years' then return old; end if;
  raise exception 'The activity record can''t be changed';
end $$;
drop trigger if exists activity_frozen on activity;
create trigger activity_frozen before update or delete on activity for each row execute function activity_frozen();

-- Every paid call the site makes, with its estimated cost (US cents: the suppliers bill in dollars)
create table if not exists usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  service text not null,               -- writing | voices | films | video | courses | email
  what text,
  tournament_id uuid,                  -- not linked: costs outlive a deleted tournament
  ok boolean not null default true,
  units jsonb,
  cents numeric not null default 0
);
create index if not exists usage_at_idx on usage (at desc);
create index if not exists usage_service_idx on usage (service, at desc);
create index if not exists usage_t_idx on usage (tournament_id, at desc);

-- The outside services: when each last worked, and since when it's been failing
create table if not exists services (
  service text primary key,
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  failing_since timestamptz,
  alerted_at timestamptz,
  last_error text,
  fails_day date,
  fails int not null default 0
);

-- Errors, grouped: one fault happening 200 times is one row
create table if not exists incidents (
  key text primary key,
  place text not null,
  message text not null,
  count int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  tournaments uuid[] not null default '{}',
  last_detail text
);
create index if not exists incidents_last_idx on incidents (last_at desc);
create or replace function record_incident(k text, p text, m text, tid uuid, d text) returns void
language plpgsql as $$
begin
  insert into incidents (key, place, message, tournaments, last_detail)
  values (k, left(p, 200), left(m, 1000), case when tid is null then '{}' else array[tid] end, left(d, 4000))
  on conflict (key) do update set
    count = incidents.count + 1,
    last_at = now(),
    last_detail = coalesce(excluded.last_detail, incidents.last_detail),
    tournaments = case when tid is null or tid = any(incidents.tournaments) or cardinality(incidents.tournaments) >= 20
                       then incidents.tournaments else incidents.tournaments || tid end;
end $$;

-- Counts by day (emails sent by kind, sign-in codes, wrong codes…), Irish days
create table if not exists day_counts (
  day date not null,
  name text not null,
  n int not null default 0,
  primary key (day, name)
);
create or replace function bump(nm text, by_n int default 1) returns void language sql as $$
  insert into day_counts (day, name, n) values ((now() at time zone 'Europe/Dublin')::date, nm, by_n)
  on conflict (day, name) do update set n = day_counts.n + excluded.n;
$$;

-- Emails that didn't go, and addresses the site has stopped emailing
create table if not exists email_failures (
  id bigserial primary key,
  at timestamptz not null default now(),
  email text not null,
  kind text,
  error text,
  tournament_id uuid
);
create index if not exists email_failures_idx on email_failures (email, at desc);
create table if not exists email_blocks (
  email text primary key,
  at timestamptz not null default now(),
  by_who text,
  reason text
);

-- People: one row per email, however they came in
create table if not exists people (
  email text primary key,
  name text,
  first_at timestamptz not null default now(),
  last_at timestamptz,
  roles text[] not null default '{}',
  marketing_at timestamptz,
  marketing_wording text,
  marketing_tournament uuid,
  marketing_stopped_at timestamptz
);
create index if not exists people_email_trgm on people using gin (email gin_trgm_ops);
create index if not exists people_name_trgm on people using gin (lower(name) gin_trgm_ops);
create index if not exists people_last_idx on people (last_at desc nulls last);
create index if not exists people_first_idx on people (first_at desc);
create index if not exists people_marketing_idx on people (marketing_at desc) where marketing_at is not null;

create or replace function touch_person(e text, nm text, role text, seen timestamptz, since timestamptz) returns void
language plpgsql as $$
begin
  if e is null or position('@' in e) = 0 then return; end if;
  insert into people (email, name, first_at, last_at, roles)
  values (lower(trim(e)), nullif(trim(nm), ''), coalesce(since, now()), seen, case when role is null then '{}' else array[role] end)
  on conflict (email) do update set
    name = coalesce(people.name, excluded.name),
    first_at = least(people.first_at, excluded.first_at),
    last_at = greatest(people.last_at, excluded.last_at),
    roles = case when role is null or role = any(people.roles) then people.roles else people.roles || role end;
end $$;

create or replace function people_from_accounts() returns trigger language plpgsql as $$
begin perform touch_person(new.email, new.name, null, new.last_seen_at, new.created_at); return null; end $$;
drop trigger if exists people_accounts on accounts;
create trigger people_accounts after insert or update on accounts for each row execute function people_from_accounts();

create or replace function people_from_joins() returns trigger language plpgsql as $$
declare e text;
begin
  select email into e from accounts where id = new.account_id;
  perform touch_person(e, null, new.role, null, new.created_at);
  return null;
end $$;
drop trigger if exists people_joins on account_tournaments;
create trigger people_joins after insert or update on account_tournaments for each row execute function people_from_joins();

create or replace function people_from_players() returns trigger language plpgsql as $$
begin perform touch_person(new.email, new.name, 'player', null, null); return null; end $$;
drop trigger if exists people_players on players;
create trigger people_players after insert or update of email on players for each row when (new.email is not null) execute function people_from_players();

create or replace function people_from_fans() returns trigger language plpgsql as $$
begin
  if new.email is null or new.verified_at is null then return null; end if;
  perform touch_person(new.email, new.name, 'follower', new.verified_at, new.created_at);
  if new.marketing_at is not null then
    update people set marketing_at = new.marketing_at, marketing_wording = new.marketing_wording, marketing_tournament = new.tournament_id
    where email = lower(trim(new.email)) and (marketing_at is null or marketing_at < new.marketing_at) and marketing_stopped_at is null;
  end if;
  return null;
end $$;
drop trigger if exists people_fans on fans;
create trigger people_fans after insert or update on fans for each row execute function people_from_fans();

create or replace function people_from_subscribers() returns trigger language plpgsql as $$
begin perform touch_person(new.email, new.name, 'subscriber', null, new.created_at); return null; end $$;
drop trigger if exists people_subscribers on subscribers;
create trigger people_subscribers after insert on subscribers for each row execute function people_from_subscribers();

-- Everyone already here
do $$
declare r record;
begin
  for r in select email, name, last_seen_at, created_at from accounts loop perform touch_person(r.email, r.name, null, r.last_seen_at, r.created_at); end loop;
  for r in select a.email, j.role, j.created_at from account_tournaments j join accounts a on a.id = j.account_id loop perform touch_person(r.email, null, r.role, null, r.created_at); end loop;
  for r in select email, name from players where email is not null loop perform touch_person(r.email, r.name, 'player', null, null); end loop;
  for r in select email, name, verified_at, created_at from fans where email is not null and verified_at is not null loop perform touch_person(r.email, r.name, 'follower', r.verified_at, r.created_at); end loop;
  for r in select email, name, created_at from subscribers loop perform touch_person(r.email, r.name, 'subscriber', null, r.created_at); end loop;
  update people p set marketing_at = f.marketing_at, marketing_wording = f.marketing_wording, marketing_tournament = f.tournament_id
  from (select distinct on (lower(email)) lower(email) e, marketing_at, marketing_wording, tournament_id from fans
        where marketing_at is not null and verified_at is not null order by lower(email), marketing_at desc) f
  where p.email = f.e and p.marketing_at is null and p.marketing_stopped_at is null;
end $$;

-- Needs you: everything waiting on a person. One open item per thing
create table if not exists queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                  -- data_request | report | film | invite | spend | follow_wait | email_failing | research
  subject text not null,               -- what it's about: a post, a film, an invite, an email…
  tournament_id uuid,
  person text,
  title text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  due_at timestamptz,
  snoozed_until timestamptz,
  assigned_to text,
  resolved_at timestamptz,
  resolved_by text,
  resolution text
);
create unique index if not exists queue_open on queue (kind, subject) where resolved_at is null;
create index if not exists queue_created_idx on queue (created_at) where resolved_at is null;

-- Asked for from My golf: a copy of my data, or delete me
create table if not exists data_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null check (kind in ('copy', 'delete')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);

-- Each tournament's figures, refreshed each night and whenever they're more than an hour old
create table if not exists tournament_stats (
  tournament_id uuid primary key references tournaments(id) on delete cascade,
  status text not null default 'setting up',     -- setting up | coming up | live | finished
  first_day date,
  last_day date,
  players int not null default 0,
  signed_in int not null default 0,
  followers int not null default 0,
  posts int not null default 0,
  comments int not null default 0,
  clips int not null default 0,
  films int not null default 0,
  cost_cents numeric not null default 0,
  last_activity_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists tstats_status_idx on tournament_stats (status, first_day);
create index if not exists tstats_cost_idx on tournament_stats (cost_cents desc);
create index if not exists tournaments_name_trgm on tournaments using gin (lower(name) gin_trgm_ops);
create index if not exists tournaments_created_idx on tournaments (created_at desc);
create index if not exists fans_created_idx on fans (created_at);
create index if not exists rounds_play_date_idx on rounds (play_date);
create index if not exists posts_t_created_idx on posts (tournament_id, created_at desc);
create index if not exists comments_t_created_idx on comments (tournament_id, created_at desc);
create index if not exists players_t_idx on players (tournament_id);
create index if not exists fans_t_idx on fans (tournament_id);
create index if not exists account_tournaments_t_idx on account_tournaments (tournament_id);

create or replace function refresh_tournament_stats(only_id uuid default null) returns void language sql as $$
  insert into tournament_stats as s (tournament_id, status, first_day, last_day, players, signed_in, followers, posts, comments, clips, films, cost_cents, last_activity_at, updated_at)
  select t.id,
    case
      when r.live > 0 or r.today > 0 then 'live'
      when r.first_day is null then 'setting up'
      when r.first_day > (now() at time zone 'Europe/Dublin')::date then 'coming up'
      when r.last_day < (now() at time zone 'Europe/Dublin')::date then 'finished'
      else 'live'
    end,
    r.first_day, r.last_day,
    coalesce(pl.n, 0), coalesce(j.n, 0), coalesce(f.n, 0), coalesce(po.n, 0), coalesce(c.n, 0), coalesce(po.clips, 0), coalesce(rl.n, 0),
    coalesce(u.cents, 0),
    greatest(po.last_at, c.last_at),
    now()
  from tournaments t
  left join lateral (select min(play_date) first_day, max(play_date) last_day, count(*) filter (where status = 'live') live,
                            count(*) filter (where play_date = (now() at time zone 'Europe/Dublin')::date) today
                     from rounds where tournament_id = t.id) r on true
  left join lateral (select count(*) n from players where tournament_id = t.id) pl on true
  left join lateral (select count(*) n from account_tournaments where tournament_id = t.id) j on true
  left join lateral (select count(*) n from fans where tournament_id = t.id and status = 'approved') f on true
  left join lateral (select count(*) n, count(*) filter (where kind = 'video') clips, max(created_at) last_at from posts where tournament_id = t.id) po on true
  left join lateral (select count(*) n, max(created_at) last_at from comments where tournament_id = t.id) c on true
  left join lateral (select count(*) n from reels where tournament_id = t.id and status = 'done') rl on true
  left join lateral (select sum(cents) cents from usage where tournament_id = t.id) u on true
  where only_id is null or t.id = only_id
  on conflict (tournament_id) do update set
    status = excluded.status, first_day = excluded.first_day, last_day = excluded.last_day, players = excluded.players,
    signed_in = excluded.signed_in, followers = excluded.followers, posts = excluded.posts, comments = excluded.comments,
    clips = excluded.clips, films = excluded.films, cost_cents = excluded.cost_cents,
    last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at;
$$;

-- A month's spend (or any period's), for one service or all, for one tournament or all
create or replace function usage_sum(svc text, since timestamptz, tid uuid default null) returns numeric language sql stable as $$
  select coalesce(sum(cents), 0) from usage
  where (svc is null or service = svc) and at >= since and (tid is null or tournament_id = tid);
$$;

-- Room used: the database, and the files in storage (nothing when storage isn't in this database, as in testing)
create or replace function console_room() returns jsonb language plpgsql security definer set search_path = public as $$
declare files bigint := null; bytes bigint := null;
begin
  begin
    execute 'select count(*), coalesce(sum((metadata->>''size'')::bigint), 0) from storage.objects' into files, bytes;
  exception when others then null;
  end;
  return jsonb_build_object('db', pg_database_size(current_database()), 'files', files, 'fileBytes', bytes);
end $$;
revoke execute on function console_room() from public, anon, authenticated;
grant execute on function console_room() to service_role;

-- The console's tournament list: each tournament with its figures and its first organiser
create or replace view console_tournaments with (security_invoker = false) as
  select t.id, t.slug, t.name, t.privacy, t.created_at,
         coalesce(s.status, 'setting up') as status, s.first_day, s.last_day,
         coalesce(s.players, 0) as players, coalesce(s.signed_in, 0) as signed_in, coalesce(s.followers, 0) as followers,
         coalesce(s.posts, 0) as posts, coalesce(s.comments, 0) as comments, coalesce(s.clips, 0) as clips, coalesce(s.films, 0) as films,
         coalesce(s.cost_cents, 0) as cost_cents, s.last_activity_at, s.updated_at as stats_at,
         (select a.email from account_tournaments j join accounts a on a.id = j.account_id
          where j.tournament_id = t.id and j.role = 'organiser' order by j.created_at limit 1) as organiser
  from tournaments t left join tournament_stats s on s.tournament_id = t.id;
revoke all on console_tournaments from anon, authenticated;
grant select on console_tournaments to service_role;

-- Spend by service since a time (calls and failures too)
create or replace function usage_breakdown(since timestamptz, tid uuid default null)
returns table (service text, cents numeric, calls bigint, fails bigint) language sql stable as $$
  select service, coalesce(sum(cents), 0), count(*), count(*) filter (where not ok)
  from usage where at >= since and (tid is null or tournament_id = tid) group by service;
$$;
-- Spend by month and service, for the twelve-month chart
create or replace function usage_months(since timestamptz)
returns table (month text, service text, cents numeric) language sql stable as $$
  select to_char(date_trunc('month', at at time zone 'Europe/Dublin'), 'YYYY-MM'), service, coalesce(sum(cents), 0)
  from usage where at >= since group by 1, 2 order by 1;
$$;
-- The most expensive tournaments since a time, and how many tournaments spent anything
create or replace function usage_top(since timestamptz, n int default 10)
returns table (tournament_id uuid, cents numeric) language sql stable as $$
  select tournament_id, sum(cents) from usage
  where at >= since and tournament_id is not null group by tournament_id order by 2 desc limit n;
$$;
create or replace function usage_tournaments(since timestamptz) returns bigint language sql stable as $$
  select count(distinct tournament_id) from usage where at >= since and tournament_id is not null and cents > 0;
$$;
create or replace function usage_by_tournament(svc text, since timestamptz)
returns table (tournament_id uuid, cents numeric) language sql stable as $$
  select tournament_id, sum(cents) from usage where service = svc and at >= since and tournament_id is not null group by 1;
$$;
revoke execute on function usage_by_tournament(text, timestamptz) from public, anon, authenticated;
grant execute on function usage_by_tournament(text, timestamptz) to service_role;
create or replace function usage_sum_tournaments(since timestamptz) returns numeric language sql stable as $$
  select coalesce(sum(cents), 0) from usage where at >= since and tournament_id is not null;
$$;
revoke execute on function usage_breakdown(timestamptz, uuid), usage_months(timestamptz), usage_top(timestamptz, int), usage_tournaments(timestamptz),
  usage_sum_tournaments(timestamptz) from public, anon, authenticated;
grant execute on function usage_breakdown(timestamptz, uuid), usage_months(timestamptz), usage_top(timestamptz, int), usage_tournaments(timestamptz),
  usage_sum_tournaments(timestamptz) to service_role;

-- Needs you, swept each morning in a few statements (whatever the number of tournaments): in with what's waited too
-- long, out with what's sorted elsewhere. Returns how many came in.
create or replace function console_sweep() returns int language plpgsql as $$
declare n int := 0; k int;
begin
  -- Films stuck: a step running for over half an hour
  insert into queue (kind, subject, tournament_id, title, detail)
  select 'film', r.id::text, r.tournament_id, 'A film is stuck', jsonb_build_object('stage', coalesce(r.stage, r.status))
  from reels r where r.status in ('planning', 'rendering') and r.updated_at < now() - interval '30 minutes'
  on conflict (kind, subject) where resolved_at is null do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Reports nobody has dealt with in a day (the post or comment still there, not hidden by the organiser)
  insert into queue (kind, subject, tournament_id, title, detail)
  select distinct on (x.id) 'report', x.id::text, x.tid, x.title, jsonb_build_object('table', x.tbl)
  from (
    select p.id, p.tournament_id tid, 'A reported post, waiting over a day' title, 'posts' tbl
    from reports r join posts p on p.id = r.post_id
    where r.created_at < now() - interval '1 day' and not (p.hidden and not coalesce(p.hidden_by_reports, false))
    union all
    select c.id, c.tournament_id, 'A reported comment, waiting over a day', 'comments'
    from reports r join comments c on c.id = r.comment_id
    where r.created_at < now() - interval '1 day' and not (c.hidden and not coalesce(c.hidden_by_reports, false))
  ) x
  where not exists (select 1 from queue q where q.kind = 'report' and q.subject = x.id::text and q.resolved_at is not null and q.resolved_at > now() - interval '1 day')
  on conflict (kind, subject) where resolved_at is null do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Follow requests still waiting three days after the organiser's reminder
  insert into queue (kind, subject, tournament_id, title, detail)
  select 'follow_wait', 'follow:' || f.tournament_id, f.tournament_id, count(*) || ' waiting to follow ' || t.name, jsonb_build_object('n', count(*))
  from fans f join tournaments t on t.id = f.tournament_id
  where f.status = 'asking' and f.reminded_at < now() - interval '3 days'
  group by f.tournament_id, t.name
  on conflict (kind, subject) where resolved_at is null do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Out: sorted elsewhere
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'The film is sorted'
  where q.resolved_at is null and q.kind = 'film'
    and not exists (select 1 from reels r where r.id::text = q.subject and r.status in ('failed', 'planning', 'rendering'));
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'It was answered'
  where q.resolved_at is null and q.kind = 'invite'
    and not exists (select 1 from invite_requests i where i.id::text = q.subject and i.status = 'new');
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'Nobody''s waiting now'
  where q.resolved_at is null and q.kind = 'follow_wait'
    and not exists (select 1 from fans f where 'follow:' || f.tournament_id = q.subject and f.status = 'asking');
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'Research found the course'
  where q.resolved_at is null and q.kind = 'research'
    and exists (select 1 from course_library c where c.ref = q.subject and c.status = 'done');
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'No failures for a fortnight'
  where q.resolved_at is null and q.kind = 'email_failing'
    and not exists (select 1 from email_failures e where e.email = q.subject and e.at > now() - interval '14 days');
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'Done'
  where q.resolved_at is null and q.kind = 'data_request'
    and not exists (select 1 from data_requests d where d.id::text = q.subject and d.done_at is null);
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'It was deleted, or dealt with'
  where q.resolved_at is null and q.kind = 'report'
    and not exists (select 1 from posts p where p.id::text = q.subject and not (p.hidden and not coalesce(p.hidden_by_reports, false)))
    and not exists (select 1 from comments c where c.id::text = q.subject and not (c.hidden and not coalesce(c.hidden_by_reports, false)));
  update queue q set resolved_at = now(), resolved_by = 'system', resolution = 'A new month'
  where q.resolved_at is null and q.kind = 'spend' and q.subject not like '%:' || to_char(now(), 'YYYY-MM');
  return n;
end $$;
revoke execute on function console_sweep() from public, anon, authenticated;
grant execute on function console_sweep() to service_role;

-- Each tournament's figures when they're due: any tournament without them straight away, everything once an hour
-- (one at a time across the servers)
create or replace function refresh_stats_due() returns boolean language plpgsql as $$
declare tid uuid;
begin
  if not pg_try_advisory_xact_lock(4242) then return false; end if;
  for tid in select t.id from tournaments t where not exists (select 1 from tournament_stats s where s.tournament_id = t.id) limit 200 loop
    perform refresh_tournament_stats(tid);
  end loop;
  if exists (select 1 from site_settings where key = 'stats' and updated_at > now() - interval '1 hour') then return false; end if;
  insert into site_settings (key, value, updated_at) values ('stats', '{}'::jsonb, now())
  on conflict (key) do update set updated_at = now();
  perform refresh_tournament_stats(null);
  return true;
end $$;
revoke execute on function refresh_stats_due() from public, anon, authenticated;
grant execute on function refresh_stats_due() to service_role;

-- When a tournament last changed who can watch (its files are re-checked for two days after)
alter table tournaments add column if not exists privacy_changed_at timestamptz;

-- Support paused a tournament's AI writing and films: what the switches were, to put back
alter table tournaments add column if not exists console_paused jsonb;

-- People get an id of their own, so their pages' addresses don't carry their email
alter table people add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists people_id_idx on people (id);

-- One row a day: what the front page's growth chart is drawn from
create table if not exists daily_stats (
  day date primary key,
  figures jsonb not null,
  made_at timestamptz not null default now()
);

-- The console signed this person out on every phone (sign-ins before this no longer count)
alter table accounts add column if not exists signout_at timestamptz;

-- A tournament's own monthly limit on AI writing (US cents)
alter table tournaments add column if not exists ai_cap_cents int not null default 1000;

do $$
declare t text;
begin
  foreach t in array array['staff', 'activity', 'usage', 'services', 'incidents', 'day_counts', 'email_failures', 'email_blocks',
                            'people', 'queue', 'data_requests', 'tournament_stats', 'daily_stats'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
revoke execute on function record_incident(text, text, text, uuid, text), bump(text, int), touch_person(text, text, text, timestamptz, timestamptz),
  refresh_tournament_stats(uuid), usage_sum(text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function record_incident(text, text, text, uuid, text), bump(text, int), refresh_tournament_stats(uuid),
  usage_sum(text, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------ stage 5: email

-- What each email says. Every save is a new version and the newest is used; with none saved, the words in the code.
create table if not exists email_words (
  key text not null,
  version int not null,
  subject text,
  headline text,
  lines text,
  button text,
  saved_by text not null,
  saved_at timestamptz not null default now(),
  restored_from int,
  primary key (key, version)
);

-- Every email sent: the figures, the weekly limit on marketing, bounces, taps and stops are all read from here
create table if not exists email_sends (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  email text not null,
  stream text not null,                    -- service | updates | marketing
  kind text not null,                      -- what it was, in words (sign-in, player link, campaign…)
  template text,                           -- the key of its words
  ref text,                                -- a series step, campaign or evening email: sent once per person
  tournament_id uuid,
  status text not null default 'sent',     -- queued | sent | failed | bounced | complained
  message_id text,
  error text,
  clicked_at timestamptz,
  stopped_at timestamptz                   -- they stopped emails from this one's link
);
create index if not exists email_sends_at_idx on email_sends (at desc);
create index if not exists email_sends_person_idx on email_sends (email, stream, at desc);
create index if not exists email_sends_ref_idx on email_sends (ref, status) where ref is not null;
create index if not exists email_sends_template_idx on email_sends (template, at desc);
create index if not exists email_sends_msg_idx on email_sends (message_id) where message_id is not null;
create unique index if not exists email_sends_once on email_sends (ref, email, coalesce(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ref is not null and status <> 'failed';

-- What each person has chosen to get
alter table people add column if not exists trip_news boolean not null default true;     -- the series (with the marketing tick)
alter table people add column if not exists offers boolean not null default true;        -- campaigns (with the marketing tick)
alter table people add column if not exists tips boolean not null default true;          -- tips for organisers
alter table people add column if not exists marketing_stopped_reason text;               -- unsubscribed | spam | stopped by the console
alter table people add column if not exists updates_stopped_at timestamptz;              -- a spam complaint, or "stop everything"
alter table subscribers add column if not exists evening boolean not null default false; -- one email each evening instead of every update

-- An organiser's tick, kept until they confirm their email
alter table account_offers add column if not exists marketing_at timestamptz;
alter table account_offers add column if not exists marketing_wording text;

-- Players whose link went by email (they have the calendar file), and the dates they were last sent
alter table players add column if not exists link_emailed_at timestamptz;
alter table players add column if not exists dates_sent text;

-- A tick from the follower's form: newer than a stop, it starts marketing again (the person asked for it)
create or replace function people_from_fans() returns trigger language plpgsql as $$
begin
  if new.email is null or new.verified_at is null then return null; end if;
  perform touch_person(new.email, new.name, 'follower', new.verified_at, new.created_at);
  if new.marketing_at is not null then
    update people set marketing_at = new.marketing_at, marketing_wording = new.marketing_wording, marketing_tournament = new.tournament_id,
      marketing_stopped_at = null, marketing_stopped_reason = null, trip_news = true, offers = true
    where email = lower(trim(new.email))
      and (marketing_at is null or marketing_at < new.marketing_at)
      and (marketing_stopped_at is null or marketing_stopped_at < new.marketing_at);
  end if;
  return null;
end $$;

-- The series: switched on by the owner, steps and timings kept once changed from the code's
create table if not exists email_series (
  key text primary key,
  enabled boolean not null default false,
  steps jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Campaigns: one-off emails written in the console
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  audience jsonb not null default '{}'::jsonb,
  status text not null default 'draft',    -- draft | scheduled | sending | paused | sent | stopped
  send_on date,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  sent_by text,
  planned int,
  note text
);
create index if not exists email_campaigns_status_idx on email_campaigns (status, send_on);

-- Photos uploaded for campaigns, kept to use again
create table if not exists email_photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  name text,
  added_by text not null,
  added_at timestamptz not null default now()
);

-- Writing sends down before they go: anyone who has had this one already (same series step or campaign) is left out
create or replace function email_queue(rows jsonb) returns setof uuid language plpgsql as $$
begin
  -- Marketing: one a week per person, whoever is sending (two campaigns at once can't both get through)
  if exists (select 1 from jsonb_array_elements(rows) r where r->>'stream' = 'marketing') then
    perform pg_advisory_xact_lock(hashtext('email-marketing-week'));
  end if;
  return query
  insert into email_sends (id, email, stream, kind, template, ref, tournament_id, status)
  select distinct on (case when x.stream = 'marketing' then x.email else x.id::text end)
    x.id, x.email, x.stream, x.kind, x.template, x.ref, x.tid, 'queued'
  from (
    select (r->>'id')::uuid id, lower(r->>'email') email, r->>'stream' stream, r->>'kind' kind, r->>'template' template, r->>'ref' ref,
      nullif(r->>'tournament_id', '')::uuid tid
    from jsonb_array_elements(rows) r
  ) x
  where x.stream <> 'marketing'
     or not exists (select 1 from email_sends s where s.email = x.email and s.stream = 'marketing' and s.status <> 'failed' and s.at > now() - interval '7 days')
  on conflict do nothing
  returning email_sends.id;
end $$;

-- What happened to each: sent (with Postmark's id for it) or failed
create or replace function email_mark(rows jsonb) returns void language sql as $$
  update email_sends s set status = r.status, message_id = coalesce(r.message_id, s.message_id), error = r.error
  from jsonb_to_recordset(rows) as r(id uuid, status text, message_id text, error text)
  where s.id = r.id
$$;

-- Who a campaign can go to: the marketing tick (and news and offers on), not stopped, with the console's filters.
-- Each person's most recent tournament comes with them, for {tournament}
create or replace function campaign_audience(want_roles text[], active_days int, idle_days int, min_trips int, max_trips int)
returns table (email text, name text, tournament text) language sql stable as $$
  with links as (
    select lower(p.email) e, p.tournament_id t from players p where p.email is not null
    union select lower(f.email), f.tournament_id from fans f where f.email is not null and f.verified_at is not null and f.status = 'approved' and not f.blocked
    union select lower(s.email), s.tournament_id from subscribers s
    union select lower(a.email), j.tournament_id from account_tournaments j join accounts a on a.id = j.account_id
  ), trips as (
    select l.e, count(distinct l.t) n, (array_agg(t.name order by t.created_at desc))[1] latest
    from links l join tournaments t on t.id = l.t group by l.e
  )
  select p.email, p.name, tr.latest
  from people p left join trips tr on tr.e = p.email
  where p.marketing_at is not null and p.marketing_stopped_at is null and p.offers
    and not exists (select 1 from email_blocks b where b.email = p.email)
    and (want_roles is null or p.roles && want_roles)
    and (active_days is null or p.last_at >= now() - make_interval(days => active_days))
    and (idle_days is null or p.last_at is null or p.last_at < now() - make_interval(days => idle_days))
    and (min_trips is null or coalesce(tr.n, 0) >= min_trips)
    and (max_trips is null or coalesce(tr.n, 0) <= max_trips)
  order by p.email
$$;

-- Everyone on a trip today (first round to last): no marketing reaches them
create or replace function emails_on_trip(today date) returns table (email text) language sql stable as $$
  with live as (select tournament_id from tournament_stats where first_day <= today and last_day >= today)
  select distinct e from (
    select lower(p.email) e from players p join live l on l.tournament_id = p.tournament_id where p.email is not null
    union all select lower(f.email) from fans f join live l on l.tournament_id = f.tournament_id where f.email is not null
    union all select lower(s.email) from subscribers s join live l on l.tournament_id = s.tournament_id where s.unsubscribed_at is null
    union all select lower(a.email) from account_tournaments j join live l on l.tournament_id = j.tournament_id join accounts a on a.id = j.account_id
  ) x order by e
$$;

-- Figures for a set of series steps or campaigns
create or replace function email_ref_stats(refs text[]) returns table (ref text, sent bigint, clicked bigint, bounced bigint, complained bigint, stopped bigint)
language sql stable as $$
  select s.ref,
    count(*) filter (where s.status in ('sent', 'bounced', 'complained')),
    count(s.clicked_at),
    count(*) filter (where s.status = 'bounced'),
    count(*) filter (where s.status = 'complained'),
    count(s.stopped_at)
  from email_sends s where s.ref = any(refs) group by s.ref
$$;

-- Each email's count since a time (the Every email list)
create or replace function email_template_counts(since timestamptz) returns table (template text, sent bigint)
language sql stable as $$
  select template, count(*) from email_sends where at >= since and template is not null and status <> 'failed' group by template
$$;

-- Health: sent, bounced and complained since a time, for updates and marketing (what Gmail and Yahoo judge us on)
create or replace function email_health(since timestamptz) returns table (stream text, sent bigint, bounced bigint, complained bigint)
language sql stable as $$
  select stream, count(*) filter (where status in ('sent', 'bounced', 'complained')), count(*) filter (where status = 'bounced'),
    count(*) filter (where status = 'complained')
  from email_sends where at >= since group by stream
$$;

do $$
declare t text;
begin
  foreach t in array array['email_words', 'email_sends', 'email_series', 'email_campaigns', 'email_photos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
revoke execute on function email_ref_stats(text[]), email_template_counts(timestamptz), email_health(timestamptz), email_queue(jsonb), email_mark(jsonb), campaign_audience(text[], int, int, int, int), emails_on_trip(date) from public, anon, authenticated;
grant execute on function email_ref_stats(text[]), email_template_counts(timestamptz), email_health(timestamptz), email_queue(jsonb), email_mark(jsonb), campaign_audience(text[], int, int, int, int), emails_on_trip(date) to service_role;
grant execute on function touch_person(text, text, text, timestamptz, timestamptz) to service_role;

-- ------------------------------------------------------------ stage 4: the end of a trip
-- Finishing: by the organiser's button or by itself 3 days after the last round (a round on your own: the day after).
-- The rounds it closed are kept, to put back if the organiser opens scoring again.
alter table tournaments add column if not exists finished_by text;
alter table tournaments add column if not exists finish_rounds jsonb;
alter table tournaments add column if not exists reopened_at timestamptz;
alter table tournaments add column if not exists finish_warned_at timestamptz;   -- organisers told the day before
alter table tournaments add column if not exists end_piece text;                  -- the final report or write-up: written | skipped
create index if not exists tournaments_finished_idx on tournaments (finished_at);
-- Films are kept for 12 months from the day they're made; a reminder goes a month before
alter table reels add column if not exists expires_at timestamptz;
alter table reels add column if not exists reminded_at timestamptz;
alter table reels add column if not exists removed_at timestamptz;
-- A player's bio follows them: kept on their account once they have one
alter table accounts add column if not exists bio jsonb;
-- What a player has been asked on their own phone (the bio, their email) and how they answered
alter table players add column if not exists asks jsonb not null default '{}'::jsonb;
-- Deleted accounts: only a scrambled copy of the address, so marketing can never reach it again
create table if not exists deleted_emails (
  hash text primary key,
  at timestamptz not null default now()
);
alter table deleted_emails enable row level security;
revoke all on deleted_emails from anon, authenticated;
grant all on deleted_emails to service_role;

-- Once, when this goes live: rounds on your own are marked as such, every trip whose last round was more than 3 days
-- ago is finished quietly (no emails, no writing), and films already made get 12 months from today.
do $$
begin
  if not exists (select 1 from site_settings where key = 'stage4_backfill') then
    update tournaments t set solo = true
      where not t.solo and t.organiser_player_id is not null
        and (select count(*) from players p where p.tournament_id = t.id) = 1
        and exists (select 1 from players p where p.tournament_id = t.id and p.id = t.organiser_player_id);
    with due as (
      select t.id from tournaments t
      where t.finished_at is null
        and (select max(r.play_date) from rounds r where r.tournament_id = t.id) < (now() at time zone 'Europe/Dublin')::date - 3
    )
    update tournaments t set finished_at = now(), finished_by = 'Finished when this part of the site went live', end_piece = 'skipped',
        feed_until = now() + interval '30 days',
        finish_rounds = (select coalesce(jsonb_agg(r.id), '[]'::jsonb) from rounds r where r.tournament_id = t.id and r.status <> 'complete')
      from due where t.id = due.id;
    update rounds r set status = 'complete'
      from tournaments t where t.id = r.tournament_id and t.finished_by = 'Finished when this part of the site went live' and r.status <> 'complete';
    update reels set expires_at = now() + interval '12 months' where status = 'done' and expires_at is null;
    insert into site_settings (key, value) values ('stage4_backfill', jsonb_build_object('at', now()));
  end if;
end $$;

-- Unfinished tournaments whose last round was before today (the hourly run finishes those that are due)
create or replace function finish_candidates(today date)
returns table (id uuid, name text, slug text, theme text, custom_colors jsonb, solo boolean, reopened_at timestamptz, finish_warned_at timestamptz, last_day date)
language sql stable as $$
  select t.id, t.name, t.slug, t.theme, t.custom_colors, t.solo, t.reopened_at, t.finish_warned_at, r.last_day
  from tournaments t
  join lateral (select max(play_date) last_day from rounds where tournament_id = t.id) r on true
  where t.finished_at is null and r.last_day < today
  order by t.id
$$;
revoke execute on function finish_candidates(date) from public, anon, authenticated;
grant execute on function finish_candidates(date) to service_role;

-- ------------------------------------------------------------ on the course: scores and detail
-- A round being played when this went live keeps its one scorer until it's finished
alter table rounds add column if not exists keep_scorer boolean not null default false;
-- More about each shot, all optional: how it was struck, its shape and its flight (a putt's length goes in distance)
alter table shots add column if not exists contact text;
alter table shots add column if not exists shape text;
alter table shots add column if not exists flight text;
alter table shots alter column outcome set default '';
-- The wind on a hole, as the group corrected it (otherwise it comes from the weather)
create table if not exists hole_notes (
  round_id uuid not null references rounds(id) on delete cascade,
  game text not null default 'main',
  hole int not null check (hole between 1 and 27),
  wind text,
  by_name text,
  updated_at timestamptz not null default now(),
  primary key (round_id, game, hole)
);
alter table hole_notes enable row level security;
drop policy if exists read_all on hole_notes;
create policy read_all on hole_notes for select using (not private_round(round_id));
grant select on hole_notes to anon, authenticated;
grant all on hole_notes to service_role;

-- One phone saves only the scores it changed: they're laid over what's there, so two phones never wipe each
-- other's. The hole's other fields (closest to the pin, long drive, a concession) change only when sent.
create or replace function save_hole_scores(p_round uuid, p_game text, p_hole int, p_scores jsonb, p_fields jsonb, p_by text)
returns hole_entries
language plpgsql as $$
declare
  out_row hole_entries;
begin
  insert into hole_entries as h (round_id, game, hole, scores, ctp_winner, ld_winner, conceded, updated_by, updated_at)
  values (p_round, p_game, p_hole, coalesce(p_scores, '{}'::jsonb), p_fields->>'ctp_winner', p_fields->>'ld_winner', p_fields->>'conceded', p_by, now())
  on conflict (round_id, game, hole) do update set
    scores = h.scores || coalesce(excluded.scores, '{}'::jsonb),
    ctp_winner = case when p_fields ? 'ctp_winner' then excluded.ctp_winner else h.ctp_winner end,
    ld_winner = case when p_fields ? 'ld_winner' then excluded.ld_winner else h.ld_winner end,
    conceded = case when p_fields ? 'conceded' then excluded.conceded else h.conceded end,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into out_row;
  return out_row;
end $$;
revoke execute on function save_hole_scores(uuid, text, int, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function save_hole_scores(uuid, text, int, jsonb, jsonb, text) to service_role;

do $$
begin
  if not exists (select 1 from site_settings where key = 'oncourse_backfill') then
    update rounds set keep_scorer = true where status = 'live';
    insert into site_settings (key, value) values ('oncourse_backfill', jsonb_build_object('at', now()));
  end if;
end $$;

notify pgrst, 'reload schema';
