# Testing Cat Frame

Last rewritten: **2026-08-13**

This file used to describe a backend that was deleted on 2026-08-07. It told you to run
`npx prisma studio`, `npm run db:seed` and `npm run curate`, to set `VISION_DEV_BYPASS`, and to
test challenges, leaderboards, feed and shop through a seeding script. None of that existed any
more, and `run-test.sh` — which is now deleted — was the same story in shell.

What follows is what can actually be run today, and what still cannot.

---

## 1. The checks that need nothing

Nine scripts, no database, no API key, no network. Each exits non-zero on failure, so they work
in a pipeline as well as by eye.

```bash
cd server

npx tsx scripts/check-scoring.ts       # the strict-output contract and the spend numbers
npx tsx scripts/check-matching.ts      # ranking, trait rarity, the identify body
npx tsx scripts/check-community.ts     # engagement smoothing and the ranked windows
npx tsx scripts/check-challenges.ts    # status from a window, winners, the capture streak
npx tsx scripts/check-progression.ts   # the rank ramp
npx tsx scripts/check-map.ts           # bbox parsing and the coarsening grid
npx tsx scripts/check-catdex.ts        # the Dex patch schema
npx tsx scripts/check-shop.ts          # the catalogue's shape and what a player owns
npx tsx scripts/check-search.ts        # ilike escaping, against a local model of the operator
```

All of them at once:

```bash
cd server && for f in scripts/check-*.ts; do npx tsx "$f" >/dev/null \
  && echo "ok   $f" || echo "FAIL $f"; done
```

Two of them load `config.ts`, which validates the environment — so run them from `server/`
where `.env` is, or pass throwaway values:

```bash
SUPABASE_URL=https://placeholder.supabase.co SUPABASE_SERVICE_ROLE_KEY=x SCORING_STUB=true \
  npx tsx scripts/check-catdex.ts
```

### What these deliberately do not cover

Everything that touches Postgres. The split is the one described in `BACKEND.md` §7: rules with
no database under them live in `server/src/game/` precisely so they can be exercised like this,
and the services around them are checked by running the thing.

### Three of them guard against drift, not bugs

`check-progression`, `check-map` and `check-community` each **parse the client's
`src/constants/game.ts` as text** and assert its constants match the server's. The rank ramp,
the map TTL and the three community numbers are mirrored on both sides — the client needs them
to render offline — and two copies of a constant is a thing that only stays correct if
something checks. If one of these fails, the two halves of the app have started disagreeing.

---

## 2. Running the server

```bash
cd server && npm install && npm run dev     # tsx watch, port 4000
npx expo start -c                          # EXPO_PUBLIC_* is inlined at build time
```

`server/.env` needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SCORING_STUB=true` until
a real key exists. The root `.env` needs `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. **Never open either file** — ask, or read `.env.example`.

Use a physical device. The simulator has no camera, and the capture loop is the whole product.

### Checking a route exists without a database

Boot against a placeholder project. Anything mounted answers 401 without a token; anything
unbuilt answers `not_implemented`. That distinction is worth having, because "this endpoint is
not built" and "this endpoint is broken" look identical from the app otherwise.

```bash
cd server
SUPABASE_URL=https://placeholder.supabase.co SUPABASE_SERVICE_ROLE_KEY=x \
  SCORING_STUB=true PORT=4099 npx tsx src/index.ts &

curl -s localhost:4099/health
curl -s localhost:4099/catdex               # {"error":{"code":"unauthenticated",...}}  mounted
curl -s -X POST localhost:4099/shop/purchase  # {"code":"not_implemented",...}          not built
```

`GET /feed/viral` is the one route that answers without a token — that is deliberate, so a CDN
can cache it. Against a placeholder project it fails at the database instead, which is how you
tell it got past auth. Against the **real** project it returns actual rows, which makes it the
only end-to-end check of the community layer available without a device or a bearer token:

```bash
curl -s "localhost:4000/feed/viral?window=all&limit=3"
```

---

## 3. What only a device can tell you

These are the things no script here reaches. `BACKEND.md` §4 is the honest ledger of what has
and has not been observed; this is what to actually do about it.

### The reveal-ledger refund — the most valuable test available

The `reveals` table replaced counting `photos.scored_at`, because counting photos meant the
count forgot: deleting a scored photo handed its reveal back, and two-a-day was unlimited for
anyone willing to delete what they disliked. **The verification run that covered the allowance
predates the ledger, so nothing has ever tested the code that runs today.**

1. Capture and score twice. The allowance should read 0 remaining.
2. Delete one of the two scored photos.
3. Capture again.

It must come back **unscored**. If it scores, the ledger is not doing its job.

### The `no_cat` path, which has never executed

`no_cat_at`, the guard that reads it back, and the client sheet that deliberately offers no
retry were all written against a stub that hardcoded `isCat: true`.

1. `SCORING_STUB_NO_CAT=true`, restart the server.
2. Capture. The sheet should say there is no cat and offer **no** "try again".
3. Turn the flag off, restart, and reveal that same photo from the album.

The second attempt must be refused **without a call to the scorer** — that is the guard, and it
is the part that has never run.

### The album cap

Set `PHOTO_LIMITS.free` to `2` in `server/src/game/album.ts` rather than taking 200 photographs.
A capture at the cap is still taken and still scored; the player is then asked to delete
something or discard it, and the reveal is spent either way.

### Photo privacy

```bash
cd server && node scripts/check-photo-privacy.mjs "<imageUrl from a capture response>"
```

EXIF GPS and the cache-control header on a real uploaded object. Neither has been observed.

### Cat identity, end to end

Photograph the same cat twice. The first gets an empty shortlist and the naming step; the
second should offer that cat as a candidate with reason phrases. Nothing about the matcher has
ever been ranked against real rows — `check-matching.ts` exercises the arithmetic, not the
queries under it.

---

## 4. Before the scorer goes live

`SCORING_STUB=true` stamps `scoring_model = 'stub'` on every row it touches. Those numbers are
plausible and entirely invented, and they sit in the columns the leaderboard ranks on.

```bash
cd server
node scripts/clear-stub-scores.mjs            # report
node scripts/clear-stub-scores.mjs --clear    # clear the scores, refund their reveals
```

It clears rather than deletes — the photographs belong to the players — and puts each row back
into the unscored, revealable state the schema already has a shape for.

---

## 5. Typechecking

```bash
cd server && npx tsc --noEmit
cd .. && npx tsc --noEmit
```

Both are clean and should stay that way. **"Typechecks" is not "works"** — most of the services
in this codebase have never had a row pass through them, and the type system cannot tell you
that. `BACKEND.md` §4 keeps that distinction honestly, and it is worth reading before believing
anything is finished.
