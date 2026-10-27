#!/bin/bash
# Builds the local test environment from nothing: a database standing in for Supabase, a stand-in for the
# outside services (Claude, voice, video, golf course data, storage) and a test mailbox. Safe to re-run:
# each step skips what is already there.
#
#   bash localtest/setup.sh
#
# Linux only for now (the cloud workspace). Needs Postgres 16, ffmpeg, Node 22 and Python 3 with Pillow.
# Everything it makes lives in /var/tmp/ospg; the scripts there are links back to this folder, so edit them here.
set -euo pipefail

L="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$L/.." && pwd)"
WORK=/var/tmp/ospg
PG=/usr/lib/postgresql/16/bin
PSQL="psql -h 127.0.0.1 -p 5433 -U postgres -q"
say() { printf '\n== %s\n' "$*"; }

say "Checking tools"
missing=""
[ -x "$PG/pg_ctl" ] || missing="$missing postgresql-16"
command -v ffmpeg >/dev/null || missing="$missing ffmpeg"
command -v node >/dev/null || missing="$missing node"
python3 -c "import PIL" 2>/dev/null || missing="$missing python3-pil"
if [ -n "$missing" ]; then echo "Install first:$missing"; exit 1; fi

# The test scripts name the project by its path in the workspace; make that path work wherever it was cloned
if [ "$REPO" != /home/claude/october-special ] && [ ! -e /home/claude/october-special ]; then
  mkdir -p /home/claude && ln -s "$REPO" /home/claude/october-special
fi

say "Packages"
[ -d "$REPO/node_modules" ] || (cd "$REPO" && npm ci)
[ -d "$L/harness/smtp/node_modules" ] || (cd "$L/harness/smtp" && npm install --silent)

say "Workspace $WORK"
mkdir -p "$WORK"/{files/golfapi,files/video,social,vid,shots,mail,testvid}
chown postgres "$WORK" 2>/dev/null || true

# Links back to this folder: tests, tools and the harness
for f in "$L"/tests/*.mjs "$L"/tools/* "$L"/harness/*.sh "$L"/harness/*.mjs "$L"/harness/*.sql; do ln -sfn "$f" "$WORK/$(basename "$f")"; done
ln -sfn "$L/harness/smtp" "$WORK/smtp"
find "$WORK" -maxdepth 1 -xtype l -delete   # links to scripts that have since been removed
cp -r "$L"/fixtures/golfapi/. "$WORK/files/golfapi/"
cp --update=none "$L"/fixtures/social/* "$WORK/social/"
cp "$L"/fixtures/files/still.jpg "$WORK/files/still.jpg"
cp --update=none "$L"/fixtures/film.webm "$WORK/vid/film.webm"

say "PostgREST (the Supabase data API)"
if [ ! -x "$WORK/postgrest" ]; then
  curl -sSL -o "$WORK/pgrst.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xJf "$WORK/pgrst.tar.xz" -C "$WORK"
fi

say "Local keys (made up here, used only by the test environment)"
if [ ! -f "$WORK/keys.env" ] || [ ! -f "$REPO/.env.local" ] || [ ! -f "$WORK/pgrst.conf" ]; then
  [ -f "$REPO/.env.local" ] && cp "$REPO/.env.local" "$REPO/.env.local.bak-$(date +%s)"
  node --input-type=module - "$WORK" "$REPO" <<'JS'
import { randomBytes, createHmac } from "node:crypto";
import fs from "node:fs";
const [work, repo] = process.argv.slice(2);
const secret = randomBytes(32).toString("hex");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role, iss: "local", iat: 1700000000, exp: 4100000000 });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const ANON = jwt("anon"), SERVICE = jwt("service_role");
const STUB = "http://127.0.0.1:54321";
fs.writeFileSync(`${work}/pgrst.conf`, `db-uri = "postgres://authenticator:auth@127.0.0.1:5433/postgres"\ndb-schemas = "public,storage"\ndb-anon-role = "anon"\njwt-secret = "${secret}"\nserver-port = 3000\n`);
fs.writeFileSync(`${work}/keys.env`, `ANON=${ANON}\nSERVICE=${SERVICE}\nSMTP_HOST=127.0.0.1\nSMTP_PORT=2525\nSMTP_USER=me@test.ie\nSMTP_PASS=app-pass\n`);
fs.writeFileSync(`${repo}/.env.local`, [
  "# Local test environment only: every service points at the stand-ins on this machine.",
  `NEXT_PUBLIC_SUPABASE_URL=${STUB}`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}`, `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}`,
  `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
  // the tests log in as the site owner with 1234 and try the old caddie login with 5555
  "ORGANISER_PIN=1234", "ORGANISER_PLAYER_ID=oisin", "CONTRIBUTOR_PIN=5555",
  "ANTHROPIC_API_KEY=local-stub", `ANTHROPIC_BASE_URL=${STUB}`,
  "SHOTSTACK_API_KEY=local-stub", `SHOTSTACK_BASE_URL=${STUB}/edit/stage`,
  "ELEVENLABS_API_KEY=local-stub", `ELEVENLABS_BASE_URL=${STUB}`,
  "GEMINI_API_KEY=local-stub", `GEMINI_BASE_URL=${STUB}/v1beta`,
  "SMTP_HOST=127.0.0.1", "SMTP_PORT=2525", "SMTP_USER=me@test.ie", "SMTP_PASS=app-pass", // the test mailbox's login
  "OWNER_EMAIL=owner@test.ie", // the site owner signs in with this email (the PIN works until they have)
  "CRON_SECRET=local-cron-secret", // made up: the daily jobs only run when this is sent
  "POSTMARK_TOKEN=local-postmark-token", "POSTMARK_API_URL=http://127.0.0.1:54321/postmark", // made up: the Postmark stand-in
  "GOLFAPI_KEY=local-stub", `GOLFAPI_BASE_URL=${STUB}/golfapi`, "",
].join("\n"));
console.log("new local keys written");
JS
fi

say "Database"
if [ ! -f "$WORK/data/PG_VERSION" ]; then
  mkdir -p "$WORK/data" && chown postgres "$WORK/data"
  su postgres -c "$PG/initdb -D $WORK/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
  echo "timezone = 'Europe/Dublin'" >> "$WORK/data/postgresql.conf"
fi
su postgres -c "$PG/pg_ctl -D $WORK/data -o '-p 5433 -c wal_level=logical' -l $WORK/log start" >/dev/null 2>&1 || true
for i in $(seq 1 20); do $PSQL -c "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
export PGOPTIONS="-c client_min_messages=warning"
$PSQL -f "$L/harness/bootstrap.sql"
$PSQL -f "$REPO/supabase/schema.sql" >/dev/null
unset PGOPTIONS
bash "$WORK/fresh.sh"

say "Test videos"
bash "$L/fixtures.sh"

say "Building the app"
(cd "$REPO" && npm run build >"$WORK/build.log" 2>&1) || { echo "Build failed: see $WORK/build.log"; exit 1; }

say "Starting the stand-ins and the app"
bash "$WORK/up.sh"
bash "$WORK/restart-app.sh"
echo
echo "Ready. Run everything:  bash /var/tmp/ospg/runall.sh"
echo "Run one or two:        bash /var/tmp/ospg/one.sh sampletest.mjs"
