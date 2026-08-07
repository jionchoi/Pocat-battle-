import type { ComponentType } from 'react';
import {
  Binoculars,
  Cards,
  Crosshair,
  Crown,
  Diamond,
  FilmStrip,
  Footprints,
  Gauge,
  HandHeart,
  HouseLine,
  Lightning,
  MapTrifold,
  PaperPlaneTilt,
  PawPrint,
  Smiley,
  SunHorizon,
  UsersThree,
  type IconProps,
} from 'phosphor-react-native';

import type { Cat, Photo } from '../models';
import { paper, rarity as rarityTokens, semantic } from '../theme';

/**
 * Achievements.
 *
 * A tree, not a checklist — every entry names a parent, and the Achievements screen draws
 * the result as a graph you can follow outward from "First Snap". The shape is the point:
 * a flat list of twelve boxes tells a new player nothing about which one is next, whereas
 * a branch tells them that "Legendary" is the far end of the road that starts with a
 * single Epic. Minecraft's advancement screen is the reference.
 *
 * Everything is derived on the device from the album, the Dex and the signed-in user.
 * Nothing is granted by the server, so an achievement can never claim something the player
 * cannot see the evidence for on their own profile.
 *
 * ## Order matters
 *
 * A parent is always defined before its children. `evaluate` walks the list once and reads
 * the parent's result out of what it has already computed, which is only sound because the
 * list is topologically ordered. Keep it that way when adding to it.
 */

export interface AchievementStats {
  photos: number;
  epicOrBetter: number;
  legendary: number;
  /** The highest single-photo score in the album — the same number the board ranks on. */
  bestScore: number;
  /** Encounters with the most-photographed cat. */
  maxEncounters: number;
  discoveries: number;
  shared: number;
  reactions: number;
  /** Distinct cats whose best shot is Rare or better. Cats, not photos — see below. */
  rareCats: number;
  /** Consecutive days up to today carrying a golden-hour capture. */
  goldenHourRun: number;
  /** Cats in the Dex. The player's own census of the neighbourhood. */
  catsLogged: number;
}

/**
 * The bands the screen is divided into.
 *
 * Named on each entry rather than derived from the tree's shape. The top-level branches
 * are the obvious source and they are the wrong one: there are seven of them, several
 * holding a single entry, so the sections would be a list of ones. A track is an editorial
 * grouping and stays legible as the set grows — a new achievement names the band it joins,
 * and the screen absorbs it without relayout.
 */
export type TrackId = 'photos' | 'scores' | 'cats' | 'community';

export interface Track {
  id: TrackId;
  title: string;
  /** One line under the heading. What this band of the game is about. */
  blurb: string;
}

export const TRACKS: Track[] = [
  { id: 'photos', title: 'Photographs', blurb: 'The album you are building.' },
  { id: 'scores', title: 'Scores', blurb: 'What the scorer makes of your shots.' },
  { id: 'cats', title: 'Cats', blurb: 'The animals themselves, and how well you know them.' },
  {
    id: 'community',
    title: 'Community',
    blurb: 'What happens once you put a photo out there.',
  },
];

export interface AchievementDef {
  id: string;
  title: string;
  /** What you have to do, in the imperative. Shown when the entry is still locked. */
  detail: string;
  Glyph: ComponentType<IconProps>;
  parent: string | null;
  target: number;
  measure: (stats: AchievementStats) => number;
  /** Which band of the screen this belongs to. See `TRACKS`. */
  track: TrackId;
  /**
   * Optional hue, borrowed from the rarity ramp or the semantic set.
   *
   * Only the three entries that came over from the weekly goal rows carry one, and they
   * carry the exact colour they wore there — so a player who has been watching "Rarity
   * Rookie" fill up on the hub recognises it here without reading the label. Everything
   * else stays on the coral accent: three borrowed hues in a list is a palette, twelve is
   * a mess.
   *
   * Colouring every entry by its branch was tried and reverted. It made the screen a
   * swatch chart — four hues competing at equal weight, none of them meaning anything —
   * and it cost the accent its job, which is to mark the things you can act on.
   */
  accent?: string;
}

export interface Achievement extends AchievementDef {
  /** Progress toward `target`, capped at it. */
  current: number;
  achieved: boolean;
  /**
   * Whether the parent is done. A locked entry is drawn dimmed rather than hidden — the
   * road ahead being visible is most of why a tree beats a list.
   */
  unlocked: boolean;
  ratio: number;
  depth: number;
}

const DEFS: AchievementDef[] = [
  {
    id: 'first-snap',
    track: 'photos',
    title: 'First Snap',
    detail: 'Photograph a cat.',
    Glyph: PawPrint,
    parent: null,
    target: 1,
    measure: (s) => s.photos,
  },

  /* --- the album --- */
  {
    id: 'ten-photos',
    track: 'photos',
    title: 'Filling the Album',
    detail: 'Keep ten photos.',
    Glyph: Cards,
    parent: 'first-snap',
    target: 10,
    measure: (s) => s.photos,
  },
  {
    id: 'fifty-photos',
    track: 'photos',
    title: 'Serious Collection',
    detail: 'Keep fifty photos.',
    Glyph: FilmStrip,
    parent: 'ten-photos',
    target: 50,
    measure: (s) => s.photos,
  },

  /* --- what the scorer thinks --- */
  {
    id: 'rare-moment',
    track: 'scores',
    title: 'Rare Moment',
    detail: 'Score an Epic shot.',
    Glyph: Lightning,
    parent: 'first-snap',
    target: 1,
    measure: (s) => s.epicOrBetter,
  },
  {
    id: 'rarity-rookie',
    track: 'scores',
    title: 'Rarity Rookie',
    detail: 'Photograph three Rare or better cats.',
    Glyph: Diamond,
    parent: 'rare-moment',
    target: 3,
    // Distinct *cats*, matching the goal it came from: three shots of the same rare cat is
    // one rare cat, and counting photos would make it farmable from a single doorstep.
    measure: (s) => s.rareCats,
    accent: rarityTokens.Rare.base,
  },
  {
    id: 'legendary',
    track: 'scores',
    title: 'Legendary',
    detail: 'Score a Legendary shot.',
    Glyph: Crown,
    parent: 'rare-moment',
    target: 1,
    measure: (s) => s.legendary,
  },
  {
    id: 'golden-hour-streak',
    track: 'scores',
    title: 'Golden Hour Streak',
    detail: 'Snap at golden hour, three days running.',
    Glyph: SunHorizon,
    parent: 'first-snap',
    target: 3,
    measure: (s) => s.goldenHourRun,
    accent: semantic.warning,
  },
  {
    id: 'photo-finish',
    track: 'scores',
    title: 'Photo Finish',
    detail: 'Score 80 on a single photo.',
    Glyph: Gauge,
    parent: 'first-snap',
    target: 80,
    measure: (s) => s.bestScore,
  },
  {
    id: 'near-perfect',
    track: 'scores',
    title: 'Near Perfect',
    detail: 'Score 95 on a single photo.',
    Glyph: Crosshair,
    parent: 'photo-finish',
    target: 95,
    measure: (s) => s.bestScore,
  },

  /* --- the cats themselves --- */
  {
    id: 'regular',
    track: 'cats',
    title: 'Regular',
    detail: 'Photograph one cat five times.',
    Glyph: Footprints,
    parent: 'first-snap',
    target: 5,
    measure: (s) => s.maxEncounters,
  },
  {
    id: 'best-friends',
    track: 'cats',
    title: 'Best Friends',
    detail: 'Photograph one cat fifteen times.',
    Glyph: HandHeart,
    parent: 'regular',
    target: 15,
    measure: (s) => s.maxEncounters,
  },
  {
    id: 'discoverer',
    track: 'cats',
    title: 'Discoverer',
    detail: 'Be the first to photograph a cat.',
    Glyph: Binoculars,
    parent: 'first-snap',
    target: 1,
    measure: (s) => s.discoveries,
  },
  {
    id: 'cartographer',
    track: 'cats',
    title: 'Cartographer',
    detail: 'Discover five cats nobody had photographed.',
    Glyph: MapTrifold,
    parent: 'discoverer',
    target: 5,
    measure: (s) => s.discoveries,
  },
  {
    id: 'neighbourhood-census',
    track: 'cats',
    title: 'Neighbourhood Census',
    detail: 'Log fifteen different cats in your Dex.',
    Glyph: HouseLine,
    parent: 'discoverer',
    target: 15,
    /**
     * The goal this came from counts *photographers* in your neighbourhood bucket, which
     * is a community meter the device cannot compute and cannot influence. As a personal
     * achievement it counts the census the player actually takes: distinct cats catalogued.
     */
    measure: (s) => s.catsLogged,
    accent: paper.text,
  },

  /* --- what everybody else thinks --- */
  {
    id: 'going-public',
    track: 'community',
    title: 'Going Public',
    detail: 'Share a photo to the feed.',
    Glyph: PaperPlaneTilt,
    parent: 'first-snap',
    target: 1,
    measure: (s) => s.shared,
  },
  {
    id: 'well-received',
    track: 'community',
    title: 'Well Received',
    detail: 'Collect 25 reactions.',
    Glyph: Smiley,
    parent: 'going-public',
    target: 25,
    measure: (s) => s.reactions,
  },
  {
    id: 'crowd-favourite',
    track: 'community',
    title: 'Crowd Favourite',
    detail: 'Collect 100 reactions.',
    Glyph: UsersThree,
    parent: 'well-received',
    target: 100,
    measure: (s) => s.reactions,
  },
];

/** Everything the tree can ask about, read off the album once rather than per entry. */
export function achievementStats({
  photos,
  cats,
  reactions,
}: {
  photos: Photo[];
  cats: Cat[];
  reactions: number;
}): AchievementStats {
  let epicOrBetter = 0;
  let legendary = 0;
  let bestScore = 0;
  let shared = 0;

  for (const photo of photos) {
    if (photo.tier === 'Epic' || photo.tier === 'Legendary') epicOrBetter += 1;
    if (photo.tier === 'Legendary') legendary += 1;
    if (photo.scores.total > bestScore) bestScore = photo.scores.total;
    if (photo.sharedToFeed) shared += 1;
  }

  let maxEncounters = 0;
  let discoveries = 0;
  let rareCats = 0;

  for (const cat of cats) {
    if (cat.encounterCount > maxEncounters) maxEncounters = cat.encounterCount;
    if (cat.discoveredByMe) discoveries += 1;
    if (cat.bestTier !== 'Common') rareCats += 1;
  }

  return {
    photos: photos.length,
    epicOrBetter,
    legendary,
    bestScore,
    maxEncounters,
    discoveries,
    shared,
    reactions,
    rareCats,
    goldenHourRun: goldenHourRun(photos),
    catsLogged: cats.length,
  };
}

/**
 * Consecutive days, ending today or yesterday, carrying a golden-hour capture.
 *
 * Yesterday still counts as live: golden hour is roughly an hour long and a streak that
 * breaks at midnight before the player has had today's chance to shoot is a streak that
 * punishes them for the clock rather than for missing it.
 *
 * Days are the device's local days, deliberately. The player's evening is the thing being
 * counted, and UTC would end their streak at 7pm in some timezones.
 */
function goldenHourRun(photos: Photo[]): number {
  const days = new Set<string>();

  for (const photo of photos) {
    if (!photo.badges.includes(GOLDEN_HOUR_BADGE)) continue;
    days.add(dayKey(new Date(photo.capturedAt)));
  }

  if (days.size === 0) return 0;

  const cursor = new Date();
  // Start from today, or from yesterday when today has nothing yet.
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let run = 0;
  while (days.has(dayKey(cursor))) {
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return run;
}

/** The label the scorer writes onto a photo, not the rule id it was matched by. */
const GOLDEN_HOUR_BADGE = 'Golden Hour';

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function evaluateAchievements(stats: AchievementStats): Achievement[] {
  const byId = new Map<string, Achievement>();

  return DEFS.map((def) => {
    const current = Math.min(def.target, Math.max(0, def.measure(stats)));
    const parent = def.parent ? byId.get(def.parent) : null;

    const entry: Achievement = {
      ...def,
      current,
      achieved: current >= def.target,
      unlocked: def.parent === null || parent?.achieved === true,
      ratio: def.target === 0 ? 1 : current / def.target,
      depth: parent ? parent.depth + 1 : 0,
    };

    byId.set(entry.id, entry);
    return entry;
  });
}

/**
 * The three to show in the hub's summary box.
 *
 * Anything under way comes first, closest to done leading — that is the one entry a player
 * can act on today, and burying it under three already-won badges wastes the whole box.
 * The rest of the slots go to *earned* achievements, drawn at random so the box is not the
 * same three trophies forever.
 *
 * `seed` keeps the draw stable between renders: it is derived from what has been earned,
 * so the shuffle only changes when the set it is drawing from does.
 */
export function featuredAchievements(all: Achievement[], count = 3): Achievement[] {
  const inProgress = all
    .filter((a) => a.unlocked && !a.achieved && a.current > 0)
    .sort((a, b) => b.ratio - a.ratio);

  const earned = all.filter((a) => a.achieved);
  const seed = earned.length * 31 + inProgress.length;

  const drawn = shuffle(earned, seed);

  /**
   * A brand-new player has neither, and only the root is unlocked — one row in a box built
   * for three. So the tail is what they could start on, then the shallowest of what is
   * still locked, which is the same order the tree is read in. The box is always full.
   */
  const available = all.filter((a) => a.unlocked && !a.achieved && a.current === 0);
  const rest = [...all].sort((a, b) => a.depth - b.depth);

  const out: Achievement[] = [];
  for (const entry of [...inProgress, ...drawn, ...available, ...rest]) {
    if (out.length >= count) break;
    if (!out.some((existing) => existing.id === entry.id)) out.push(entry);
  }

  return out;
}

/**
 * Deterministic shuffle — a mulberry32 walk over a Fisher–Yates pass.
 *
 * `Math.random` would reorder the box on every render of the screen, which reads as a
 * glitch rather than as variety.
 */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed + 0x6d2b79f5;

  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}
