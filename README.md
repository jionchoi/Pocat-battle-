# CatSnap — Real Cat Photography & Scoring App
*(working title — swap in your final name once picked; "CatSnap"/"Whisker Watch"/etc. were shortlisted earlier)*

> Explore your real neighborhood, spot real cats, and race to catch them mid-moment with your camera before they dart off. Every candid, funny, or perfectly-timed shot gets scored, collected into your personal cat album, and is built to be shared. No battling, no combat engine — the game IS the shot.

This document is a full build brief: concept, architecture, screens, components, data models, and phased roadmap. Built for React Native + Expo (iOS + Android from day one).

---

## 1. Concept Summary

- Players walk around in the real world; the camera live-scans for cats using on-device AI.
- Once a cat is detected, players get a short window to frame and snap the shot before it moves/leaves — timing and composition are the actual gameplay skill, not a coax minigame or a fight.
- Every photo gets **two scores**, and the gap between them is deliberate:
  - an **instant score** (composition, pose rarity, cat rarity) shown the second you shoot — the app's own opinion, and the reason capturing feels good before anyone has seen the photo;
  - a **community score** built from other players' reactions over time — the real currency, and what actually drives Photographer Rank, leaderboards and challenge wins.
  A photo the algorithm rates modestly but the community loves is a genuine "this blew up" moment, which is exactly the content worth sharing.
- Recurring real cats are tracked individually (a "Cat Dex" per unique cat you've photographed), building a relationship with specific neighborhood cats over repeat encounters, without needing a static "raised pet" system.
- Progression comes from a Photographer Rank (cosmetic gear/filters) driven mostly by **cumulative community reception**, not by the instant algorithmic score — there is no battle system, deliberately. Capturing still pays, so a player who never shares still progresses, just more slowly.
- Competitive/social layer replaces battling entirely: community voting, neighborhood/city leaderboards, and themed weekly photo challenges.
- A crowd-sourced live map of verified cat sightings remains the core retention/network-effect mechanic.
- Built to be inherently shareable — funny, well-timed cat photos are the kind of content people already post organically; the app is designed to make grabbing and sharing that moment effortless.
- Monetization: free-to-play, opt-in ads, cosmetics (camera filters, frame styles, gallery themes), and a "Pro" tier (unlimited album storage, higher-res exports, early challenge access). No pay-to-win, since there's nothing to "win" competitively beyond votes/leaderboard rank.

---

## 2. Tech Stack

- **Frontend**: React Native via Expo. Real-time camera frame processing (for live cat detection) requires a custom development build via expo-dev-client/EAS Build — not compatible with Expo Go, but still fully within Expo's managed workflow via config plugins.
- **Navigation**: React Navigation (native-stack + bottom-tabs)
- **State management**: Zustand
- **Local persistence**: MMKV or AsyncStorage for cache; SQLite (via WatermelonDB or expo-sqlite) for offline-first photo album data
- **Camera/AI**:
  - Live on-device detection: react-native-vision-camera (frame processors) + Google ML Kit's Image Labeling/Object Detection (via @infinitered/react-native-mlkit-object-detection, Expo-compatible) — detects a cat is in frame and drives the "framing window" countdown, free and offline.
  - Server-side scoring pipeline: on photo submission, Node calls a cloud Vision API (Google Cloud Vision or AWS Rekognition) for composition signals (subject framing/position, blur/focus detection, lighting) and runs pose/action classification to detect rarity-worthy moments (mid-jump, mid-yawn, grooming, unusual sleeping position). This is also the anti-cheat checkpoint — verifies it's a genuine live-cat photo, not a spoofed image.
  - Optional fun feature: an AI caption generator (LLM-based) suggests a funny/meme-style caption for each photo based on its detected pose/expression, editable before sharing — directly supports the "funny cat pictures" goal and boosts shareability.
  - Phase 2: a custom-trained breed/pose classifier (fine-tuned model) to make scoring more accurate and specific than generic cloud-vision labels. Not required for MVP.
- **Maps**: react-native-maps (Google Maps SDK / Apple Maps)
- **Backend**: Node.js (Express or Fastify) — the app's only backend. The client never talks to the database directly; every request goes through Node.
- **Database**: PostgreSQL, hosted on Supabase — used purely as a managed Postgres instance (connection string), accessed only from Node via an ORM (Prisma or Drizzle recommended). Supabase's auto-generated client API and Row Level Security are intentionally not used, since Node owns all data access and authorization.
- **File storage**: Supabase Storage or a CDN-backed bucket (Cloudflare R2, S3 + CloudFront) for photos, uploaded via Node-issued short-lived signed URLs — the client never gets direct write access to storage. CDN matters more here than in a typical app since photos are the entire product.
- **Realtime**: not required for MVP at all (no live combat, no live matchmaking) — a major simplification vs. the earlier battle-based plans. Can add lightweight push notifications for challenge results/leaderboard changes instead of a persistent socket connection.
- **Auth**: Handled in Node — JWT issuance/verification, Google/Apple Sign-In token exchange (Apple Sign-In is mandatory if offering any other social login, per App Store rules).
- **Push notifications**: Firebase Cloud Messaging / Expo Notifications (for "your photo won the weekly challenge," "someone voted on your shot," "a rare cat was spotted nearby," etc.)
- **Analytics**: Amplitude or Firebase Analytics
- **Crash/monitoring**: Sentry
- **Hosting**: A platform that autoscales easily with minimal config changes — Railway, Render, Fly.io, or Google Cloud Run. Deploy Node stateless so scaling is "add more instances behind a load balancer," not a rewrite.

### 2a. Why this architecture is simpler than the original battle-based plan

Dropping the battle system removes the two most complex pieces from earlier drafts of this app: the live WebSocket combat/matchmaking engine and Redis-backed live queue state. What's left is almost entirely request/response: submit a photo, get a score back; vote on a photo; fetch a leaderboard. This is a much smaller, faster MVP to build, with Node's job narrowing to:

- Auth & sessions
- Photo submission handling: forwarding to the Vision API, computing the composite score, running rarity/dedup checks against the recurring-cat database, persisting the result
- Cat Dex tracking (matching new photos to existing known cats at that location)
- Voting/reaction handling and leaderboard aggregation (scheduled, not computed live per-request)
- Weekly/seasonal challenge management (defining prompts, scoring submissions against them)
- In-app purchase receipt validation with Apple/Google before granting Pro status or cosmetics
- Push notification triggers
- The only thing with a database connection at all

On scale: this is an even lighter load profile than the battle-based version, since there's no persistent live connections to maintain — a stateless Node deployment behind a load balancer, with a CDN in front of photo storage, comfortably covers early growth. Add caching for leaderboard reads and horizontal scaling only once real usage data shows where load concentrates.

---

## 3. Folder Structure (React Native / Expo — frontend)

```
/src
  /api            - API client, endpoint definitions, request/response types (calls the Node backend only)
  /assets         - images, icons, fonts, lottie animations
  /components     - reusable UI components (see Section 7)
  /screens        - one folder per screen (see Section 6)
  /navigation     - navigator setup, route definitions, deep linking config
  /store          - global state (Zustand slices)
  /hooks          - custom hooks (useCatDetection, useLocation, useFramingWindow, etc.)
  /services       - camera/AI frame-processor wrapper, location service, share/export service
  /models         - TypeScript types/interfaces for Photo, Cat, User, Challenge, etc. (mirrors backend types)
  /theme          - design tokens: colors, typography, spacing (see Section 5)
  /utils          - formatting, score-display helpers
  /constants      - rarity tiers, badge definitions, config values
```

### Backend folder structure (Node.js)

```
/server
  /src
    /routes          - REST endpoint definitions (auth, photos, catdex, challenges, leaderboard, votes, shop)
    /controllers      - request handling logic per route
    /services         - business logic (scoringEngine, rarityDetector, catMatcher, leaderboardAggregator, captionGenerator)
    /db               - Prisma/Drizzle schema + client, migrations
    /middleware        - auth verification, rate limiting, input validation
    /jobs              - scheduled jobs (leaderboard aggregation, challenge rotation, sighting expiry cleanup)
    /integrations       - Vision API client, LLM caption client, Apple/Google receipt validation, push notification client
```

---

## 4. Design System

### Brand tone
Warm, playful, funny — closer to a meme/social app than a hardcore gaming app. Should feel like flipping through a delightful photo album, not grinding a game. Rounded shapes, soft shadows, no harsh gradients, plenty of whitespace so photos are the visual star.

### Color palette (proposed - adjust to taste)
```
Primary (brand):      #FF8A5B  (warm coral-orange, "tabby" feel)
Primary Dark:         #E06B3E
Secondary:            #6C63FF  (playful violet, used for rare/badge accents)
Background:           #FFF8F1  (warm off-white)
Surface/Card:         #FFFFFF
Text Primary:         #2E2A26
Text Secondary:       #8A8178
Success/Common:       #6FCF97
Rare:                 #56CCF2
Epic:                 #BB6BD9
Legendary:            #F2C94C
Error/Danger:         #EB5757
Border/Divider:       #F0E6DA
```

### Typography
- Headings: a rounded, friendly sans-serif (e.g. "Baloo 2" or "Nunito") - weight 700/800
- Body: "Inter" or "Nunito Sans" - weight 400/500/600
- Score/numeric displays: tabular-nums variant for alignment

### Spacing scale
4, 8, 12, 16, 24, 32, 48 (px) - use an 8pt-ish rhythm throughout.

### Shape language
- Photo cards: 16-20px corner radius, full-bleed image with score/badge overlay
- Buttons: fully rounded (pill-shaped) for primary CTAs, 12px radius for secondary
- Rarity borders: colored gradient border on photo cards matching rarity tier color above

### Iconography
Custom cat-paw-based icon set for nav (camera-paw hybrid for Capture, map pin with cat ear for Map, photo-stack for Album, trophy-paw for Leaderboard, person for Profile).

---

## 5. Screens

### 5.1 Onboarding & Auth
- Splash Screen - logo animation, checks auth state, routes to Onboarding or Home
- Onboarding Carousel (3-4 slides) - explains the capture/score/share loop; requests camera + location permissions with clear "why we need this" copy before the OS prompt
- Sign Up / Log In - email, Google, Apple Sign-In
- Username & Avatar Setup - pick a photographer name and avatar

### 5.2 Home / Map (primary tab)
- Map Screen - live map centered on user location; shows nearby verified cat sighting pins and active challenge locations if any; floating "Capture" button; toggle for "My photos" vs "Community sightings"
- Capture Screen - live camera feed; on-device detection overlay shows a bounding box and starts a short framing-window countdown once a cat is recognized; tap to snap (or auto-capture at window's end); submits to backend for scoring
- Score Result Screen - animated score reveal (composition, pose rarity, cat rarity, bonus modifiers), badge/title assigned ("Golden Hour Ginger"), suggested funny caption (editable), share button

### 5.3 Album / Cat Dex (tab)
- Photo Album Grid Screen - all your photos, filterable by score/rarity/date, search by cat nickname
- Cat Dex Screen - one entry per unique real cat you've photographed, showing your best shot of each, total times photographed, and an editable nickname/mini-bio
- Cat Profile Screen - all your photos of one specific real cat, encounter history, encounter location(s) on a mini map
- Photo Detail Screen - full-size photo, score breakdown, caption, share/export options, delete option

### 5.4 Challenges & Social (tab)
- Challenges Hub Screen - current weekly/seasonal themed prompt(s) ("Best Halloween costume shot," "Sleepiest cat of the week"), countdown to close, past challenge winners
- Challenge Submission Screen - pick an eligible photo (new or existing) to submit
- Leaderboard Screen - tabs for Neighborhood / City / Global / Friends, ranked by top-scored photos or challenge wins
- Community Feed Screen - browse and react/vote on other players' shared photos (opt-in, not forced social pressure)
- Friends List Screen - add/search friends, view friends' albums

### 5.5 Profile
- Profile Screen (own) - avatar, Photographer Rank, badges/achievements, top shots showcase, settings entry point
- Public Profile Screen (others') - view another player's showcased photos and rank

### 5.6 Settings & Account
- Settings Screen - notifications, privacy/location controls, account management, Pro subscription management, support/contact
- Privacy & Data Screen - clear explanation of what's stored and why, data deletion request flow

### 5.7 Monetization
- Shop Screen - tabs for Camera Filters, Frame Styles, Gallery Themes, Pro subscription
- Pro Upsell Modal - triggered contextually (e.g. when album storage nears its free-tier limit)

---

## 6. Component Library

### Core/shared
- Button (primary, secondary, ghost variants; loading state)
- Card (base surface with rarity-border variant)
- Avatar
- TabBar (custom bottom nav with paw icon set)
- Modal / BottomSheet
- ProgressBar (used for Photographer Rank XP, album storage usage)
- Badge (rarity tag, rank tag, "New" tag, challenge-winner tag)
- EmptyState (used for empty album, no nearby cats, etc.)
- LoadingSpinner / SkeletonLoader
- Toast (capture success, error messages)

### Domain-specific
- PhotoCard - the core content component; compact (grid) and expanded (detail) variants; shows the photo, rarity border, score badge, caption
- ScoreBreakdown - composition/pose-rarity/cat-rarity/bonus displayed as a mini report-card
- CaptureOverlay - camera overlay UI: detection bounding box, framing-window countdown, shutter button
- FramingTimer - visual countdown ring shown during the capture window
- MapPin - variants for cat sighting, active challenge location
- CatDexEntry - compact card for a unique real cat: best photo, nickname, encounter count
- LeaderboardRow - rank, avatar, top photo thumbnail, score
- VoteButton - like/react control for community feed
- ChallengeBanner - current prompt, countdown, entry CTA
- RarityGlow - reusable animated border/glow wrapper component driven by rarity prop
- CaptionSuggestionChip - tappable AI-suggested captions on the Score Result screen

---

## 7. Data Models (TypeScript interfaces - shared shape between frontend and Node backend)

```ts
interface User {
  id: string;
  username: string;
  avatarUrl: string;
  photographerRank: number;
  photographerXp: number;
  createdAt: string;
  friendIds: string[];
  proSubscriptionActive: boolean;
}

interface Photo {
  id: string;
  ownerId: string;
  imageUrl: string;
  caption?: string;
  catId: string; // links to the recurring-cat record this photo is of
  scores: {
    composition: number;
    poseRarity: number;
    catRarity: number;
    bonus: number;
    total: number;
  };
  badges: string[]; // e.g. "Golden Hour", "Mid-Air Menace"
  capturedAt: string;
  capturedLocation: { lat: number; lng: number };
  voteCount: number;
  submittedToChallengeId?: string;
}

interface Cat {
  id: string;
  discoveredByUserId: string; // first person to photograph this recurring cat
  nickname?: string;
  bio?: string;
  bestPhotoId: string;
  encounterCount: number;
  firstSeenLocation: { lat: number; lng: number };
  lastSeenAt: string;
}

interface Challenge {
  id: string;
  title: string;
  prompt: string;
  startsAt: string;
  endsAt: string;
  winningPhotoId?: string;
}

interface CatSighting {
  id: string;
  reportedByUserId: string;
  location: { lat: number; lng: number };
  photoUrl: string;
  verified: boolean;
  createdAt: string;
}

interface Vote {
  id: string;
  photoId: string;
  voterId: string;
  reaction: 'laugh' | 'love' | 'wow';
  createdAt: string;
}
```

---

## 8. Navigation Map

```
RootNavigator
|-- AuthStack (unauthenticated)
|   |-- Splash
|   |-- Onboarding
|   `-- SignInSignUp
`-- MainTabs (authenticated)
    |-- MapTab
    |   |-- MapScreen
    |   |-- CaptureScreen (modal, presented over map)
    |   `-- ScoreResultScreen (modal)
    |-- AlbumTab
    |   |-- PhotoAlbumGridScreen
    |   |-- CatDexScreen
    |   |-- CatProfileScreen
    |   `-- PhotoDetailScreen
    |-- ChallengesTab
    |   |-- ChallengesHubScreen
    |   |-- ChallengeSubmissionScreen
    |   |-- LeaderboardScreen
    |   |-- CommunityFeedScreen
    |   `-- FriendsListScreen
    `-- ProfileTab
        |-- ProfileScreen
        |-- PublicProfileScreen
        |-- ShopScreen
        |-- SettingsScreen
        `-- PrivacyDataScreen
```

Bottom tab bar: Map | Album | Challenges | Profile (Map is the default/landing tab post-login). Note: this is a leaner tab structure than the original battle-based plan — no separate Battle tab needed at all.

---

## 9. Core Feature Logic Specs

### 9.1 Capture flow
1. User opens Capture from Map or floating button.
2. On-device ML Kit detection runs live on the camera feed - purely client-side, for responsiveness, not trusted for the final score.
3. On stable detection (cat in frame for X frames), start a short framing-window countdown (e.g. 3-5 seconds) shown as a visual ring/timer - this is the actual skill moment, encouraging the player to wait for a funnier/better pose rather than snapping instantly.
4. User taps to shoot at their chosen moment, or it auto-captures at the window's end if they don't.
5. Photo + GPS location sent to the Node backend.
6. Node calls the cloud Vision API for composition/blur/lighting signals and pose/action classification, checks for a match against known recurring cats at that location (Cat Dex matching), computes the composite score server-side (client never computes or reports its own score), optionally generates a suggested funny caption via the LLM integration, and returns the finalized Photo record for the reveal animation.

### 9.2 Scoring breakdown
- **Composition** (0-100): derived from subject framing/position in frame, focus/blur level, lighting quality - computed from Vision API signals.
- **Pose rarity** (0-100): common poses (sitting, standing) score low; action/expression moments (mid-yawn, mid-jump, grooming, unusual sleeping position, funny face) score high - computed from pose/action classification.
- **Cat rarity** (0-100): based on real-world scarcity signals (unusual coat pattern, purebred detection) plus a first-encounter bonus for a cat nobody's photographed yet.
- **Bonus modifiers**: additive small bonuses for golden-hour lighting, unusual location, multiple cats in one frame.
- **Total score** and resulting badge/title are derived from the combination, not just summed linearly - e.g. a high pose-rarity + low composition shot might earn a "Blurry but Worth It" badge rather than a flat low score, keeping funny-but-imperfect shots feeling rewarded rather than punished.

### 9.3 Cat Dex & recurring-cat matching
- On each submitted photo, Node checks whether it matches an existing Cat record (same approximate location + visual similarity match) or represents a newly discovered cat.
- Matching a known cat increments its encounterCount and can update its bestPhotoId if the new score beats the current best.
- This is what gives the "relationship with a specific real cat" feeling the raise-a-pet idea was going for, but expressed through repeat photography rather than a static care system.

### 9.4 Challenges
- Node defines rotating weekly/seasonal prompts (a scheduled job manages the rotation).
- Players submit an eligible photo (new capture or from their existing album) against the active challenge.
- Submissions are scored against the normal scoring pipeline plus challenge-specific criteria (e.g. a "Halloween costume" challenge might weight a "costume detected" signal, if feasible, or default to community voting for subjective prompts).
- Winner determined at close by top instant score or by **community score** (the smoothed engagement ratio, not raw vote count - raw counts would just re-elect whoever has the most followers), per challenge type.
- The fixed window is load-bearing for fairness: an open-ended board lets an old photo coast on accumulated votes forever, so challenges resolve on a schedule and start clean.

### 9.5 Voting, community score & leaderboards
- Community Feed shows opt-in shared photos; other players can react (laugh/love/wow) - lightweight, no negative/downvote option to keep the tone positive.
- **Standing is an engagement ratio, not a raw count** - reactions divided by unique viewers, so a great photo from a small account can outrank a mediocre one from a popular account. Reach is in the denominator by design.
- **Smoothed toward a prior rather than a raw ratio.** A literal votes/views would make a photo seen once and voted once score 1.000 and top every board. The score is a Bayesian average - each photo starts with ~20 imaginary views at the global average rate, and real data pulls it away. This also solves cold start: a new photo sits at the prior instead of at zero.
- **One reaction per player per photo** (changeable, and tapping the same one again clears it), plus a **daily cap per player** to blunt brigading and reciprocity rings.
- Views are counted as **unique viewers**, reported from what actually became visible on screen - not from what the feed returned - so re-scrolling cannot inflate a denominator.
- The feed itself stays **newest-first, never engagement-ranked**: ordering by score would give the photos that already won all the remaining views, which is the rich-get-richer loop the ratio exists to prevent. Score decides standing; exposure stays roughly equal.
- **Editorial featuring** seeds the feed during cold start - a curated photo rides the top of the first page for a few days. It buys exposure, never score.
- Leaderboards (neighborhood/city/global/friends) are computed via a scheduled aggregation job in Node, not live per-request, over a rolling 30-day window so boards stay winnable. The default board is community reception; the instant algorithmic score is a secondary tab so the two can visibly disagree.

### 9.6 Map & sighting verification
- Sightings are crowd-sourced: any capture attempt (successful or not) can optionally log a pin, submitted to Node.
- Verification badge shown once a sighting is corroborated by a second independent capture/report at the same location within a set time window, computed server-side to reduce spam/fake pins.
- Map queries are bounding-box scoped (Node returns only sightings within the current viewport) rather than loading a full city's data at once.

---

## 10. State Management Notes (frontend)

- Keep photo album data in local SQLite/WatermelonDB for offline access and fast grid rendering, synced from the Node API on connectivity.
- Keep capture/framing-window state in an ephemeral Zustand slice, not persisted - it's a short-lived UI interaction, not durable state.
- Keep map/sighting data paginated/windowed by viewport - fetch by bounding box as the user pans/zooms, don't load the entire city's pins at once.
- Auth/session state in a dedicated Zustand slice, hydrated from secure storage (expo-secure-store) on app launch, holding the JWT issued by Node.

---

## 11. Backend API Surface (Node.js)

```
POST   /auth/signup
POST   /auth/login
POST   /auth/refresh
POST   /photos                     submit a captured photo (image + location), returns scored Photo
GET    /album                       current user's photo album
GET    /catdex                      current user's discovered cats
GET    /catdex/:catId                one cat's full profile + photo history
PATCH  /photos/:id                   edit caption, delete
GET    /map/sightings?bbox=...       sightings within viewport
GET    /challenges/active
POST   /challenges/:id/submit
GET    /leaderboard?scope=neighborhood|city|global|friends
POST   /photos/:id/vote
POST   /photos/impressions           report which photos were actually seen (ratio denominator)
GET    /feed                        community feed of opt-in shared photos
GET    /users/:id/public-profile
POST   /shop/purchase                validates receipt with Apple/Google before granting item
GET    /shop/catalog
```

---

## 12. MVP Phasing

Phase 1 - MVP
- Auth, onboarding, permissions flow
- Capture loop (on-device detection, framing window, server-side scoring + Vision API verification)
- Photo Album + Cat Dex + Photo Detail
- Basic map with sightings
- Suggested captions (basic template-based, not full LLM yet, if time-constrained)
- Shop: cosmetics + Pro tier only
- Node backend deployed stateless on a single instance to start (Railway/Render/Fly.io)

Phase 2 - Fast follow
- Weekly/seasonal Challenges
- Leaderboards (neighborhood/city/global/friends)
- Community Feed + voting/reactions
- LLM-based caption generation (upgrade from templates)
- Push notifications (challenge results, votes, nearby rare cat)

Phase 3 - Post-launch (needs city-level user density)
- Custom-trained pose/breed classifier to make scoring more accurate and specific than generic cloud-vision labels
- Seasonal events / limited cosmetics
- Expanded social features (photo duels between friends, public profile showcases)
- Possible simple battle/game layer added on top of the Companion Cat / Cat Dex relationship, only once there's real usage data on what players actually want next

---

## Open items for further brainstorming
- Tuning the community-score constants against real traffic: the smoothing pseudo-count (20), the prior vote rate (0.12) and the confidence floor (10 views) are all starting guesses. The prior in particular should be recomputed from the observed global mean once there is volume.
- Whether the daily vote cap (30) is generous enough for a heavy browser and tight enough against a coordinated ring
- Pose/action classification approach: off-the-shelf model vs. custom-trained, and its real-world accuracy on cats specifically (needs testing)
- Exact choice between Google Cloud Vision vs. AWS Rekognition for server-side scoring signals (pricing/accuracy comparison needed)
- Prisma vs. Drizzle for the ORM layer
- Final app name (see earlier naming brainstorm - "CatSnap" here is a placeholder)
