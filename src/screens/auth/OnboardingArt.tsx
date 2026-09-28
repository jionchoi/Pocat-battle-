import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUp, Cat, Equals, LockSimple, ShieldCheck, Sun } from 'phosphor-react-native';

import { lagoon, marmalade, paper, radii, spacing, text } from '../../theme';

/**
 * The four illustrations that sit above the onboarding copy.
 *
 * Their own file because they are the bulk of the screen and none of them is reused: keeping
 * them here leaves `OnboardingScreen` as the flow — paging, permissions, footer — rather than
 * six hundred lines of decoration with the navigation buried in it.
 *
 * ## Everything here is a drawing, not data
 *
 * No component in this file fetches, counts or reads a store. The scores, the cat names and
 * the map pins are illustrations of what the product does, shown to somebody who has not yet
 * signed in and therefore has no photographs, no cats and no rank to draw from. Wiring these
 * to live values would mean four empty frames on the one screen whose whole job is to show
 * what a full one looks like.
 *
 * The one rule that follows: **nothing here may state a fact about the reader**. "1,204 cats
 * met on your streets" is the product's number, not a claim about this person's album.
 */

/* -------------------------------------------------------------------------- */
/* The stand-in photograph                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A photograph that does not exist yet.
 *
 * The design canvas draws these as diagonal hatching, which is a mock-up convention meaning
 * "a picture goes here" — printed literally into a shipped build it reads as a rendering
 * fault. These are flat neutral gradients instead: unmistakably placeholder, quiet enough to
 * sit under type, and carrying no hue, because a tinted grey beside a photograph shifts its
 * apparent white balance and this app judges photographs for a living.
 *
 * Bundling four sample cat photographs would be better than either and is the obvious later
 * change — `tone` is already the only thing a caller picks, so swapping the fill for an
 * `<Image>` is a change inside this component.
 */
const TONES = {
  light: ['#D8D8DD', '#C4C4CA'],
  mid: ['#C2C2C8', '#ADADB4'],
  dim: ['#A8A8AF', '#93939A'],
  dark: ['#9A9AA1', '#84848B'],
} as const;

export type PhotoTone = keyof typeof TONES;

export const PhotoBlock = React.memo(function PhotoBlock({
  tone = 'mid',
  label,
  style,
  children,
}: {
  tone?: PhotoTone;
  /** A mono caption printed into the frame — "SIT", "MID-YAWN". Names what it depicts. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.photo, style]}>
      <LinearGradient
        colors={[...TONES[tone]]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {label ? (
        <View style={styles.photoLabelWrap} pointerEvents="none">
          <Text style={[text.eyebrow, styles.photoLabel]}>{label}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Slide 1 — the album wall                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Three columns of captures, running off the top of the screen behind the title.
 *
 * The columns are deliberately out of step with each other — a masonry wall, the layout
 * archetype the design system names — and the whole thing fades to white before the type
 * starts, so the copy sits on paper rather than on a picture.
 */
export const AlbumWall = React.memo(function AlbumWall({ height }: { height: number }) {
  return (
    <View style={[styles.wall, { height }]} pointerEvents="none">
      <View style={styles.wallRow}>
        <View style={[styles.wallCol, { transform: [{ translateY: -18 }] }]}>
          <PhotoBlock tone="light" style={{ height: 168 }} />
          <PhotoBlock tone="dim" style={{ height: 132 }} />
          <PhotoBlock tone="light" style={{ height: 200 }} />
        </View>

        <View style={styles.wallCol}>
          <PhotoBlock tone="dark" style={{ height: 210 }}>
            {/* The one scored frame on the wall. One number is enough to say what the
                album is for; a score on every tile would be wallpaper. */}
            <View style={styles.scorePill}>
              <Text style={styles.scorePillText}>92</Text>
            </View>
          </PhotoBlock>
          <PhotoBlock tone="mid" style={{ height: 148 }} />
          <PhotoBlock tone="dim" style={{ height: 160 }} />
        </View>

        <View style={[styles.wallCol, { transform: [{ translateY: -34 }] }]}>
          <PhotoBlock tone="light" style={{ height: 140 }} />
          <PhotoBlock tone="dark" style={{ height: 186 }} />
          <PhotoBlock tone="mid" style={{ height: 170 }} />
        </View>
      </View>

      {/*
        The fade is what makes this a background rather than a picture the title is stuck on.
        It has to end fully opaque: any transparency at the last stop leaves a grey seam
        across the screen exactly where the eyebrow starts.
      */}
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.92)', '#FFFFFF']}
        locations={[0.42, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.wallPill}>
        <Cat size={15} weight="fill" color={paper.bg} />
        <Text style={styles.wallPillText}>1,204 cats met on your streets</Text>
      </View>
    </View>
  );
});

/** The overlapping regulars under slide one's rule. */
export const RegularsRow = React.memo(function RegularsRow() {
  return (
    <View style={styles.regulars}>
      <View style={styles.stack}>
        <PhotoBlock tone="light" style={styles.avatar} />
        <PhotoBlock tone="dim" style={[styles.avatar, styles.avatarOverlap]} />
        <PhotoBlock tone="mid" style={[styles.avatar, styles.avatarOverlap]} />
      </View>
      <Text style={styles.regularsText}>Mochi, Biscuit and Loaf are regulars</Text>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Slide 2 — the moment                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Two photographs of the same cat, side by side, with what each one scored.
 *
 * This is the slide doing the most work in the flow. It is asking for the camera, and the
 * argument for saying yes is not "we need it to take photos" — it is that waiting is worth
 * points. Two frames and two numbers make that case faster than the paragraph under them,
 * which is why the taller, sharper, better-lit one is also the one that scored.
 */
export const MomentCompare = React.memo(function MomentCompare() {
  return (
    <View>
      <View style={styles.compare}>
        <View style={{ flex: 150 }}>
          <PhotoBlock tone="light" label="SIT" style={styles.compareLoser} />
          <View style={styles.compareCaption}>
            <Text style={[text.h2, { color: paper.textFaint }]}>61</Text>
            <Text style={[text.bodySm, { color: paper.textSubtle, flexShrink: 1 }]}>
              Snapped straight away
            </Text>
          </View>
        </View>

        <View style={{ flex: 172 }}>
          <PhotoBlock tone="dark" label="MID-YAWN" style={styles.compareWinner}>
            <View style={styles.gainPill}>
              <ArrowUp size={11} weight="bold" color={paper.bg} />
              <Text style={styles.gainPillText}>27</Text>
            </View>
          </PhotoBlock>
          <View style={styles.compareCaption}>
            <Text style={[text.h2, { color: paper.text }]}>88</Text>
            <Text style={[text.bodySm, styles.compareWinnerLabel]}>You waited</Text>
          </View>
        </View>
      </View>

      {/*
        The shutter, drawn at the size it is drawn on the camera screen.

        It is here because the sentence beside it is the correction: the app used to fire on
        its own and the old onboarding taught that. Somebody who has heard of this app before
        needs to see the control, not just be told the countdown is gone.
      */}
      <View style={styles.shutterNote}>
        <View style={styles.shutterRing}>
          <View style={styles.shutterDisc} />
        </View>
        <Text style={[text.bodySm, { color: paper.textMuted, flex: 1 }]}>
          The shutter only fires when you press it. No auto-capture, no countdown.
        </Text>
      </View>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Slide 3 — the neighbourhood                                                */
/* -------------------------------------------------------------------------- */

/**
 * A street grid with pins on it, and a dashed ring where a home area would be.
 *
 * The ring is the whole point of the illustration. This slide asks for location, and the
 * honest version of that request has to show the coarsening rather than only promise it —
 * the pins are precise, the area is a soft blur several streets wide, and the badge names
 * the difference in the four words a reader will actually take in.
 */
export const NeighbourhoodMap = React.memo(function NeighbourhoodMap() {
  return (
    <View>
      <View style={styles.map}>
        {/* Blocks, drawn as pale roads over a sunken field rather than as a grid of lines:
            RN has no repeating background, and four strips read as streets anyway. */}
        <View style={[styles.road, styles.roadV]} />
        <View style={[styles.road, styles.roadH]} />

        <View style={styles.homeArea} />

        <Pin size={30} glyph={16} tone="accent" style={{ top: 86, left: 96 }} />
        <Pin size={26} glyph={14} tone="accent" style={{ top: 138, left: 168 }} />
        <Pin size={22} glyph={12} tone="ink" style={{ top: 62, left: 176 }} />

        <View style={styles.mapBadge}>
          <ShieldCheck size={13} weight="fill" color={lagoon[600]} />
          <Text style={[text.caption, { color: lagoon[600] }]}>
            Rounded home area, not an address
          </Text>
        </View>
      </View>

      <View style={styles.recognise}>
        <PhotoBlock tone="light" style={styles.recogniseThumb} />
        <Equals size={14} weight="bold" color={paper.textFaint} />
        <PhotoBlock tone="light" style={styles.recogniseThumb} />
        <Text style={[text.bodySm, styles.recogniseText]}>
          <Text style={styles.recogniseStrong}>Same corner, same cat — </Text>
          Mochi recognised on sight two
        </Text>
      </View>
    </View>
  );
});

const Pin = React.memo(function Pin({
  size,
  glyph,
  tone,
  style,
}: {
  size: number;
  glyph: number;
  tone: 'accent' | 'ink';
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.pin,
        style,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone === 'accent' ? marmalade[600] : paper.text,
          shadowOpacity: tone === 'accent' ? 0.35 : 0,
        },
      ]}
    >
      <Cat size={glyph} weight="fill" color={paper.bg} />
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Slide 4 — the verdict                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A reveal, reproduced at rest.
 *
 * The four bars are the four components the rubric actually returns, in the order the score
 * breakdown draws them, and the bonus row is coral because a bonus is the only one of the
 * four that is not guaranteed. It is the last thing seen before "Get started", so it is a
 * picture of the payoff rather than another explanation of it.
 *
 * The numbers are illustrative and sum to the 88 above them. Anything else here would be a
 * breakdown that does not add up, on the screen teaching people to read a breakdown.
 */
const BARS = [
  { label: 'Composition', value: '31', fill: 0.78, accent: false },
  { label: 'Pose rarity', value: '28', fill: 0.7, accent: false },
  { label: 'Cat rarity', value: '23', fill: 0.58, accent: false },
  { label: 'Light bonus', value: '+6', fill: 0.24, accent: true },
] as const;

export const ScoreSheet = React.memo(function ScoreSheet() {
  return (
    <View>
      <View style={styles.verdict}>
        <PhotoBlock tone="dark" label="PHOTO" style={styles.verdictPhoto} />

        <View style={styles.verdictBody}>
          <View style={styles.totalRow}>
            <Text style={[text.statLg, { color: paper.text }]}>88</Text>
            <Text style={[text.h2, { color: paper.textFaint }]}>/100</Text>
          </View>

          <View style={styles.lightChip}>
            <Sun size={13} weight="fill" color={marmalade[600]} />
            <Text style={[text.caption, { color: paper.text }]}>Great light · +6</Text>
          </View>
        </View>
      </View>

      <View style={styles.bars}>
        {BARS.map((bar) => (
          <View key={bar.label}>
            <View style={styles.barHead}>
              <Text style={[text.bodySm, { color: paper.textMuted }]}>{bar.label}</Text>
              <Text
                style={[text.h3, { color: bar.accent ? marmalade[600] : paper.text }]}
              >
                {bar.value}
              </Text>
            </View>
            <View
              style={[
                styles.barTrack,
                { backgroundColor: bar.accent ? marmalade[200] : paper.sunken },
              ]}
            >
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${bar.fill * 100}%`,
                    backgroundColor: bar.accent ? marmalade[600] : paper.text,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={styles.privateChip}>
        <LockSimple size={14} weight="fill" color={paper.textMuted} />
        <Text style={[text.bodySm, { color: paper.textMuted }]}>
          Private until you share it
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  photo: {
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  photoLabelWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLabel: {
    color: 'rgba(255,255,255,0.58)',
  },

  /* Slide 1 */
  wall: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  wallRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    gap: 4,
  },
  wallCol: {
    flex: 1,
    gap: 4,
  },
  scorePill: {
    position: 'absolute',
    top: 12,
    left: 12,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scorePillText: {
    ...text.h3,
    fontSize: 17,
    color: paper.bg,
  },
  wallPill: {
    position: 'absolute',
    top: 64,
    left: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: 'rgba(11,11,12,0.72)',
  },
  wallPillText: {
    ...text.bodySm,
    color: paper.bg,
  },
  regulars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: paper.hairlineHi,
  },
  stack: {
    flexDirection: 'row',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: paper.bg,
  },
  avatarOverlap: {
    marginLeft: -10,
  },
  regularsText: {
    ...text.bodySm,
    color: lagoon[600],
    flexShrink: 1,
  },

  /* Slide 2 */
  compare: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  compareLoser: {
    height: 154,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: paper.hairlineHi,
  },
  compareWinner: {
    height: 190,
    borderRadius: radii.lg,
    shadowColor: paper.text,
    shadowOpacity: 0.18,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 6,
  },
  compareCaption: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 10,
  },
  compareWinnerLabel: {
    color: paper.text,
    flexShrink: 1,
  },
  gainPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
  },
  gainPillText: {
    ...text.h3,
    fontSize: 12,
    color: paper.bg,
  },
  shutterNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: paper.sunkenSoft,
  },
  shutterRing: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    borderWidth: 3,
    borderColor: marmalade[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisc: {
    width: 26,
    height: 26,
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
  },

  /* Slide 3 */
  map: {
    height: 236,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: paper.hairlineHi,
  },
  road: {
    position: 'absolute',
    backgroundColor: paper.bg,
  },
  roadV: {
    top: 0,
    bottom: 0,
    left: 118,
    width: 26,
  },
  roadH: {
    left: 0,
    right: 0,
    top: 96,
    height: 22,
  },
  homeArea: {
    position: 'absolute',
    top: 52,
    left: 60,
    width: 168,
    height: 138,
    borderRadius: radii.full,
    backgroundColor: 'rgba(14,112,120,0.10)',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: lagoon[600],
  },
  pin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: marmalade[600],
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  mapBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: radii.full,
    backgroundColor: lagoon[100],
  },
  recognise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.md,
  },
  recogniseThumb: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
  },
  recogniseText: {
    color: paper.textMuted,
    flex: 1,
  },
  recogniseStrong: {
    ...text.caption,
    color: paper.text,
  },

  /* Slide 4 */
  verdict: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  verdictPhoto: {
    width: 132,
    height: 150,
    borderRadius: radii.lg,
    shadowColor: paper.text,
    shadowOpacity: 0.14,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  verdictBody: {
    flex: 1,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  lightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  bars: {
    gap: 10,
    marginTop: spacing.lg,
  },
  barHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  barTrack: {
    height: 6,
    borderRadius: radii.full,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radii.full,
  },
  privateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: paper.sunkenSoft,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
