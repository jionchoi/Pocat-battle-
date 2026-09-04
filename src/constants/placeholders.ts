import type { Cat, ChallengeTrophy, PhotoWithAuthor, Rarity } from '../models';

/**
 * Design placeholders.
 *
 * Stand-ins for surfaces that are built but have nothing real to draw yet, so the layout can
 * be looked at and judged on a device instead of only existing as an empty branch. Everything
 * here is fake, is obviously fake in the UI, and is gated behind one switch.
 *
 * ## Turning it off
 *
 * Set `SHOW_PLACEHOLDERS` to `false` and every surface below falls back to the real empty
 * state it will ship with. That is the flag to flip before a build goes to anybody outside
 * the project — a placeholder trophy on somebody's public profile is a lie about what they
 * have won, and the whole point of keeping it to one constant is that turning it off is not
 * an audit.
 *
 * Nothing in here is ever *written* anywhere. It is read at render time and thrown away.
 */
export const SHOW_PLACEHOLDERS = true;

/* -------------------------------------------------------------------------- */
/* Photographs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where the placeholder pictures come from.
 *
 * `placecats.com` — the cat-shaped descendant of placekitten. Real photographs of real
 * cats, served at whatever dimensions the path asks for, no key and no rate limit. Which
 * matters more than it sounds: a grey rectangle tells you nothing about whether a scrim is
 * dark enough, whether a rank numeral survives on a light coat, or whether a 4:5 crop of an
 * animal actually works — and those are the only questions a placeholder feed is for.
 *
 * The names are the service's own named cats. There are nine, which is why the lists below
 * cycle through them rather than asking for a tenth.
 *
 * **It is a network call to somebody else's host.** That is acceptable for a design
 * placeholder and would not be acceptable for anything else; with `SHOW_PLACEHOLDERS` off
 * nothing here is ever requested.
 */
const CATS = [
  'neo',
  'millie',
  'bella',
  'poppy',
  'louie',
  'neo_banana',
  'neo_2',
  'millie_neo',
  'g',
] as const;

/** A 4:5 crop, which is the ratio every photo surface in the product uses. */
function catImage(index: number, width = 600): string {
  const name = CATS[index % CATS.length];
  return `https://placecats.com/${name}/${width}/${Math.round((width * 5) / 4)}`;
}

function catAvatar(index: number): string {
  return `https://placecats.com/${CATS[index % CATS.length]}/120/120`;
}

/**
 * The names, captions and tags the fake photographs wear.
 *
 * Written out rather than generated, because the thing being previewed is *typography*: a
 * one-word cat name and a three-word one break a card differently, and "Caught mid-yawn"
 * is the exact tag that exposed the album tile's height bug. Generated lorem would have
 * hidden both.
 */
const SUBJECTS: {
  cat: string;
  by: string;
  caption?: string;
  badges: string[];
  score: number;
}[] = [
  { cat: 'Biscuit', by: 'haru.shoots', caption: 'He owns this doorway now.', badges: ['Golden Hour'], score: 94 },
  { cat: 'The Mayor', by: 'nine_lives', caption: 'Would not move for anyone.', badges: ['Caught mid-yawn'], score: 88 },
  { cat: 'Pepper', by: 'yuki', badges: [], score: 81 },
  { cat: 'Sir Loaf', by: 'tabbytime', caption: 'Peak loaf. No notes.', badges: ['Perfect Loaf'], score: 76 },
  { cat: 'Momo', by: 'streetcats.kr', badges: ['Eye Contact'], score: 72 },
  { cat: 'Ghost', by: 'haru.shoots', caption: 'Gone the second I focused.', badges: [], score: 69 },
  { cat: 'Two Socks', by: 'mira.p', badges: ['Golden Hour', 'Mid-Air Menace'], score: 64 },
  { cat: 'Dumpling', by: 'nine_lives', caption: 'Regular. Sixth time this month.', badges: [], score: 58 },
  { cat: 'Marbles', by: 'yuki', badges: ['Caught mid-yawn'], score: 51 },
  { cat: 'Bandit', by: 'tabbytime', caption: 'Stole a whole fish. Respect.', badges: [], score: 47 },
  { cat: 'Cloud', by: 'mira.p', badges: ['Eye Contact'], score: 42 },
  { cat: 'Onion', by: 'streetcats.kr', caption: 'Came for the sun, stayed for the sun.', badges: [], score: 36 },
];

function tierFor(score: number): Rarity {
  if (score >= 90) return 'Legendary';
  if (score >= 75) return 'Epic';
  if (score >= 55) return 'Rare';
  return 'Common';
}

/**
 * One fake photograph, filled in field for field.
 *
 * Every field of `PhotoWithAuthor` is set rather than cast, so a placeholder can never be
 * the reason a card renders differently from the real thing — a `Partial` with an `as`
 * would let a missing field pass typecheck and then read as a design decision on screen.
 *
 * `scoredAt` is always set. An unscored placeholder would draw the lock chip everywhere and
 * hide the scored layout, which is the one being looked at.
 */
function placeholderPhoto(index: number): PhotoWithAuthor {
  const subject = SUBJECTS[index % SUBJECTS.length]!;
  const score = subject.score;

  // Reactions spread unevenly on purpose: an even split would make every stack look the
  // same and hide whether the leading face actually reads as the leading face.
  const heat = 240 - index * 17;
  const reactions = {
    love: Math.max(0, Math.round(heat * 0.42)),
    laugh: Math.max(0, Math.round(heat * 0.21)),
    wow: Math.max(0, Math.round(heat * 0.16)),
    melt: Math.max(0, Math.round(heat * 0.14)),
    fire: Math.max(0, Math.round(heat * 0.07)),
  };

  const voteCount = Object.values(reactions).reduce((sum, n) => sum + n, 0);

  return {
    id: `placeholder-photo-${index}`,
    ownerId: `placeholder-user-${index % 6}`,
    imageUrl: catImage(index),
    caption: subject.caption,
    catId: `placeholder-cat-${index % 9}`,
    scores: {
      composition: Math.round(score * 0.4),
      poseRarity: Math.round(score * 0.25),
      catRarity: Math.round(score * 0.25),
      bonus: Math.round(score * 0.1),
      total: score,
    },
    badges: subject.badges,
    // Fixed timestamps, not `Date.now()` offsets: a relative time that changes every render
    // makes the feed look like it is refreshing when nothing has happened.
    capturedAt: `2026-08-${String(28 - (index % 12)).padStart(2, '0')}T09:12:00.000Z`,
    capturedLocation: { lat: 37.5665, lng: 126.978 },
    voteCount,
    pawCount: placeholderPaws(`placeholder-photo-${index}`),
    /*
     * Every third fake photograph was unlocked by somebody else, so the credit line is looked
     * at *beside* rows that do not have one. A placeholder feed where every card carried the
     * same mark would say nothing about whether it reads as an aside or as a headline.
     */
    revealedBy:
      index % 3 === 1
        ? { id: `placeholder-user-${(index + 2) % 6}`, username: 'nine_lives' }
        : null,
    tier: tierFor(score),
    pose: 'sitting',
    catNickname: subject.cat,
    sharedToFeed: true,
    showcased: false,
    sharedToMap: true,
    communityScore: 400 + index * 31,
    viewCount: 1_200 - index * 74,
    featured: false,
    reactions,
    myReaction: null,
    scoredAt: '2026-08-28T09:20:00.000Z',
    identifiedAt: '2026-08-28T09:20:00.000Z',
    author: {
      id: `placeholder-user-${index % 6}`,
      username: subject.by,
      avatarUrl: catAvatar(index + 3),
      photographerRank: 12 - (index % 7),
    },
  };
}

/**
 * A whole fake feed: five for the bento, then a run of posts under it.
 *
 * Five because the bento is five — two across, then three — and a placeholder that filled
 * only part of it would leave the same hole it exists to close. Six posts because that is
 * more than a screenful, so the scroll rhythm and the separator spacing can be judged.
 *
 * The two halves share `SUBJECTS` but not entries: `rising` starts past the trending five,
 * because a photo appearing in both the bento and the list below it is a real state the
 * feed handles, and a placeholder that leant on it would be testing the wrong thing.
 */
export const PLACEHOLDER_TRENDING: PhotoWithAuthor[] = Array.from({ length: 5 }, (_, i) =>
  placeholderPhoto(i)
);

export const PLACEHOLDER_POSTS: PhotoWithAuthor[] = Array.from({ length: 6 }, (_, i) =>
  placeholderPhoto(i + 5)
);

/**
 * The prefix every fake id carries, and the one check that stops a placeholder reaching
 * the network.
 *
 * Placeholder photographs are rendered by the same components as real ones, which is the
 * point — a preview built out of a parallel set of components previews the wrong thing. But
 * those components are wired to real endpoints, so a tap on a fake heart would post a vote
 * for `placeholder-photo-3` and get a 404 and an error toast, and a fake card scrolling into
 * view would push a fake id into the impression batch and quietly poison somebody's
 * denominator.
 *
 * So every id here starts with the same prefix, and the three places that talk to the server
 * about a photo ask this first: `usePhotoReaction`, `usePhotoImpressions`, and the detail
 * screen's fetch. Each one degrades locally instead — the reaction applies and stays applied,
 * the impression is dropped, and the detail screen reads the photograph out of this file.
 */
const PLACEHOLDER_PREFIX = 'placeholder-';

export function isPlaceholderId(id: string): boolean {
  return id.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * A placeholder photograph by id, for a screen that was opened rather than scrolled to.
 *
 * Photo Detail is reachable from any card, so a placeholder that could be looked at but not
 * *opened* would leave half the thing being previewed unreachable — and it is the half with
 * the score, the breakdown and the author on it.
 */
export function placeholderPhotoById(id: string): PhotoWithAuthor | null {
  return (
    [...PLACEHOLDER_TRENDING, ...PLACEHOLDER_POSTS].find((photo) => photo.id === id) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Cat Dex                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Nine Dex entries, which is exactly three rows of the three-across grid.
 *
 * Encounter counts run from one to nineteen so the on-image counter is seen at one digit
 * and at two, and three of them are marked `discoveredByMe` so the discoverer sparkle can
 * be judged next to tiles that do not have it — a grid where every tile wears the same
 * marks says nothing about whether the mark reads.
 */
export const PLACEHOLDER_CATS: Cat[] = Array.from({ length: 9 }, (_, i) => {
  const subject = SUBJECTS[i]!;

  return {
    id: `placeholder-cat-${i}`,
    discoveredByUserId: `placeholder-user-${i % 6}`,
    nickname: subject.cat,
    bio: undefined,
    bestPhotoId: `placeholder-photo-${i}`,
    bestPhotoPinned: false,
    encounterCount: [19, 12, 8, 6, 5, 4, 3, 2, 1][i]!,
    firstSeenLocation: { lat: 37.5665, lng: 126.978 },
    lastSeenAt: `2026-08-${String(28 - i).padStart(2, '0')}T18:30:00.000Z`,
    bestPhotoUrl: catImage(i, 400),
    bestPhotoScore: subject.score,
    bestTier: tierFor(subject.score),
    discoveredByMe: i % 3 === 0,
    photoCount: [19, 12, 8, 6, 5, 4, 3, 2, 1][i]!,
  };
});

/* -------------------------------------------------------------------------- */
/* Trophy case                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Three wins, oldest last, so the rail has something to scroll.
 *
 * Deliberately not five: a short rail is what a *good* trophy case looks like, and a
 * placeholder that filled the screen would flatter the design into looking finished.
 *
 * The last one carries no `photoUrl` on purpose. A player can delete the photograph they
 * won with — `winning_photo_id` is `on delete set null` — so the tile's fallback is a real
 * state, and it needs looking at beside the two that loaded rather than only on its own.
 */
export const PLACEHOLDER_TROPHIES: ChallengeTrophy[] = [
  {
    challengeId: 'placeholder-1',
    title: 'Golden Hour',
    wonAt: '2026-08-17T18:00:00.000Z',
    photoUrl: catImage(0, 400),
    score: 94,
    tier: 'Legendary',
    icon: 'sun',
    entrants: 218,
  },
  {
    challengeId: 'placeholder-2',
    title: 'Caught Mid-Yawn',
    wonAt: '2026-07-27T18:00:00.000Z',
    photoUrl: catImage(1, 400),
    score: 88,
    tier: 'Epic',
    icon: 'community',
    entrants: 141,
  },
  {
    challengeId: 'placeholder-3',
    title: 'Rainy Day Regulars',
    wonAt: '2026-06-15T18:00:00.000Z',
    photoUrl: '',
    score: 81,
    tier: 'Epic',
    icon: 'rain',
    entrants: 96,
  },
];

/**
 * A placeholder Dex entry as a full `CatProfile`, for a tile that was tapped.
 *
 * The Dex grid is only half of the Dex — the other half is the cat's own page, with the
 * encounter history and the rename field on it — so a placeholder grid whose tiles all
 * dead-end at "we could not load that cat" previews the smaller half. The encounter photos
 * are drawn from the same fake album the feed uses, which is also what makes the count on
 * the tile and the number of photographs on the page agree.
 */
export function placeholderCatProfile(catId: string): {
  cat: Cat;
  photos: PhotoWithAuthor[];
  encounterLocations: { lat: number; lng: number }[];
  firstEncounterAt: string;
} | null {
  const cat = PLACEHOLDER_CATS.find((entry) => entry.id === catId);
  if (!cat) return null;

  const all = [...PLACEHOLDER_TRENDING, ...PLACEHOLDER_POSTS];
  const photos = all.filter((photo) => photo.catId === catId);

  return {
    cat,
    // At least one, so the page is never an empty history under a filled-in header — which
    // is a state the real Dex cannot produce, since a cat exists because it was photographed.
    photos: photos.length > 0 ? photos : [all[0]!],
    encounterLocations: [cat.firstSeenLocation],
    firstEncounterAt: '2026-06-02T08:15:00.000Z',
  };
}

/* -------------------------------------------------------------------------- */
/* Paws                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A placeholder photograph's paw count.
 *
 * Real paws exist now — `pawStore`, `usePawGift` and `photos.paw_count` are all built — but a
 * placeholder photograph has no row behind it, so it has no count either. It gets one from
 * here, and giving a paw to a `placeholder-` id stays local exactly as a reaction does.
 *
 * Derived from the photo id rather than random, so a card does not change its number every
 * time it re-renders or scrolls back into view — a placeholder that flickers is worse than
 * no placeholder, because it reads as a bug in the reaction bar rather than as a stand-in.
 *
 * A cheap FNV-1a walk over the id, bucketed so most photos have a small count and a few have
 * a large one. That distribution is the thing being previewed: a bar that has to hold "3"
 * and "1.2k" is a different bar from one that only ever holds single digits.
 */
export function placeholderPaws(photoId: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < photoId.length; i += 1) {
    hash ^= photoId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const roll = hash % 100;
  if (roll < 40) return hash % 9;
  if (roll < 85) return 10 + (hash % 90);
  return 100 + (hash % 1_800);
}
