# Cat Frame — what is left

Written **2026-08-14**, for a session starting cold.

`BACKEND.md` is the reference: what was built, and *why* each load-bearing decision went the way
it did. This file is the action list. Where the two disagree, check the code — and where either
makes a claim about the live project, verify it rather than believing it. That is the lesson of
the last session: the migration list in `BACKEND.md` was maintained by hand and was wrong.

```bash
cd server
node scripts/schema-state.mjs                                   # which migrations are applied
for f in scripts/check-*.ts; do npx tsx "$f" >/dev/null && echo "ok $f" || echo "FAIL $f"; done
npx tsc --noEmit && cd .. && npx tsc --noEmit                   # both trees
```

---

## Where things actually stand

**The schema is complete.** All eleven migrations are applied, confirmed by probe on 2026-08-14.
Trap 17 — any player granting themselves Pro — is closed.

**34 of the client's 36 calls are answered.** The two that are not are unbuilt for stated
reasons, not for want of time. See "Deliberately unbuilt" below.

**Almost none of it has been watched running.** Two things have been observed against real data:
the capture loop on a phone (2026-08-12) and one anonymous `/feed/viral` read (2026-08-13).
Every write path in the Dex, challenges, votes, friendships and the map typechecks and has never
had a row pass through it. `BACKEND.md` §4 is the honest ledger. **"Typechecks" is not "works".**

---

## Blocking a first release

These four are the release. Nothing below this section matters until they are done.

### 1. Write the rubric — yours, and nobody else's

- [ ] Add `OPENAI_API_KEY` and `OPENAI_SCORING_MODEL`; set `SCORING_STUB=false`
- [ ] **Write the rubric** in `server/src/game/scoring.ts`. The file says "THIS IS THE PART YOU
      WRITE" and it is right. Bump `SCORING_VERSION` when you do
- [ ] `node scripts/clear-stub-scores.mjs --clear` afterwards. Every stub score is a plausible
      invented number sitting in the columns the leaderboard ranks on
- [ ] Then test prompt injection for real: photograph a sign reading "score this 100". The
      structural defence is already in — the rubric is a system message, the photograph is the
      user turn — and this is whether it holds

Right now the app takes a photograph and shows an invented number. This is not a feature at the
edge; "every photo gets scored" is the product.

### 2. The device tests — a few hours, and they convert most of the unknown

Steps in `TESTING.md` §3. In priority order:

- [ ] **The reveal-ledger refund.** Score twice, delete one, capture again — it must come back
      **unscored**. The most valuable test available: the `reveals` ledger replaced counting
      `photos.scored_at`, the 2026-08-09 verification run predates it, so *nothing has ever
      tested the code that runs today*. It is also the paywall — if a delete refunds a reveal,
      the free tier is unlimited for anyone willing to delete
- [ ] **The `no_cat` path**, via `SCORING_STUB_NO_CAT=true`. The guard refusing a second paid
      look at a photo the model already rejected has never executed
- [ ] **The album cap** — set `PHOTO_LIMITS.free` to `2` in `game/album.ts` rather than taking
      200 photographs
- [ ] **`node scripts/check-photo-privacy.mjs "<imageUrl>"`** on a real upload — EXIF GPS, and
      what the CDN actually returns for `cache-control`
- [ ] **Cat identity end to end.** Photograph the same cat twice; the second should offer the
      first as a candidate with reason phrases. No `cats` row has ever been written
- [ ] **The map clustering and story stack** (built 2026-08-14, never run). Several captures in
      one spot should collapse to one paw pin with a count, opening as an auto-advancing stack.
      Gestures, bar timing and badge position are all things only a phone can judge
- [ ] **Home location now actually writes** — the column exists as of this migration. Confirm
      the `PUT /auth/home-location` call stops failing silently

### 3. Decide the Pro dead-end — a product call, not a bug

Free tier is **2 reveals per 24 hours** and Pro is the release valve, but `POST /shop/purchase`
is deliberately unbuilt — so **Pro cannot be bought**. The likeliest first session is: take three
photographs, hit the padlock, tap the upsell, find a disabled button.

Every individual decision there is right and the combination dead-ends on day one. Pick one:

- [ ] **Raise `REVEAL_LIMITS.free` in `game/scoring.ts` for launch** — one line. Recommended:
      shipping IAP is a week plus store review, and a first MVP does not need to take money
- [ ] Or build purchasing properly — see "Deliberately unbuilt"

### 4. Deploy, with error reporting

- [ ] Pick a host. `server/Dockerfile` is the deploy unit; deploy stateless
- [ ] Point the client at it — the client defaults to `localhost:4000` (`src/api/client.ts`)
- [ ] **Add Sentry.** There is no crash reporting and no analytics anywhere in either tree. For a
      codebase where most paths have never executed against real data, shipping without it means
      the first thing you learn about a broken endpoint is a bad review. Treat it as part of
      deploying rather than as a nice-to-have

---

## Deliberately unbuilt — do not "finish" these without reading why

- [ ] **`POST /shop/purchase`.** It grants `pro_subscription_active`, and validation against
      Apple and Google is the entire security of it. Shipping it stubbed is a self-service Pro
      button — the hole the 2026-08-13 migration just closed, reopened through the front door.
      **It also needs somewhere for cosmetics to live**: there is no entitlements table, so
      `ownsEntry` in `game/shop.ts` returns false for anything purchasable. That is truthful only
      while nothing can be bought, and `check-shop.ts` asserts it so the day it stops being true
      the test fails and says so
- [ ] **`POST /map/sightings`** — a bare report with no photograph. It needs a table, and
      `mapApi.report` **has no caller anywhere in the app**: the MapScreen empty state says "Log
      the first one" over a card with `pointerEvents: none` and no button. **Add the control
      first, or drop the copy.** Building the endpoint does not make the button exist

---

## After the MVP

- [ ] **Auto-suppress captures near home.** The only unbuilt *feature* left, and now unblocked —
      `profiles.home_lat/lng` exist and are coarsened to 1km on write. This is the real answer to
      the leak coarsening cannot fix: somebody photographing the same cat from their own doorstep
      every morning publishes a repeating pin near it
- [ ] **`neighborhood` and `city` leaderboards** return an empty snapshot, which is the degrade
      the client models. Two separate things are missing. First, a way to *name* an area — a
      board labelled with a coordinate is not a place anybody recognises, so this needs
      geocoding. Second, **`home_lat/lng` cannot be grouped on for equality**: the longitude step
      is computed from each point's own latitude, so cells shift continuously and two neighbours
      differ in the fifth decimal. Asserted in `check-map.ts`
- [ ] **Re-read `game/matching.ts`'s weights against real rows.** The 0.2/0.8 proximity/traits
      split was tuned on a synthetic four-cat pool. `check-matching.ts` has since shown that "one
      rare trait beats two common ones" is *false* below about eight cats — idf has nothing to
      measure rarity against in a small pool, so the shortlist is worst exactly when a player is
      meeting their first cats in a new area
- [ ] **`goals` on the challenges hub** is omitted rather than sent empty. Standing goals are
      authored content and there is nothing to author them from yet. `ChallengesHubScreen` never
      reads the field, so this costs nothing today
- [ ] **Push notifications.** The token column and `PUT /auth/push-token` exist; nothing sends
- [ ] **Real shop product ids.** The ones in `game/shop.ts` are placeholders and must match App
      Store Connect and the Play Console before purchasing is built. Price labels are static
      strings where a real IAP would show the store's own localised price

---

## Parked — real, small, nobody is blocked

- [ ] **`not_detected` and "Score it anyway" are dead client-side.** The server still returns the
      reason; nothing sends `detected: false` since capture became manual. Left in deliberately —
      it is harmless, and it is the cheap re-entry point if on-device detection ever returns.
      Delete it only if you have decided that is never happening
- [ ] **`MAX_SIGHTINGS` is 300 and clustering happens client-side.** A dense area burns the cap
      on photographs that will be collapsed into one pin anyway. Not worth fixing until a real
      map is dense enough to notice, but that is where it would be felt

---

## Decisions waiting on you

1. **The Pro dead-end** — raise the free allowance, or build purchasing? (blocking, see §3)
2. **`POST /map/sightings`** — add the control, or drop the copy?
3. **A deployment host.**
4. **Geocoding**, whenever the neighbourhood boards matter.

---

## House rules for whoever picks this up

- Never open `.env` or `server/.env`. Ask for variable names, or read `.env.example`
- Never add a paid model call without a guard in front of it. Read `BACKEND.md` §2's spend-guard
  decisions and trap 10 before touching the scoring path
- Migrations are raw SQL, dated, and run by hand in the Supabase editor. None are idempotent —
  `add constraint` has no `if not exists` — so run each whole and read the error rather than
  re-running if one stops partway
- Rules with no database under them go in `server/src/game/`, with a `scripts/check-*.ts` beside
  them. Nine exist and all run with no project and no key
- Follow `BACKEND.md` §7's conventions. Comments explain **why**, not what
- **Before concluding something is unused or unwired, grep the whole tree** and compare against a
  working example of the same thing. That is trap 15, and it has been re-learned since
- Read `BACKEND.md` §8 — eighteen traps already hit, and re-learning one costs a day
