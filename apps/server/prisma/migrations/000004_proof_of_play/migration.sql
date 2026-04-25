CREATE TABLE "ProofOfPlay" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'playlist',
    "playlistId" TEXT NOT NULL DEFAULT '',
    "scheduleId" TEXT NOT NULL DEFAULT '',
    "mediaId" TEXT NOT NULL DEFAULT '',
    "playbackItemId" TEXT NOT NULL DEFAULT '',
    "eventId" TEXT NOT NULL DEFAULT '',
    "mediaTitle" TEXT NOT NULL DEFAULT '',
    "mediaKind" "MediaKind" NOT NULL DEFAULT 'video',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL DEFAULT '',
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "appVersion" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofOfPlay_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProofOfPlay_deviceId_occurredAt_idx" ON "ProofOfPlay"("deviceId", "occurredAt");
CREATE INDEX "ProofOfPlay_status_idx" ON "ProofOfPlay"("status");
CREATE INDEX "ProofOfPlay_mediaId_idx" ON "ProofOfPlay"("mediaId");
CREATE INDEX "ProofOfPlay_playlistId_idx" ON "ProofOfPlay"("playlistId");
CREATE INDEX "ProofOfPlay_occurredAt_idx" ON "ProofOfPlay"("occurredAt");

ALTER TABLE "ProofOfPlay" ADD CONSTRAINT "ProofOfPlay_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
