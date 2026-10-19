-- The parts of a Supabase project that schema.sql expects to find already there:
-- the API roles, the storage schema (just the buckets table) and the realtime publication.
-- Run once on a new local database, before supabase/schema.sql.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'auth'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint
);

do $$ begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;

-- As on Supabase, the server's role can use every table, including ones created later in schema.sql
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
