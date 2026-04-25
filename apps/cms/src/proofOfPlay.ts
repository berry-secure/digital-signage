import type { ProofOfPlayRecord, ProofOfPlayStatus } from "./types";

export type ProofOfPlayFilters = {
  clientId: string;
  deviceId: string;
  status: ProofOfPlayStatus | "";
  query: string;
};

export type ProofOfPlaySummary = {
  total: number;
  started: number;
  finished: number;
  error: number;
  uniqueDevices: number;
  uniqueMedia: number;
};

const csvHeaders = [
  "status",
  "device",
  "serial",
  "client",
  "channel",
  "media",
  "source",
  "startedAt",
  "finishedAt",
  "durationSeconds",
  "checksum",
  "contentVersion",
  "errorMessage"
];

export function filterProofOfPlay(records: ProofOfPlayRecord[], filters: ProofOfPlayFilters) {
  const query = filters.query.trim().toLowerCase();

  return records.filter((record) => {
    if (filters.clientId && record.clientId !== filters.clientId) {
      return false;
    }
    if (filters.deviceId && record.deviceId !== filters.deviceId) {
      return false;
    }
    if (filters.status && record.status !== filters.status) {
      return false;
    }
    if (!query) {
      return true;
    }

    return [
      record.deviceName,
      record.deviceSerial,
      record.clientName,
      record.channelName,
      record.mediaTitle,
      record.mediaId,
      record.playlistId,
      record.scheduleId,
      record.checksum,
      record.errorMessage,
      record.appVersion
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function summarizeProofOfPlay(records: ProofOfPlayRecord[]): ProofOfPlaySummary {
  const devices = new Set<string>();
  const media = new Set<string>();

  return records.reduce<ProofOfPlaySummary>(
    (summary, record) => {
      summary.total += 1;
      if (record.status === "started") {
        summary.started += 1;
      } else if (record.status === "finished") {
        summary.finished += 1;
      } else {
        summary.error += 1;
      }
      if (record.deviceId) {
        devices.add(record.deviceId);
      }
      if (record.mediaId) {
        media.add(record.mediaId);
      }
      summary.uniqueDevices = devices.size;
      summary.uniqueMedia = media.size;
      return summary;
    },
    {
      total: 0,
      started: 0,
      finished: 0,
      error: 0,
      uniqueDevices: 0,
      uniqueMedia: 0
    }
  );
}

export function buildProofOfPlayCsv(records: ProofOfPlayRecord[]) {
  const rows = records.map((record) => [
    record.status,
    record.deviceName,
    record.deviceSerial,
    record.clientName,
    record.channelName,
    record.mediaTitle,
    record.sourceType,
    record.startedAt,
    record.finishedAt,
    String(record.durationSeconds || 0),
    record.checksum,
    String(record.contentVersion || 1),
    record.errorMessage
  ]);

  return [csvHeaders, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
