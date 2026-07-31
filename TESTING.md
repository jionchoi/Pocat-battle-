# Testing CatSnap by hand

## Start it

**Terminal 1** — simulator + API:

```bash
./run-test.sh                     # sightings stay in London
./run-test.sh 37.5665 126.9780    # seed sightings in Seoul and match the simulator
```

**Terminal 2** — the app:

```bash
npm start          # then press i
```

The script boots the simulator, sets its GPS, and starts the API. That last part matters
more than it looks: **capture requires a location.** Without one the server rejects the
submission with `location-required`, because a photo with no coordinates cannot be matched
to a cat or scored for rarity.

To move the simulator later without restarting:

```bash
xcrun simctl location booted set 51.5074,-0.1278
```

---

## Walk-through

Tick these in order. Expected results are what the server actually returns, not guesses.

### Onboarding

- [ ] Splash animates, lands on the carousel
- [ ] Carousel explains the capture loop before asking for **camera** — grant it
- [ ] Next slide explains **location** before asking — grant it
- [ ] Sign up with any email, a 10+ char password, and a username
- [ ] Pick an avatar → lands on the Map

Validation is inline under each field. Try a bad email and a 3-character password: both
should show a message under the input, and no popup alert anywhere.

### Map

- [ ] Your location dot **breathes** (slow pulse)
- [ ] Seeded sighting pins appear nearby once you have run the seed with an account
- [ ] Toggle **Community / My photos** at the top
- [ ] With no pins in view, a floating card says so *over* the map — the map is not replaced

### The capture loop — the important one

- [ ] Tap the green camera button
- [ ] Point at anything textured — the detector needs ~12 stable frames
- [ ] Corner brackets appear, with "Holding focus N of 12" underneath
- [ ] Once stable, the **countdown ring wraps the shutter** and the copy changes to
      *"Wait for a better moment"*
- [ ] **Do nothing.** At zero it auto-captures — this is the accessibility path, and it
      must produce a scored photo without any input
- [ ] Repeat, and this time tap the shutter early
- [ ] "Scoring your shot" → the reveal

With `VISION_DEV_BYPASS=true` any photo is accepted and scored from stubbed signals, so a
coffee mug works. Scores will vary run to run by design — the bypass randomises the pose
and coat so you can exercise all four tiers.

On the reveal, check:

- [ ] The four score components fill **in sequence**, then the total counts up
- [ ] The pose row is named ("Pose rarity · Mid-yawn"), not a bare number
- [ ] Badges appear under the breakdown
- [ ] Caption suggestions are tappable and land in the editable field
- [ ] "New cat" badge on the first capture; the count rises on later ones

Then:

- [ ] Capture again **in the same spot** → the Cat Dex entry's encounter count goes up and
      **no second cat is created**
- [ ] Capture somewhere far away → a new cat

Photos show a "No image" state because storage is not configured locally. Scoring still
works — that is the point of separating the two.

### Album and Cat Dex

- [ ] Grid shows your photos, 2 across, cascading in on a stagger
- [ ] Tier filter chips work; tapping the active chip clears it
- [ ] Search by the cat's nickname
- [ ] Tap a card → Photo Detail with the breakdown in its resting state (no re-animation)
- [ ] Edit the caption and save
- [ ] Toggle **Show in the community feed** — this is the only thing that makes a photo
      visible to anyone else
- [ ] Toggle **Pin to my public profile**; pin a seventh and it should refuse with a reason
- [ ] Delete your best photo of a cat → the Cat Dex promotes your next-best, it does not
      leave a dangling entry
- [ ] Cat Dex → tap an entry → Cat Profile with the encounter history and a mini map
- [ ] Rename the cat → the new name appears on every photo of it

### The community layer

This is the second scoring system, and it needs **two accounts** to test — one to shoot,
one to react. Sign up a second account on a simulator or a device.

- [ ] Account A: share a photo to the feed
- [ ] Account B: open the Community feed and **let the photo sit on screen for a second**
      — the impression only counts after ~600ms of real visibility
- [ ] Account B: react to it
- [ ] Account A: Photo Detail → "What people thought" now shows 1 reaction, 1 seen
- [ ] It should say the figure is **not meaningful yet** — that is the confidence floor
      doing its job, not a bug. A 1-view/1-vote photo is deliberately not treated as a
      100% hit rate.
- [ ] Account A: Profile → the "Reactions" stat rose, and rank XP moved
- [ ] Account B: react to the same photo again → the reaction clears (toggle)
- [ ] Account B: react, un-react, re-react a few times → the owner's XP does not spiral;
      it is capped per photo per day
- [ ] Leaderboard → "Best received" is the default tab; "Best shot" is a separate tab and
      the two can rank people differently. That divergence is the design working.

Check it in the database:

```bash
cd server && npx prisma studio
```

`PhotoView` should have exactly one row per (photo, viewer) no matter how much you
scroll back and forth. `Photo.communityScore` is the smoothed ratio ×1000.

To exercise the cold-start curation:

```bash
cd server
npm run curate list                # least-seen shared photos
npm run curate feature <photoId>   # rides the top of the feed for 3 days
```

Featuring an unshared photo should be **refused** — it would publish something private.

### Challenges and community

- [ ] Challenges tab shows one hero prompt, not three equal cards
- [ ] The banner states the countdown **and** how the winner is decided
- [ ] Enter a photo → the entry screen preselects an existing entry if you have one
- [ ] Entering shares the photo to the feed, and the screen says so before you commit
- [ ] Re-enter with a different photo → it *replaces*, and the hub shows "Entered"
- [ ] Community feed lists shared photos, newest first
- [ ] React to someone's photo; tapping the same reaction again clears it
- [ ] Your own photos have their reaction buttons disabled
- [ ] Leaderboard: four scopes and four metrics all switch
- [ ] With one player, boards show a composed empty state — not a blank screen

### Profile

- [ ] Rank meter shows XP progress and states that ranks unlock cosmetics only
- [ ] Stats: photos, cats known, discovered, reactions received
- [ ] Album-quota meter appears; the Pro upsell only shows once you pass 85% of the cap
- [ ] Album breakdown bars match your tier distribution
- [ ] Milestones tick as you meet them
- [ ] Shop lists filters/frames/themes/Pro; rank-gated items show a rank, not a price
- [ ] Settings → Privacy & Data → typing `delete` enables account deletion

### States worth forcing

- [ ] **Offline:** turn off Wi-Fi, reopen the Album → cached photos still render with a
      "Showing your last saved album" badge. The map says it is showing your last view
      rather than going blank.
- [ ] **Loading:** kill the API (`Ctrl-C` in terminal 1) and pull-to-refresh the Album →
      an inline retry row, not a crash
- [ ] **Empty:** a fresh account's Album shows "No photos yet" with a camera CTA
- [ ] **Rejection:** set `VISION_DEV_BYPASS=false` without a Vision key, then capture →
      "We could not score that photo right now", and your rate-limit slot is refunded
- [ ] **Reduce motion:** turn it on in Accessibility settings → the reveal shows its end
      state immediately and the map dot stops breathing

---

## Checking the database directly

```bash
cd server
npx prisma studio        # browser UI at localhost:5555
```

Worth looking at after a few captures: `Cat` versus `CatDexEntry`. One row per real
animal, one row per player-cat relationship. Two accounts photographing the same cat
should share a `Cat` and have separate `CatDexEntry` rows with their own nicknames.

Or straight from the API:

```bash
curl -s localhost:4000/health
```

---

## When something looks broken

**The countdown never starts.** The detector needs ~12 consecutive stable frames. Point at
something textured — a blank wall will never trigger it.

**Capture rejected with `location-required`.** The simulator has no GPS fix. Set one:
`xcrun simctl location booted set <lat>,<lng>`.

**Every photo scores the same.** You are probably not on the bypass. With a real Vision key
scores reflect the actual image; with `VISION_DEV_BYPASS=true` they are randomised.

**Two entries for the same cat.** Expected if you moved more than ~60 m between captures,
or if the coat labels differed. The matcher biases toward creating a new record —
splitting one cat into two entries is recoverable, merging two cats into one is not.

**Everything 401s.** Access tokens last 15 minutes and the client refreshes automatically.
If refresh fails you get bounced to sign-in, which is intended.

**Camera is black.** The simulator has no real camera; it renders a synthetic scene. The
detector still works because it is analysing frames, not recognising real cats.

**API won't start.** It prints exactly which env var is wrong. Config is validated once at
boot rather than failing later on a request.
