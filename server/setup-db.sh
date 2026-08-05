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
      echo "!! You passed only the transaction-pooler (6543) URL."
      echo "!! Prisma migrations cannot run through pgbouncer in transaction mode. Pass a"
      echo "!! session-mode URL (port 5432) as the second argument."
      echo
    fi

    # Supabase's direct host is IPv6-only unless the project has the IPv4 add-on. On an
    # IPv4-only network that is not slow, it is unroutable — and Prisma reports it as
    # P1001 "Can't reach database server", which reads like a firewall or a typo and
    # sends people looking in entirely the wrong place. Catch it here with the real fix.
    DB_HOST=$(printf '%s' "$DB_URL" | sed -E 's#.*@([^:/?]+).*#\1#')
    if [[ "$DB_HOST" == db.*.supabase.co ]] && ! dig +short A "$DB_HOST" | grep -q .; then
      echo "!! $DB_HOST has no IPv4 address."
      echo "!! Supabase direct connections are IPv6-only without the IPv4 add-on."
      if ! curl -6 -s -m 5 -o /dev/null https://ifconfig.co 2>/dev/null; then
        echo "!! This machine has no IPv6 route, so that host is unreachable from here."
        echo "!!"
        echo "!! Use the SESSION POOLER instead. Supabase dashboard > Project Settings >"
        echo "!! Database > Connection string > Session pooler. It is reachable over IPv4,"
        echo "!! and session mode supports migrations (transaction mode on 6543 does not):"
        echo "!!"
        echo "!!   postgresql://postgres.<ref>:PW@aws-0-<region>.pooler.supabase.com:5432/postgres"
        echo "!!"
        echo "!! Note the username gains the project ref: postgres.<ref>, not postgres."
        exit 1
      fi
      echo "!! This machine does have IPv6, so carrying on."
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
      echo
      echo "This targets the EDB PostgreSQL install at /Library/PostgreSQL/17 and its"
      echo "'postgres' superuser — NOT a Homebrew postgresql@N, which creates a role named"
      echo "after your macOS user instead and has no 'postgres' password at all."
      echo "The password is the one you set in the PostgreSQL 17 installer."
      exit 1
    fi
    export PATH="/Library/PostgreSQL/17/bin:$PATH"
    export PGPASSWORD="$2"

    echo "==> Creating the catsnap database"
    createdb -U postgres -h localhost catsnap 2>/dev/null || echo "    already there, carrying on"

    # URL-encode so a symbol in the password cannot break the connection string.
    ENC_PW=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$2")
    DB_URL="postgresql://postgres:${ENC_PW}@localhost:5432/catsnap"
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

# Skips the Google Vision call so capture works without a billed API key: every photo is
# accepted and scored from stubbed signals. The server refuses to boot in production
# with this on.
VISION_PROVIDER="google"
GOOGLE_VISION_API_KEY=""
VISION_DEV_BYPASS=true

GOOGLE_OAUTH_CLIENT_IDS=""
APPLE_BUNDLE_ID="app.catsnap.client"

# Caption generation. Blank means the built-in template engine (README phase 1). Set both
# to switch to the LLM writer (phase 2); it falls back to templates on any failure.
ANTHROPIC_API_KEY=""
CAPTION_LLM_ENABLED=false

# Photo storage. Leave blank and capture still works — cards show their no-photo state.
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
npx prisma migrate deploy

echo "==> Seeding an open challenge"
# Optional — capture works on an empty database. This just means the Challenges tab is
# not blank before the rotation job's first tick.
npx tsx src/db/seed.ts

echo
echo "Database ready. Start the API with:  cd server && npm run dev"
