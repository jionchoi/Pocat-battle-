import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import {
  CloudRain,
  Crown,
  Moon,
  Sparkle,
  Sun,
  Trophy,
  Users,
  type IconProps,
} from 'phosphor-react-native';

import { RarityBadge, ScoreChip } from './Badge';
import { rankTitle, tierFor } from '../constants/game';
import type {
  ChallengeIconKey,
  ChallengeTrophy,
  LeaderboardEntry,
  Photo,
} from '../models';
import { chrome, lagoon, marmalade, paper, radii, spacing, text } from '../theme';
import { compactNumber, pluralize } from '../utils/format';

/**
 * The pieces both profiles are built from.
 *
 * Your own profile and a stranger's are the same screen with different permissions, so
 * they are the same components rather than two implementations that drift. What the public
 * one drops is everything that is *yours* — the settings gear, the shop, the album links,
 * the storage quota, the achievements — not the way a photographer is presented.
 */

/** Two across, and six is the cap the showcase toggle enforces on Photo Detail. */
export const SHOWCASE_LIMIT = 6;

/**
 * The player's title, directly under their name rather than in a card further down.
 */
export const RankPill = React.memo(function RankPill({ rank }: { rank: number }) {
  return (
    <View style={styles.rankPill}>
      <Crown size={11} weight="fill" color={marmalade[600]} />
      <Text style={[text.caption, styles.rankPillText]} numberOfLines={1}>
        {`Rank ${rank} · ${rankTitle(rank)}`}
      </Text>
    </View>
  );
});

/**
 * Four figures on one rule.
 *
 * Hairlines above, below and between, no card: these are a masthead for the screen, and
 * boxing them would make them look like one more section competing with the ones that
 * follow.
 */
export const StatRail = React.memo(function StatRail({
  stats,
  style,
}: {
  stats: { label: string; value: number }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.statRail, style]}>
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          style={[styles.railCell, index > 0 && styles.railDivider]}
        >
          <Text style={[text.statMd, { color: paper.text }]}>
            {compactNumber(stat.value)}
          </Text>
          <Text style={[text.captionSm, styles.railLabel]} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
});

/**
 * A showcase cell: the photo, its score top-left, its tier top-right.
 *
 * Same corner grammar as every other photo surface in the product, so a player who has
 * learned to read a feed card can read this without being taught twice.
 */
export const ShowcaseTile = React.memo(function ShowcaseTile({
  photo,
  width,
  onPress,
}: {
  photo: Photo;
  /**
   * Measured, not a percentage. A wrapping flex row with a `gap` cannot hold two 50%
   * children — the gap pushes the second onto its own line — so the width is computed
   * from the window once and handed down.
   */
  width: number;
  /** Omitted on a stranger's profile: their album is private, so there is nothing to open. */
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;
  const [failed, setFailed] = React.useState(false);

  return (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${photo.catNickname}, scored ${photo.scores.total}, ${photo.tier}`}
      style={[styles.showcaseTile, { width }]}
    >
      {/*
        The aspect-ratio box is this plain View, not the Pressable around it.
        
        They were the same element, and the tile rendered as a correctly sized white blank:
        an `absoluteFill` child resolves its height against its parent's *resolved* height,
        and a parent whose height comes from `aspectRatio` on a pressability wrapper can hand
        it zero. The box took up space, the photograph painted nothing, and no error was
        raised because nothing had failed. `PhotoCard` never had the bug because it has always
        kept the ratio on an inner View — this now matches it.
      */}
      <View style={styles.showcaseFrame}>
        <Image
          source={photo.imageUrl || undefined}
          contentFit="cover"
          transition={200}
          style={StyleSheet.absoluteFill}
          accessible={false}
          /*
           * A tile that cannot load its photograph says so.
           *
           * Without this the failure is invisible: the box is sized from `aspectRatio`, so a
           * dead URL leaves a correctly proportioned empty space that looks like a layout bug
           * rather than a missing image, and there is nothing on screen or in the log to say
           * which of the two it is. The url is logged because it is the only thing that
           * distinguishes "the row is wrong" from "the object is gone".
           */
          onError={(event) => {
            setFailed(true);
            console.warn('[showcase] image failed', photo.id, photo.imageUrl, event?.error);
          }}
        />

        {failed || !photo.imageUrl ? (
          <View style={styles.showcaseMissing}>
            <Text style={[text.caption, { color: paper.textFaint }]}>No image</Text>
          </View>
        ) : null}

        {/* Withheld until scored, for the reason spelled out in `FeedPost`. */}
        <View style={styles.showcaseCorners} pointerEvents="none">
          <ScoreChip score={photo.scores.total} scored={photo.scoredAt !== null} />
          {photo.scoredAt !== null ? (
            <RarityBadge rarity={photo.tier} size="sm" compact />
          ) : null}
        </View>
      </View>
    </Container>
  );
});

/**
 * A photograph that is on the board, shown on its photographer's profile.
 *
 * Only ever rendered for a top-ten placing (see `useBoardStanding`), so it is a trophy
 * rather than a rank readout — which is why the numeral is a badge on the corner of the
 * image and not a line of text under it. The photograph is the achievement; the number
 * says how far it got.
 *
 * It sits between the stat rail and the showcase because that is the seam between what a
 * player *is* and what they *chose to show*, and this is neither: it is what the crowd
 * put them at.
 */
export const BoardTrophy = React.memo(function BoardTrophy({
  entry,
  label,
  style,
}: {
  entry: LeaderboardEntry;
  /** "Your best score" on your own profile, "Best score" on somebody else's. */
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tier = tierFor(entry.value);

  return (
    <View style={[styles.trophy, style]}>
      <Image
        source={entry.topPhotoUrl || undefined}
        contentFit="cover"
        transition={220}
        style={StyleSheet.absoluteFill}
        accessibilityLabel={`Ranked ${entry.rank} in the neighbourhood, scored ${entry.value}`}
      />

      <View style={styles.trophyScrim} pointerEvents="none" />

      <View style={styles.trophyRank}>
        <Text style={[text.statSm, styles.onPhoto]}>{entry.rank}</Text>
      </View>

      <View style={styles.trophyFoot}>
        <View style={styles.trophyText}>
          <Text style={[text.eyebrow, styles.trophyEyebrow]}>{label}</Text>
          <Text style={[text.caption, styles.trophyMeta]} numberOfLines={1}>
            {`${tier} · ${entry.rank === 1 ? 'top of the neighbourhood' : `number ${entry.rank} nearby`}`}
          </Text>
        </View>
        <Text style={[text.statLg, styles.onPhoto]}>{entry.value}</Text>
      </View>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Trophy case                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The same glyph set the Challenges hub uses, so a challenge is recognisable on a profile as
 * the one you entered. Kept local rather than imported from `ChallengeBanner`, which would
 * pull the hero, its gradient and the leader card in behind it — a profile needs none of
 * that to draw a 15pt icon.
 */
const TROPHY_GLYPHS: Record<ChallengeIconKey, React.ComponentType<IconProps>> = {
  rain: CloudRain,
  sun: Sun,
  night: Moon,
  rarity: Sparkle,
  community: Users,
  trophy: Trophy,
};

/** Wide enough for two lines of challenge title under a 4:5 crop, narrow enough that a
 *  second tile is always visibly cut off — which is what says the rail scrolls. */
const TROPHY_WIDTH = 132;

/**
 * Challenges this player has won.
 *
 * ## Why it is public, and why it is a rail of photographs
 *
 * Everything else on a profile is either a total or something the player chose to show. A win
 * is neither: it was decided by the field, and it is the only claim on the screen that says
 * this photographer beat *other people* rather than beat a threshold. So it is public on both
 * profiles — same component, same data, same heading.
 *
 * The heading does not change between them. It was "Challenges @name won" on a stranger's,
 * which is a sentence rather than a section label: it wrapped on any handle longer than a
 * word, it pushed the count off the row, and it said something the reader already knew from
 * the avatar six lines above it. Whose profile this is has been settled by the time anyone
 * reaches this rail.
 *
 * It draws the winning photograph rather than a medal, for the reason the whole product
 * exists: the trophy *is* the picture. A row of identical cups says nothing about which
 * challenge was which, and a player scanning their own profile is looking for the shot — the
 * count is already three cells along in the stat rail.
 *
 * ## It disappears entirely at zero
 *
 * No empty state, no "no wins yet" card. A section explaining that somebody has not won
 * anything is a section about a failure, and on a stranger's profile it invites a reading of
 * the person that the app has no business proposing. This returns null and the screen closes
 * up around it.
 */
export const TrophyCase = React.memo(function TrophyCase({
  trophies,
  onPress,
  style,
}: {
  trophies: readonly ChallengeTrophy[];
  /** Opens the challenge's results. Omitted where there is nothing to open. */
  onPress?: (trophy: ChallengeTrophy) => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (trophies.length === 0) return null;

  return (
    <View style={[styles.case, style]}>
      {/*
        Glyph and title on the left, count hard right — the same three-part row every
        `SectionHeader` in the product draws. It used to be three items sharing one gap, so
        "3 wins" sat wherever the title happened to end and drifted from card to card; a
        count that moves with the length of the word beside it reads as a typo.
      */}
      <View style={styles.caseHead}>
        <Trophy size={15} weight="fill" color={lagoon[600]} />
        <Text style={[text.h3, styles.caseTitle]} numberOfLines={1}>
          Challenges won
        </Text>
        <Text style={[text.caption, styles.trophySub]}>
          {pluralize(trophies.length, 'win')}
        </Text>
      </View>

      {/*
        A rail rather than a wrapping grid. Wins arrive one a week at most, so the set stays
        small for a long time, and a grid holding one tile beside two empty columns is a worse
        picture of "you have won something" than a short rail is. It also keeps the section one
        row tall however full the case gets, which is what stops a decorated player's profile
        pushing their photographs off the screen.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.caseRail}
      >
        {trophies.map((trophy) => (
          <TrophyTile key={trophy.challengeId} trophy={trophy} onPress={onPress} />
        ))}
      </ScrollView>
    </View>
  );
});

/**
 * One win: the photograph, the challenge it took, and what it beat.
 *
 * The gold pill is the only use of gold in the product, and it is deliberate — first place is
 * the one state allowed to look like first place. Flat, not a gradient or a shine, so it stays
 * a label rather than becoming a sticker.
 */
const TrophyTile = React.memo(function TrophyTile({
  trophy,
  onPress,
}: {
  trophy: ChallengeTrophy;
  onPress?: (trophy: ChallengeTrophy) => void;
}) {
  const Glyph = TROPHY_GLYPHS[trophy.icon ?? 'trophy'] ?? Trophy;
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress ? () => onPress(trophy) : undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Won ${trophy.title}${
        trophy.score !== null ? `, scored ${trophy.score}` : ''
      }, ${pluralize(trophy.entrants, 'entrant')}`}
      style={styles.trophyTile}
    >
      <View style={styles.trophyFrame}>
        <Image
          source={trophy.photoUrl || undefined}
          contentFit="cover"
          transition={200}
          style={StyleSheet.absoluteFill}
          accessible={false}
        />

        {/*
          The winning photograph can be gone: `winning_photo_id` is `on delete set null`, and
          a player may delete the photo they won with. The win outlives it, so the tile falls
          back to the challenge's own glyph rather than to a hole.
        */}
        {!trophy.photoUrl ? (
          <View style={styles.trophyMissing}>
            <Glyph size={24} weight="fill" color={paper.textFaint} />
          </View>
        ) : null}

        <View style={styles.trophyRibbon}>
          <Trophy size={10} weight="fill" color={chrome.fill} />
          <Text style={[text.eyebrow, styles.trophyRibbonText]}>1st</Text>
        </View>

        {trophy.score !== null ? (
          <View style={styles.trophyScore}>
            <Text style={[text.statSm, styles.onPhoto]}>{trophy.score}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[text.caption, styles.trophyTitle]} numberOfLines={2}>
        {trophy.title}
      </Text>
      <Text style={[text.captionSm, styles.trophySub]} numberOfLines={1}>
        {`${compactNumber(trophy.entrants)} entered`}
      </Text>
    </Container>
  );
});

export const profileStyles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  headBody: {
    flex: 1,
    gap: 6,
  },
  showcase: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

const styles = StyleSheet.create({
  /* ------------------------------ trophy case ------------------------------ */
  case: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  caseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /** Takes the slack, which is what pins the count to the right edge of the row. */
  caseTitle: {
    flex: 1,
    color: paper.text,
  },
  caseRail: {
    gap: spacing.sm,
    // The screen is already gutter-padded, so the first tile is flush and only the tail
    // needs air — otherwise the last tile sits hard against the window edge.
    paddingRight: spacing.xs,
  },
  trophyTile: {
    width: TROPHY_WIDTH,
    gap: 3,
  },
  trophyFrame: {
    width: TROPHY_WIDTH,
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  trophyMissing: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trophyRibbon: {
    position: 'absolute',
    top: 7,
    left: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: '#F2C14E',
  },
  trophyRibbonText: {
    color: chrome.fill,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  trophyScore: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: chrome.onPhoto,
  },
  trophyTitle: {
    color: paper.text,
  },
  trophySub: {
    color: paper.textFaint,
  },

  trophy: {
    marginTop: spacing.lg,
    /**
     * Portrait, and the same 4:5 as every other photo tile in the product. A cat is a
     * vertical subject and the old fixed 168pt made a full-width card roughly 2:1 — a
     * letterbox crop that cut the animal off at both ends.
     */
    aspectRatio: 4 / 5,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
    justifyContent: 'flex-end',
  },
  trophyScrim: {
    ...StyleSheet.absoluteFillObject,
    top: '40%',
    backgroundColor: 'rgba(11, 11, 12, 0.46)',
  },
  /** Top-left, where a rank numeral sits on every other photo surface in the product. */
  trophyRank: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 7,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 11, 12, 0.55)',
  },
  trophyFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm + 2,
  },
  trophyText: {
    flex: 1,
    gap: 2,
  },
  trophyEyebrow: {
    color: '#FFFFFF',
  },
  trophyMeta: {
    color: 'rgba(255, 255, 255, 0.76)',
  },
  onPhoto: {
    color: '#FFFFFF',
  },
  rankPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: marmalade[100],
  },
  rankPillText: {
    color: marmalade[600],
    flexShrink: 1,
  },
  statRail: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: paper.hairline,
  },
  railCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  railDivider: {
    borderLeftWidth: 1,
    borderLeftColor: paper.hairline,
  },
  railLabel: {
    color: paper.textSubtle,
  },
  showcaseTile: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: paper.sunken,
  },
  /** Owns the ratio, so the image has a real height to fill. See the note at the call site. */
  showcaseFrame: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  showcaseMissing: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showcaseCorners: {
    position: 'absolute',
    top: 7,
    left: 7,
    right: 7,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
});
