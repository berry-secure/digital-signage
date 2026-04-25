export type DeviceApprovalStatus = "pending" | "approved";
export type PlayerState = "waiting" | "idle" | "playing";
export type MediaKind = "video" | "image" | "audio";
export type DeviceCommandType =
  | "reboot_os"
  | "restart_app"
  | "force_sync"
  | "force_playlist_update"
  | "force_app_update"
  | "clear_cache"
  | "screenshot"
  | "blackout"
  | "wake"
  | "set_volume"
  | "network_diagnostics"
  | "upload_logs"
  | "rotate_secret";

export interface DeviceIdentity {
  serial: string;
  secret: string;
  createdAt: string;
}

export interface PlaybackEntry {
  id: string;
  playlistId: string;
  scheduleId?: string;
  mediaId?: string;
  title: string;
  kind: MediaKind;
  url: string;
  durationSeconds: number;
  volumePercent: number;
  hasAudio: boolean;
  checksum?: string;
  contentVersion?: number;
  sourceType?: "playlist" | "event";
  eventId?: string;
}

export interface PlaybackEvent {
  id: string;
  name: string;
  eventType: "audio" | "visual";
  triggerMode: "items" | "minutes";
  intervalItems: number;
  intervalMinutes: number;
  priority: number;
  media: PlaybackEntry;
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
  playerType: string;
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

export interface DeviceCommand {
  id: string;
  type: DeviceCommandType;
  payload: Record<string, unknown>;
  requestedAt: string;
}

export interface SessionResponse {
  device: DeviceRecord;
  approvalStatus: DeviceApprovalStatus;
  playback: PlaybackPayload;
  commands: DeviceCommand[];
  serverTime: string;
}
