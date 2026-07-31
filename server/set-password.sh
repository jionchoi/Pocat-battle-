#!/usr/bin/env bash
# Put your Supabase database password into .env and verify it actually connects.
#
#   ./set-password.sh 'your-db-password'
#
# Project ref and region are already filled in. This only fills the password, then proves
# the connection works before you waste time on migrations.

set -euo pipefail
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
  echo "Usage: ./set-password.sh 'your-db-password'"
  echo
  echo "Get it from Supabase: Project Settings > Database > Reset database password."
  echo "(The original is only shown once at project creation.)"
  exit 1
fi

PW="$1"
# URL-encode so a symbol in the password cannot break the connection string.
ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PW")

python3 - "$ENC" <<'PY'
import re, sys
enc = sys.argv[1]
p = '.env'
s = open(p).read()
s = re.sub(r'(postgresql://postgres\.[a-z0-9]+:)[^@]*(@)', r'\1' + enc + r'\2', s)
open(p, 'w').write(s)
PY

echo "==> Password written. Testing the direct (5432) connection used by migrations..."

export PATH="/Library/PostgreSQL/17/bin:$PATH"
DIRECT=$(grep -E '^DIRECT_URL=' .env | sed -E 's/^DIRECT_URL="?//; s/"?$//')

if PGCONNECT_TIMEOUT=10 psql "$DIRECT" -c "select 'connected' as status;" >/dev/null 2>&1; then
  echo "    ✅ connected"
else
  echo "    ❌ could not connect. Full error:"
  PGCONNECT_TIMEOUT=10 psql "$DIRECT" -c "select 1;" 2>&1 | head -3 | sed 's/^/       /'
  echo
  echo "    If it says 'password authentication failed', reset the password in Supabase:"
  echo "    Project Settings > Database > Reset database password, then re-run this."
  exit 1
fi

echo
echo "==> Next:"
echo "    npx prisma migrate dev --name init"
echo "    npx tsx src/db/seed.ts"
echo "    npm run dev"
