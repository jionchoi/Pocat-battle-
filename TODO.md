# Cat Frame — what is left

Rewritten **2026-08-24**, for a session starting cold. Revised **2026-09-29**. Previous
revisions: 2026-09-28, 2026-08-14.

`BACKEND.md` is the reference: what was built, and *why* each load-bearing decision went the way
it did. This file is the action list. Where the two disagree, check the code — and where either
makes a claim about the live project, verify it rather than believing it. That is the lesson of
the 2026-08-14 session, when the migration list in `BACKEND.md` was maintained by hand and was
wrong; it was re-learned on 2026-08-24, when **this file said "write the rubric" for ten days
after the rubric had been written**; and again on 2026-09-29, when it spent a month describing
four applied migrations as unapplied and **every reveal as answering a 500**. The failure mode
flips direction but never goes away: a hand-maintained claim about the live project is wrong by
default. Probe first.

```bash
npm install && (cd server && npm install)                       # neither tree is installed cold
cd server
node scripts/schema-state.mjs                                   # which migrations are applied
for f in scripts/check-*.ts; do npx tsx "$f" >/dev/null && echo "ok $f" || echo "FAIL $f"; done
npx tsc --noEmit && cd .. && npx tsc --noEmit                   # both trees
```

Last run 2026-09-29: **both trees clean, all 12 checks pass**, client on SDK 57 with
`expo-doctor` 21/21 and a clean iOS bundle. (`TESTING.md` §1 said "nine
scripts" for a fortnight after there were eleven; it now says twelve and lists twelve, which is
what `ls server/scripts/check-*.ts` reports.)

---

## Where things actually stand

**The schema is almost complete.** `node scripts/schema-state.mjs` reported **17 of 17 probeable
migrations applied on 2026-09-29**, including the whole paw economy and `reveal_attribution`.
Trap 17 — any player granting themselves Pro — is closed. Everything this file said for a month
about reveals and paw endpoints answering 500 was **stale**, and it was stale in the direction
that wastes the most time: it described working code as broken.

**Three migrations are unapplied. Two were written on 2026-09-29; the first has been
outstanding since August:**

- `2026-08-28_five_reactions.sql` — widens `votes.reaction` from three kinds to five. **This one
  is old and was never run.** Confirmed by behaviour rather than by probe: 🥹 and 🔥 answer a
  check-constraint violation on a real device, where ❤️ 🤣 😮 work. `services/votes.ts` now
  catches the 23514 and logs the migration filename, so the next person to hit it is told what to
  run instead of reading a 500.
- `2026-09-29_one_paw_per_photo.sql` — the per-photograph paw cap. **It deletes rows**, which is
  the one place the ledger's append-only rule is broken on purpose: a unique index cannot be
  created over rows that already violate it, and the duplicates are gifts the overspend race
  invented. Read its header before running it.
- `2026-09-29_map_pin_extension.sql` — `photos.map_pin_until` and the `pin_extension` ledger
  reason. Until it runs, `POST /photos/:id/map-pin` answers a 500 about a missing column and the
  pin row on Photo Detail prices something the server cannot sell.

**Probe before believing any of this** — `node scripts/schema-state.mjs`. It cannot see
`2026-08-28_five_reactions.sql` or the reason-enum half of the pin migration: both widen check
constraints and create nothing to select, so the only probe would be a write and the script is
deliberately read-only. For the reaction one, the read-only answer is:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'votes'::regclass;
```

Run whatever is missing in the Supabase SQL editor, in date order. A hand-maintained list of
what is applied is exactly what was wrong on 2026-08-14, and **this section was wrong again on
2026-09-29 in the opposite direction** — it claimed four migrations were unapplied when all four
had been run. Probe, then edit this paragraph.

**The rubric is written.** `server/src/game/scoring.ts` carries a full rubric with bands tied to
the client's Rare/Epic/Legendary thresholds, badge and trait instructions, and an anti-injection
clause sent as a system message. `SCORING_VERSION` is `2026-08-13.1`. The "THIS IS THE PART YOU
WRITE" banner still sits above it, which is what made this look unstarted. **It is not
unwritten — it is unapproved.**

**Some of it has now been watched running, and it immediately paid for itself.** Observed
against real data: the capture loop on a phone (2026-08-12), one anonymous `/feed/viral` read
(2026-08-13), and on **2026-09-29** a real session covering the camera, the filter rail, the
reaction tray, the paw button and the map. That session found six bugs — see the section below —
and **five of the six were invisible to every tool in the verification block above.** A race, a
native view hierarchy, a text rasterization artefact, an expiry rule that contradicted its own
endpoint's documented purpose, and a screen that never stated the state it was in. None of them
is the kind of thing a typecheck or a pure-rules check can reach.

The remaining untested surface is still large: the whole Dex and matching path, challenges, the
map clustering and story stack, the reveal ledger refund, and every paw spend. `BACKEND.md` §4
is the honest ledger. **"Typechecks" is not "works" — and the 2026-09-29 session is the
evidence, not the counterexample.**

---

## Shipped 2026-09-29 — six bugs found by the first real session on a device

The first time anybody drove the app on a phone against live data, and it is worth saying what
that bought: every one of these had typechecked and passed its checks for weeks. Five of the six
were invisible to every tool in the verification block at the top of this file.

- **Toasts were invisible over the camera and the reveal.** `Capture` and `ScoreResult` are
  `presentation: 'fullScreenModal'`, which on iOS is a separate native view controller presented
  above the React root — so the single `ToastHost` in `App.tsx`, a sibling of `<RootNavigator />`,
  rendered *behind* them. `zIndex: 100` cannot help; the two views are not in the same hierarchy
  for it to order them within. The symptom was not a missing toast but a **late** one:
  "Golden Hour is locked." fired when the rail slid back, sat invisible for its five seconds, and
  appeared the instant the modal was dismissed — looking like it belonged to the screen the
  player had just arrived at. `Toast.tsx` now keeps a **stack** of hosts and delivers to the
  newest, and both modal screens mount one as their last child. This also un-hid every other
  toast on those two screens: failed captions, pinned Dex tiles, refused paws
- **A spammed paw button spent eleven paws out of a grant of seven.** A read-modify-write race:
  `give()` read `remaining`, chose a bucket, wrote the ledger, then wrote
  `setGrantRemaining(grant.remaining - 1)` using the value read at the top — so every request in
  a burst read 7, each believed it could afford it, and each wrote 6. It only stopped at eleven
  when the requests began serializing. The client made it worse rather than catching it: each
  response called `apply(result.balance)`, so stale server balances overwrote the optimistic
  decrements. Now `reserveGrantPaw` does the read and the write in **one statement whose `where`
  names the expected value**, so of two concurrent callers exactly one matches a row
- **A paw is now one per photograph per player**, which is a reversal — `services/paws.ts` argued
  at length that any number should be allowed, since a paw is a tip rather than a verdict and
  giving moves nothing ranked. Both halves of that were true and it was still the wrong control:
  an uncapped button has no legible cost, so the only way to find out what a tap spends is to
  tap. `PAW_GIFT_LIMIT_PER_PHOTO` carries the full argument. **Enforced as a unique index, not in
  the service** — no read-then-write check closes the race without a transaction, and PostgREST
  gives none, so the service catches the 23505 and turns it into the ordinary refusal
- **The reaction tray arrived blurred for about a second.** `scale: 0.5 + 0.5 * enter.value` on an
  `Animated.Text`. A transform does not re-lay-out text: the glyph is rasterized once at its
  layout size and the bitmap is stretched, so scaling up from half size draws an emoji at half
  resolution and magnifies it. Emoji are the worst case — colour bitmap glyphs, with no vector to
  re-render from. The tray container was *also* scaling 0.86 → 1, so the first face was magnified
  twice over. Both now animate opacity and `translateY`, which resamples nothing. **The rule worth
  keeping: never scale a view containing text up from below 1.**
- **The reveal did not say whether the photo was public, and now it asks.** `shared_to_feed`
  defaults to false, so nothing was ever auto-posted — but a reveal has the visual grammar of a
  publication (a score, a tier crest, badges, full bleed), and with "Share to feed" beside "Save
  to Album" and no statement of the current state, the honest reading is that the photo is already
  out and that button shares it somewhere *else*. A line now states the state, and a sheet asks
  once **on the way out**. Deliberately not over the reveal: this screen's rule is that a player
  who only wanted the number is not made to answer anything, and the back arrow is documented as
  the door that costs nothing. Skipped entirely for anyone who already posted or pressed Save to
  Album
- **Your own map pins expired after 72 hours**, which contradicted the endpoint's own reason for
  being authenticated — `routes/map.ts` says the map's most valuable case is finding your way back
  to a cat *you* photographed, which is why your pins come back at true coordinates. The cutoff
  was applied before the viewer was considered, so that case expired on a timer and "My photos"
  could only ever show three days. Liveness is now three ways in one `or`: **you own it**, it is
  inside the TTL, or somebody paid to keep it. The empty-state copy also named the TTL, because
  "No sightings nearby" was shown both for "nobody has been here" and "the pins aged out" — which
  is what made an empty map read as broken software

## Shipped 2026-09-29 — paw stamps: keeping a map pin alive

The first thing paws buy that **another player receives**. Everything else they buy is cosmetic
or a shortcut past a wait; a pin kept alive is a pin somebody else can still walk to, which makes
it the right sink for a currency whose supply comes from being *given* paws.

- **`POST /photos/:photoId/map-pin`** — `PAW_PIN_EXTENSION_COST` (2) for
  `PAW_PIN_EXTENSION_HOURS` (168). Wallet-only, through `spendFromWallet`, like every other spend
- **`photos.map_pin_until` is service-role only** and deliberately *not* on the column grant the
  other four owner-editable fields share. A player who could write it would extend pins for free —
  the same shape as trap 17. This is why it is a POST of its own rather than a field on
  `PATCH /photos/:id`: that handler is the free fields, and folding a priced write into it would
  put a spend behind the same door as editing a caption
- **`extendedPinUntil` adds to whatever the pin already has**, rather than resetting to a week
  from today, so paying early is never worse than paying late. Tested in `check-paws.ts`
- **It buys duration, never position.** No `community_score`, no `featured`, no coarsening
  change. The only thing money moves is *how long*
- **A local notification 12 hours before expiry** (`src/lib/pinExpiry.ts`), offering the
  extension and naming the price. Local rather than push, for the reason the paw grant settles
  lazily instead of on a cron: the expiry is arithmetic on a row the client already has, so a
  push would mean a scheduled job walking every photograph to recompute what each device can work
  out for itself. The cost is that it does not follow the player to a second phone — reopening the
  photograph reschedules it from the row in hand

**None of this has run against a real database.** The migration is unapplied; see the top of this
file. The pure arithmetic is covered by `check-paws.ts` and nothing else here has executed.

## Shipped 2026-09-28 — Expo SDK 54 → 57, so the app runs on a real iPhone again

Expo Go for iOS only ever ships the latest SDK, and the App Store copy is SDK 57 — so an SDK 54
project could not be opened on a physical iPhone at all, and the usual escape hatch (an iOS
simulator) needs macOS. The choice was a dev build, an Android device, or this. This is what was
chosen, and it turned out far cheaper than the old Parked note feared.

- **`expo@57.0.25`, React Native 0.86.3, React 19.2.3, Reanimated 4.5.1, worklets 0.10.1**, and
  all twenty-odd `expo-*` packages on 57.x. 29 native modules re-pinned by
  `npx expo install --fix`. TypeScript went to 6.0.3 and `@types/react` to 19.2.4, both because
  SDK 57 asks for them
- **No `prebuild` and no CocoaPods/Gradle surgery.** There is no `ios/` or `android/` directory
  — this is a CNG project, so the native projects are generated at build time and the whole
  bare-workflow half of the upgrade checklist does not apply
- **`StyleSheet.absoluteFillObject` is gone from RN 0.86** — 23 sites across 14 files. It is not
  merely untyped: the name appears nowhere in the package, so spreading it would have silently
  produced a style with no absolute positioning, breaking every full-screen overlay, scrim and
  the camera filter layer. `StyleSheet.absoluteFill` is now a plain frozen object with exactly
  the old shape (`StyleSheet.create` is an identity function these days), so the fix was a
  mechanical rename rather than a rewrite
- **`expo.splash` is no longer a valid config field.** Both values moved into the
  `expo-splash-screen` config plugin, which is what took `expo-doctor` from 20/21 to 21/21.
  `expo install --fix` also added the four config plugins SDK 57 now requires — `expo-image`,
  `expo-splash-screen`, `expo-sqlite`, `expo-status-bar`
- **`newArchEnabled` removed** from app.json; the new architecture has been the default since
  SDK 53 and the flag is no longer read
- **The duplicate `babel-preset-expo` is gone** — a Parked item that stopped being harmless the
  moment the upgrade bumped the `devDependencies` copy to 57 and left the `dependencies` copy on
  54. It is a build-time preset and now lives in `devDependencies` alone. `babel.config.js` was
  **kept**: it is not just the preset, it carries `react-native-worklets/plugin`, which
  Reanimated 4 needs and which must stay last in the plugin list
- **Verified as far as is possible without a device**: `expo-doctor` 21/21, both trees
  typecheck, all 12 game checks pass, and `npx expo export -p ios` produced an 11MB Hermes
  bundle — every module resolved and compiled, React Navigation 6 against RN 0.86 included.
  What that does **not** prove is anything about how it behaves once running: Reanimated 4.5 and
  gesture-handler 2.32 are the usual casualties of an RN jump, and the app's animations are
  worklet-heavy
- **To launch it:** `npx expo start -c`. The `-c` matters — `EXPO_PUBLIC_*` is inlined at build
  time (trap 5), and the cache is stale across an upgrade this size. The client rewrites a
  `localhost` API base to whichever host Metro was reached on (`src/api/client.ts`), so a phone
  finds the dev server on its own, but **the server has to be running** for anything with paws
  in it

## Shipped 2026-08-31 — the paw economy. **Partly exercised on a device 2026-09-29**

Paws are the in-app currency. A player can now give one to somebody else's photograph, drawn
from a weekly grant that expires and falling through to a permanent wallet when the grant runs
out. **Giving only, and a gift is final** — see "Deliberately unbuilt" for what spending still
needs.

**Updated 2026-09-29.** This section said "none of it has executed" and that the migration had
never been run; both were wrong by then. `2026-08-29_paws.sql` **is** applied — confirmed by
probe — and giving has been driven on a phone. What that session found is the overspend race
described at the top of this file, which is the sharpest available illustration of why the
caveat in this header was worth writing even though its facts had gone stale: the code
typechecked, `check-paws.ts` passed, the migration was applied, and the feature was still wrong
in a way only a thumb could find.

Still unexercised here: the grant period rolling, the wallet fallback at the eighth gift, and
every refusal except `own_photo`.

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

## Shipped 2026-08-31 — spending paws. **Migration applied; nothing here has executed**

The second half of the economy, added in the same session after the giving half. Paws now buy
two things — three, since the map pin extension shipped on 2026-09-29.

**Updated 2026-09-29.** `2026-08-30_paw_spending.sql` **is** applied; this section claimed
otherwise for a month. What remains true is the part that matters: **no paw has ever been
spent.** Not a reveal, not an unlock, not an extension. Giving has run on a device and spending
has not, so `spendFromWallet` — the single path every purchase goes through — has never
executed against a real wallet.

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
- **The camera never checked filter ownership at all — so buying one did nothing.** The rail
  held its selection in plain state and offered every look to everybody; `game/shop.ts` gated
  two of the three behind rank and nothing on the capture screen ever asked. Harmless while
  filters could only be earned, and a paid button that unlocks nothing once they could be
  bought. `useOwnedFilters` now reads `owned` off the catalogue on every camera focus (so an
  unlock is live when you come back), locked faces wear a padlock with the swatch still
  showing through, and landing on one slides back and offers the shop. It **fails open** while
  ownership is unknown: the cost of that is one free *preview*, since filters never reach the
  file or the score, and the alternative locks owned filters on every slow connection
- **Adding a filter is a two-file change, and `check-shop.ts` now enforces it.** The look lives
  in `src/constants/filters.ts`; the terms (rank, paw price) live in `game/shop.ts`. A look
  with no catalogue row is locked for everybody forever, and a catalogue row with no look is
  sellable and invisible — so the check reads the client file as text and fails on either.
  The old "exactly one entry is priced" assertion is now "at least one": it was a check on
  today's content, and it would have failed the first time a second filter was priced
- **"Reveal for 3 🐾" on the score result, right after capture.** The padlock there used to be
  the end of the road — the paid reveal was only on Photo Detail, two screens away, at the
  exact moment somebody runs out of free scores. Shown only on the ordinary out-of-allowance
  path: not on a `scoreError` (that has a free retry, and charging for what a retry might fix
  would be selling a player their own second chance) and not on Pro
- **`no_paws` now actually routes to the shop.** The server comment said the client told this
  refusal apart by its code; nothing did. `isNoPaws` + `useShopRoute` are now the one way to do
  it, shared by the paw button, both reveal buttons and the camera rail — the inline
  `navigate` in `usePawGift` was the first copy of what would otherwise have been four
- **Two older shop routes were missing trap 11's `initial: false`** — the album's Pro upsell
  (`PhotoAlbumGridScreen`) and the album-full sheet on the score result. Found by grepping for
  inline shop navigation once `useShopRoute` existed; both now go through it. Not paw work, and
  not from this session — but it is exactly the "same defence written out twice, missing from
  one" failure trap 18 describes, and here it was missing from both. Every `no_paws` refusal is
  now a neutral toast rather than a red one, the shop's own unlock button included

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

## Known limits of the paw economy — no transactions, and what that costs

Not bugs to fix now, but the honest list, because every one of them is a place a paw can be
gained or lost and none of them will announce itself. PostgREST gives us statements rather than
transactions, so every balance in the economy is read-then-written and two requests can
interleave. `services/progression.ts` already documents the same shape for XP and reaches the
same conclusion: survivable, and the real fix is a Postgres function.

Every case below needs two requests in flight at the same instant, and each costs at most one
paw:

- **Two simultaneous gifts** can both read `remaining: 1` and both write `0`, so one paw is
  given twice. `paw_grants_remaining_nonnegative` stops it going below zero, so the damage is
  bounded at a paw rather than a negative balance.
- **Two simultaneous spends** can both pass `canAfford`, so the wallet's ledger sum can go
  slightly negative. `walletBalance` floors the display at zero, so a player never *sees* a
  negative balance — but they did get something for free.
- **Two people revealing the same photograph at the same moment** both pass the `scored_at`
  check, so both pay and both call the model. One of them paid for a score that was already
  arriving. `MAX_SCORING_ATTEMPTS` caps how far that can go.

What makes all three tolerable is that they are self-inflicted or vanishingly rare, that the
ledger records exactly what happened either way, and that **the ledger is the authority** — so
each is answerable and refundable by hand, which is the whole reason it is a ledger and not a
counter column. The fix, when one is wanted, is a Postgres function doing the read and the
write in one statement; that is a migration and a second place the rules would live, which is
why it is not here yet.

## Blocking a first release

These are the release. Nothing below this section matters until they are done.

### 0. Run the three unapplied migrations

Five minutes, and it comes first because two of the things shipped on 2026-09-29 answer a 500
until it is done — and because one of these has been outstanding since August while the app
quietly offered two reactions the database would not accept.

- [ ] `2026-08-28_five_reactions.sql` — until this runs, 🥹 and 🔥 fail. Verify with the
      `pg_constraint` query at the top of this file rather than by trusting this line
- [ ] `2026-09-29_one_paw_per_photo.sql` — **read its header first.** It deletes duplicate
      ledger rows, which is deliberate and explained, and it will not create its index until
      they are gone
- [ ] `2026-09-29_map_pin_extension.sql` — until this runs, `POST /photos/:id/map-pin` answers a
      500 about a missing column
- [ ] Then `node scripts/schema-state.mjs` again, and **edit "Where things actually stand"** to
      say what it reported. That paragraph has now been wrong in both directions; it is only
      worth having if it is rewritten from a probe

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
- [ ] **Give a paw to seven different photographs.** Rewritten 2026-09-29: it used to say "seven
      times" on one photo, which is no longer a thing that can happen. One paw per photograph
      now, so the allowance can only be walked down across seven *cards*. The sequence worth
      watching: the count moves in the same frame, the toast says "6 left this week", and the
      *eighth* gift says "from your wallet" (or "You are out of paws" with a Shop route, on an
      empty wallet). **There is nothing to undo** — confirm a given paw stays given. Then confirm
      the paw button is dead on your own photograph: that was the bug the wiring fixed, and the
      server refusing it is the backstop rather than the fix
- [ ] **Spam the paw button on one photograph.** After running
      `2026-09-29_one_paw_per_photo.sql`. This is the regression test for the overspend, and it is
      the most valuable test in this list because it is checking a **concurrency** fix that no
      check script can reach: `check-paws.ts` tests the arithmetic, and the bug was never in the
      arithmetic. Tap as fast as possible. The first tap must land and every later one must do
      nothing at all — no toast, no second count, and the grant down by exactly **one**. Then
      check `paw_ledger` has one `gift_sent` row for that photo and the recipient has one
      `gift_received`
- [ ] **Give a paw, then reinstall (or clear the app's storage) and open the same photograph.**
      The one path that exercises the `already_given` refusal rather than the local guard:
      `givenByPhotoId` is gone, so the button offers a tap, the server refuses it, and
      `markGiven` has to put the given state back without moving either balance. Confirm the
      wallet and grant are unchanged afterwards
- [ ] **Keep a pin up for 2 paws.** After running `2026-09-29_map_pin_extension.sql`. On Photo
      Detail with the map switch **on**: the row states a date, the button charges the wallet
      once, and the date moves a week out. Then turn the map switch off and confirm the row
      disappears rather than offering to extend an invisible pin — the server refuses it with
      `not_on_map`, and the row not being there is the fix rather than the refusal. Buy a second
      week on a pin that is still live and confirm the date **adds** rather than resetting to a
      week from today
- [ ] **An expired pin of your own.** The Edmonton and Korea captures are all months old, so this
      needs no setup: open one on the map's "My photos" layer and it must be **there** — own pins
      no longer expire. Its Photo Detail row must read "The pin has come off the map" with "Put it
      back", and that sentence must not read as an error, because it is not one
- [ ] **The expiry notification.** Needs notification permission granted in Settings first, and
      it is the one test here that cannot be hurried: the warning is scheduled 12 hours before
      expiry, so the only way to see it is to extend a pin and then move `map_pin_until` back in
      the SQL editor to within 12 hours of now, reopen the photograph — which reschedules from the
      row — and wait. Worth doing once: a notification that routes to a deleted photograph, or one
      that fires for a pin already down, are both states `syncPinExpiryWarning` claims to prevent
      and nothing has verified
- [ ] **A toast raised over the camera and over the reveal.** The fix for the invisible-toast bug,
      and the cheapest test in this list: swipe to a locked filter on the camera and confirm
      "Golden Hour is locked." appears **while the camera is still open**, not after it closes.
      Then do the same on the reveal — pin a Dex photo, or refuse a paw — and confirm the toast
      lands over the photograph. Also confirm a toast raised from an ordinary screen still works,
      which is what the host stack could plausibly break
- [ ] **Open the reaction tray and look at the first face.** It must be sharp from the first
      frame. This is a watch-it-once test rather than a pass/fail assertion, and it is the only
      kind available for a rendering bug
- [ ] **Leave the reveal without posting.** The sheet must ask once, "Keep it private" must leave
      immediately, and pressing back a second time must **not** ask again. Then post one and
      confirm the sheet is skipped entirely on the way out, and that the line above the buttons
      reads "This photo is in the feed."
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
- [ ] **Unlock Monochrome for 40 paws, then use it.** Before buying: open the camera and
      swipe to Monochrome — it must wear a padlock, slide back, and offer the shop. Then buy it:
      the wallet falls, the row flips to "Owned", a second tap is refused with "You already have
      that" rather than charging twice. Then go **straight back to the camera** — the padlock
      must be gone without restarting the app, because ownership is refetched on focus and that
      is the first time any of this path has ever run
- [ ] **Golden Hour below rank 4.** It has always been rank-gated in the catalogue and was
      never gated on the camera. A new account must now see it locked. This is a visible change
      for every existing player below rank 4 — they had it, and now they do not
- [ ] **Run out of free scores at capture.** Take a third photo on the free tier: the result
      screen must say the photo is safe *or* can be revealed now, and offer "Reveal for 3 🐾".
      With an empty wallet the refusal must be a neutral toast with a Shop button, not a red one
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
      `mapApi.report` **still has no caller anywhere in the app**. The copy half of this is
      **resolved as of 2026-09-29**: the empty state said "Log the first one" over a card with
      `pointerEvents: none` and no button, and it now explains the pin TTL instead — so the app
      no longer offers something that does not exist. What remains is only the endpoint, and it
      is still unbuilt on purpose. **Building it does not make the button exist**

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
- [ ] **Push notifications.** The token column and `PUT /auth/push-token` exist; nothing sends.
      Still true for *push* — the one notification the app now schedules is **local**, and
      `src/lib/pinExpiry.ts` argues for why a derivable expiry does not need a server to
      announce it. Read that before building a push for anything a device can work out itself
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
      map is dense enough to notice, but that is where it would be felt. **It got slightly more
      likely on 2026-09-29**: the viewer's own pins no longer expire, so a player who has
      photographed one street for a year has a permanently growing number of rows inside any box
      covering it. The ordering is `captured_at desc`, so what the cap drops is their *oldest*
      captures rather than anybody's fresh ones — which is the right thing to lose, and is why
      this is still parked rather than blocking
- [ ] **16 npm advisories in the client, and two of them now ship in the binary.** This item
      used to say "23, all in Metro and the Expo CLI, none of it ships, leave them" — and the
      reason given for leaving them was that `npm audit fix --force` wanted `expo@57`. We are on
      `expo@57` now, so that argument is spent and the list has changed shape.
      Most are still dev-time tooling: `@expo/cli`, `@expo/config*`, `@expo/metro-config`,
      `@expo/prebuild-config`, `xcode`, `@xmldom/xmldom`, `query-string`. Those still do not
      reach a device and the gate for them is still `npx expo install --check`, not `npm audit`.
      **The two that matter are `@react-navigation/core` and `@react-navigation/native`**, which
      do ship. The fix is React Navigation 7 — see the item below. The server tree still has
      zero advisories
- [ ] **React Navigation is still on v6, and it is the last stale major in the tree.** SDK 57
      did not move it: `expo install --fix` only manages packages Expo versions, and
      `@react-navigation/*` is not one of them. It **bundles and typechecks** fine against RN
      0.86 — the Hermes bundle built clean on 2026-09-28 — so nothing is broken today, but it is
      unmaintained against this RN line and it is where the two shipping advisories live.
      v6 → v7 renames a handful of APIs (`NavigationContainer` children, `screenOptions`
      shapes, the `Screen` generic signature) and this project types every route centrally in
      `navigation/types.ts`, which is the thing that makes it tractable. Do it as its own pass,
      not folded into feature work

---

## Decisions waiting on you

1. **The rubric** — read it and sign it off. (blocking, §1)
2. **The image-quality trade** — which constraint binds? (§3)
3. **The Pro dead-end** — raise the free allowance, or build purchasing? (blocking, §4)
4. **A deployment host.** (blocking, §5)
5. **`POST /map/sightings`** — add the control, or drop the copy? The copy is **gone** as of
   2026-09-29, so this is now only "add the control, or leave it unbuilt". See
   "Deliberately unbuilt".
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
9. **What a reveal, a cosmetic and a pin extension cost in paws — all placeholders with real
   values in them.** `PAW_REVEAL_COST` in `server/src/game/paws.ts` is **3**,
   `PAW_PIN_EXTENSION_COST` is **2**, and Monochrome's `pawPrice` in `game/shop.ts` is **40**;
   each is one line, and the reveal and extension prices have mirrored copies in
   `src/constants/game.ts` that `check-paws.ts` will fail loudly about if you change one and
   not the other. None of the three is researched. They are set so the path can be played with
   on a device, which is the only way the right numbers get found. What they have to balance:
   the supply is seven a week, spending is wallet-only, and a wallet is filled by *being given*
   paws — so the price is really the exchange rate between generosity and getting things. The
   extension is priced **below** a reveal on purpose: a reveal buys the player something for
   themselves, an extension buys other people a pin they can walk to, and a price that forced a
   choice between the two would mean nobody ever chose the generous one.
10. **Which filters are paw-unlockable.** The mechanism is built and the default is off:
   `pawPrice: null` on a catalogue row means it cannot be bought with paws, and every entry
   carries that except the one worked example. Adding a filter never makes it buyable by
   accident; deciding it should be is one line on that row. **A new filter is two files** — its look in
   `src/constants/filters.ts`, its row in `game/shop.ts` — and `check-shop.ts` fails if either
   is missing, because each half on its own is a real bug (locked forever, or sold and invisible). Two rules the code enforces and
   you should not loosen: **nothing rank-gated** takes a paw price (it would empty out the
   visible record of having taken photographs), and **Pro never** does (it is the one entry
   that is not cosmetic).
11. **One paw per photograph, decided 2026-09-29 — and it is the one rule here that was
   reversed rather than chosen.** The original design allowed any number and argued for it:
   a paw is a tip rather than a verdict, giving moves nothing ranked, so there is no honest
   reason to cap how many times somebody may say "this one is good". That reasoning is still
   sound and it was still the wrong control, because it ignored what the button feels like
   under a thumb — an uncapped tap has no legible cost, and a player who taps three times has
   spent nearly half their week without deciding to. `PAW_GIFT_LIMIT_PER_PHOTO` carries the
   argument. **If you reverse it back**, the unique index has to be dropped and `paw_count`
   stops meaning "how many people liked this", which is what the card has always implied it
   was showing.
12. **Whether the reveal's "post this?" sheet should be the *default* answer rather than a
   question.** It asks on the way out and defaults to nothing — the photo stays private unless
   the player says otherwise, because `shared_to_feed` defaults false. The other reading is
   that a cat-photo game is for showing people cats, and private-by-default is the setting
   nobody wants but everybody gets. Worth revisiting once there is a feed with strangers in it;
   do not change it before then, because every photograph in the database was captured under
   the current promise.

---

## House rules for whoever picks this up

- Never open `.env` or `server/.env`. Ask for variable names, or read `.env.example`
- Never add a paid model call without a guard in front of it. Read `BACKEND.md` §2's spend-guard
  decisions and trap 10 before touching the scoring path
- Migrations are raw SQL, dated, and run by hand in the Supabase editor. None are idempotent —
  `add constraint` has no `if not exists` — so run each whole and read the error rather than
  re-running if one stops partway
- Rules with no database under them go in `server/src/game/`, with a `scripts/check-*.ts` beside
  them. **Twelve** exist and all run with no project and no key — `ls server/scripts/check-*.ts`
  is the only trustworthy count, and this line said eleven for a month after there were twelve
- Follow `BACKEND.md` §7's conventions. Comments explain **why**, not what
- **Before concluding something is unused or unwired, grep the whole tree** and compare against a
  working example of the same thing. That is trap 15, and it has been re-learned since
- **A permission check on one control is not a permission check on the screen.** The photo detail
  screen had `isMine` in four places and was ungated in eight. When a screen becomes reachable
  by a new audience, audit every control on it rather than the ones that mention the flag
- Read `BACKEND.md` §8 — eighteen traps already hit, and re-learning one costs a day
