CREATE TABLE "MusicTrack" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL DEFAULT '',
  "album" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL DEFAULT 180,
  "status" "MediaStatus" NOT NULL DEFAULT 'published',
  "tags" TEXT NOT NULL DEFAULT '',
  "licenseNotes" TEXT NOT NULL DEFAULT '',
  "checksum" TEXT NOT NULL DEFAULT '',
  "contentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicPlaylist" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicPlaylistTrack" (
  "id" UUID NOT NULL,
  "playlistId" UUID NOT NULL,
  "trackId" UUID NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 10,
  "volumePercent" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicPlaylistTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicChannel" (
  "id" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "playlistId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MusicChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MusicChannelLocation" (
  "id" UUID NOT NULL,
  "musicChannelId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicChannelLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MusicTrack_status_idx" ON "MusicTrack"("status");
CREATE INDEX "MusicTrack_updatedAt_idx" ON "MusicTrack"("updatedAt");
CREATE INDEX "MusicPlaylist_isActive_idx" ON "MusicPlaylist"("isActive");
CREATE INDEX "MusicPlaylist_updatedAt_idx" ON "MusicPlaylist"("updatedAt");
CREATE INDEX "MusicPlaylistTrack_playlistId_sortOrder_idx" ON "MusicPlaylistTrack"("playlistId", "sortOrder");
CREATE INDEX "MusicPlaylistTrack_trackId_idx" ON "MusicPlaylistTrack"("trackId");
CREATE INDEX "MusicChannel_clientId_idx" ON "MusicChannel"("clientId");
CREATE INDEX "MusicChannel_playlistId_idx" ON "MusicChannel"("playlistId");
CREATE INDEX "MusicChannel_isActive_idx" ON "MusicChannel"("isActive");
CREATE INDEX "MusicChannelLocation_locationId_idx" ON "MusicChannelLocation"("locationId");
CREATE UNIQUE INDEX "MusicChannelLocation_musicChannelId_locationId_key" ON "MusicChannelLocation"("musicChannelId", "locationId");

ALTER TABLE "MusicPlaylistTrack" ADD CONSTRAINT "MusicPlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicPlaylistTrack" ADD CONSTRAINT "MusicPlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "MusicTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MusicChannel" ADD CONSTRAINT "MusicChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicChannel" ADD CONSTRAINT "MusicChannel_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MusicPlaylist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MusicChannelLocation" ADD CONSTRAINT "MusicChannelLocation_musicChannelId_fkey" FOREIGN KEY ("musicChannelId") REFERENCES "MusicChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MusicChannelLocation" ADD CONSTRAINT "MusicChannelLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
