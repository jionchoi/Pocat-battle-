#!/usr/bin/env bash
# Point .env at a Supabase project and prove the connection works.
#
#   ./connect-supabase.sh <PROJECT_REF> '<DB_PASSWORD>' [REGION]
#
# Example:
#   ./connect-supabase.sh abcdefghijklmnopqrst 'my-password' us-west-1
#
# Uses the POOLER hostname, not db.<ref>.supabase.co — the direct host is IPv6-only on the
# free tier and unreachable from most networks.
#   6543 = transaction pooler, used by the app
#   5432 = session pooler,     used by migrations (they cannot run through pgbouncer)

set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 2 ]; then
  cat <<'USAGE'
Usage: ./connect-supabase.sh <PROJECT_REF> '<DB_PASSWORD>' [REGION]

  PROJECT_REF   20-char id from your dashboard URL:
                https://supabase.com/dashboard/project/THIS_PART
  DB_PASSWORD   Settings > Database > Reset database password
  REGION        defaults to us-west-1
USAGE
  exit 1
fi

REF="$1"
PW="$2"
REGION="${3:-us-west-1}"

if ! printf '%s' "$REF" | grep -qE '^[a-z0-9]{15,25}$'; then
  echo "!! '$REF' does not look like a project ref (expected ~20 lowercase letters/digits)."
  echo "   Take it from the dashboard URL: /dashboard/project/<REF>"
  exit 1
fi

# URL-encode so symbols in the password cannot break the connection string.
ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PW")

HOST="aws-0-${REGION}.pooler.supabase.com"
POOLED="postgresql://postgres.${REF}:${ENC}@${HOST}:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT="postgresql://postgres.${REF}:${ENC}@${HOST}:5432/postgres"

python3 - "$POOLED" "$DIRECT" <<'PY'
import re, sys
pooled, direct = sys.argv[1], sys.argv[2]
p = '.env'
s = open(p).read()
s = re.sub(r'^DATABASE_URL=.*$', 'DATABASE_URL="%s"' % pooled, s, flags=re.M)
s = re.sub(r'^DIRECT_URL=.*$',   'DIRECT_URL="%s"'   % direct, s, flags=re.M)
open(p, 'w').write(s)
PY

echo "==> .env updated: ref=${REF} region=${REGION}"
echo "==> Testing the session pooler (5432) that migrations use..."

export PATH="/Library/PostgreSQL/17/bin:$PATH"

if PGCONNECT_TIMEOUT=12 psql "$DIRECT" -c "select 1;" >/dev/null 2>&1; then
  echo "    connected"
else
  echo "    FAILED. Error:"
  PGCONNECT_TIMEOUT=12 psql "$DIRECT" -c "select 1;" 2>&1 | head -3 | sed 's/^/       /'
  echo
  echo "    'Tenant or user not found'      -> wrong ref, or wrong region for this project"
  echo "    'password authentication failed'-> reset it: Settings > Database > Reset database password"
  exit 1
fi

echo
echo "==> Next:"
echo "    npx prisma migrate dev --name init"
echo "    npx tsx src/db/seed.ts"
echo "    npm run dev"
