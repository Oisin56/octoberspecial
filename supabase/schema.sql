-- October Special — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it only creates what's missing.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ tables

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  subtitle text,
  ctp_points int not null default 10,
  ld_points int not null default 10,
  gir_points int not null default 20,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id text primary key,                       -- short slug, e.g. 'oisin'
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
  pin_hash text,                             -- never exposed publicly
  sort int not null default 0
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number int not null,
  course_slug text not null,
  course_name text not null,
  play_date date,
  tee_time text,
  tee text,
  format text not null check (format in ('stableford','stroke','match')),
  nine_points int not null default 10,
  full_points int not null,
  shots jsonb not null default '{}'::jsonb,  -- { "oisin": 0, "neil": 3 }
  holes jsonb not null,                      -- [{number,par,si,yards}]
  scorer_id text references players(id),
  status text not null default 'upcoming' check (status in ('upcoming','live','complete')),
  unique (tournament_id, number)
);

create table if not exists hole_entries (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  scores jsonb not null default '{}'::jsonb, -- { "oisin": {gross, pickedUp, gir} }
  ctp_winner text,
  ld_winner text,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (round_id, hole)
);

create table if not exists attestations (
  round_id uuid not null references rounds(id) on delete cascade,
  segment text not null check (segment in ('front','back')),
  player_id text not null references players(id),
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

create index if not exists posts_t_idx on posts (tournament_id, created_at desc);
create index if not exists comments_t_idx on comments (tournament_id, created_at desc);
create index if not exists ai_t_idx on ai_pieces (tournament_id, created_at desc);
create index if not exists hole_entries_round_idx on hole_entries (round_id);
-- One automatic bulletin per moment, even if saves arrive at the same time
create unique index if not exists ai_auto_trigger_uniq on ai_pieces (round_id, kind, trigger)
  where trigger is not null and trigger not like 'manual%';

-- ------------------------------------------------------------ security
-- Everyone (followers, no login) can READ public data.
-- All WRITES go through the website's server using the service key,
-- which checks PINs first. So no insert/update policies for anon.

alter table tournaments enable row level security;
alter table players enable row level security;
alter table rounds enable row level security;
alter table hole_entries enable row level security;
alter table attestations enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table ai_pieces enable row level security;

drop policy if exists read_all on tournaments;
create policy read_all on tournaments for select using (true);
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

-- players: hide pin_hash from the public by exposing a view instead
drop policy if exists read_all on players;
revoke select on players from anon, authenticated;
create or replace view public_players with (security_invoker = false) as
  select id, tournament_id, name, nickname, handicap, home_club, bio, best_club,
         worst_club, weakness, quote, photo_path, sort
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
end $$;

-- ------------------------------------------------------------ storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)  -- 50 MB per file (Supabase free plan max)
on conflict (id) do update set public = true, file_size_limit = 52428800;
