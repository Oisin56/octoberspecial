cd /var/tmp/ospg && set -a && . ./keys.env && set +a
fuser -k 54321/tcp >/dev/null 2>&1; (setsid nohup node stub.mjs > stub.log 2>&1 &); sleep 1
bash restart-app.sh >/dev/null 2>&1; bash fresh.sh; node e2e.mjs | tail -1
for t in "$@"; do echo "== $t"; timeout 900 node $t 2>&1 | grep -v '^PASS' | tail -25; done
