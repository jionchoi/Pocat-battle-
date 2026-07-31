#!/usr/bin/env bash
# One-shot database setup for testing. Safe to re-run.
#
# Supabase (matches the production architecture):
#   ./setup-db.sh --supabase 'postgresql://postgres.xxx:PW@aws-0-region.pooler.supabase.com:6543/postgres' \
#                            'postgresql://postgres.xxx:PW@aws-0-region.pooler.supabase.com:5432/postgres'
#
# Local Postgres (fastest, no signup — identical code path):
#   ./setup-db.sh --local 'your-postgres-password'
#
# Node only ever sees a connection string. Supabase's auto-generated API and Row Level
# Security are deliberately unused (README section 2a), so both modes are the same code.

set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-}"

case "$MODE" in
  --supabase)
    if [ $# -lt 2 ]; then
      echo "Usage: ./setup-db.sh --supabase '<pooled-url>' ['<direct-url>']"
      echo
      echo "Find both in Supabase: Project Settings > Database > Connection string."
      echo "  pooled  = port 6543 (Transaction mode) — used by the app"
      echo "  direct  = port 5432 (Session mode)     — used by migrations"
      exit 1
    fi
    DB_URL="$2"
    # Migrations cannot run through pgbouncer, so they need the direct connection.
    DIRECT="${3:-$2}"

    if [ "$DIRECT" = "$DB_URL" ] && [[ "$DB_URL" == *":6543"* ]]; then
      echo "!! You passed only the pooled (6543) URL."
      echo "!! Prisma migrations fail through pgbouncer. Pass the direct 5432 URL as the"
      echo "!! second argument, or migrations below will error."
      echo
    fi

    # Prisma needs this flag to behave against a transaction-mode pooler.
    if [[ "$DB_URL" == *":6543"* && "$DB_URL" != *"pgbouncer=true"* ]]; then
      SEP="?"; [[ "$DB_URL" == *"?"* ]] && SEP="&"
      DB_URL="${DB_URL}${SEP}pgbouncer=true&connection_limit=1"
    fi
    ;;

  --local)
    if [ $# -lt 2 ]; then
      echo "Usage: ./setup-db.sh --local 'your-postgres-password'"
      echo "(the password you set when installing PostgreSQL 17)"
      exit 1
    fi
    export PATH="/Library/PostgreSQL/17/bin:$PATH"
    export PGPASSWORD="$2"

    echo "==> Creating the pawgo database"
    createdb -U postgres -h localhost pawgo 2>/dev/null || echo "    already there, carrying on"

    # URL-encode so a symbol in the password cannot break the connection string.
    ENC_PW=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$2")
    DB_URL="postgresql://postgres:${ENC_PW}@localhost:5432/pawgo"
    DIRECT="$DB_URL"
    ;;

  *)
    echo "Usage:"
    echo "  ./setup-db.sh --supabase '<pooled-url>' '<direct-url>'"
    echo "  ./setup-db.sh --local    'your-postgres-password'"
    exit 1
    ;;
esac

echo "==> Writing server/.env"
cat > .env <<EOF
DATABASE_URL="${DB_URL}"
DIRECT_URL="${DIRECT}"

PORT=4000
NODE_ENV=development

# Local-only test secrets. Generate real ones for anything deployed:
#   openssl rand -base64 48
JWT_ACCESS_SECRET="local-dev-access-secret-not-for-production-01"
JWT_REFRESH_SECRET="local-dev-refresh-secret-not-for-production-1"
ACCESS_TOKEN_TTL="15m"
REFRESH_TOKEN_TTL_DAYS=30

# No Redis locally — the server falls back to an in-process store, correct for one
# instance. Production refuses to boot without a real REDIS_URL.
REDIS_URL=""

# Skips the Google Vision call so catching works without a billed API key: every photo is
# accepted as a real cat. The server refuses to boot in production with this on.
VISION_PROVIDER="google"
GOOGLE_VISION_API_KEY=""
VISION_DEV_BYPASS=true

GOOGLE_OAUTH_CLIENT_IDS=""
APPLE_BUNDLE_ID="app.pawgo.client"

# Photo storage. Leave blank and catches still work — cards show their no-photo state.
# To switch it on, add your Supabase project URL and service role key and make a public
# "cat-photos" bucket. The key is server-side only; the app never receives it.
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_BUCKET="cat-photos"
PHOTO_CDN_BASE_URL=""

APPLE_SHARED_SECRET=""
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=""
EXPO_ACCESS_TOKEN=""
SENTRY_DSN=""
EOF

echo "==> Generating the Prisma client"
npx prisma generate >/dev/null

echo "==> Applying migrations"
npx prisma migrate dev --name init --skip-generate

echo "==> Seeding abilities and towers"
# Not optional: catching throws without ability rows, and the map has nothing to challenge
# without towers.
npx tsx src/db/seed.ts

echo
echo "Database ready. Start the API with:  cd server && npm run dev"
