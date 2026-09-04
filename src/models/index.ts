/**
 * Shared domain types. These mirror the Node backend exactly (server/src/db/schema.prisma
 * and server/src/types.ts) — if you change one side, change the other.
 *
 * The interfaces in README section 7 are reproduced here field-for-field. Where the UI
 * needs something the brief did not list, it is added below the brief's fields and
 * commented with why, rather than quietly changing the documented shape.
 */

/** Photo quality tier, derived server-side from `scores.total`. Drives the card bezel. */
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

/**
 * What a reader can say about somebody else's photograph.
 *
 * Five, and all five are positive — there is no downvote and there is no key here that
 * could become one. That is a structural decision rather than a moderation policy: you
 * cannot brigade with buttons that do not exist, so the worst thing a player can do to a
 * photo is scroll past it.
 *
 * `laugh`, `love` and `wow` are the original three and keep their names, because rows in
 * `votes` are already written with those strings. `melt` and `fire` were added beside them;
 * the column's check constraint lists all five (see the 2026-08-28 migration).
 */
export type Reaction = 'love' | 'laugh' | 'wow' | 'melt' | 'fire';

/**
 * Pose/action classes the scoring pipeline recognises (README 9.2, "pose rarity").
 * `unknown` exists so a low-confidence classification degrades instead of throwing.
 */
export type PoseClass =
  | 'sitting'
  | 'standing'
  | 'walking'
  | 'sleeping'
  | 'grooming'
  | 'stretching'
  | 'yawning'
  | 'jumping'
  | 'pouncing'
  | 'loafing'
  | 'unknown';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* User                                                               */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  username: string;
  avatarUrl: string;
  photographerRank: number;
  photographerXp: number;
  createdAt: string;
  friendIds: string[];
  proSubscriptionActive: boolean;
}

/**
 * Own-account view. Album quota and lifetime totals are never exposed on another
 * player's profile, so they live here rather than on `User`.
 */
export interface Me extends User {
  email: string | null;
  /**
   * Cumulative instant score across every photo — the app's opinion of your work. Shown
   * for interest; it is deliberately NOT what rank is computed from.
   */
  lifetimeScore: number;
  /** Reactions received across every photo — the dominant term in Photographer Rank. */
  votesReceived: number;
  /** XP still needed to reach `photographerRank + 1`. Drives the profile meter. */
  xpToNextRank: number;
  photoCount: number;
  /** Free tier is capped; Pro is unlimited and reports `null`. */
  photoLimit: number | null;
  catsDiscovered: number;
}

/** Photographer Rank tiers — cosmetic progression only, never power (README section 1). */
export interface RankTier {
  rank: number;
  title: string;
  xpRequired: number;
}

/* ------------------------------------------------------------------ */
/* Photo — the core content object                                    */
/* ------------------------------------------------------------------ */

export interface PhotoScores {
  composition: number;
  poseRarity: number;
  catRarity: number;
  bonus: number;
  total: number;
}

/** Who unlocked a score. Just enough to name somebody and open their profile. */
export interface RevealCredit {
  id: string;
  username: string;
}

export interface Photo {
  id: string;
  ownerId: string;
  imageUrl: string;
  caption?: string;
  /** Links to the recurring-cat record this photo is of. */
  catId: string;
  scores: PhotoScores;
  /** e.g. "Golden Hour", "Mid-Air Menace". */
  badges: string[];
  capturedAt: string;
  capturedLocation: GeoPoint;
  voteCount: number;
  /**
   * Paws given to this photograph by other players.
   *
   * The currency's only public number. It sits beside `voteCount` and is deliberately not
   * like it: reactions are capped at one per person and feed `communityScore`, which is what
   * the leaderboards rank on, while paws are uncapped per person and this count feeds
   * **nothing at all**. That is what makes many-from-one-person safe here and unsafe there.
   *
   * Note the boundary: *giving* moves no ranked number, which is what this field is about.
   * *Spending* a paw on a reveal does earn XP — a different act, and it does not touch this.
   */
  pawCount: number;
  /**
   * Who paid to unlock this score, when it was not the photographer.
   *
   * **Null is the ordinary case** and means there is nothing to draw: the photographer
   * revealed their own score, or it has not been revealed at all. It is only ever set when
   * somebody else spent paws on it, which is exactly when a credit is worth showing.
   *
   * The server decides this, not the screen — `revealCreditFor` nulls it out for the owner's
   * own reveals so the feed and the album cannot disagree about whether a credit exists.
   */
  revealedBy: RevealCredit | null;
  submittedToChallengeId?: string;

  /* --- added for rendering; all derived server-side --- */

  /** Tier from `scores.total`. Colour-encoding a photo card needs one field, not a range. */
  tier: Rarity;
  /** Detected pose, shown as the pose-rarity row's label in the breakdown. */
  pose: PoseClass;
  /** Owner's nickname for the cat, denormalised so a grid does not N+1 on cats. */
  catNickname: string;
  /** Opt-in — a photo only reaches the Community Feed when the owner shared it. */
  sharedToFeed: boolean;
  /** Pinned to the owner's public-profile showcase. */
  showcased: boolean;
  /**
   * Whether this capture appears as a sighting pin for other players.
   *
   * Opt-*out*, unlike the two above: the onboarding carousel tells a player their photos
   * put sightings on the map, so the map is what they already agreed to and this switch is
   * how they take one back.
   *
   * It does not control `capturedLocation`. The coordinates are recorded either way —
   * matching a cat to the one you met last week is proximity, and a capture that forgot
   * where it happened could not do it. What this governs is publication, and the pins other
   * players see are coarsened regardless of it.
   */
  sharedToMap: boolean;

  /* --- the community layer --- */

  /**
   * Bayesian-smoothed engagement ratio, 0..1000. This is the community's verdict, and
   * it — not `scores.total` — is what drives Photographer Rank and the leaderboards.
   * The gap between the two is intentional: a photo the algorithm rates modestly but
   * players love is the "this blew up" moment.
   */
  communityScore: number;
  /** Unique viewers. Below `COMMUNITY_CONFIG.minViewsForConfidence` the score is provisional. */
  viewCount: number;
  /** Editorially boosted in the feed for cold start. */
  featured: boolean;
  /** Per-reaction tallies. `voteCount` is their sum, kept for the brief's shape. */
  reactions: Record<Reaction, number>;
  /** The signed-in player's reaction, when they have one. */
  myReaction: Reaction | null;

  /**
   * When the score was revealed, or null while it is still waiting for one.
   *
   * The one field that says whether `scores` means anything. Everything that draws a
   * number checks this first, because an unscored photo carries zeroes rather than
   * absent fields — see the serializer's note on why.
   */
  scoredAt: string | null;
  /** When the player confirmed which cat this is. Null until they do. */
  identifiedAt: string | null;
}

/** Feed and leaderboard rows carry their author inline to avoid a second request. */
export interface PhotoWithAuthor extends Photo {
  author: Pick<User, 'id' | 'username' | 'avatarUrl' | 'photographerRank'>;
}

/**
 * What `GET /photos/:id` answers with.
 *
 * The owner gets the album serialization and everyone else gets the feed card, so `author`
 * is present exactly when you are *not* the owner — which is also exactly when the detail
 * screen needs it, because that is when there is somebody else's profile to offer.
 *
 * Optional rather than two types the caller has to discriminate: every field the screen
 * draws is on `Photo`, and the author is the one thing it has to check for anyway.
 */
export type PhotoDetail = Photo & Partial<Pick<PhotoWithAuthor, 'author'>>;

/* ------------------------------------------------------------------ */
/* Cat Dex                                                            */
/* ------------------------------------------------------------------ */

export interface Cat {
  id: string;
  /** First person to photograph this recurring cat. */
  discoveredByUserId: string;
  nickname?: string;
  bio?: string;
  bestPhotoId: string;
  /**
   * True when the player chose the Dex photo by hand. While set, a higher-scoring shot of
   * the same cat no longer takes the tile.
   */
  bestPhotoPinned: boolean;
  encounterCount: number;
  firstSeenLocation: GeoPoint;
  lastSeenAt: string;

  /* --- added for rendering --- */

  /** Denormalised so a Cat Dex grid renders without fetching every best photo. */
  bestPhotoUrl: string;
  bestPhotoScore: number;
  /** Highest tier this player has achieved on this cat — drives the entry's bezel. */
  bestTier: Rarity;
  /** True when the signed-in player was the discoverer (shows the "Discovered by you" mark). */
  discoveredByMe: boolean;
  /** How many of this player's photos are of this cat. */
  photoCount: number;
}

/** Cat Profile screen: the cat plus this player's full encounter history. */
export interface CatProfile {
  cat: Cat;
  photos: Photo[];
  /** Distinct capture locations, for the mini map. */
  encounterLocations: GeoPoint[];
  firstEncounterAt: string;
}

/* ------------------------------------------------------------------ */
/* Identifying a photo                                                */
/* ------------------------------------------------------------------ */

/**
 * A cat the matcher thinks this photograph might be of.
 *
 * Deliberately not a `Cat`. A `Cat` is a cat *this player has met* — it carries their
 * nickname, their encounter count, their best shot and who discovered it. A candidate may be
 * an animal they have never photographed, and sending a `Cat` for one would mean sending
 * another player's photograph and another player's id to someone who has no relationship
 * with either.
 *
 * So this is the smaller shape: enough to draw a row in the "Is this Mochi?" sheet and no
 * more. Everything owner-relative below is null or zero until `inYourDex` is true, and the
 * server is what enforces that rather than the client remembering to check.
 *
 * The list is a shortlist, never an answer. Nothing here auto-assigns — the player confirms,
 * and two cats in one house is the normal case rather than the failure case.
 */
export interface CatCandidate {
  id: string;
  /**
   * What to call it in the sheet: this player's nickname when they have one, the cat's
   * default when they do not. The same two-layer fallback `catNickname` uses on a photo.
   */
  nickname: string;
  /**
   * How well location and traits agree, 0..1.
   *
   * For ordering the list and for deciding whether to draw a "best guess" mark on the top
   * row. It is not a claim about the animal, and the sheet must never present it as one.
   */
  confidence: number;
  /**
   * Why this cat is on the list, as short phrases the sheet renders verbatim
   * ("seen nearby", "black and white", "notched left ear").
   *
   * Written server-side so the wording is not a deploy, and so precision is decided next to
   * the data: a phrase about a cat the player has not met is never more precise about
   * location than a map pin would be, because the shortlist must not become a way to ask
   * where somebody else's cat lives.
   */
  reasons: string[];
  /**
   * True when this player already has a Dex entry for this cat.
   *
   * The difference between "Mochi" and "a cat someone else named Mochi", which is what the
   * sheet needs to know before it says "seen 4 times" to a player who has never seen it.
   */
  inYourDex: boolean;
  /**
   * This cat's Dex tile — and null unless `inYourDex`, always.
   *
   * The tile is a photograph, photographs belong to whoever took them, and a candidate the
   * player has never met has no photograph of theirs to show. The row draws a silhouette
   * instead, which is honest: they are being asked whether they recognise the animal, not
   * shown a picture of it.
   */
  thumbnailUrl: string | null;
  /** Times *this* player has photographed it. Zero when it is not theirs yet. */
  encounterCount: number;
  /** When this cat was last seen by anyone. Drives "seen this week" copy. */
  lastSeenAt: string;
}

/**
 * The player's answer to "which cat is this?".
 *
 * A union rather than two optional fields, because the two branches are genuinely different
 * requests and a body carrying both has an intent nobody can guess. `catId` attaches to a cat
 * that already exists — theirs or anyone's. `newCat` says none of the candidates was right;
 * its traits and its location are promoted off the photograph, which is why there is nothing
 * else to send. The server refuses a body with both.
 */
export type IdentifyChoice = { catId: string } | { newCat: { nickname: string } };

/**
 * What comes back from confirming which cat a photo is of.
 *
 * Both objects are returned because both changed: the photo gained a `catId` and an
 * `identifiedAt`, and the cat gained an encounter and possibly a new best shot. Returning
 * them together is what lets the album and the Dex update from one response instead of
 * refetching two lists to find out what the write did.
 */
export interface Identification {
  photo: Photo;
  /** The Dex entry as it now stands — created by this call when `created` is true. */
  cat: Cat;
  /**
   * True when this call brought a new cat into the world rather than attaching the photo to
   * one that already existed. The moment worth celebrating in the UI.
   */
  created: boolean;
  /**
   * The cat this photograph used to be attributed to, when this call moved it.
   *
   * Null on a first identification. Re-identifying is allowed on purpose — a player who
   * picked wrong should be able to say so — and the correction is a leave-and-join, so the
   * old entry loses an encounter and re-promotes its next-best photo.
   *
   * Refetch this cat rather than adjusting it locally. If the moved photograph was the only
   * one the player had of it, the entry is gone entirely: an encounter count cannot fall to
   * zero, and a Dex should not list an animal its owner never actually photographed.
   */
  releasedCatId: string | null;
}

/* ------------------------------------------------------------------ */
/* Challenges                                                         */
/* ------------------------------------------------------------------ */

/**
 * How a challenge picks its winner (README 9.4). Objective prompts rank by score;
 * subjective ones ("funniest") fall back to community votes.
 */
export type ChallengeJudging = 'score' | 'votes';

export type ChallengeStatus = 'upcoming' | 'active' | 'closed';

/**
 * Which glyph a challenge wears on the hub.
 *
 * A closed key rather than an icon name so the server never dictates a client asset: it
 * says what the challenge is *about*, and the client decides what that looks like. An
 * unrecognised key falls back to the trophy rather than rendering nothing.
 */
export type ChallengeIconKey =
  | 'rain'
  | 'sun'
  | 'night'
  | 'rarity'
  | 'community'
  | 'trophy';

/**
 * Progress toward a challenge's goal, for the player asking.
 *
 * `target` is what finishes it and `current` is where this player is. A community goal
 * reports the whole field's progress instead — same shape, and `unit` is what makes the
 * difference legible ("spotted" vs "hunters joined").
 */
export interface ChallengeProgress {
  current: number;
  target: number;
  /** Noun or verb completing "3 of 5 ___". Kept server-side so copy is not a deploy. */
  unit: string;
}

/**
 * A standing goal — the quiet list under the weekly challenge.
 *
 * Not a challenge: nothing is submitted to a goal and none of them closes on a date. They
 * are running counts over what the player has already done, which is why the hub draws
 * them as meters and gives them no tap target.
 */
export interface ChallengeGoal {
  id: string;
  title: string;
  description: string;
  icon: ChallengeIconKey;
  /** A community goal's meter is the whole neighbourhood's, not this player's. */
  kind: 'personal' | 'community';
  progress: ChallengeProgress;
}

/** Who is winning an in-flight challenge. Only meaningful while it is still open. */
export interface ChallengeLeader {
  user: Pick<User, 'id' | 'username' | 'avatarUrl'>;
  qualifyingShots: number;
  reactions: number;
}

export interface Challenge {
  id: string;
  title: string;
  prompt: string;
  startsAt: string;
  endsAt: string;
  winningPhotoId?: string;

  /* --- added for rendering --- */

  status: ChallengeStatus;
  judging: ChallengeJudging;
  submissionCount: number;
  /** This player's entry, when they have one — the hub shows "Entered" instead of a CTA. */
  mySubmissionPhotoId: string | null;
  /** Populated on closed challenges so the winners rail needs no extra fetch. */
  winningPhoto?: PhotoWithAuthor;

  /* --- optional, for the hub's richer surfaces --- */

  /**
   * Everything below is optional and every one of them renders only when the server sends
   * it. The hub degrades a row at a time rather than all at once: a challenge with no
   * `progress` still shows its title, countdown and reward, and a challenge with none of
   * these is exactly the card that shipped before.
   */

  /**
   * What winning pays, derived server-side from the XP rule that actually grants it.
   * There is no per-challenge badge — do not put one here without shipping one.
   */
  reward?: string | null;
  /** This player's progress, or the field's for a community goal. */
  progress?: ChallengeProgress | null;
  icon?: ChallengeIconKey | null;
}

/* ------------------------------------------------------------------ */
/* Map                                                                */
/* ------------------------------------------------------------------ */

export interface CatSighting {
  id: string;
  reportedByUserId: string;
  location: GeoPoint;
  photoUrl: string;
  verified: boolean;
  createdAt: string;

  /* --- the capture behind the pin, when there was one --- */

  /**
   * Score and tier of the photograph that logged this sighting.
   *
   * Null for a bare report with no capture behind it, and for a sighting whose photo has
   * since been deleted — the pin outlives its evidence, because the cat was there either
   * way. Each field degrades on its own.
   */
  score: number | null;
  tier: Rarity | null;
  /** Who reported it. Null only if the account is gone. */
  reporter: { username: string; avatarUrl: string } | null;
}

/* ------------------------------------------------------------------ */
/* Votes                                                              */
/* ------------------------------------------------------------------ */

export interface Vote {
  id: string;
  photoId: string;
  voterId: string;
  reaction: Reaction;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Capture flow                                                       */
/* ------------------------------------------------------------------ */

/*
 * `PhotoSubmission` is gone. The phone uploads to storage itself and the request carries a
 * path, so there is no base64 body left to describe — see photoApi.capture.
 */

export type SubmissionRejectionReason =
  | 'no-cat-detected'
  | 'spoofed-photo'
  | 'rate-limited'
  | 'location-required'
  | 'album-full'
  | 'vision-unavailable';

/**
 * How many scores a player has left in the rolling window.
 *
 * The shutter is never rationed; this is. `limit: null` means unlimited, which is what a
 * Pro account gets.
 */
export interface RevealAllowance {
  limit: number | null;
  used: number;
  remaining: number | null;
  /** When the next slot frees up. Null while there are slots left. */
  resetsAt: string | null;
}

/**
 * How full the album is.
 *
 * The cap does not stop the shutter. A capture at the cap is stored and scored like any
 * other, and `overflowing` then says the player owes an answer: delete something to keep it,
 * or discard it. The reveal is spent on either branch, so this is a question about which
 * photograph to keep rather than about whether the score counted.
 *
 * `overflowing` is the server's verdict rather than a comparison the client makes, so
 * "full" means one thing across the app.
 */
export interface AlbumUsage {
  count: number;
  /** Null on Pro, where the album is unbounded. */
  limit: number | null;
  overflowing: boolean;
}

/** Both quotas, as `GET /photos/allowance` answers them. */
export interface Quotas extends RevealAllowance {
  album: AlbumUsage;
}

/**
 * What comes back from a capture.
 *
 * `scored` is the field everything branches on. A capture beyond the allowance is stored
 * whole and returns `scored: false` with a photo whose `scoredAt` is null — the score is
 * revealed from the album later, and until then there is no number to show.
 *
 * The cat, the XP and the rank-up that used to ride along are gone until the systems that
 * produce them exist. Carrying them as zeroes would have put a "+0 XP" on the reveal screen
 * and a cat nobody identified.
 */
/**
 * Why a capture came back without a score.
 *
 * `no_cat` is final for this photograph — the same pixels contain the same nothing on a
 * second look, so the only useful offer is another shot. `scoring_failed` is the model or
 * the network having a bad moment, and trying again is exactly right.
 *
 * `not_detected` is the phone's own verdict, reached before anything was sent anywhere. It
 * is the only one that is *cheap to be wrong about*, because no model was paid to produce
 * it — so it is also the only one where "score it anyway" is offered, and the on-device
 * detector being a rough heuristic is exactly why that escape hatch has to exist.
 *
 * The `message` is written server-side and shown as-is. It knows things the app does not:
 * whether the scorer timed out, was unreachable, or refused.
 */
export type ScoreFailureReason = 'no_cat' | 'scoring_failed' | 'not_detected';

export interface ScoreFailure {
  reason: ScoreFailureReason;
  message: string;
}

/**
 * What a scored photograph earned.
 *
 * Absent on anything that was not scored, and `null` rather than a zeroed object — a
 * "+0 XP" under a real score reads as the capture having been worth nothing, which is why
 * this rode off the response entirely until something existed to produce it.
 *
 * The totals are the ones *after* the award, so the profile meter can be drawn from this
 * response instead of refetching. Rank is deliberately not recomputed on the client: the ramp
 * is mirrored in both places for offline rendering, and if the two ever disagree the server's
 * answer is the one that is true.
 */
export interface CaptureAward {
  xpAwarded: number;
  xp: number;
  rank: number;
  /** Set only when this photograph crossed a threshold. The moment worth celebrating. */
  rankUp: { from: number; to: number; title: string } | null;
  xpToNextRank: number;
  /** True when this is the best score the player has ever reached. */
  personalBest: boolean;
  bestScore: number;
}

export interface ScoredCapture {
  photo: Photo;
  allowance: RevealAllowance;
  scored: boolean;
  /**
   * XP and rank, when this call scored something.
   *
   * Optional so a server without progression simply omits it and the reveal screen draws
   * nothing — the same degrade-a-row-at-a-time rule `candidates` follows. Null is the other
   * absence: the call ran and there was no score to pay for.
   */
  award?: CaptureAward | null;
  /**
   * Null when nothing went wrong — including on the ordinary unscored path, where the
   * player has simply used today's allowance and the photo is waiting its turn.
   *
   * So `scored: false` alone does not mean failure. `scored: false` with a `scoreError` does,
   * and that pairing is what separates the padlock from the retry sheet.
   */
  scoreError: ScoreFailure | null;
  /**
   * Read *after* this capture landed, so `album.overflowing` on the response is what raises
   * the sheet asking the player to make room or discard.
   */
  album: AlbumUsage;
  /**
   * Cats this photograph might be of, for the sheet that opens on this screen.
   *
   * Rides along because this is the moment the question gets asked — a separate request the
   * instant the reveal lands would be a second round trip for something the server already
   * knew while it was writing the row.
   *
   * Optional, and absent is not empty: a server without matching omits the field and the
   * sheet never opens, where `[]` means the matcher looked and found nobody nearby, which is
   * the "add a new cat" prompt. Weakest on an unscored photo, where there are no traits to
   * rank on yet and proximity is all there is — identifying does not wait for a score, and a
   * photograph can be attached to a cat long before it is judged.
   */
  candidates?: CatCandidate[];
}

/* ------------------------------------------------------------------ */
/* Social                                                             */
/* ------------------------------------------------------------------ */

export type LeaderboardScope = 'neighborhood' | 'city' | 'global' | 'friends';

/**
 * `community` is the headline board — best smoothed engagement ratio. `topPhoto` is the
 * app's own opinion, kept as a secondary tab so the two can visibly disagree.
 */
export type LeaderboardMetric =
  | 'community'
  | 'votesReceived'
  | 'challengeWins'
  | 'topPhoto';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string;
  value: number;
  isSelf: boolean;
  /** Thumbnail of the photo that earned the rank. Null for the challenge-wins metric. */
  topPhotoUrl: string | null;
}

/**
 * A challenge this player won, as a profile draws it.
 *
 * Public by design. Everything else a profile shows about somebody is either a total (how
 * many photos, how many cats) or something they chose to put on show; a win is neither —
 * it is a *result*, decided by the field, and hiding it would make the challenge system a
 * private scoreboard. It is also the only thing on a profile that says a player beat other
 * people rather than beat a threshold.
 *
 * The photograph may be gone: `winning_photo_id` is `on delete set null`, and a player can
 * delete a photo they won with. The win outlives it, so `photoUrl` degrades to empty rather
 * than the whole trophy disappearing.
 */
export interface ChallengeTrophy {
  challengeId: string;
  title: string;
  /** When the challenge closed, ISO 8601. Newest first, as the server sends them. */
  wonAt: string;
  /** The winning photograph, or '' if it has since been deleted. */
  photoUrl: string;
  /** What it scored. Null on a challenge judged by reactions, and on an unscored photo. */
  score: number | null;
  tier: Rarity | null;
  icon: ChallengeIconKey | null;
  /** How many entered. Context for what the win was worth — beating six is not beating six hundred. */
  entrants: number;
}

export interface PublicProfile {
  user: User;
  /** The photos this player chose to showcase, best-first. */
  showcasePhotos: Photo[];
  /**
   * Tier counts across their *shared* photos only.
   *
   * The photographs themselves are not here and never were sent: a stranger sees the shape
   * of an album, not its contents. `sharedToFeed` is the public/private line and it is the
   * player's own switch — counting the full album would leak how much they keep private,
   * which is exactly the number they decided not to share.
   */
  tierCounts: Record<Rarity, number>;
  /** Public photos, not the album total: how much is kept private is itself private. */
  totalPhotos: number;
  catsDiscovered: number;
  bestScore: number;
  challengeWins: number;
  /**
   * The wins themselves, newest first, not just the count beside them in the stat rail.
   *
   * Optional so a client running against a server that predates the field renders an empty
   * trophy case rather than throwing — the profile is the last screen that should fail hard
   * over a section it can simply not draw.
   */
  challengeTrophies?: ChallengeTrophy[];
}

/* ------------------------------------------------------------------ */
/* Shop                                                               */
/* ------------------------------------------------------------------ */

/** README section 5.7: Camera Filters, Frame Styles, Gallery Themes, Pro. */
export type ShopItemKind = 'filter' | 'frame' | 'theme' | 'pro';

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  /** Store product identifier passed to StoreKit / Play Billing. */
  productId: string;
  priceLabel: string;
  owned: boolean;
  /** Cosmetics can gate on rank — cosmetic progression, never power. */
  requiredRank: number;
  /**
   * What this costs in paws, or `null` for "not sold for paws".
   *
   * Null is the default and the common case: an item is only paw-purchasable because somebody
   * authored a number for it on the server. Independent of `priceLabel` — an item may carry
   * both a money price and a paw price, which are two doors to the same thing.
   *
   * Never set on Pro, and never on anything rank-gated. Both are enforced server-side; the
   * screen should not be the only thing stopping it.
   */
  pawPrice: number | null;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  /** Field-level validation failures, when the server sent them. */
  details?: unknown;
}
