-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('Common', 'Rare', 'Epic', 'Legendary');

-- CreateEnum
CREATE TYPE "PoseClass" AS ENUM ('sitting', 'standing', 'walking', 'sleeping', 'grooming', 'stretching', 'yawning', 'jumping', 'pouncing', 'loafing', 'unknown');

-- CreateEnum
CREATE TYPE "Reaction" AS ENUM ('laugh', 'love', 'wow');

-- CreateEnum
CREATE TYPE "ChallengeJudging" AS ENUM ('score', 'votes');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('email', 'google', 'apple');

-- CreateEnum
CREATE TYPE "CosmeticKind" AS ENUM ('filter', 'frame', 'theme', 'pro');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "provider" "AuthProvider" NOT NULL DEFAULT 'email',
    "providerSub" TEXT,
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "photographerRank" INTEGER NOT NULL DEFAULT 1,
    "photographerXp" INTEGER NOT NULL DEFAULT 0,
    "lifetimeScore" INTEGER NOT NULL DEFAULT 0,
    "votesReceived" INTEGER NOT NULL DEFAULT 0,
    "proSubscriptionActive" BOOLEAN NOT NULL DEFAULT false,
    "proExpiresAt" TIMESTAMP(3),
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "cityName" TEXT,
    "pushToken" TEXT,
    "shareCapturesByDefault" BOOLEAN NOT NULL DEFAULT false,
    "pushChallengeResults" BOOLEAN NOT NULL DEFAULT true,
    "pushVotes" BOOLEAN NOT NULL DEFAULT true,
    "pushNearbyRareCats" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cat" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "discoveredByUserId" TEXT NOT NULL,
    "defaultNickname" TEXT NOT NULL,
    "breedGuess" TEXT,
    "coatLabels" TEXT[],
    "rarityScore" INTEGER NOT NULL DEFAULT 0,
    "firstSeenLat" DOUBLE PRECISION NOT NULL,
    "firstSeenLng" DOUBLE PRECISION NOT NULL,
    "globalEncounterCount" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatDexEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "nickname" TEXT,
    "bio" TEXT,
    "bestPhotoId" TEXT,
    "bestPhotoScore" INTEGER NOT NULL DEFAULT 0,
    "bestTier" "Rarity" NOT NULL DEFAULT 'Common',
    "encounterCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatDexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "catId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "caption" TEXT,
    "composition" INTEGER NOT NULL,
    "poseRarity" INTEGER NOT NULL,
    "catRarity" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "tier" "Rarity" NOT NULL,
    "pose" "PoseClass" NOT NULL DEFAULT 'unknown',
    "badges" TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedLat" DOUBLE PRECISION NOT NULL,
    "capturedLng" DOUBLE PRECISION NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "laughCount" INTEGER NOT NULL DEFAULT 0,
    "loveCount" INTEGER NOT NULL DEFAULT 0,
    "wowCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "communityScore" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featuredAt" TIMESTAMP(3),
    "submittedToChallengeId" TEXT,
    "sharedToFeed" BOOLEAN NOT NULL DEFAULT false,
    "showcased" BOOLEAN NOT NULL DEFAULT false,
    "visionLabels" TEXT[],

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoView" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "judging" "ChallengeJudging" NOT NULL DEFAULT 'score',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "winningPhotoId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "reaction" "Reaction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatSighting" (
    "id" TEXT NOT NULL,
    "reportedByUserId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "corroborationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnedCosmetic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "CosmeticKind" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnedCosmetic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "topPhotoUrl" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_providerSub_key" ON "User"("providerSub");

-- CreateIndex
CREATE INDEX "User_lifetimeScore_idx" ON "User"("lifetimeScore");

-- CreateIndex
CREATE INDEX "User_votesReceived_idx" ON "User"("votesReceived");

-- CreateIndex
CREATE INDEX "User_homeLat_homeLng_idx" ON "User"("homeLat", "homeLng");

-- CreateIndex
CREATE INDEX "User_cityName_idx" ON "User"("cityName");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cat_identityKey_key" ON "Cat"("identityKey");

-- CreateIndex
CREATE INDEX "Cat_firstSeenLat_firstSeenLng_idx" ON "Cat"("firstSeenLat", "firstSeenLng");

-- CreateIndex
CREATE INDEX "Cat_discoveredByUserId_idx" ON "Cat"("discoveredByUserId");

-- CreateIndex
CREATE INDEX "CatDexEntry_userId_lastSeenAt_idx" ON "CatDexEntry"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "CatDexEntry_catId_idx" ON "CatDexEntry"("catId");

-- CreateIndex
CREATE UNIQUE INDEX "CatDexEntry_userId_catId_key" ON "CatDexEntry"("userId", "catId");

-- CreateIndex
CREATE INDEX "Photo_ownerId_capturedAt_idx" ON "Photo"("ownerId", "capturedAt");

-- CreateIndex
CREATE INDEX "Photo_ownerId_total_idx" ON "Photo"("ownerId", "total");

-- CreateIndex
CREATE INDEX "Photo_ownerId_tier_idx" ON "Photo"("ownerId", "tier");

-- CreateIndex
CREATE INDEX "Photo_catId_idx" ON "Photo"("catId");

-- CreateIndex
CREATE INDEX "Photo_submittedToChallengeId_idx" ON "Photo"("submittedToChallengeId");

-- CreateIndex
CREATE INDEX "Photo_sharedToFeed_capturedAt_idx" ON "Photo"("sharedToFeed", "capturedAt");

-- CreateIndex
CREATE INDEX "Photo_sharedToFeed_communityScore_idx" ON "Photo"("sharedToFeed", "communityScore");

-- CreateIndex
CREATE INDEX "Photo_featured_featuredAt_idx" ON "Photo"("featured", "featuredAt");

-- CreateIndex
CREATE INDEX "PhotoView_viewerId_createdAt_idx" ON "PhotoView"("viewerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoView_photoId_viewerId_key" ON "PhotoView"("photoId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_slug_key" ON "Challenge"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_winningPhotoId_key" ON "Challenge"("winningPhotoId");

-- CreateIndex
CREATE INDEX "Challenge_startsAt_endsAt_idx" ON "Challenge"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Vote_photoId_idx" ON "Vote"("photoId");

-- CreateIndex
CREATE INDEX "Vote_voterId_idx" ON "Vote"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_photoId_voterId_key" ON "Vote"("photoId", "voterId");

-- CreateIndex
CREATE INDEX "CatSighting_lat_lng_idx" ON "CatSighting"("lat", "lng");

-- CreateIndex
CREATE INDEX "CatSighting_expiresAt_idx" ON "CatSighting"("expiresAt");

-- CreateIndex
CREATE INDEX "CatSighting_reportedByUserId_idx" ON "CatSighting"("reportedByUserId");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_accepted_idx" ON "Friendship"("addresseeId", "accepted");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_transactionId_key" ON "Purchase"("transactionId");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "OwnedCosmetic_userId_idx" ON "OwnedCosmetic"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnedCosmetic_userId_itemId_key" ON "OwnedCosmetic"("userId", "itemId");

-- CreateIndex
CREATE INDEX "XpLedgerEntry_userId_createdAt_idx" ON "XpLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_scope_metric_bucket_rank_idx" ON "LeaderboardSnapshot"("scope", "metric", "bucket", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardSnapshot_scope_metric_bucket_userId_key" ON "LeaderboardSnapshot"("scope", "metric", "bucket", "userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cat" ADD CONSTRAINT "Cat_discoveredByUserId_fkey" FOREIGN KEY ("discoveredByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatDexEntry" ADD CONSTRAINT "CatDexEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatDexEntry" ADD CONSTRAINT "CatDexEntry_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_catId_fkey" FOREIGN KEY ("catId") REFERENCES "Cat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_submittedToChallengeId_fkey" FOREIGN KEY ("submittedToChallengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoView" ADD CONSTRAINT "PhotoView_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoView" ADD CONSTRAINT "PhotoView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_winningPhotoId_fkey" FOREIGN KEY ("winningPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatSighting" ADD CONSTRAINT "CatSighting_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnedCosmetic" ADD CONSTRAINT "OwnedCosmetic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedgerEntry" ADD CONSTRAINT "XpLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

