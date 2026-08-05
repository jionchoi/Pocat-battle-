-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "hotScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Photo_sharedToFeed_hotScore_idx" ON "Photo"("sharedToFeed", "hotScore");

-- CreateIndex
CREATE INDEX "Photo_sharedToFeed_capturedAt_hotScore_idx" ON "Photo"("sharedToFeed", "capturedAt", "hotScore");
