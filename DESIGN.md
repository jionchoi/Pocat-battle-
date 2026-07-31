# CatSnap — Design System v2

This document **replaces Section 4 of the build brief** and amends Sections 5–7 where the
original design language conflicted with the project's design standards.

Platform reality check: the design skills in `.claude/skills/` are written for web
(Tailwind utilities, `100dvh`, `backdrop-blur`, CSS Grid). CatSnap is React Native + Expo.
Every rule below is the **principle** from those skills, ported to a mechanism that
actually exists on RN. Where a rule has no RN equivalent, that is stated rather than
faked.

---

## 0. Configuration

```
DESIGN_VARIANCE   8   asymmetric — bento grids, fractional spans, deliberate offset
MOTION_INTENSITY  6   perpetual micro-interactions, spring physics, no linear easing
VISUAL_DENSITY    4   daily-app spacing, macro-whitespace on marketing/reveal surfaces
```

**Vibe archetype:** Soft Structuralism — warm neutral bases, heavy grotesk display type,
airy components with diffused ambient shadows.
**Layout archetype:** Asymmetrical Bento, with Z-Axis Cascade reserved for the score
reveal.

### The two contexts

CatSnap has a light chrome and a dark immersive mode. This is **not** the banned
"random dark section in a light page" — those are committed full-screen mode switches
with their own token set, entered and exited deliberately.

| Context | Screens | Token namespace |
|---|---|---|
| **Bone** (light) | Map, Album, Cat Dex, Photo Detail, Challenges, Social, Profile, Shop, Settings | `colors.bone.*` |
| **Arena** (dark) | Capture Camera, Score Result | `colors.arena.*` |

Rule: a screen commits to one context for its entire surface. No light card floating on
an Arena screen, no dark strip inside a Bone screen. The transition between contexts is a
600ms cross-fade, never a hard cut.

Proper OS-level dark mode is Phase 2. The `arena` ramp is already structured to seed it,
so it is a token swap and not a redesign.

---

## 1. Color

### Rule: one accent, saturation < 80%

The original palette shipped two accents (`#FF8A5B` coral **and** `#6C63FF` violet). The
violet is the single most recognizable AI-design fingerprint and is banned outright. The
coral sat at ~100% saturation.

The fix reassigns roles rather than just recolouring: **the warm family becomes the
neutral base** (it carries the "tabby / cozy" brand tone across every surface), and a
single desaturated accent does all interactive work.

```
ACCENT — Fern
fern.500   #3C8763   active / focus
fern.600   #2F6B4F   default CTA fill, links, success        HSL(154, 39%, 30%)
fern.700   #24543E   pressed
fern.100   #E4EDE7   tinted fill, selected chip background
```

Fern reads as park / hedge / outdoors, which is thematically what the player is doing —
walking a real neighborhood with a camera. It contrasts cleanly against warm sand neutrals, is 39%
saturated, and is not purple, not neon-emerald, and not Stripe-blue.

`fern.600` doubles as **success**. A separate success green would be a second accent.

### Bone (light context)

```
bone.bg          #FBF8F4   app background — warm off-white
bone.surface     #FFFFFF   inner core of a bezel
bone.sunken      #F4EFE8   outer shell of a bezel, input wells
bone.hairline    rgba(33,29,24,0.08)
bone.hairlineHi  rgba(33,29,24,0.14)
bone.text        #211D18   warm off-black — never #000000
bone.textMuted   #6E655B
bone.textFaint   #9A9086
```

### Arena (dark context)

```
arena.bg         #14120F   warm off-black — not #000, not cool #0A0A0A
arena.surface    rgba(255,255,255,0.06)
arena.sunken     rgba(255,255,255,0.03)
arena.hairline   rgba(255,255,255,0.10)
arena.hairlineHi rgba(255,255,255,0.18)
arena.text       #F5F1EB
arena.textMuted  rgba(245,241,235,0.62)
arena.textFaint  rgba(245,241,235,0.38)
```

Both grays are tinted warm (hue ~30°). Mixing warm and cool grays in one product is a
banned pattern — there is no cool gray anywhere in this system.

### Semantic

```
danger   #A63B2E   brick — HSL(8, 57%, 41%)
warning  #9A6B1F   brass
```

Both live in the warm family, so an error state does not visually leave the product.

### Photo tier — a sequential scale, not four brand colors

The brief calls for *"colored gradient border on photo cards matching rarity tier"*.
Gradient-glow borders are a banned pattern. The tier is **semantic data encoding**, so it
gets a controlled ramp that steps in both hue and lightness (readable for colorblind
players, since it is never colour-only — see §7).

Tier is derived server-side from the composite score: Common below 50, Rare 50–69,
Epic 70–85, Legendary 86 and up.

```
Common      #8A8078   stone      neutral, deliberately unremarkable
Rare        #4A6D86   slate      HSL(203, 29%, 41%)
Epic        #7C4F6B   mulberry   HSL(320, 22%, 40%)
Legendary   #A07A2C   brass      HSL( 40, 57%, 40%)
```

Mulberry is not a Lila-Ban violation: the ban targets neon violet button glows around
hue 255° at high saturation. This is a 22%-saturated wine at hue 320°, used as a
1px ring and a 6% tint fill — never as a glow.

**Application (this is the mechanic that replaces the gradient border):** the tier tints
the *outer shell* of the card's Double-Bezel (§3.A) at 8% opacity plus a hairline ring at
40%. The inner core stays neutral so the photo itself is never colour-cast. Legendary
additionally gets a single sheen sweep — a translated, masked highlight, pure
`transform`/`opacity`, no `shadow` glow, and viewport-gated so a scrolled-off card stops.

### Pose classes get zero colors

Eleven pose classes (`yawning`, `jumping`, `loafing`, …) would mean eleven more hues,
which obliterates the one-accent rule. They are distinguished by **icon glyph + label
only**, rendered in `text` or `textMuted`. The pose appears in the score breakdown as a
named row ("Pose rarity · Mid-yawn"), never as a colour.

---

## 2. Typography

Inter, Nunito, Nunito Sans, Baloo 2, Roboto, Open Sans, Helvetica and Arial are all banned.

```
Display / UI   Satoshi Variable   (Fontshare — bundle locally, load via expo-font)
Numeric        JetBrains Mono     (@expo-google-fonts/jetbrains-mono)
```

Satoshi carries geometric warmth without the rounded-cartoon read of Baloo, which keeps
the app from looking like a children's app while staying inviting. JetBrains Mono is
tabular by construction — every score, score-component value, framing countdown, reaction
count and leaderboard rank uses it, so digits never jitter while the reveal tallies up.

`fontVariant: ['tabular-nums']` is unreliable on Android. Using a mono face is the fix, not
the CSS property.

### Scale

| Token | Size / Line | Tracking | Weight | Use |
|---|---|---|---|---|
| `display` | 34 / 36 | -1.2 | 800 | Score reveal, cat nickname on the result screen |
| `h1` | 26 / 30 | -0.6 | 700 | Screen titles |
| `h2` | 20 / 26 | -0.3 | 700 | Section heads, challenge title |
| `h3` | 17 / 22 | -0.2 | 600 | Card titles |
| `body` | 15 / 24 | 0 | 500 | Paragraph, list rows |
| `bodySm` | 13 / 20 | 0 | 500 | Secondary meta |
| `caption` | 11 / 16 | +0.2 | 500 | Timestamps, helper text |
| `eyebrow` | 10 / 12 | +2.0 | 600 | Uppercase pill labels above headings |
| `stat` | 15 / 20 | +0.4 | 500 | Mono — score components, reaction counts |
| `statLg` | 28 / 30 | -0.4 | 600 | Mono — the composite score total |

**No oversized H1s.** `display` caps at 34 on mobile. Hierarchy is carried by weight and
colour, not by scale inflation.

Weights in use: 500 / 600 / 700 / 800. The 400/700-only two-step is a flagged weakness.

**Measure:** body copy is capped at `measure` (≈ 62 characters) via `maxWidth`. Long-form
copy (Privacy & Data, onboarding, challenge prompts) must never run the full width of a
tablet.

**Orphans:** all headings and narrative copy set `{ textBreakStrategy: 'balanced' }` on
Android; iOS gets a manual ` ` before the final word of hand-written headings.

**Sentence case everywhere.** Not Title Case On Every Header. The only uppercase in the
product is the `eyebrow` token.

---

## 3. Materiality

### A. The Double-Bezel

No card, photo, tile or input sits flat on the background. Every significant container is
a nested pair: an outer shell that reads as a machined tray, and an inner core that reads
as the glass plate sitting in it.

```
Outer shell   bg bone.sunken · 1px hairline ring · padding 6 · radius 28
Inner core    bg bone.surface · inset top highlight · radius 22  (= 28 − 6, concentric)
```

Radii must be concentric or the curves visibly disagree. `radii.concentric(outer, pad)`
exists for exactly this and is the only correct way to compute an inner radius.

Applies to: `PhotoCard`, `CatDexEntry`, shop tiles, the score-result card, the floating
tab bar.

### B. Anti-card-overuse

A card is only allowed when **elevation communicates hierarchy**. Everything else groups
with a `hairline` divider or with pure negative space:

- Settings, Privacy & Data, Friends List → `divide-y` hairlines, no cards
- Profile and public-profile stats → negative space + mono numerals, no boxes
- Leaderboard rows → hairlines, no boxes
- Album grid and Cat Dex → cards (elevation is the point; each is a tangible photo)

### C. Shadows

Generic black `box-shadow` is banned. Every shadow is tinted to the background hue
(`#3A2E22` warm charcoal in Bone, `#0A0806` warm near-black in Arena — pure `#000000` is
banned in shadows too), wide-spreading and low-opacity — a diffusion shadow, not a drop
shadow.

RN has no `inset` box-shadow, so the Double-Bezel's inner highlight is a real 1px top
border rather than a faked inset shadow. This is the only mechanism that actually renders
edge refraction on native.

Default elevation is **0**. Four levels exist; most surfaces use `flat`.

### D. Glass

Where blur is used — the floating tab bar, the catch-camera control strip, modal
scrims — it is real glass, not just `expo-blur`:

```
BlurView intensity 40   +  1px inner border (hairline)  +  inset top highlight
```

**Performance constraint:** `BlurView` only ever wraps a fixed or absolutely-positioned
element. Never inside a `ScrollView` or `FlatList` row. Blur over a live camera preview
plus a scrolling list is the single fastest way to drop frames on mid-range Android. In
practice this leaves exactly two blurred surfaces: the floating tab bar and the capture
control strip.

### E. Texture

A fixed, `pointerEvents="none"` grain overlay at 3% opacity sits above the Arena
background only. It is a static asset positioned `absolute inset-0`, never attached to a
scrolling container.

### F. Shape

```
xs 8   chips, ticks
sm 10  badges, mono value pills
md 14  secondary buttons, inputs
lg 20  inner cores of small bezels
xl 28  card outer shells
xxl 36 modals, catch result card
full   999 — primary CTAs, tab bar, avatars
```

Radii vary by depth: tighter inside, softer outside. Uniform radius on everything is a
flagged weakness. Avatars use **squircles** (`radii.xl` on a square) rather than perfect
circles, except for author chips sitting over a photo in the feed, where a round crop
reads correctly against the image.

---

## 4. Motion

`MOTION_INTENSITY 6`. No `linear`, no `ease-in-out`, no instant state change.

All animation runs through **Reanimated 3 worklets on the UI thread**. RN's core
`Animated` API is not used — it hops the bridge and stutters under camera-frame load.

### Springs

```
snap       stiffness 220  damping 24  mass 0.90   taps, toggles, chips, reactions
soft       stiffness 100  damping 20  mass 1.00   default — layout, sheets, cards
overshoot  stiffness 160  damping 12  mass 0.85   badge pops, score reveal, rank-up
```

### Timing

```
enter  620ms  bezier(0.32, 0.72, 0, 1)
exit   240ms  bezier(0.40, 0.00, 1, 1)
stagger 60ms per index
```

### Required behaviours

- **Tactile press:** every pressable does `scale 0.98` + `translateY 1` on
  `onPressIn` via `snap`. No exceptions, including map pins and tab bar items.
- **Button-in-button trailing icon:** a CTA with a trailing arrow never shows a naked
  glyph. The icon is nested in its own 30px circular well; on press the well translates
  `+2, -1` and scales `1.05` while the parent compresses. Internal kinetic tension.
- **Staggered mount:** lists and grids never appear all at once. `FlatList` items enter on
  a 60ms-per-index cascade. Parent and children must live in the same component tree for
  the cascade to sequence correctly.
- **Shared element:** tapping a `PhotoCard` in the grid morphs it into the Photo Detail
  hero via a shared transition tag; it does not cross-fade between two screens.
- **Perpetual micro-interactions:** the product must feel alive at rest.
  - Map: user location dot breathes (scale 1 → 1.08, 2.4s loop)
  - Map: active challenge pins pulse their ring
  - Legendary cards: sheen sweep on a 6s loop
  - Framing window: the countdown ring sweeps in real time

  **Performance gate:** every perpetual loop is `React.memo`'d and isolated in its own leaf
  component so it can never re-render a parent. In the album grid, the sheen loop runs on
  Legendary cards only and pauses when the card leaves the viewport
  (`onViewableItemsChanged`). A 200-card grid animating every card is a frame-rate collapse.

  **The one deliberate exception to "no linear easing"** is the framing-window ring. It
  represents real elapsed time, and easing it would make the ring lie about how long the
  player has left.

### Hard constraints

- Animate `transform` and `opacity` only. Never `width`, `height`, `top`, `left`, or
  `flex`. These trigger layout on every frame.
- `useNativeDriver: true` wherever the legacy API is unavoidable (third-party libs).
- No scroll listeners in JS. Use `useAnimatedScrollHandler`.
- **Reduce motion:** read `AccessibilityInfo.isReduceMotionEnabled()` once and expose it
  through the theme. When true: all perpetual loops stop, springs collapse to a 120ms
  fade, and the score reveal shows its end state immediately. Never a hard requirement the
  player has to sit through.

---

## 5. Navigation — the Fluid Island tab bar

Edge-to-edge nav bars glued to a screen edge are a banned layout. The RN translation of
the Fluid Island pattern:

The tab bar is a **floating glass pill detached from the bottom edge** — inset 16 from
each side, lifted clear of the safe-area inset, `radii.full`, `BlurView` + hairline inner
border + inset top highlight. It is the one place in the app allowed to use `z-index`.

- Active tab: Phosphor `fill` weight, `fern.600`, label visible
- Inactive tab: Phosphor `light` weight, `textFaint`, label hidden
- The active indicator is a single pill that **slides between slots** with the `soft`
  spring — it does not fade out and in per tab.
- Entering Arena context (Capture, Score Result) slides the bar off-screen downward with
  `exit` timing. Immersive screens have no chrome.

**Icons:** `phosphor-react-native` exclusively — `light` for content, `fill` for active
state, stroke weight standardized to 1.5 at every size. Lucide, Feather, FontAwesome and
Material are banned as the default-AI icon choice. The brief's custom paw-based glyph set
remains the intent; Phosphor's `MapTrifold` / `Cards` / `Trophy` / `UserCircle` are the
shipping tab set until custom SVGs are drawn to the same 1.5 stroke.

**No emoji.** Anywhere. Not in UI, not in copy, not in push notification bodies, not in
accessibility labels.

---

## 6. Amendments to the brief's screens & components

### 6.1 Challenges Hub — the three-card row is banned

An obvious reading of the brief's Challenges Hub is three equal cards: current challenge,
leaderboard, feed. Three equal cards in a row is the most generic AI layout there is.
Replaced with a **single hero plus a stacked rail**:

```
┌───────────────────────────────────────────┐
│  THIS WEEK  (hero)                        │
│  prompt as the headline, countdown,       │
│  judging method, entry CTA                │
└───────────────────────────────────────────┘
   Community feed  ·  Leaderboard  ·  Friends   (stacked, secondary)
┌───────────────────────────────────────────┐
│  Previous winners (hairline rows)         │
└───────────────────────────────────────────┘
```

The active prompt is the only thing on this screen a player can act on right now, so it
takes the whole width. The three community destinations are navigation, not content, and
sit below as secondary buttons. Previous winners are hairline rows, not cards.

RN has no CSS Grid; equal columns come from `gap` + `flex: 1`, and fractional spans from a
single `flexBasis` computed once from window width. Never `calc()`-style percentage math.

Section titles and descriptions sit **outside and above** their content, gallery-style,
not crammed inside it.

### 6.1b The framing window is the product

The capture screen's countdown ring is the one piece of UI that carries the whole game
design. If a player does not understand why it is counting, they will snap instantly every
time and never discover that waiting scores higher. Three rules follow:

- The ring wraps the shutter, so the timer and the control it governs are one object.
- The prompt copy says what to *do* ("Wait for a better moment"), not what is happening.
- Running out is **not** a failure state and is never coloured as one — the app simply
  takes the shot for you.

### 6.2 Component library — revisions

| Component | Change |
|---|---|
| `PhotoCard` | Tier gradient border → Double-Bezel with tier-tinted shell + hairline ring. `grid` and `feed` variants |
| `RarityGlow` | **Deleted.** Outer glows are banned. Replaced by `RaritySheen` — a masked, translated highlight on Legendary only, viewport-gated |
| `TypeIcon` | **Deleted** with the personality system. Pose is a named row in `ScoreBreakdown`, not an icon-only chip |
| `FramingTimer` | → `FramingRing` in `ProgressBar`. A rotating sweep, not an animated SVG arc — RN cannot animate a stroke-dasharray on the UI thread |
| `LoadingSpinner` | **Deleted.** Skeletons matching each layout's shape replace it everywhere; capture progress lives in the shutter button |
| `Badge` | Tier/rank badges are square-ish (`radii.sm`), not pills. Pill-shaped "New"/"Beta" badges are a flagged cliché. The `eyebrow` pill survives for section labels only |
| `TabBar` | → `FloatingTabBar` (§5), now four slots |
| `ProgressBar` | `MeterBar` (rank XP, album quota — hairline track, `fern`), `ScoreMeter` (one breakdown row, staggered fill), `FramingRing` (capture countdown). All `scaleX`/`rotate`, never animated `width` |
| `Avatar` | Squircle default; circle for author chips over a photo |
| `Card` | Base variant is **flat** — hairline, no shadow. Elevation is opt-in |
| `VoteButton` | Laugh/love/wow only. There is deliberately no downvote to style |

### 6.3 Screens — additions

- **Custom 404 equivalent:** a branded "this cat has moved on" screen for dead deep links
  (expired sighting, deleted photo, a cat whose last photo was deleted, a closed account).
  Deep links will break; the brief has no handler for it.
- **Back navigation everywhere.** No dead-end screens. Score Result needs an explicit exit,
  not just a hardware back button — and it also needs a state for being reopened after the
  ephemeral capture store has been cleared.
- **Skip-to-content equivalent:** RN has no skip link, but every screen sets
  `accessibilityViewIsModal` correctly on modals and exposes a logical focus order.
- Footer legal links have no RN equivalent — Privacy Policy and Terms live in
  **Settings → Legal**, and are also linked from the sign-up screen above the CTA, which
  is where consent actually needs to be visible.

### 6.4 Mandatory states

Every data surface ships four states. A screen with only its success state is incomplete.

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Album | Skeleton grid, exact card geometry, shimmer sweep | "No photos yet — the first one is usually on your own street." + Open Camera CTA | Inline retry row, cached photos still shown, "showing your last saved album" badge |
| Cat Dex | Skeleton grid | "No cats yet. Photograph the same one twice and it starts keeping count." | Falls back to cached entries |
| Map | Skeleton pins at last-known viewport | "No sightings nearby. Log the first one." over a live map | "Couldn't reach the server. Showing your last view." |
| Challenges Hub | Skeleton hero tiles | "No challenge running. A new prompt opens shortly." + leaderboard CTA | Inline retry row |
| Community feed | Skeleton feed card | "The feed is quiet." / "Nothing from friends yet." | Inline retry row |
| Leaderboard | 10 skeleton rows | "Not enough players in your neighborhood yet." / "No neighbourhood yet" when no home area is set | Retry row |
| Photo submit | Progress in the shutter button itself | n/a | Rejection sheet with the reason: no cat, spoofed, album full, or scoring unavailable |

**Skeletons, never circular spinners.** Each skeleton matches the real layout's
dimensions so nothing jumps when data lands.

**Copy rules:** no exclamation marks in success messages ("Caption saved", not "Saved!").
No "Oops!". A rejected photo is described as "Not scored" with a reason and a way
forward, never as an error the player caused. Active voice — "We couldn't save your changes", never "Mistakes were
made". No `Alert.alert()` for validation; errors render inline beneath the field. Banned
words: elevate, seamless, unleash, next-gen, game-changer, delve, tapestry.

**Forms:** label above input, `gap 8`, helper text present in markup even when empty,
error text below. Visible focus treatment on every input — a 2px `fern.500` ring, not a
platform default that Android silently drops.

---

## 7. Accessibility

- Body and label text meets 4.5:1 against its own background; `textFaint` is used for
  decorative meta only, never for information you need to act on.
- **Tier is never colour-only.** Every tier is also a label, a distinct bezel weight, and
  a distinct pip count — and the score itself is on the card.
- **The score reveal is announced, not just animated.** The tallying total is rendered
  into a `TextInput` driven from the UI thread, and carries an `accessibilityLabel` with
  the *final* score so a screen reader never reads a mid-animation frame.
- Minimum touch target 44×44, including map pins. A 24px pin needs a 44px hit slop.
- Every icon-only control has an `accessibilityLabel`. No emoji in labels.
- `AccessibilityInfo` reduce-motion is respected globally (§4).
- **The framing window has a non-timing-dependent path by construction.** A player who
  cannot react inside the countdown does not lose the photo: the window auto-captures at
  zero, so doing nothing still produces a scored shot. Timing raises a score; it is never
  required to get one. This is why auto-capture is a correctness requirement and not a
  convenience.

---

## 8. Prerequisites

No `package.json` exists in this repo yet — the project is not scaffolded. These are the
dependencies this design system requires, over and above the brief's Section 2 stack:

```bash
npx expo install react-native-reanimated expo-blur expo-font react-native-svg expo-image
npm install phosphor-react-native
npm install @expo-google-fonts/jetbrains-mono
```

`expo-image` rather than RN's `Image`: photos are the entire product, and its disk cache
keyed on the CDN URL is what stops the album refetching every thumbnail on every scroll.

Satoshi is **not on Google Fonts**. Download the variable family from Fontshare
(fontshare.com/fonts/satoshi, free commercial licence) into `src/assets/fonts/`. The token
file lists the exact filenames it expects in `requiredFontFiles`.

Once those four files are in place, wire the loader up at the app root. It is not in the
token file because a `require()` of a font that has not been downloaded yet fails at
bundle time:

```tsx
import { useFonts } from 'expo-font';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

const [fontsReady] = useFonts({
  'Satoshi-Medium': require('./src/assets/fonts/Satoshi-Medium.otf'),
  'Satoshi-SemiBold': require('./src/assets/fonts/Satoshi-SemiBold.otf'),
  'Satoshi-Bold': require('./src/assets/fonts/Satoshi-Bold.otf'),
  'Satoshi-Black': require('./src/assets/fonts/Satoshi-Black.otf'),
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
});
```

Hold the splash screen until `fontsReady` — a flash of system font on launch undoes the
entire type system.

`react-native-reanimated/plugin` must be the **last** entry in `babel.config.js` plugins.
`react-native-safe-area-context` is required by the floating tab bar and ships with Expo's
navigation template; if it is missing, `npx expo install react-native-safe-area-context`.

---

## 9. Pre-flight checklist

Run this before any UI ships.

- [ ] One accent colour only; no violet anywhere; every colour under 80% saturation
- [ ] No Inter / Nunito / Baloo / Roboto / Arial in any style object
- [ ] No `#000000` and no cool grays
- [ ] Every card uses the Double-Bezel with concentric radii; the inner core stays neutral
      so no photo is ever colour-cast by its tier
- [ ] No outer glows; every shadow tinted to its background hue
- [ ] CTAs use the button-in-button trailing icon pattern
- [ ] No three-equal-column card rows
- [ ] Every transition uses a spring or a custom bezier — no `linear`, no `ease-in-out`
      (the framing ring is the one documented exception; it tracks real elapsed time)
- [ ] Nothing mounts statically; lists cascade
- [ ] Only `transform` and `opacity` are animated
- [ ] `BlurView` appears only on fixed/absolute elements, never inside a scroll container
- [ ] Perpetual loops are memoized, isolated, and viewport-gated
- [ ] Loading, empty and error states exist for every data surface
- [ ] Skeletons, not circular spinners
- [ ] Reduce-motion respected
- [ ] Touch targets ≥ 44×44; tier conveyed by more than colour
- [ ] The framing window auto-captures, so no score depends on reaction time
- [ ] No emoji in code, copy, labels or notifications
