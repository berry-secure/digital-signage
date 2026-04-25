import type { DeviceDisplayState, DeviceRecord } from "./types";

export type DeviceConnection = "online" | "stale" | "offline";
export type DeviceQuickAction = "blackout" | "wake";
export type DeviceType = "android" | "rpi" | "web" | "other";

export type DeviceCenterFilters = {
  clientId: string;
  query: string;
  type: DeviceType | "";
};

export type DeviceFleetSummary = {
  total: number;
  pending: number;
  approved: number;
  online: number;
  stale: number;
  offline: number;
  blackout: number;
};

const offlineWindowMs = 5 * 60 * 1000;

export function getDeviceConnection(device: DeviceRecord, now = new Date()): DeviceConnection {
  if (device.online) {
    return "online";
  }

  const lastSeenAt = Date.parse(device.lastSeenAt || "");
  if (!Number.isFinite(lastSeenAt)) {
    return "offline";
  }

  return now.getTime() - lastSeenAt <= offlineWindowMs ? "stale" : "offline";
}

export function summarizeDeviceFleet(devices: DeviceRecord[], now = new Date()): DeviceFleetSummary {
  return devices.reduce<DeviceFleetSummary>(
    (summary, device) => {
      summary.total += 1;
      if (device.approvalStatus === "pending") {
        summary.pending += 1;
        return summary;
      }

      summary.approved += 1;
      if (device.desiredDisplayState === "blackout") {
        summary.blackout += 1;
      }

      const connection = getDeviceConnection(device, now);
      summary[connection] += 1;
      return summary;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      online: 0,
      stale: 0,
      offline: 0,
      blackout: 0
    }
  );
}

export function filterDeviceCenterDevices(devices: DeviceRecord[], filters: DeviceCenterFilters) {
  const query = filters.query.trim().toLowerCase();

  return devices.filter((device) => {
    if (filters.clientId && device.clientId !== filters.clientId) {
      return false;
    }

    if (filters.type && getDeviceType(device) !== filters.type) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      device.name,
      device.serial,
      device.clientName,
      device.channelName,
      device.locationLabel,
      device.platform,
      device.deviceModel,
      device.appVersion,
      device.playerMessage,
      device.activeItemTitle
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

export function getDeviceType(device: DeviceRecord): DeviceType {
  const typeHint = `${device.platform} ${device.deviceModel}`.toLowerCase();

  if (typeHint.includes("raspberry") || typeHint.includes("rpi")) {
    return "rpi";
  }

  if (typeHint.includes("web") || typeHint.includes("chrome") || typeHint.includes("browser")) {
    return "web";
  }

  if (typeHint.includes("android")) {
    return "android";
  }

  return "other";
}

export function buildDeviceQuickUpdate(device: DeviceRecord, action: DeviceQuickAction) {
  const desiredDisplayState: DeviceDisplayState = action === "blackout" ? "blackout" : "active";

  return {
    name: device.name,
    clientId: device.clientId,
    channelId: device.channelId,
    locationLabel: device.locationLabel,
    notes: device.notes,
    desiredDisplayState,
    volumePercent: device.volumePercent
  };
}
