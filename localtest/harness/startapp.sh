#!/bin/bash
# Start the built app on :3100. VOICE=1 adds the stand-in voice service.
cd /home/claude/october-special
EXTRA=""
[ "$VOICE" = "1" ] && EXTRA="ELEVENLABS_API_KEY=stubkey ELEVENLABS_BASE_URL=http://127.0.0.1:54321"
(set -a; . /var/tmp/ospg/keys.env; env $EXTRA ANTHROPIC_BASE_URL=http://127.0.0.1:54321 setsid nohup npx next start -p 3100 > /var/tmp/ospg/app.log 2>&1 < /dev/null & disown)
