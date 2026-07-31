#!/usr/bin/env bash
# Boot an iOS simulator, give it a GPS fix, and start the API.
#
#   ./run-test.sh                      # London (default seed location)
#   ./run-test.sh 37.5665 126.9780     # Seoul — also seeds sightings there
#
# The GPS fix is not optional: capture is rejected with `location-required` without one,
# because a photo with no coordinates cannot be matched to a cat or scored for rarity.
#
# Leaves the API running in this terminal. Start the app in a second one with `npm start`.

set -euo pipefail
cd "$(dirname "$0")"

LAT="${1:-51.5074}"
LNG="${2:--0.1278}"
DEVICE="${SIM_DEVICE:-iPhone 15 Pro}"

echo "==> Target location: $LAT, $LNG"

# Only reseed when a location was passed, so a plain run never rewrites your data.
# Sightings only seed once an account exists — sign up first, then re-run.
if [ $# -ge 2 ]; then
  echo "==> Seeding a challenge and sightings around $LAT, $LNG"
  ( cd server && SEED_LAT="$LAT" SEED_LNG="$LNG" npm run db:seed )
fi

echo "==> Booting simulator: $DEVICE"
UDID=$(xcrun simctl list devices available \
  | grep -F "$DEVICE (" | head -1 | grep -oE '[0-9A-F-]{36}' || true)

if [ -z "$UDID" ]; then
  echo "!! No simulator named '$DEVICE'. Available iPhones:"
  xcrun simctl list devices available | grep -E "iPhone" | sed 's/^/   /'
  exit 1
fi

STATE=$(xcrun simctl list devices | grep "$UDID" | grep -oE '\((Booted|Shutdown)\)' | tr -d '()')
if [ "$STATE" != "Booted" ]; then
  xcrun simctl boot "$UDID"
  # The location command is rejected until the device finishes booting.
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
fi
open -a Simulator

echo "==> Setting simulated location"
xcrun simctl location "$UDID" set "$LAT,$LNG"

echo
echo "==> Starting the API on :4000  (Ctrl-C to stop)"
echo "    In a second terminal:  npm start   then press i"
echo
cd server && npm run dev
