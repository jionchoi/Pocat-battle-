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

**Vibe archetype:** neutral chrome, one hot coral, saturated tier badges. The photograph
is the only thing on screen allowed to carry colour of its own; everything around it is
white, black or grey.
**Layout archetype:** Asymmetrical Bento, with Z-Axis Cascade reserved for the score
reveal.

### The two contexts

CatSnap has a light chrome and a dark immersive mode. This is **not** the banned
"random dark section in a light page" — those are committed full-screen mode switches
with their own token set, entered and exited deliberately.

| Context | Screens | Token namespace |
|---|---|---|
| **Paper** (light) | Viral Feed, Map, Album, Cat Dex, Photo Detail, Challenges, Social, Profile, Shop, Settings | `colors.paper.*` |
| **Arena** (dark) | Capture Camera, Score Result | `colors.arena.*` |

Rule: a screen commits to one context for its entire surface. No light card floating on
an Arena screen, no dark strip inside a Paper screen. The transition between contexts is a
600ms cross-fade, never a hard cut.

Photo Detail is the one screen that reads as a hybrid and is not one: the photograph is
content, not a dark surface, and every piece of chrome on it belongs to the light context.

Proper OS-level dark mode is Phase 2. The `arena` ramp is already structured to seed it,
so it is a token swap and not a redesign.

---

## 1. Color

### Rule: one interactive accent

The original palette shipped two accents (`#FF8A5B` coral **and** `#6C63FF` violet). The
violet is the single most recognizable AI-design fingerprint and is banned outright.

What replaces it is a split by *job* rather than by hue family. The chrome is a true
neutral and carries no colour at all; one hot coral marks every place the player can act;
and a closed four-value ramp encodes photo tier and nothing else. Three roles, three
vocabularies, no overlap — a coral thing is always tappable, a gold thing is always
Legendary, and a grey thing is always structure.

```
ACCENT — Coral
marmalade.600  #FF5A36  CTA fill, active tab, trending flame, links
marmalade.700  #E44A28  pressed
marmalade.500  #FF7454  hover / on-photo variant
marmalade.100  #FFF1EC  tinted fill — rank pill, accent badge, selected reaction
```

The accent is deliberately saturated. It is doing one job on a screen otherwise made of
white, black and photographs, and a desaturated version of it disappears against a busy
cat photo — which is the exact situation it exists for.

`sage.600` (`#4F7A5C`) is **not** a second accent. It is the muted complement used only
where a success state must sit beside neutral content without competing.

### Neutrals are true neutrals

```
paper.bg          #FFFFFF   app background and card surface
paper.sunken      #F2F2F4   chips, inputs, skeleton bases
paper.sunkenSoft  #F7F7F8   the softer well — reaction bars, inline rows, cards
paper.hairline    #F0F0F1   dividers, meter tracks
paper.hairlineHi  #E3E3E6
paper.text        #0B0B0C
paper.textMuted   #6B6B70
paper.textSubtle  #8A8A90   metadata that still has to be read at a glance
paper.textFaint   #A6A6AC
```

The previous system tinted every neutral warm at hue ~28°, on the reasoning that mixing
warm and cool greys is a banned pattern. It still is — but the constraint that outranks it
here is that **this is a scoring app for photographs**. A warm grey field beside a
photograph shifts the photo's apparent white balance, and a product that tells you your
composition scored 84 cannot be quietly recolouring the thing it is grading. The neutrals
are unbiased for the same reason a gallery wall is.

`chrome.fill` (`#0B0B0C`) is the one opaque dark surface in the light context — the
floating tab bar, the rank disc on a poster, the selected filter chip. Every one of them
uses that exact value, so they read as the same material. Never `#000000`: pure black
clips on OLED and kills the shadow that separates the tab bar from the page.

### Arena (dark context)

```
arena.bg          #0B0B0C
arena.surface     rgba(255,255,255,0.12)
arena.sunken      rgba(255,255,255,0.06)
arena.hairline    rgba(255,255,255,0.15)
arena.hairlineHi  rgba(255,255,255,0.28)
arena.text        #FFFFFF
arena.textMuted   rgba(255,255,255,0.62)
arena.textFaint   rgba(255,255,255,0.32)
```

Surfaces here are white at low alpha rather than opaque greys, because everything on the
camera and the reveal floats over a live preview or a photograph. An opaque grey panel
over a photo reads as a rendering artefact; a translucent one reads as glass.

### Semantic

```
danger   #D6402B
warning  #B4952C
success  #4F7A5C   (= sage.600)
```

### Photo tier — a closed encoding, never an accent

Tier is derived server-side from the composite score: Common below 50, Rare 50–69,
Epic 70–85, Legendary 86 and up.

```
Common      #8B8D98   grey     glyph: Circle    1 pip
Rare        #3B82F6   blue     glyph: Diamond   2 pips
Epic        #A855F7   violet   glyph: Hexagon   3 pips
Legendary   #D9B94C   gold     glyph: Crown     4 pips
```

The ramp runs cool to warm as tier rises. That is the order a player already expects from
every collection game they have played, and fighting the convention to be distinctive
would cost comprehension and buy nothing.

**On the violet.** The Lila-Ban targets neon violet as a *brand* colour — the AI-startup
gradient, the violet CTA, the violet glow. This is none of those. It is one value in a
four-step data scale, it appears only inside a tier badge or a meter fill, and it is
structurally barred from every interactive affordance in the product. If Epic were coral
instead, tier and tappability would share a colour, which is a far worse failure than
using a hue that is unfashionable.

**Application.** Tier is a solid badge worn in the top-right corner of the photograph,
with a glyph and an uppercase label. This replaces the brief's gradient border (banned)
*and* the previous tinted double-bezel shell, which cost 10pt of a 148pt poster to say
something a corner badge says for free. Legendary alone carries a glow — a shadow at its
own hue, never a gradient border — and a sheen sweep on its card, viewport-gated so a
scrolled-off card stops animating.

Never colour alone: `glyph`, `label` and `pips` each carry the same information, so tier
survives greyscale and colourblindness.

### Pose classes get zero colors

Eleven pose classes (`yawning`, `jumping`, `loafing`, …) would mean eleven more hues,
which obliterates the one-accent rule. They are distinguished by **icon glyph + label
only**, rendered in `text` or `textMuted`. The pose appears in the score breakdown as a
named row ("Pose rarity · Mid-yawn"), never as a colour.

---

## 2. Typography

Inter, Nunito, Nunito Sans, Baloo 2, Roboto, Open Sans, Helvetica and Arial are all banned.

```
Display / numerals   Plus Jakarta Sans   700, 800   (@expo-google-fonts/plus-jakarta-sans)
UI / body            Manrope             400–800    (@expo-google-fonts/manrope)
Mode labels          Space Mono          400, 700   (@expo-google-fonts/space-mono)
```

Three voices, each with one job:

**Plus Jakarta Sans ExtraBold** carries display, headings and every number. It is a
tightly-spaced geometric grotesk that goes genuinely heavy at 800, which is what lets a
two-digit score sit on a photograph at 100pt and read as a graphic rather than a caption.
Numbers use it too — a photo app's numbers are trophies, and a trophy set in a text face
is a receipt.

**Manrope** carries UI and body. It is the quieter grotesk: slightly wider, lower
contrast, and legible at the 9–11pt the metadata rows run at, where Jakarta's tight
apertures start to close up.

**Space Mono** carries labels that are not prose — the uppercase eyebrows ("YOUR SCORE",
"AUTO CAPTURE") and technical annotations on a photo. It is the only voice with any
personality, so it is rationed to text that is naming a mode.

Numerals are tabular via `fontVariant`. The previous system used a mono face for every
number specifically because `fontVariant: ['tabular-nums']` is unreliable on Android —
that is true for arbitrary faces, but Jakarta ships real tabular figures, so it resolves
rather than silently no-opping. The cost of the old approach was that every score in the
product was set in a typewriter face.

### Scale

| Token | Size / Line | Tracking | Face | Use |
|---|---|---|---|---|
| `displayHuge` | 88 / 92 | -3.5 | Jakarta 800 | Score reveal (overridden to 100), capture countdown |
| `display` | 34 / 38 | -1.0 | Jakarta 800 | Reserved for full-bleed moments |
| `h1` | 26 / 31 | -0.6 | Jakarta 800 | Screen titles, wordmark, hero cat name |
| `h2` | 20 / 26 | -0.4 | Jakarta 800 | Profile handle, tier label |
| `h3` | 15 / 20 | -0.2 | Jakarta 800 | Section heads, card titles |
| `body` | 14 / 22 | 0 | Manrope 500 | Paragraph, list rows |
| `bodySm` | 12 / 18 | 0 | Manrope 500 | Secondary meta |
| `caption` | 11 / 15 | 0 | Manrope 600 | Timestamps, helper text, chip labels |
| `captionSm` | 9 / 13 | +0.1 | Manrope 600 | The metadata line riding on a card face |
| `eyebrow` | 11 / 14 | +1.2 | Space Mono 700 | Uppercase mode labels |
| `annotation` | 10 / 14 | +0.2 | Space Mono 400 | Technical note printed on a photo |
| `stat` | 13 / 17 | 0 | Manrope 700 | Inline counts next to a glyph |
| `statSm` | 10 / 14 | 0 | Manrope 700 | Counts riding on a photo |
| `statMd` | 18 / 22 | -0.4 | Jakarta 800 | Stat-rail figures |
| `statLg` | 40 / 42 | -1.6 | Jakarta 800 | Score totals |

**No oversized H1s.** `display` caps at 34 on mobile. `displayHuge` is the single
exception, reserved for the score reveal and the capture countdown, where one number is
the entire screen.

**Measure:** body copy is capped at `measure` (≈ 62 characters) via `maxWidth`.

**Orphans:** headings and narrative copy set `{ textBreakStrategy: 'balanced' }` on
Android; iOS gets `preventOrphan()` from `utils/format`.

**Sentence case everywhere.** The only uppercase in the product is `eyebrow` and the tier
badge label.

---

## 3. Materiality

### A. The photograph is the surface

The previous system put every card in a **Double-Bezel**: an outer shell tinted by tier,
a hairline ring, and a concentric inner core holding the image. It is deleted, for two
reasons.

The first is arithmetic. A 6pt shell plus a hairline on each side takes 14pt out of a
110pt Cat Dex tile — roughly a quarter of the cat — to communicate something a corner
badge communicates for free.

The second is that the bezel needed the page to be darker than the card. The page is now
white, so the inner core became the same colour as the background behind it and all the
bezel rendered was a grey picture frame around nothing.

What replaces it: **the photograph runs to the card's own edge**, and the chrome is worn
on the image. One consistent corner grammar across every photo surface in the product —

```
top-left    score chip     chrome black at 55%, white tabular figure
top-right   tier badge     opaque tier fill, glyph + uppercase label
bottom      name / meta    over a two-stop scrim
```

— so a player who has learned to read a feed card can read an album tile, a showcase cell
and a Dex entry without being taught three times.

`concentric()` survives in `theme/radii` for the few genuine nested cases, and remains the
only correct way to derive an inner radius when there is one.

### B. Anti-card-overuse

A card is only allowed when **elevation communicates hierarchy**. Everything else groups
with a `hairline` divider or with pure negative space:

- Settings, Privacy & Data, Friends List → hairlines, no cards
- Profile stat rail → one rule above, one below, dividers between. No box
- Leaderboard rows → hairlines, no boxes
- Album grid, Cat Dex, showcase → the photo *is* the card; no container around it

`Card` itself is now a single soft well (`sunkenSoft`), not a shell wrapping a core. On a
white page a shade off white is enough separation, and it reads as recessed rather than
as one more floating box.

### C. Shadows

Default elevation is **flat**, and most surfaces stay there. On a white page a shadow
under every tile turns a grid into a pile of receipts.

Five levels exist. `hairline` (1/2 at 5%) is the workhorse — it separates a white card
from a white page and does nothing more. `floating` is reserved for the tab bar, which
genuinely hovers over scrolling content, and `modal` for sheets.

Shadows are neutral black at low opacity, matching the neutral chrome, and all point
straight down — one light source. The one exception is `accentGlow()`, which tints a
shadow to the accent's own hue for the capture shutter and the primary CTA: a saturated
coral button dropping a grey shadow looks unlit, and this is the only place in the product
a coloured shadow is allowed.

RN has no `inset` box-shadow, so where an inner highlight is wanted it is a real 1px top
border (`innerHighlight()`).

### D. Glass

Where blur is used it is real glass, not just `expo-blur`:

```
BlurView intensity 40   +   a tint over it   +   1px inner border
```

The tint is not optional. Blur alone samples whatever is behind it, so the same button
over a bright sky and over a dark alley ends up as two different-looking controls — the
tint is what makes them one material.

**Performance constraint:** `BlurView` only ever wraps a fixed or absolutely-positioned
element. Never inside a `ScrollView` or `FlatList` row. In practice this leaves the
capture screen's circle buttons and mode pills, and the photo-detail hero buttons.

### E. Texture

The grain overlay is **arena-only** (`Screen` defaults it to `context === 'arena'`). It
earns its cost there, breaking up banding in the dark gradient behind a 100pt numeral. On
a white page it does not: dots on white read as dirt rather than as tooth, and it was
mounting an SVG overlay on every screen to render a texture nobody could see.

### F. Shape

```
xs   8    icon wells, small glyph squares
sm   10   badges, tier chips, value pills
md   14   secondary buttons, inputs
lg   18   collection tiles, showcase cells, wall cards, cards
xl   20   poster cards on the trending rail
xxl  26   the sheet overlapping a hero, bottom sheets, modals
full 999  primary CTAs, tab bar, avatars, the capture shutter
```

The scale is tighter than it was. Photographs now bleed to the card edge with no bezel
between them, and a 28pt radius on a 148pt poster eats a visible bite out of the cat.
Containers hold their curve; anything wrapping an image sits at 16–20.

Radii vary by depth: tighter inside, softer outside. Uniform radius on everything is a
flagged weakness.

**Avatars are circles.** They were squircles, on the reasoning that circle avatars read as
generic. In this product they read as *photos*: every avatar sits either on a cat
photograph or in a row beside one, and at 36–64pt a rounded square is indistinguishable
from a thumbnail of a cat. The round crop is what says "this is a person", which is the
only thing the shape has to communicate.

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

## 5. Navigation — the floating bar and the shutter

Edge-to-edge nav bars glued to a screen edge are a banned layout. The assembly is a
**dark pill detached from the bottom edge** — inset 16 from each side, lifted clear of the
safe-area inset, `radii.full`, `chrome.fill`, `floating` elevation — with the **capture
shutter riding above it in the accent**.

It replaces the glass pill it used to be. Blur was the wrong material here: the bar sits
over a white feed most of the time, so the blur resolved to a pale smudge with almost no
contrast against the page, and the active tab had to carry the whole burden of being
findable. Solid black gives the glyphs a fixed, high-contrast field regardless of what
scrolls under it — and it costs one less continuously-repainting blur surface.

- Four slots, glyphs only, split two-and-two around the shutter. Labels do not fit at
  this width; the names survive as accessibility labels, which is where a screen reader
  looks for them anyway.
- The **album has no slot**. It gave its position to the shutter, and its stack stays
  mounted and navigable — it is entered from Profile, which is also where its recent
  photos are shown.
- Active tab: Phosphor `fill`, `marmalade.600`, scaled 1.08 on a `snap` spring.
- Inactive tab: Phosphor `regular`, `chrome.textMuted`. Weight and colour change together,
  so the active tab is legible in greyscale.
- Entering Arena context (Capture, Score Result) slides the whole assembly off-screen
  downward with `exit` timing. Immersive screens have no chrome.

### The shutter is not a fifth tab

Taking a photo is the only thing in this product that leaves the tab tree entirely, and it
is the thing the whole app exists to do. So it takes the **centre** and breaks out of the
pill's top edge: a 56pt coral disc with a 4pt white ring and an `accentGlow` shadow,
rising 24pt clear of the bar.

The ring is what makes it read as punching through the pill rather than resting on it.

Four tabs fit around it because the album gave up its slot — the alternative was five tabs
with a disc parked on top of the middle one, which is legible in a still and untappable on
a phone. `fabSlot` holds the centre of the row open; the shutter is absolutely positioned,
so it cannot reserve its own width.

`layout.tabBarClearance` (116) clears the whole assembly, shutter included. Clearing only
the pill would leave the last card in a list half under a coral disc.

**The map carries no capture button.** It used to have a coral camera FAB above the tab
bar; the shutter now sits ~60pt below that spot in the same colour, and two coral camera
buttons that close together read as two different actions the player has to tell apart.

**Icons:** `phosphor-react-native` exclusively — `regular` for content, `fill` for active
state. `regular`, not `light`: the icons here are small (11pt reaction glyphs on a
photograph, 21pt tab glyphs on black) and Phosphor's light stroke disappears at those
sizes against anything but a plain field. Lucide, Feather, FontAwesome and Material are
banned as the default-AI icon choice.

**No emoji.** Anywhere. Not in UI, not in copy, not in push notification bodies, not in
accessibility labels.
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
| `PhotoCard` | Tier gradient border → photo bled to the card edge, score chip top-left, tier badge top-right. `grid` and `feed` variants |
| `ViralCard` | `TrendingCard` (148pt poster, everything worn on the image) and `WallCard` (photo + metadata on white). Not variants of `PhotoCard` — the feed leads with what the community did, the album leads with the app's score |
| `CircleButton` | Round glass/solid icon button for chrome floating on a photograph or the camera preview |
| `TierCrest` | The hexagonal seal on the score reveal. An SVG path, not a CSS `clip-path` polygon — that is web-only and silently renders a plain square on native |
| `RarityGlow` | **Deleted.** Outer glows are banned. Replaced by `RaritySheen` — a masked, translated highlight on Legendary only, viewport-gated |
| `TypeIcon` | **Deleted** with the personality system. Pose is a named row in `ScoreBreakdown`, not an icon-only chip |
| `FramingTimer` | → the capture shutter itself. The countdown ring and the shutter used to be separate objects — a ring mid-screen and a button in a bottom strip — which asked the player to watch one thing and press another. Now one control: an SVG arc driven by `strokeDashoffset` through `useAnimatedProps`, so it runs on the UI thread over a live preview. `FramingRing` in `ProgressBar` remains for the smaller inline case |
| `LoadingSpinner` | **Deleted.** Skeletons matching each layout's shape replace it everywhere; capture progress lives in the shutter button |
| `Badge` | Tier badges are pills carrying a glyph + uppercase label, worn on the photograph. That is the one place a pill is right — it is a label on an image, not a "New"/"Beta" tag stuck to a menu item. `RarityChip` (tinted, for tier counts on neutral chrome), `ScoreChip` (the app's score on a photo face) and `Eyebrow` (now bare mono text, not a tinted pill) live here too |
| `TabBar` | → `FloatingTabBar` (§5): four slots on a solid dark pill, glyphs only, with the capture shutter breaking out of the pill's top edge in the centre. The album is reached from Profile |
| `ProgressBar` | `MeterBar` (rank XP, album quota), `ScoreMeter` (one breakdown row, `inline` or `stacked`, staggered fill, one hue per component), `FramingRing`. All `scaleX`/`rotate`, never animated `width` |
| `Avatar` | Circle default (§3.F); `squircle` retained for the shop's frame previews |
| `Card` | Base variant is **flat** — hairline, no shadow. Elevation is opt-in |
| `VoteButton` | Laugh/love/wow only. There is deliberately no downvote to style. `sm` is the inline pill under a feed card; `lg` is the 44pt bar on Photo Detail, where reacting is a primary action |

### 6.2b The viral feed has no window control

Today / This week / All time shipped as chips above the trending rail and have been
removed. A time window is a lever on a ranking, and the ranking is not settled — offering
three ways to slice a result set the product cannot yet explain asks the player to tune
something nobody understands, and it puts a row of chrome above the first photograph on
the app's home screen.

The window still exists server-side, and the client still tracks which one it was served
so paging keeps asking for the same slice. Restoring the control later is re-adding a
component, not re-plumbing the screen.

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
error text below. Visible focus treatment on every input — a 2px `marmalade.600` ring, not a
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

- [ ] One *interactive* accent only. Tier hues appear on tier badges and meter fills and
      nowhere else — never on a button, link or focus ring
- [ ] No Inter / Nunito / Baloo / Roboto / Arial in any style object; numerals are Jakarta
      800 with tabular figures
- [ ] No `#000000` as a surface; neutrals are untinted, so no photo's white balance shifts
- [ ] Photographs bleed to their card's edge; tier is a corner badge, never a tint over
      the image, so no photo is ever colour-cast by its own score
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
