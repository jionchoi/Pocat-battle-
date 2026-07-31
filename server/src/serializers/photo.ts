import type { Cat, CatDexEntry, Photo, User, Vote } from '@prisma/client';

/**
 * Wire format for Photo, Cat and User.
 *
 * The client's models nest `scores` and `capturedLocation`, while the tables store them
 * flat for indexing. This is the one place that translation happens, so no controller
 * invents its own shape.
 */

export type PhotoRow = Photo & { votes?: Vote[]; cat?: Cat | null };

export interface PhotoSerializeOptions {
  /** The signed-in player, so `myReaction` can be resolved. */
  viewerId: string;
  /** This viewer's dex entry for the photo's cat, for the denormalised nickname. */
  dexEntry?: CatDexEntry | null;
  /** Falls back to the cat's default nickname when the viewer has no entry. */
  cat?: Cat | null;
}

export function serializePhoto(photo: PhotoRow, options: PhotoSerializeOptions) {
  const cat = options.cat ?? photo.cat ?? null;

  const myReaction =
    photo.votes?.find((v) => v.voterId === options.viewerId)?.reaction ?? null;

  return {
    id: photo.id,
    ownerId: photo.ownerId,
    imageUrl: photo.imageUrl,
    caption: photo.caption ?? undefined,
    catId: photo.catId,
    scores: {
      composition: photo.composition,
      poseRarity: photo.poseRarity,
      catRarity: photo.catRarity,
      bonus: photo.bonus,
      total: photo.total,
    },
    badges: photo.badges,
    capturedAt: photo.capturedAt.toISOString(),
    capturedLocation: { lat: photo.capturedLat, lng: photo.capturedLng },
    voteCount: photo.voteCount,
    submittedToChallengeId: photo.submittedToChallengeId ?? undefined,

    tier: photo.tier,
    pose: photo.pose,
    catNickname: options.dexEntry?.nickname ?? cat?.defaultNickname ?? 'Unnamed cat',
    sharedToFeed: photo.sharedToFeed,
    showcased: photo.showcased,

    // The community layer. `communityScore` is the Bayesian-smoothed engagement ratio
    // ×1000; `viewCount` is unique viewers, so the client can say whether the score is
    // provisional yet rather than presenting a one-view ratio as fact.
    communityScore: photo.communityScore,
    viewCount: photo.viewCount,
    featured: photo.featured,
    reactions: {
      laugh: photo.laughCount,
      love: photo.loveCount,
      wow: photo.wowCount,
    },
    myReaction,
  };
}

export type AuthorRow = Pick<User, 'id' | 'username' | 'avatarUrl' | 'photographerRank'>;

export function serializePhotoWithAuthor(
  photo: PhotoRow & { owner: AuthorRow },
  options: PhotoSerializeOptions
) {
  return {
    ...serializePhoto(photo, options),
    author: {
      id: photo.owner.id,
      username: photo.owner.username,
      avatarUrl: photo.owner.avatarUrl,
      photographerRank: photo.owner.photographerRank,
    },
  };
}

/**
 * A Cat Dex entry, merged from the global `Cat` and this player's `CatDexEntry`.
 *
 * README section 7 defines a single flat `Cat` interface; the database splits it because
 * the animal is shared between players while the nickname, best shot and encounter count
 * are personal. The merge happens here so the client sees the documented shape.
 */
export function serializeCat(
  cat: Cat,
  entry: CatDexEntry,
  viewerId: string,
  extras: { bestPhotoUrl: string; photoCount: number }
) {
  return {
    id: cat.id,
    discoveredByUserId: cat.discoveredByUserId,
    nickname: entry.nickname ?? cat.defaultNickname,
    bio: entry.bio ?? undefined,
    bestPhotoId: entry.bestPhotoId ?? '',
    encounterCount: entry.encounterCount,
    firstSeenLocation: { lat: cat.firstSeenLat, lng: cat.firstSeenLng },
    lastSeenAt: entry.lastSeenAt.toISOString(),

    bestPhotoUrl: extras.bestPhotoUrl,
    bestPhotoScore: entry.bestPhotoScore,
    bestTier: entry.bestTier,
    discoveredByMe: cat.discoveredByUserId === viewerId,
    photoCount: extras.photoCount,
  };
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    photographerRank: user.photographerRank,
    photographerXp: user.photographerXp,
    createdAt: user.createdAt.toISOString(),
    friendIds: [] as string[],
    proSubscriptionActive: user.proSubscriptionActive,
  };
}

/**
 * Own-account view. Album quota and lifetime totals never appear on another player's
 * profile, so they are added only here.
 */
export function serializeMe(
  user: User,
  extras: {
    friendIds: string[];
    photoCount: number;
    photoLimit: number | null;
    catsDiscovered: number;
    xpToNextRank: number;
  }
) {
  return {
    ...serializeUser(user),
    friendIds: extras.friendIds,
    email: user.email,
    lifetimeScore: user.lifetimeScore,
    votesReceived: user.votesReceived,
    xpToNextRank: extras.xpToNextRank,
    photoCount: extras.photoCount,
    photoLimit: extras.photoLimit,
    catsDiscovered: extras.catsDiscovered,
  };
}

export function serializeChallenge(
  challenge: {
    id: string;
    slug: string;
    title: string;
    prompt: string;
    judging: string;
    startsAt: Date;
    endsAt: Date;
    winningPhotoId: string | null;
  },
  extras: { submissionCount: number; mySubmissionPhotoId: string | null; now?: Date }
) {
  const now = extras.now ?? new Date();

  const status =
    now < challenge.startsAt ? 'upcoming' : now >= challenge.endsAt ? 'closed' : 'active';

  return {
    id: challenge.id,
    title: challenge.title,
    prompt: challenge.prompt,
    startsAt: challenge.startsAt.toISOString(),
    endsAt: challenge.endsAt.toISOString(),
    winningPhotoId: challenge.winningPhotoId ?? undefined,

    status,
    judging: challenge.judging,
    submissionCount: extras.submissionCount,
    mySubmissionPhotoId: extras.mySubmissionPhotoId,
  };
}

export function serializeSighting(sighting: {
  id: string;
  reportedByUserId: string;
  lat: number;
  lng: number;
  photoUrl: string;
  verified: boolean;
  createdAt: Date;
}) {
  return {
    id: sighting.id,
    reportedByUserId: sighting.reportedByUserId,
    location: { lat: sighting.lat, lng: sighting.lng },
    photoUrl: sighting.photoUrl,
    verified: sighting.verified,
    createdAt: sighting.createdAt.toISOString(),
  };
}
