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
alter table tournaments add column if not exists theme text not null default 'clubhouse';
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
alter table rounds add column if not exists course_guide jsonb;     -- {overview, signature, holes:{"1":note}} for the AI writer
alter table rounds add column if not exists course_blurb text;
alter table rounds add column if not exists lat double precision;
alter table rounds add column if not exists lon double precision;

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

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) <= 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

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

drop policy if exists read_all on rounds;
create policy read_all on rounds for select using (true);
drop policy if exists read_all on hole_entries;
create policy read_all on hole_entries for select using (true);
drop policy if exists read_all on attestations;
create policy read_all on attestations for select using (true);
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
drop view if exists public_tournaments;
create view public_tournaments with (security_invoker = false) as
  select id, slug, name, subtitle, start_date, end_date, theme, custom_colors, logo_path, hero_path, tone,
         side_games, side_games_by, teams, auto_bulletins, video_enabled, organiser_player_id, published, created_at, reel_music_path
  from tournaments;
grant select on public_tournaments to anon, authenticated;

drop policy if exists read_all on players;
revoke select on players from anon, authenticated;
drop view if exists public_players;
create view public_players with (security_invoker = false) as
  select id, tournament_id, name, nickname, handicap, home_club, bio, best_club,
         worst_club, weakness, quote, photo_path, sort, team_id
  from players;
grant select on public_players to anon, authenticated;

-- ------------------------------------------------------------ realtime
do $$
begin
  begin alter publication supabase_realtime add table hole_entries; exception when others then null; end;
  begin alter publication supabase_realtime add table posts; exception when others then null; end;
  begin alter publication supabase_realtime add table comments; exception when others then null; end;
  begin alter publication supabase_realtime add table ai_pieces; exception when others then null; end;
  begin alter publication supabase_realtime add table rounds; exception when others then null; end;
  begin alter publication supabase_realtime add table attestations; exception when others then null; end;
  begin alter publication supabase_realtime add table votes; exception when others then null; end;
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

-- ------------------------------------------------------------ access (explicit, for projects that don't grant by default)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant select on rounds, hole_entries, attestations, posts, comments, ai_pieces, votes to anon, authenticated;
grant select on public_tournaments, public_players to anon, authenticated;
revoke all on reels from anon, authenticated;

-- Tell the API about the new tables straight away
notify pgrst, 'reload schema';
