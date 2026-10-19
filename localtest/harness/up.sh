#!/bin/bash
# Bring up the local stand-ins: Postgres, PostgREST, storage/Claude stub
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/ospg/data -o '-p 5433 -c wal_level=logical' -l /var/tmp/ospg/log start" >/dev/null 2>&1
sleep 2
cd /var/tmp/ospg
(fuser 3000/tcp >/dev/null 2>&1) || (nohup ./postgrest pgrst.conf > pgrst.log 2>&1 &)
(fuser 54321/tcp >/dev/null 2>&1) || (nohup node stub.mjs > stub.log 2>&1 &)
(fuser 2525/tcp >/dev/null 2>&1) || (nohup node smtp/server.mjs > smtp.log 2>&1 &)
sleep 2
psql -h 127.0.0.1 -p 5433 -U postgres -qtc "select 'db ok: ' || count(*) || ' tournaments' from tournaments"
