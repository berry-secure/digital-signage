ALTER TABLE "UserClient" ADD COLUMN "allLocations" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Location" (
  "id" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserLocationAccess" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserLocationAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelLocation" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlaylistItemLocation" (
  "id" UUID NOT NULL,
  "playlistItemId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistItemLocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Device" ADD COLUMN "locationId" UUID;

CREATE INDEX "Location_clientId_idx" ON "Location"("clientId");
CREATE INDEX "UserLocationAccess_clientId_idx" ON "UserLocationAccess"("clientId");
CREATE INDEX "UserLocationAccess_locationId_idx" ON "UserLocationAccess"("locationId");
CREATE UNIQUE INDEX "UserLocationAccess_userId_locationId_key" ON "UserLocationAccess"("userId", "locationId");
CREATE INDEX "ChannelLocation_locationId_idx" ON "ChannelLocation"("locationId");
CREATE UNIQUE INDEX "ChannelLocation_channelId_locationId_key" ON "ChannelLocation"("channelId", "locationId");
CREATE INDEX "PlaylistItemLocation_locationId_idx" ON "PlaylistItemLocation"("locationId");
CREATE UNIQUE INDEX "PlaylistItemLocation_playlistItemId_locationId_key" ON "PlaylistItemLocation"("playlistItemId", "locationId");
CREATE INDEX "Device_locationId_idx" ON "Device"("locationId");

ALTER TABLE "Location" ADD CONSTRAINT "Location_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelLocation" ADD CONSTRAINT "ChannelLocation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelLocation" ADD CONSTRAINT "ChannelLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistItemLocation" ADD CONSTRAINT "PlaylistItemLocation_playlistItemId_fkey" FOREIGN KEY ("playlistItemId") REFERENCES "PlaylistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistItemLocation" ADD CONSTRAINT "PlaylistItemLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
