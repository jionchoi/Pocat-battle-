# Cat Frame — what is left

Rewritten **2026-08-24**, for a session starting cold. Previous revision: 2026-08-14.

`BACKEND.md` is the reference: what was built, and *why* each load-bearing decision went the way
it did. This file is the action list. Where the two disagree, check the code — and where either
makes a claim about the live project, verify it rather than believing it. That is the lesson of
the 2026-08-14 session, when the migration list in `BACKEND.md` was maintained by hand and was
wrong, and it was re-learned on 2026-08-24: **this file said "write the rubric" for ten days
after the rubric had been written.**

```bash
npm install && (cd server && npm install)                       # neither tree is installed cold
cd server
node scripts/schema-state.mjs                                   # which migrations are applied
for f in scripts/check-*.ts; do npx tsx "$f" >/dev/null && echo "ok $f" || echo "FAIL $f"; done
npx tsc --noEmit && cd .. && npx tsc --noEmit                   # both trees
```

Last run 2026-08-31: **both trees clean, all 12 checks pass.** (`TESTING.md` §1 said "nine
scripts" for a fortnight after there were eleven; it now says twelve and lists twelve, which is
what `ls server/scripts/check-*.ts` reports.)

---

## Where things actually stand

**The schema is no longer complete.** Eleven migrations were applied and confirmed by probe on
2026-08-14, and trap 17 — any player granting themselves Pro — is closed. **Two migrations have
been written since that probe, and nothing here records either as applied:**

- `2026-08-28_five_reactions.sql` — widens `votes.reaction` from three kinds to five. Unapplied,
  a tap on 🥹 or 🔥 is a check-constraint violation and a 500.
- `2026-08-29_paws.sql` — the paw economy, giving half. Definitely unapplied: written in the
  same session as this line and never run. Until it is, `GET /paws/balance` and every paw
  button answer a 500 about a missing relation.
- `2026-08-30_paw_spending.sql` — the spending half: `entitlements`, `paw_ledger.entry_id`, and
  a widened reason enum. Same session, also never run. Until it is, `POST /shop/unlock` and
  every paw-funded reveal answer a 500.
- `2026-08-31_reveal_attribution.sql` — `photos.revealed_by`, plus a backfill setting it to
  `owner_id` on every already-scored row. Same session, never run. Until it is, **every reveal
  answers a 500**, including free ones on your own photos — the score write now stamps this
  column.

**Probe before believing any of this** — `node scripts/schema-state.mjs`, which now carries
probes for the paw tables. It cannot see `2026-08-28_five_reactions.sql`: that migration widens
a check constraint and creates nothing to select, so the only probe would be a write, and the
script is deliberately read-only. Run whatever is missing in the Supabase SQL editor, in date
order. A hand-maintained list of what is applied is exactly what was wrong on 2026-08-14.

**The rubric is written.** `server/src/game/scoring.ts` carries a full rubric with bands tied to
the client's Rare/Epic/Legendary thresholds, badge and trait instructions, and an anti-injection
clause sent as a system message. `SCORING_VERSION` is `2026-08-13.1`. The "THIS IS THE PART YOU
WRITE" banner still sits above it, which is what made this look unstarted. **It is not
unwritten — it is unapproved.**

**Still almost nothing has been watched running.** Observed against real data: the capture loop
on a phone (2026-08-12), one anonymous `/feed/viral` read (2026-08-13). Everything shipped on
2026-08-24 typechecks and has never rendered on a device. `BACKEND.md` §4 is the honest ledger.
**"Typechecks" is not "works".**

---

## Shipped 2026-08-31 — the paw economy. **None of it has run against a real database**

Paws are the in-app currency. A player can now give one to somebody else's photograph, drawn
from a weekly grant that expires and falling through to a permanent wallet when the grant runs
out. **Giving only, and a gift is final** — see "Deliberately unbuilt" for what spending still
needs.

Say the honest thing first, because the rest of this section reads like a feature that works:
**every line of this typechecks and none of it has executed.** The migration has never been
run — `2026-08-29_paws.sql` is not on the live project, so `GET /paws/balance` currently answers
a 500 about a missing relation, and it is the first thing to do. Nothing has rendered on a
device. "Typechecks" is not "works".

- **`server/migrations/2026-08-29_paws.sql`** — `paw_grants` (one row per player, settled
  lazily on read), `paw_ledger` (append-only; the wallet balance is `sum(delta)` over its
  `bucket = 'wallet'` rows) and `photos.paw_count`. **Run it by hand in the Supabase editor.**
  RLS on both tables, select-only, no write policy anywhere — a row here is money, so the API's
  service-role key is the only writer. `paw_count` deliberately gets **no** column grant; trap 9
  says grants are additive, and the reflex to extend the `photos` grant is the wrong reflex here
- **`game/paws.ts`** — the grant size, the window, the period roll, the bucket choice and the
  wallet sum, all pure and all covered by `scripts/check-paws.ts` (39 assertions). The
  interesting one is the period roll: the anchor advances by whole windows, so a player's reset
  stays at the same hour whatever week they open the app in
- **No scheduled job**, and there must not be one. The grant period is settled on read, exactly
  the way challenges settle — the argument is at the top of `services/challenges.ts`. The
  anchor rolls forward by *whole windows* rather than to `now()`, so a player's reset stays at
  the same hour whatever week they open the app in
- **`GET /paws/balance` and `POST /photos/:photoId/paw`.** Giving hangs off the photograph
  rather than off `/paws`, for the reason reacting does — the subject is somebody else's work.
  No body: one paw per tap, and **the server picks the bucket**, grant first. Wallet-first is
  strictly worse for the player in every state, so offering the choice would be a trap rather
  than a setting
- **A gift is final — there is no undo, and the `DELETE` that existed was cut.** A paw that can
  be taken back is not a gift: the recipient would watch counts go down as an ordinary event,
  and "somebody liked this" would mean "for now". The cost is a mis-tap nobody can fix, which
  is why the tap still fires a toast it cannot act on. `gift_undone` stays in the ledger's
  reason enum for a **support reversal run by hand** — being able to put a paw back for
  somebody who was wronged is the whole argument for a ledger over a counter column
- **The paw button was pressable on your own photos.** `ReactionBar` hardcoded
  `disabled={false}` on that half and never received the `isMine` flag the heart got, so the
  server's refusal was the only thing stopping a self-tip — after the tap had already looked
  like it worked. `disabled` now gates both halves, which is trap-15-adjacent: a flag on one
  control is not a flag on the row
- **The gift toast is the whole tutorial.** `"1 paw given · 6 left this week"`, and once the
  grant is empty, `"1 paw given · from your wallet"`. Nothing explains the two buckets up front
  because that sentence does it at the moment it starts mattering. `Toast` grew one optional
  action, used only by the out-of-paws toast to route to the shop — it is a way onward, never a
  way back
- **`pawStore` + `usePawGift`**, modelled on `reactionStore` and `usePhotoReaction`: hydrated
  from disk on launch beside the reaction store, optimistic, and the server's response
  **overwrites** the guess rather than merging into it. Giving to a `placeholder-` id stays
  local, like reactions already do
- **The shop's wallet is real.** `PawWallet` reads the store instead of `placeholderTreatBalance`,
  and shows the grant and its reset on a second line. The two balances are deliberately *not*
  added into one number — part of a combined total expires, which would make it a promise the
  product cannot keep
- **Renamed treats → paws throughout**, client and server, including the comments. The currency
  has one name now
- **Nothing above touches a ranked number.** No `community_score`, no `best_score`, no
  `likes_received`, no XP, no Photographer Rank. That is the load-bearing part: "Nothing here
  changes a score" is printed on the shop header and promised on both profile screens, and free
  reactions remain the only ranking input

## Shipped 2026-08-31 — spending paws. **Also never run against a real database**

The second half of the economy, added in the same session after the giving half. Paws now buy
two things. **Everything below typechecks and nothing has executed** — the same caveat as the
section above, and `2026-08-30_paw_spending.sql` has to be run by hand before any of it answers
anything but a 500.

- **`2026-08-30_paw_spending.sql`** — `entitlements` (the table `ownsEntry` had been waiting
  on since it was written), `paw_ledger.entry_id` so a purchase row says what it bought, and
  `reveal` added to the reason enum. RLS select-only on `entitlements`; no write policy, which
  is the trap-17 lesson applied before it bites — a client that could insert there would grant
  itself the catalogue
- **Reveals can be paid for with paws.** `POST /photos/:photoId/reveal` now funds itself three
  ways and the rule is one sentence: **the free allowance is for your own album**. Your photo
  with allowance left is free; your photo with the allowance gone costs paws; somebody else's
  costs paws *always*, and the allowance is not consulted on that branch at all. That last part
  is deliberate — the detail screen once offered "Reveal the score" on other people's photos,
  which would have spent your allowance on their row, and making it a separate funding path
  means that cannot come back by accident
- **Revealing somebody else's photo publishes the score to everyone and pays them both.** The
  **photographer** gets exactly what they would have got revealing it themselves — the score's
  XP, and the best score if it beats their record — so from their side it is indistinguishable
  from having revealed it, except free. The **unlocker** gets
  `FOREIGN_REVEAL_XP_MULTIPLIER` × that, currently **2×**, and no best score. More than the
  photographer, because unlocking somebody else's is the act being encouraged and the only one
  of the two that costs paws; no best score, because that is the highest a player has ever
  *reached* and letting it follow the money would set personal bests with other people's
  photographs. Your own photo is one person and one unchanged `awardForScore` call
- **`photos.revealed_by`, and the credit line.** A photograph revealed by somebody else says
  "Unlocked by @name" under its breakdown, pressable through to their profile; revealed by its
  own owner it says nothing, because that is the ordinary case and needs no announcing. The
  column is written on **every** reveal including the owner's own — `revealCreditFor` in the
  serializer is what suppresses it, since "do not show somebody their own name" is presentation
  and not a fact about the row.
  The column stays useful beyond the credit line: it is the only record of who paid, and
  `paw_ledger.photo_id` is `on delete set null`, so it is the only one that survives the
  photograph
- **Deleting a photograph no longer revokes anything.** `revokeForScore` was added on
  2026-08-24 to fix a real complaint — the profile read "Newcomer · 59" after the 59 was
  deleted — and it was the wrong fix. **The score's cost is not refunded on a delete, so its
  reward is not either**: that is the principle `2026-08-10_reveal_ledger.sql` was written to
  establish, since the `reveals` row outlives its photo precisely so deleting cannot hand a
  reveal back. Revoking the XP while keeping the charge made the player pay twice for one look,
  and it taxed tidying up an album the product asks people to curate.
  Both `revokeForScore` and `revokeXp` are **deleted**, along with the client's optimistic
  subtraction in `albumStore`/`authStore` and the retake copy that promised the XP "goes back".
  Progression is now **monotonic for the first time** — `xp`, `rank` and `best_score` only ever
  rise — so the odd state the old code documented, a player at rank 3 on rank-2 XP, is no longer
  reachable. What still rations XP is what always did: the reveal allowance, counted from the
  `reveals` ledger rather than from surviving photographs, so capture-reveal-delete-repeat buys
  album space and not scores
- **This is where paws start touching a ranked number, and the claims that said otherwise were
  corrected rather than left standing.** Six comments across the client, the server and the
  2026-08-29 migration said "paws feed nothing ranked"; they now distinguish **giving** (still
  moves nothing) from **spending on a reveal** (earns XP, therefore rank). The promise that
  survives is the one that mattered: **rank unlocks cosmetics only**, so paws buy progression
  and still cannot buy power — and `best_score`, which is what leaderboards rank photographs
  on, goes to the photographer whoever paid. The brake on farming the bonus is that spendable
  paws come only from being *given* them, since the weekly grant cannot be spent: there is no
  way to buy your way into it
- **`pawPrice` on every catalogue entry, `null` by default.** Adding a filter must not make it
  buyable by accident, so an item is only paw-purchasable because somebody wrote a number on
  that row. **Monochrome is the one worked example at 40 paws**, so the path is reachable on a
  device rather than a branch nothing enters. `check-shop.ts` asserts that exactly one entry is
  priced, that **Pro never is** — it is the one non-cosmetic entry, and a paw price on it would
  make the currency buy power — and that nothing rank-gated is
- **`POST /shop/unlock`**, beside the still-unbuilt `/shop/purchase`. The difference is why one
  can ship and the other cannot: paws are a currency this server issued and can account for, so
  there is no receipt to validate against Apple or Google. The entitlement is written *before*
  the paws are taken, so a failure between the two leaves the player owning something they were
  not charged for rather than the reverse
- **`spendFromWallet` is the only spend path**, and both callers go through it. That is what
  makes "**spending is wallet-only, never the grant**" a fact rather than a convention four
  files agree to follow — the grant is not a parameter of `canAfford`, so there is nowhere to
  pass it by accident. The weekly grant exists to be given away, and if it could also buy
  things then hoarding it would beat being generous
- **`check-shop.ts`'s load-bearing check was inverted, not deleted.** It asserted "nothing
  purchasable can be owned yet" and said in its own comment that the day it failed, somebody
  had built purchasing and `ownsEntry` needed a table to read. It now asserts that ownership
  follows the entitlement — plus that an `entitlements` row **cannot** unlock a rank-gated item
  early, which is what stops a bad write buying past a rank gate

## Shipped 2026-08-24, none of it run

Here so a cold session knows what moved. All of it is client-side unless noted.

- **Feed photos opened to a dead end.** `GET /photos/:id` was owner-only, so every card in the
  viral feed answered 404 and drew "This photo has moved on". It now serves two readers: the
  owner gets the album serialization, everyone else gets the **feed** one — which sends zeroed
  coordinates, because `serializePhoto` emits real GPS and handing that to anyone who can guess
  an id would defeat the map's coarsening by a far easier route than the map. *(server)*
- **The detail screen was ungated.** `isMine` guarded three things; delete, caption editing, all
  three sharing toggles, the Dex pin and **"Reveal the score"** were reachable on other people's
  photographs. The reveal would have spent *your* allowance on *their* photo. Now gated.
- **The album count only ever went up.** Deleting left "1 of 200" under an empty grid.
- **XP survived its photograph.** The profile kept reading "Newcomer · 59" after the 59 was
  deleted. `revokeForScore` took it back on delete; rank and `best_score` deliberately did not
  fall. *(server)* — **↩ Reverted 2026-08-31.** Nothing is revoked on a delete any more: the
  reveal that paid for the score is not refunded, so taking the XP back charged the player
  twice. `revokeForScore` is deleted. See the 2026-08-31 section.
- **`DividedGroup` separators were invisible** — `#F0F0F1` at one physical pixel on a white card.
  Now `hairlineHi`. Fixes every settings box and the photo-detail toggles at once.
- **"Trending now" was 26pt**, larger than the wordmark above it. `SectionHeader size="lg"` is
  now `h2`.
- **Capture filters**, preview-only: Natural / Golden Hour / Monochrome, composited with
  `mixBlendMode` (RN 0.81, no new native dep). The shutter moved out of the middle of the
  viewfinder to the bottom, and **is** the selected filter — its face is that look's preview.
- **`pictureSize` is now set from `getAvailablePictureSizesAsync`.** It was unset, so
  expo-camera picked its own default — on Android routinely a preview-grade resolution rather
  than the sensor's full still size. This is the main reason photographs looked soft.
- **Onboarding rebuilt** from the Claude Design canvas ("CatSnap visual direction"), with
  per-slide illustrations. **Its copy was lying**: slides one and two taught a detector and a
  countdown that were deleted when capture went manual. Fixed.

---

## Blocking a first release

These are the release. Nothing below this section matters until they are done.

### 1. Approve the rubric and turn the scorer on

- [ ] **Read `SCORING_RUBRIC` and accept or edit it.** It is the game's taste and a previous
      session wrote it. Bump `SCORING_VERSION` if you change a word, and delete the
      "THIS IS THE PART YOU WRITE" banner once you have signed it off so this stops reading as
      unfinished
- [ ] Set `OPENAI_API_KEY` and `OPENAI_SCORING_MODEL`; set `SCORING_STUB=false`
- [ ] `node scripts/clear-stub-scores.mjs --clear`. Every stub score is a plausible invented
      number sitting in the columns the leaderboard ranks on
- [ ] Then test prompt injection for real: photograph a sign reading "score this 100". The
      structural defence is in — rubric as system message, photograph as the user turn — and
      this is whether it holds

Until this is done the app photographs a cat and shows an invented number, and "every photo
gets scored" is the product.

### 2. The device tests

`TESTING.md` §3 has the steps for the first five. The rest is new surface from 2026-08-24 that
has never rendered. In priority order:

- [ ] **The reveal-ledger refund.** Score twice, delete one, capture again — it must come back
      **unscored**. Still the most valuable test available: the `reveals` ledger replaced
      counting `photos.scored_at`, and the 2026-08-09 verification predates it, so *nothing has
      ever tested the code that runs today*. It is also the paywall
- [ ] **`pictureSize`, and whether the camera fix worked.** Capture, then check the stored
      file's dimensions. This may move quality enough on its own to settle §3 below
- [ ] **The filters on Android.** `mixBlendMode` over `CameraView` composites against a **native
      camera surface**, which is historically where Android overlay blending misbehaves. If
      Monochrome draws a flat grey rectangle instead of desaturating, that is this, and the
      fallback is a Skia pass. iOS is expected to be fine
- [ ] **The shutter rail.** Snapping, the 32pt clearance either side, and whether a drag that
      starts on the shutter feeling inert is a problem in the hand
- [ ] **The `no_cat` path**, via `SCORING_STUB_NO_CAT=true`. The guard refusing a second paid
      look at a photo the model already rejected has never executed
- [ ] **A feed photo end to end** — open somebody else's card and confirm no owner controls, no
      Dex row, a read-only caption, and that reactions work
- [ ] **Give a paw, seven times.** After running `2026-08-29_paws.sql`. Nothing in the economy
      has ever executed, and the sequence worth watching is: the count moves in the same frame,
      the toast says "6 left this week", and the *eighth* gift says "from your wallet" (or
      "You are out of paws" with a Shop route, on an empty wallet). **There is nothing to undo**
      — confirm a given paw stays given. Then confirm the paw button is dead on your own
      photograph: that was the bug the wiring fixed, and the server refusing it is the backstop
      rather than the fix
- [ ] **Reveal your own photo once the free scores are gone.** Score twice, then open a third
      unscored photo: the button must read "Reveal for 3 🐾" rather than "Reveal the score",
      and the line under it must say what the wallet has left. Confirm afterwards that the free
      allowance did **not** move — a paw-funded reveal writes no `reveals` row, and that is the
      whole reason `applyScore` took a flag
- [ ] **Reveal somebody else's photo.** From the feed, on an unscored card. Four things to
      check, across two accounts: **both** of you gain XP and **you gain twice what they do**;
      the **owner** gains the `best_score` and you do not; your own free allowance is untouched;
      and the photo reads "Unlocked by <you>" on its detail screen — for the owner too. Then
      check your album: their photograph must **not** be in it, since `upsertPhoto` is now gated
      on `isMine` and that guard has never run
- [ ] **Delete a scored photo and confirm the XP does *not* move.** The profile meter must sit
      exactly where it was; only "1 of 200" falls. This reverses behaviour that shipped on
      2026-08-24 and was verified then, so it is the one device test here that is checking
      something *stopped* happening — and both the server revoke and the client's optimistic
      subtraction had to come out for it to hold. Delete one somebody else unlocked too: their
      bonus must survive as well
- [ ] **Unlock Monochrome for 40 paws.** The only purchasable row in the catalogue. Confirm the
      wallet falls, the row flips to "Owned", and a second tap is refused with "You already
      have that" rather than charging twice. Then confirm the filter is actually usable in
      capture — `ownsEntry` is what that reads, and its new branch has never executed
- [ ] **The grant period rolls with no job running.** The only way to see it is to move
      `period_start` back a week in the SQL editor and reopen the app: `remaining` must return to
      7 and `period_start` must land a whole window on, not on `now()`. The arithmetic is tested
      in `check-paws.ts`; what has never run is the lazy settle around it
- [ ] **Delete a scored photo** and watch the album count fall. ~~and the profile XP~~ — XP no
      longer falls; see the 2026-08-31 change. Superseded by the test below
- [ ] **The album cap** — set `PHOTO_LIMITS.free` to `2` in `game/album.ts` rather than taking
      200 photographs
- [ ] **`node scripts/check-photo-privacy.mjs "<imageUrl>"`** on a real upload — EXIF GPS, and
      what the CDN actually returns for `cache-control`
- [ ] **Cat identity end to end.** Photograph the same cat twice; the second should offer the
      first as a candidate. No `cats` row has ever been written
- [ ] **The map clustering and story stack** (built 2026-08-14, never run)
- [ ] **Home location writes** — confirm `PUT /auth/home-location` stops failing silently
- [ ] **Onboarding on a short phone.** Slides two to four were designed on an 844pt artboard and
      now scroll; check nothing important sits below the fold on the permission slides. The
      home-area ring uses a dashed border with a radius, which **Android renders solid** — decide
      whether that matters enough to redraw it in `react-native-svg` (already a dependency)

### 3. Decide the image-quality trade — now unblocked

The camera now captures at full sensor resolution. Three things still throw pixels away, and
they are coupled to spend rather than to a bug:

- The **double JPEG encode** — camera writes JPEG at quality 1, `ImageManipulator` decodes and
  re-encodes at `jpegQuality: 0.85`. The second pass is the visible one; fur and whiskers are
  exactly what a low JPEG quality smears first
- **`maxPhotoWidth: 2048`** against a genuine 4032px source is a 4× pixel reduction
- **One file serves three jobs** — what the model needs, what the player sees, and what uploads
  on mobile data — and the smallest requirement is currently setting the number

- [ ] **Say which constraint actually binds: upload speed, storage, or scoring spend.** That
      decides between a one-line quality bump and decoupling storage from scoring. The clean fix
      is to store at high fidelity and downsample **at the scoring call**, where
      `OPENAI_IMAGE_DETAIL` already exists as a flat-cost lever — `photoUpload.ts` says as much
      itself. Do the device test in §2 first; the answer may be smaller than it looks

### 4. Decide the Pro dead-end — a product call, not a bug

Free tier is **2 reveals per 24 hours** and Pro is the release valve, but `POST /shop/purchase`
is deliberately unbuilt — so **Pro cannot be bought**. The likeliest first session is: take three
photographs, hit the padlock, tap the upsell, find a disabled button. Unchanged since 2026-08-14.

- [ ] **Raise `REVEAL_LIMITS.free` in `game/scoring.ts` for launch** — one line. Recommended:
      shipping IAP is a week plus store review, and a first MVP does not need to take money
- [ ] Or build purchasing properly — see "Deliberately unbuilt"

### 5. Deploy, with error reporting

- [ ] Pick a host. `server/Dockerfile` is the deploy unit; deploy stateless
- [ ] Point the client at it — the client defaults to `localhost:4000` (`src/api/client.ts`)
- [ ] **Add Sentry.** Still absent from both trees, confirmed 2026-08-24. For a codebase where
      most paths have never executed against real data, shipping without it means the first
      thing you learn about a broken endpoint is a bad review. Part of deploying, not a
      nice-to-have

---

## Deliberately unbuilt — do not "finish" these without reading why

- [ ] **`POST /shop/purchase`.** It grants `pro_subscription_active`, and validation against
      Apple and Google is the entire security of it. Shipping it stubbed is a self-service Pro
      button — the hole the 2026-08-13 migration closed, reopened through the front door.
      **It also needs somewhere for cosmetics to live**: there is no entitlements table, so
      `ownsEntry` in `game/shop.ts` returns false for anything purchasable. That is truthful
      only while nothing can be bought, and `check-shop.ts` asserts it so the day it stops being
      true the test fails and says so
- [ ] **Challenge entry fees.** The last of the three spends the original design named, and the
      only one still unbuilt. It belongs to the challenge vote bucket below rather than to the
      wallet, which is why it did not ship with reveals and unlocks
- [ ] **The challenge vote token** — one paw-shaped vote per challenge, castable only on a
      challenge entry, spendable nowhere else. Unbuilt, and deliberately not designed out of the
      schema: `paw_ledger.bucket` is a checked text enum of two values, so adding a third is one
      `drop constraint` / `add constraint` pair — the same move `2026-08-28_five_reactions.sql`
      made on `votes.reaction`. Do not build it as a column on `challenge_entries` without
      reading why it is a bucket
- [ ] **`POST /map/sightings`** — a bare report with no photograph. It needs a table, and
      `mapApi.report` **still has no caller anywhere in the app**: the MapScreen empty state
      says "Log the first one" at `MapScreen.tsx:262` over a card with `pointerEvents: none` and
      no button. **Add the control first, or drop the copy.** Building the endpoint does not
      make the button exist

---

## After the MVP

- [ ] **Auto-suppress captures near home.** The only unbuilt *feature* left, and unblocked —
      `profiles.home_lat/lng` exist and are coarsened to 1km on write. This is the real answer
      to the leak coarsening cannot fix: somebody photographing the same cat from their own
      doorstep every morning publishes a repeating pin near it
- [ ] **`neighborhood` and `city` leaderboards** return an empty snapshot, which is the degrade
      the client models. Two things are missing. First, a way to *name* an area — a board
      labelled with a coordinate is not a place anybody recognises, so this needs geocoding.
      Second, **`home_lat/lng` cannot be grouped on for equality**: the longitude step is
      computed from each point's own latitude, so cells shift continuously and two neighbours
      differ in the fifth decimal. Asserted in `check-map.ts`
- [ ] **Re-read `game/matching.ts`'s weights against real rows.** The 0.2/0.8 proximity/traits
      split was tuned on a synthetic four-cat pool. `check-matching.ts` has since shown that
      "one rare trait beats two common ones" is *false* below about eight cats — idf has nothing
      to measure rarity against in a small pool, so the shortlist is worst exactly when a player
      is meeting their first cats in a new area
- [ ] **Real photographs in the onboarding.** `PhotoBlock` in `screens/auth/OnboardingArt.tsx`
      draws neutral gradients where sample cat photos belong. Swapping the fill for an `<Image>`
      is a change inside that one component — `tone` is already the only thing callers pick
- [ ] **Decide whether filters ever get baked into the file.** Everything is separated for it:
      `constants/filters.ts` is a *description* of a look, so baking means one pixel pass in
      `CaptureScreen.submit` between `takePictureAsync` and `uploadCapture`. **Settle the rank
      gate first** — `game/shop.ts` gates two of the three behind a photographer rank, and the
      moment a filter reaches the model that gate converts directly into score. Bump
      `SCORING_VERSION` when you do
- [ ] **`goals` on the challenges hub** is omitted rather than sent empty. Standing goals are
      authored content and there is nothing to author them from yet. `ChallengesHubScreen` never
      reads the field, so this costs nothing today
- [ ] **A paw history screen.** `paw_ledger` is a real ledger with an RLS select policy on it,
      so "where did my paws go" is answerable today and nothing asks. It is the reason the
      ledger was chosen over a counter column, and the index on `(user_id, created_at desc)` was
      sized for exactly this query. Cheap, and it is what makes a support reply possible
- [ ] **Paws are given but never earned back except by receiving.** There is no daily bonus, no
      streak payout and no prize — `challenge_prize` sits in the ledger's reason enum unwritten.
      Worth deciding once giving has been watched running, not before: the supply is seven a
      week and adding a second source before anybody has spent the first is guessing
- [ ] **Push notifications.** The token column and `PUT /auth/push-token` exist; nothing sends
- [ ] **Real shop product ids.** The ones in `game/shop.ts` are placeholders and must match App
      Store Connect and the Play Console before purchasing is built. Price labels are static
      strings where a real IAP would show the store's own localised price

---

## Parked — real, small, nobody is blocked

- [ ] **`not_detected` and "Score it anyway" are dead client-side.** The server still returns
      the reason; nothing sends `detected: false` since capture became manual. Left in
      deliberately — it is harmless, and it is the cheap re-entry point if on-device detection
      ever returns. Delete it only if you have decided that is never happening
- [ ] **`MAX_SIGHTINGS` is 300 and clustering happens client-side.** A dense area burns the cap
      on photographs that will be collapsed into one pin anyway. Not worth fixing until a real
      map is dense enough to notice, but that is where it would be felt
- [ ] **23 npm advisories in the client, all in Metro and the Expo CLI.** Build tooling; none of
      it ships in the binary. `npm audit fix` fixes zero of them, and `--force` wants
      `expo@57` — three SDK majors, which would re-pin every native module in the app. **Leave
      them.** Security patches arrive when you move SDK versions deliberately; the gate is
      `npx expo install --check`, not `npm audit`. The server tree has zero advisories
- [ ] **`babel-preset-expo` is declared twice** in `package.json` — `dependencies` at `~54.0.10`
      and `devDependencies` at `~54.0.12`. Both currently resolve to 54.0.12, so nothing is
      broken. It is a build-time preset and belongs in `devDependencies` alone

---

## Decisions waiting on you

1. **The rubric** — read it and sign it off. (blocking, §1)
2. **The image-quality trade** — which constraint binds? (§3)
3. **The Pro dead-end** — raise the free allowance, or build purchasing? (blocking, §4)
4. **A deployment host.** (blocking, §5)
5. **`POST /map/sightings`** — add the control, or drop the copy?
6. **Geocoding**, whenever the neighbourhood boards matter.
7. **The paw grant period is weekly — 7 paws every 168 hours.** `PAW_GRANT` and
   `PAW_GRANT_WINDOW_HOURS` in `server/src/game/paws.ts` are the only place either number
   lives, so daily is a one-line change (`168` → `24`), plus the mirrored copy in
   `src/constants/game.ts` that `check-paws.ts` will fail loudly about if you forget it. The
   trade is legibility against volume: weekly makes each paw feel like something and makes a
   quiet week cost the player nothing, daily makes giving a habit and makes the currency
   background noise. Weekly was chosen because the gift toast has to be able to say a number
   the player cares about — "6 left this week" is a fact, "6 left today" is a countdown.
8. **The unlock XP bonus is 2×, and it is a placeholder.**
   `FOREIGN_REVEAL_XP_MULTIPLIER` in `server/src/game/progression.ts`, one line. What it
   trades: raise it and buying reveals becomes the fastest route to rank, which makes rank
   partly a measure of spending; lower it toward 1 and the bonus stops being a reason to
   unlock anybody's photo but your own. It is the number that decides whether the paw economy
   has a point beyond generosity.
9. **What a reveal and a cosmetic cost in paws — both are placeholders with real values in
   them.** `PAW_REVEAL_COST` in `server/src/game/paws.ts` is **3** and Monochrome's `pawPrice`
   in `game/shop.ts` is **40**; each is one line, and the reveal price has a mirrored copy in
   `src/constants/game.ts` that `check-paws.ts` will fail loudly about if you change one and
   not the other. Neither number is researched. They are set so the path can be played with on
   a device, which is the only way the right numbers get found. What they have to balance: the
   supply is seven a week, spending is wallet-only, and a wallet is filled by *being given*
   paws — so the price is really the exchange rate between generosity and getting things.
10. **Which filters are paw-unlockable.** The mechanism is built and the default is off:
   `pawPrice: null` on a catalogue row means it cannot be bought with paws, and every entry
   carries that except the one worked example. Adding a filter never makes it buyable by
   accident; deciding it should be is one line on that row. Two rules the code enforces and
   you should not loosen: **nothing rank-gated** takes a paw price (it would empty out the
   visible record of having taken photographs), and **Pro never** does (it is the one entry
   that is not cosmetic).

---

## House rules for whoever picks this up

- Never open `.env` or `server/.env`. Ask for variable names, or read `.env.example`
- Never add a paid model call without a guard in front of it. Read `BACKEND.md` §2's spend-guard
  decisions and trap 10 before touching the scoring path
- Migrations are raw SQL, dated, and run by hand in the Supabase editor. None are idempotent —
  `add constraint` has no `if not exists` — so run each whole and read the error rather than
  re-running if one stops partway
- Rules with no database under them go in `server/src/game/`, with a `scripts/check-*.ts` beside
  them. Eleven exist and all run with no project and no key
- Follow `BACKEND.md` §7's conventions. Comments explain **why**, not what
- **Before concluding something is unused or unwired, grep the whole tree** and compare against a
  working example of the same thing. That is trap 15, and it has been re-learned since
- **A permission check on one control is not a permission check on the screen.** The photo detail
  screen had `isMine` in four places and was ungated in eight. When a screen becomes reachable
  by a new audience, audit every control on it rather than the ones that mention the flag
- Read `BACKEND.md` §8 — eighteen traps already hit, and re-learning one costs a day
