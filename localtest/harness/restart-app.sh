ps -eo pid,comm | awk '$2 ~ /^next-server/ {print $1}' | xargs -r kill
sleep 1
cd /home/claude/october-special && (set -a; . /var/tmp/ospg/keys.env; ANTHROPIC_BASE_URL=http://127.0.0.1:54321 nohup npx next start -p 3100 > /var/tmp/ospg/app.log 2>&1 &)
sleep 4
