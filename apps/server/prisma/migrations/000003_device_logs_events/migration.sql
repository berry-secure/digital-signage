ALTER TYPE "MediaKind" ADD VALUE 'audio';

CREATE TABLE "PlaybackEvent" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "channelId" UUID,
    "mediaId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'visual',
    "triggerMode" TEXT NOT NULL DEFAULT 'items',
    "intervalItems" INTEGER NOT NULL DEFAULT 1,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceLog" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "severity" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT '',
    "context" JSONB,
    "appVersion" TEXT NOT NULL DEFAULT '',
    "osVersion" TEXT NOT NULL DEFAULT '',
    "networkStatus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaybackEvent_clientId_idx" ON "PlaybackEvent"("clientId");
CREATE INDEX "PlaybackEvent_channelId_idx" ON "PlaybackEvent"("channelId");
CREATE INDEX "PlaybackEvent_mediaId_idx" ON "PlaybackEvent"("mediaId");
CREATE INDEX "PlaybackEvent_isActive_priority_idx" ON "PlaybackEvent"("isActive", "priority");
CREATE INDEX "DeviceLog_deviceId_createdAt_idx" ON "DeviceLog"("deviceId", "createdAt");
CREATE INDEX "DeviceLog_severity_idx" ON "DeviceLog"("severity");
CREATE INDEX "DeviceLog_component_idx" ON "DeviceLog"("component");
CREATE INDEX "DeviceLog_createdAt_idx" ON "DeviceLog"("createdAt");

ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaybackEvent" ADD CONSTRAINT "PlaybackEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceLog" ADD CONSTRAINT "DeviceLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
