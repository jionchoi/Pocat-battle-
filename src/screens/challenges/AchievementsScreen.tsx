import React, { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { CheckCircle, Lock } from 'phosphor-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Screen, ScreenHeader } from '../../components/Screen';
import { TRACKS, type Achievement, type TrackId } from '../../constants/achievements';
import { useAchievements } from '../../hooks/useAchievements';
import type { ChallengesStackParamList } from '../../navigation/types';
import { layout, marmalade, paper, radii, spacing, text } from '../../theme';

/**
 * Achievements.
 *
 * ## Two designs came before this one, and both failed on the same axis
 *
 * The first was a Minecraft advancement graph: a wide canvas of tiles joined by elbows,
 * panned in two directions. The second was a Duolingo path: one winding column of discs
 * climbing the screen. Both drew the *structure* of the set, and both stopped working as
 * soon as the set grew — a graph gets wider than the phone, a path gets longer than
 * patience, and neither can be skimmed or searched. Seventeen entries is not the problem
 * this screen has to survive; the fiftieth is.
 *
 * So this one draws the *content* instead. A sectioned list: banded by track, sticky
 * headings, one row per entry, virtualised. It absorbs a hundred entries without a single
 * layout decision changing, it can be scrolled to a heading, and every row is the same
 * shape — which is what makes a long list readable rather than merely long.
 *
 * ## What a list loses, and how it is paid back
 *
 * A tree shows what opens what; a list does not. That relationship is worth keeping, so it
 * is stated in words on the only rows where it matters: a locked entry reads "Unlocks
 * after Serious Collection" rather than being drawn hanging off it. Words scale to any
 * depth and survive being read aloud, which the elbows never did.
 *
 * A tree also answers "what is next" by shape. The **Next up** card answers it outright,
 * in constant screen space no matter how many entries exist — the nearest unearned one,
 * with the exact distance left. It is the thing most players open this screen for, so it
 * sits above the sections rather than inside them.
 */

type Props = NativeStackScreenProps<ChallengesStackParamList, 'Achievements'>;

interface Section {
  id: TrackId;
  title: string;
  blurb: string;
  earned: number;
  total: number;
  data: Achievement[];
}

export function AchievementsScreen(_: Props) {
  const achievements = useAchievements();

  const earned = achievements.filter((a) => a.achieved).length;

  /** Titles by id, so a locked row can name the entry that opens it. */
  const titleById = useMemo(
    () => new Map(achievements.map((entry) => [entry.id, entry.title])),
    [achievements]
  );

  const sections = useMemo<Section[]>(
    () =>
      TRACKS.map((track) => {
        const data = achievements.filter((entry) => entry.track === track.id);

        return {
          id: track.id,
          title: track.title,
          blurb: track.blurb,
          earned: data.filter((entry) => entry.achieved).length,
          total: data.length,
          data,
        };
      }).filter((section) => section.total > 0),
    [achievements]
  );

  /**
   * The nearest thing to done.
   *
   * Ranked by how far along it is, then by how few steps it needs — so a player one photo
   * from a ten-photo target is pointed there rather than at a 90%-complete hundred-reaction
   * grind. Falls back to anything open but unstarted, which is what a new account has.
   */
  const nextUp = useMemo(() => {
    const open = achievements.filter((entry) => entry.unlocked && !entry.achieved);
    if (open.length === 0) return null;

    const started = open.filter((entry) => entry.current > 0);
    const pool = started.length > 0 ? started : open;

    return [...pool].sort(
      (a, b) => b.ratio - a.ratio || a.target - a.current - (b.target - b.current)
    )[0];
  }, [achievements]);

  return (
    <Screen padded={false}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.head}>
            <ScreenHeader
              title="Achievements"
              subtitle={`${earned} of ${achievements.length} unlocked.`}
              style={styles.header}
            />

            <View style={styles.overall}>
              <View style={styles.overallTrack}>
                <View
                  style={[
                    styles.overallFill,
                    {
                      width: `${
                        achievements.length === 0
                          ? 0
                          : Math.round((earned / achievements.length) * 100)
                      }%`,
                    },
                  ]}
                />
              </View>
            </View>

            {nextUp ? <NextUp entry={nextUp} /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <SectionHeading section={section as Section} />
        )}
        renderItem={({ item }) => (
          <Row
            entry={item}
            opensAfter={item.parent ? titleById.get(item.parent) : undefined}
          />
        )}
        SectionSeparatorComponent={null}
      />
    </Screen>
  );
}

/**
 * The one to go and do.
 *
 * Deliberately the only card on the screen. Everything below it is a row, so the card is
 * legible as an instruction rather than as the first item of a list — and there is exactly
 * one, because a screen with three things to do next has none.
 */
const NextUp = React.memo(function NextUp({ entry }: { entry: Achievement }) {
  const { Glyph } = entry;
  const accent = entry.accent ?? marmalade[600];
  const remaining = Math.max(0, entry.target - entry.current);

  return (
    <View style={styles.next}>
      <Text style={[text.eyebrow, styles.nextEyebrow]}>Next up</Text>

      <View style={styles.nextBody}>
        <View style={[styles.nextTile, { backgroundColor: `${accent}1F` }]}>
          <Glyph size={22} color={accent} />
        </View>

        <View style={styles.nextText}>
          <Text style={[text.h3, { color: paper.text }]} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={[text.bodySm, { color: paper.textMuted }]} numberOfLines={2}>
            {entry.detail}
          </Text>
        </View>
      </View>

      {entry.target > 1 ? (
        <View style={styles.nextMeter}>
          <View style={[styles.track, styles.trackWide]}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(entry.ratio * 100)}%`, backgroundColor: accent },
              ]}
            />
          </View>
          <Text style={[text.caption, styles.nextCount]}>
            {`${remaining} to go`}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * A band's heading, and its own tally.
 *
 * Sticky, and opaque for it — a translucent heading over scrolling rows is unreadable for
 * the half-second it takes them to pass under it.
 */
const SectionHeading = React.memo(function SectionHeading({
  section,
}: {
  section: Section;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionText}>
        <Text style={[text.h3, { color: paper.text }]}>{section.title}</Text>
        <Text style={[text.caption, { color: paper.textSubtle }]} numberOfLines={1}>
          {section.blurb}
        </Text>
      </View>

      <Text style={[text.caption, styles.sectionCount]}>
        {section.earned}
        <Text style={{ color: paper.textFaint }}>{` / ${section.total}`}</Text>
      </Text>
    </View>
  );
});

/**
 * One entry.
 *
 * The same anatomy in all three states — tile, title, one line under it, one accessory —
 * so a long list reads down four straight columns instead of as a stack of little
 * bespoke layouts. What changes between states is weight and colour, and the line under
 * the title, which carries whichever fact is useful: the instruction while it is open, the
 * gate while it is locked, nothing once it is done.
 */
const Row = React.memo(function Row({
  entry,
  opensAfter,
}: {
  entry: Achievement;
  opensAfter?: string;
}) {
  const { Glyph, achieved, unlocked } = entry;
  const accent = entry.accent ?? marmalade[600];
  const tint = entry.accent ? `${entry.accent}1F` : marmalade[100];

  const showMeter = unlocked && !achieved && entry.target > 1;

  return (
    <View
      accessible
      accessibilityLabel={`${entry.title}. ${
        achieved
          ? 'Unlocked.'
          : unlocked
            ? `${entry.detail} ${entry.current} of ${entry.target}.`
            : `Locked. ${opensAfter ? `Unlocks after ${opensAfter}. ` : ''}${entry.detail}`
      }`}
      style={styles.row}
    >
      <View
        style={[
          styles.tile,
          { backgroundColor: achieved || entry.current > 0 ? tint : paper.sunken },
        ]}
      >
        <Glyph
          size={18}
          weight={achieved ? 'fill' : 'regular'}
          color={achieved ? accent : unlocked ? paper.textMuted : paper.textFaint}
        />
      </View>

      <View style={styles.rowText}>
        <Text
          style={[text.bodySm, { color: unlocked ? paper.text : paper.textFaint }]}
          numberOfLines={1}
        >
          {entry.title}
        </Text>

        {showMeter ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(entry.ratio * 100)}%`, backgroundColor: accent },
              ]}
            />
          </View>
        ) : achieved ? null : (
          <Text style={[text.caption, styles.rowDetail]} numberOfLines={1}>
            {unlocked
              ? entry.detail
              : opensAfter
                ? `Unlocks after ${opensAfter}`
                : entry.detail}
          </Text>
        )}
      </View>

      {achieved ? (
        <CheckCircle size={17} weight="fill" color={accent} />
      ) : unlocked ? (
        <Text style={[text.caption, styles.rowCount]}>
          {entry.current}
          <Text style={{ color: paper.textFaint }}>{` / ${entry.target}`}</Text>
        </Text>
      ) : (
        <Lock size={14} color={paper.textFaint} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingBottom: layout.tabBarClearance,
  },
  head: {
    paddingHorizontal: layout.gutter,
  },
  header: {
    paddingBottom: spacing.sm,
  },
  overall: {
    marginBottom: spacing.lg,
  },
  overallTrack: {
    height: 5,
    borderRadius: radii.full,
    backgroundColor: paper.sunken,
    overflow: 'hidden',
  },
  overallFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: marmalade[600],
  },

  /* --------------------------------- next up -------------------------------- */
  next: {
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: paper.sunkenSoft,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  nextEyebrow: {
    color: paper.textFaint,
    letterSpacing: 1.6,
  },
  nextBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nextTile: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    flex: 1,
    gap: 2,
  },
  nextMeter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nextCount: {
    color: paper.textMuted,
  },

  /* -------------------------------- sections -------------------------------- */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    // Opaque: these stick, and rows scroll underneath them.
    backgroundColor: paper.bg,
  },
  sectionText: {
    flex: 1,
    gap: 1,
  },
  sectionCount: {
    color: paper.text,
  },

  /* ---------------------------------- rows ---------------------------------- */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 5,
  },
  rowDetail: {
    color: paper.textSubtle,
  },
  rowCount: {
    color: paper.textMuted,
  },
  track: {
    height: 3,
    borderRadius: radii.full,
    backgroundColor: paper.sunken,
    overflow: 'hidden',
  },
  /** Only where the meter shares a row with a label; in a column it must not stretch. */
  trackWide: {
    flex: 1,
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
  },
});
