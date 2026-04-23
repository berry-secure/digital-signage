export type DeviceApprovalStatus = "pending" | "approved";
export type PlayerState = "waiting" | "idle" | "playing";
export type MediaKind = "video" | "image";

export interface DeviceIdentity {
  serial: string;
  secret: string;
  createdAt: string;
}

export interface PlaybackEntry {
  id: string;
  playlistId: string;
  title: string;
  kind: MediaKind;
  url: string;
  durationSeconds: number;
  volumePercent: number;
  hasAudio: boolean;
}

export interface PlaybackPayload {
  mode: "idle" | "playlist";
  queue: PlaybackEntry[];
  label: string;
  reason: string;
  fallbackUsed: boolean;
}

export interface DeviceRecord {
  id: string;
  serial: string;
  approvalStatus: DeviceApprovalStatus;
  name: string;
  clientId: string;
  channelId: string;
  locationLabel: string;
  notes: string;
  platform: string;
  appVersion: string;
  deviceModel: string;
  desiredDisplayState: "active" | "blackout";
  volumePercent: number;
  playerState: PlayerState;
  playerMessage: string;
  activeItemTitle: string;
  lastSeenAt: string;
  lastSyncAt: string;
  lastPlaybackAt: string;
  clientName: string;
  channelName: string;
  online: boolean;
}

export interface SessionResponse {
  device: DeviceRecord;
  approvalStatus: DeviceApprovalStatus;
  playback: PlaybackPayload;
  serverTime: string;
}
