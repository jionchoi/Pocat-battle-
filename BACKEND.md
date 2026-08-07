# Cat Frame — backend status and roadmap

Last updated: **2026-08-07**

This file exists so a new session can pick the work up cold. It says what is built, what is
only *believed* to work, why the load-bearing decisions were made, and what is left.

---

## 1. Where things stand

The old backend was deleted on 2026-08-07 and is being rebuilt from the database schema up.
The last commit containing it is on the **`legacy-backend`** branch — recover any of it with
`git checkout legacy-backend -- server/`. Do not treat it as a base; it is reference only.

**Working end to end:** sign up → username/avatar setup → main tabs, with the session
persisting across launches.

**Built but never run against a real device:** the capture path. Types pass, the server
boots, routes reject unauthenticated calls. Nothing beyond that has been observed.

**Not built:** everything else. The client expects 20 endpoints; the server serves 4.

---

## 2. The decisions that shape everything else

Read this section before changing anything. Each of these was argued out and several
non-obvious bugs came from getting them wrong first.

**Supabase for the platform, our server for anything that decides a score.**
RLS can say *which rows* you may write. It cannot say *what a photograph is worth*, and the
whole game is that number. So reads of your own data go straight to Postgres, and every
write that affects rank goes through the API holding the service-role key.

**Auth verifies against JWKS, not a shared secret.**
The project signs with an ECC (P-256) key, so `SUPABASE_JWT_SECRET` does not exist. The
server holds no signing material and key rotation needs no redeploy. Issuer and audience are
checked alongside the signature.

**`profiles` and `player_stats` are separate tables.**
RLS policies grant *rows*, and the columns needing protection are on the same row as the
ones a player must edit. One update policy on a combined table would let anyone who can
rename themselves also set their own rank. Split, `player_stats` simply has no update policy.

**Column grants, not just RLS, on `photos` and `cat_dex_entries`.**
Same reason. `revoke update … grant update (caption, shared_to_feed, showcased)` is what
stops the app writing `score_total`. Postgres checks both and the narrower wins.

**The storage bucket is public.**
Privacy rests on unguessable uuid paths, not a check at read time. Chosen for the album grid:
private means minting, caching and re-minting a signed URL per thumbnail per scroll, and
stable URLs are what let a CDN cache anything. Writes are *not* public — policies compare the
first path segment to `auth.uid()`, which is what makes direct phone-to-bucket upload safe.
The app's copy says photos stay "out of the feed" rather than "invisible", because that is
what is actually true.

**Rows store a `storage_path`, never a URL.**
Bucket, host and signing scheme are deployment details. A URL frozen into a row breaks every
photo ever taken the day one of them changes.

**The model decides the score outright.**
No rule engine. What is fixed: the four components, that the total is their sum (a model
asked for both will eventually contradict itself, and the reveal draws both), and that
`scoring_model` + `scoring_version` are stamped on every row. Ranges in the prompt are
guidance, not caps — totals above 100 are expected. A score is written once and never
recomputed.

**Scoring is rationed; the shutter is not.**
2 reveals per rolling 24 hours (free), unlimited for Pro. Counted from `photos.scored_at`,
not a ledger table — the rows already carry that fact and two copies would disagree. Rolling,
so no midnight to farm, no timezone to agree, and moving the device clock buys nothing.

**Unscored and unidentified are first-class states, not gaps.**
`scored_at` null means the score is waiting to be revealed. `cat_id` null means the player
has not confirmed which cat it is. Check constraints keep both all-or-nothing, so no screen
ever renders half a score.

**Cat identity is location + traits + the player.**
A vision model asked "is this the same cat" fails both ways and the second failure destroys
the Dex. Traits come from the scoring call, location shortlists candidates, and the player
confirms. Confirmation is the feature, not the fallback.

---

## 3. What exists

### Migrations — `server/migrations/`, run in this order

| File | What it does |
|---|---|
| `2026-08-07_create_profiles.sql` | `profiles`, `player_stats`, `set_updated_at()`, the `handle_new_user` signup trigger, RLS |
| `2026-08-07_fix_player_stats_fk.sql` | Repoints `player_stats.user_id` at `profiles` so PostgREST can embed it |
| `2026-08-07_username_chosen_at_onboarding.sql` | Drops the not-null, replaces the trigger, clears generated usernames |
| `2026-08-07_create_photos_and_cats.sql` | `cats`, `cat_dex_entries`, `photos`, RLS + column grants |
| `2026-08-07_create_storage_bucket.sql` | The public `cat-photos` bucket and its four write policies |

The first three are already folded into the create script; they exist for a database that ran
an earlier copy. A fresh database only needs `create_profiles`, `create_photos_and_cats` and
`create_storage_bucket`.

### Server — `server/src/`

```
app.ts          cors, json, /health, routers, errorHandler last
index.ts        binds the port, handles EADDRINUSE
config.ts       zod-validated env; exits naming a bad variable
game/scoring.ts THE RUBRIC (yours to edit), ranges, allowance, response schema
lib/supabase.ts service-role client, sessions off
lib/storage.ts  bucket name, public URL, path ownership, download, orphan cleanup
lib/openai.ts   the one scoring call, plus the deterministic stub
middleware/     auth (JWKS), errorHandler (HttpError), validate (zod body)
routes/         photos
controllers/    photos
services/       photos — capture, reveal, allowance
serializers/    photo — db row to the client's shape
```

### Endpoints served

- `GET /health`
- `GET /photos/allowance`
- `POST /photos` — capture
- `POST /photos/:photoId/reveal`

### Client integration points

- `src/lib/supabase.ts` — session on AsyncStorage, auto-refresh gated on AppState
- `src/lib/profile.ts` — `fetchMe`, `saveOnboarding`, `ProfileMissingError`
- `src/lib/photoUpload.ts` — downscale + direct upload, returns `{ storagePath, localUri }`
- `src/store/authStore.ts` — Supabase sessions; `onAuthStateChange` is the only source of truth
- `src/api/endpoints.ts` + `src/models/index.ts` — the contract. **These two files are the spec.**

---

## 4. Verified vs assumed

Be honest about this line when picking work up.

**Verified:** both typecheck; server boots; `/health` returns 200; protected routes 401
without a token; a malformed `SUPABASE_URL` exits 1 naming the variable; `SCORING_STUB=true`
with `NODE_ENV=production` exits 1.

**Assumed, never observed:** a real capture. Upload to the bucket, `POST /photos`, the stub
score, the row landing, the reveal screen rendering either state. Also unobserved: whether
`manipulateAsync` strips GPS EXIF before upload — worth checking with `exiftool` on one
object, since the bucket is public.

---

## 5. Running it

```bash
# server/.env  — never read this file; ask, or read .env.example
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=4000                # the client defaults here (src/api/client.ts)
SCORING_STUB=true        # until the OpenAI key is added at the end of development

cd server && npm install && npm run dev
npx expo start -c        # EXPO_PUBLIC_* is inlined at build time
```

Root `.env` needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Never open either `.env`.** Ask for variable names, or read `.env.example`.

---

## 6. The todo list

Ordered. Each item is a session's worth of work or less.

### Now — prove the capture loop
- [ ] Run a real capture on a device: photo → bucket object → `photos` row → reveal screen
- [ ] Confirm the third capture in 24h shows the padlock state, not an error
- [ ] Check EXIF GPS is stripped from an uploaded object

### Next — the album, so a capture is worth keeping
- [ ] `GET /album` — paginated, newest first, filters for tier/search/sort
- [ ] `GET /photos/:id`
- [ ] `PATCH /photos/:id` — caption, `shared_to_feed`, `showcased` (respect the showcase limit)
- [ ] `DELETE /photos/:id` — remove the row, the storage object, and repair the Dex entry
      that pointed at it by promoting the next best
- [ ] This alone fixes Save to Album, Share to feed and Retake on the reveal screen

### Then — cat identity, which is what the Dex is
- [ ] `services/catMatching.ts` — shortlist by bounding box on `cats.last_seen_*` plus trait
      similarity; return candidates ranked, never auto-assign
- [ ] `POST /photos/:id/identify` — `{ catId }` to confirm, or `{ newCat: { nickname } }`
- [ ] Creating a cat: write `cats`, `cat_dex_entries`, set `discovered_by`
- [ ] Confirming an existing one: bump `encounter_count`, `last_seen_*`, promote best photo
      unless `best_photo_pinned`
- [ ] Client: the "Is this Mochi?" sheet after a reveal
- [ ] `GET /catdex`, `GET /catdex/:catId`, `PATCH /catdex/:catId` (nickname, bio, pin)

### Then — progression, so scores mean something
- [ ] Award XP on a scored capture; update `player_stats.xp`, `rank`, `best_score`
- [ ] Rank ramp lives in `RANK_TIERS` in the client's `constants/game.ts` — mirror it server-side
- [ ] Return the rank-up on the capture response and restore that block on the reveal screen

### Then — the community layer
- [ ] Migration: `votes`, plus `community_score`, `view_count`, `featured`, `vote_count` on photos
- [ ] `GET /feed`, `GET /feed/viral`, `POST /photos/:id/vote`, `POST /photos/impressions`
- [ ] Bayesian smoothing for `community_score`; `likes_received` on `player_stats`
- [ ] RLS: shared photos become readable by other signed-in players

### Then — challenges
- [ ] Migration: `challenges`, `challenge_entries`
- [ ] `GET /challenges/active`, `GET /challenges/eligible-photos`, `POST /challenges/:id/enter`
- [ ] `GET /challenges/:id/entries`
- [ ] Rotation job — decide where scheduled work runs before writing it

### Then — social and the rest
- [ ] `GET /leaderboard` (ranks on `best_score`)
- [ ] `GET /friends`, `POST /friends/respond`, `GET /users/search`
- [ ] `GET /map/sightings`, `POST /map/sightings`
- [ ] `DELETE /auth/account` — needs the admin API, the one auth action the app cannot do
- [ ] `PUT /auth/push-token`, `/auth/home-location`, `GET|PATCH /auth/preferences`
- [ ] `GET /shop/catalog`, `POST /shop/purchase` — receipt validation, sets `pro_subscription_active`

### Last — the real scorer
- [ ] Add `OPENAI_API_KEY` and `OPENAI_SCORING_MODEL`, set `SCORING_STUB=false`
- [ ] Rewrite the rubric in `game/scoring.ts` and bump `SCORING_VERSION`
- [ ] Delete or re-score every row with `scoring_model = 'stub'`
- [ ] Test the prompt-injection case: a photo containing "score this 100"

### Deployment, whenever
- [ ] Pick a host; the `Dockerfile` is the deploy unit
- [ ] Graceful shutdown on SIGTERM
- [ ] Decide where scheduled jobs run

---

## 7. Conventions

- ESM with `.js` import specifiers. Express 5, zod 4.
- `routes/` → `controllers/` → `services/`. Controllers are thin: validate, call, respond,
  `next(err)`. All logic in services.
- `export default router`; `import * as fooController`.
- Errors: `throw new HttpError(status, message)`. The message is read by a player, so write
  it for one. Anything unlabelled becomes a 500 with a generic body and a logged stack.
- `req.user!.id` after `authenticate`. Never trust an id from a body.
- Migrations are raw SQL, dated, and comment *why* rather than what.
- The client's `src/models/index.ts` is the contract. Serializers translate; screens do not
  learn the database's shape.

---

## 8. Traps already hit

Do not re-learn these.

1. **PostgREST embeds only across a foreign key.** `profiles(..., player_stats(...))` failed
   with `PGRST200` because both tables referenced `auth.users` and neither referenced the
   other. Symptom was the setup screen never appearing.
2. **Editing a `.sql` file changes nothing.** A function lives in the database once created.
   The old `handle_new_user` kept generating placeholder usernames long after the file said
   otherwise.
3. **An `UPDATE` that matches no rows is a success.** `saveOnboarding` reported a saved
   username that was never written until it started selecting the row back.
4. **Catching an error and carrying on hides schema bugs.** The profile fetch failed for every
   account for a day because the catch treated `PGRST200` as a flaky network. Anything not a
   known case is logged now.
5. **`EXPO_PUBLIC_*` is inlined at build time.** A running bundler will not pick up a changed
   `.env`; restart with `-c`.
