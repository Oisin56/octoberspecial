cd /home/claude/october-special && psql -h 127.0.0.1 -p 5433 -U postgres -qc "truncate tournaments cascade" 2>/dev/null && psql -h 127.0.0.1 -p 5433 -U postgres -q -f supabase/seed.sql >/dev/null
