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
create view public_tournaments with (security_invoker = false) as
  select id, slug, name, subtitle, start_date, end_date, theme, custom_colors, logo_path, hero_path, tone,
         side_games, side_games_by, teams, auto_bulletins, video_enabled, organiser_player_id, published, created_at, reel_music_path,
         require_attestation, broadcast_on, broadcast_cap_cents, standings, feed_on, ai_on, setup_jobs, units, share_shape, win, prizes,
         privacy, players_need_email
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

notify pgrst, 'reload schema';
