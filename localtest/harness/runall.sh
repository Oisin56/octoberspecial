cd /var/tmp/ospg && set -a && . ./keys.env && set +a
run() { echo "== $*"; timeout 900 node "$@" 2>&1 | grep -E "FAIL|ALL PASSED|Error:|TimeoutError" | head -6; }
fresh() { bash restart-app.sh >/dev/null 2>&1; bash fresh.sh; node e2e.mjs | tail -1; }
# tests about films and the player: broadcast clips off, so they see the clips as filmed
nobc() { sleep 3; psql -h 127.0.0.1 -p 5433 -U postgres -qc "update tournaments set broadcast_on=false; update posts set broadcast_status=null, broadcast_path=null, broadcast_render=null"; }
bash fresh.sh; run e2e.mjs
fuser -k 54321/tcp >/dev/null 2>&1; (setsid nohup node stub.mjs > stub.log 2>&1 &); sleep 1
fresh; run oncoursetest.mjs
fresh; run socialtest.mjs
fresh; run cardtest.mjs
fresh; run livetest.mjs
fresh; run multitest.mjs
fresh; run broadcasttest.mjs
fresh; nobc; run phaseetest.mjs; run feedtest.mjs
fresh; run guidetest.mjs; run emailtest.mjs; run resettest.mjs
for t in newstest cleantest; do bash fresh.sh; run $t.mjs; done
for t in trimtest orgtest; do fresh; run $t.mjs; done
for t in phaseatest; do fresh; run $t.mjs; done
for t in phasebtest; do fresh; run $t.mjs; done
for t in phasectest; do fresh; run $t.mjs; done
for t in phasedtest; do fresh; run $t.mjs; done
for t in phaseftest; do fresh; run $t.mjs; done
# the set-up redesign: every kind of tournament end to end, and the course research in the background
for t in setupwalk researchtest; do fresh; run $t.mjs; done
# sign-in: emails and codes, My golf, co-organisers, one-use player links, the owner's second check
for t in signintest; do fresh; run $t.mjs; done
# who can watch: private tournaments locked everywhere, asking to follow, followers
for t in privacytest; do fresh; run $t.mjs; done
# the console: the owner and support staff, Needs you, money, the activity record, exports
for t in consoletest emailsteptest; do fresh; run $t.mjs; done
for t in sampletest; do fresh; run $t.mjs; done
# the sample film's commentary and sound, with the voice stand-in on; then the app back to normal
voice() { ps -eo pid,comm | awk '$2 ~ /^next-server/ {print $1}' | xargs -r kill; sleep 1; VOICE=1 bash startapp.sh; sleep 6; bash fresh.sh; node e2e.mjs | tail -1; }
voice; run ownersample.mjs; run filmaudio.mjs
bash restart-app.sh >/dev/null 2>&1
