-- AlterTable
ALTER TABLE "Device" ADD COLUMN "playerType" TEXT NOT NULL DEFAULT 'video_standard';

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "message" TEXT NOT NULL DEFAULT '',
    "requestedByUserId" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_status_idx" ON "DeviceCommand"("deviceId", "status");

-- CreateIndex
CREATE INDEX "DeviceCommand_requestedByUserId_idx" ON "DeviceCommand"("requestedByUserId");

-- CreateIndex
CREATE INDEX "DeviceCommand_updatedAt_idx" ON "DeviceCommand"("updatedAt");

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
