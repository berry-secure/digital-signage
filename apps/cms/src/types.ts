export type UserRole = "owner" | "manager" | "editor";
export type DeviceApprovalStatus = "pending" | "approved";
export type DeviceDisplayState = "active" | "blackout";
export type DevicePlayerState = "waiting" | "idle" | "playing";
export type DevicePlayerType =
  | "music_mini"
  | "music_max"
  | "video_standard"
  | "video_premium"
  | "streaming"
  | "android_tv"
  | "mobile_app";
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
export type DeviceCommandStatus = "pending" | "sent" | "acked" | "failed";
export type MediaKind = "video" | "image";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface ClientRecord {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRecord {
  id: string;
  clientId: string;
  name: string;
  slug: string;
  description: string;
  orientation: "landscape" | "portrait";
  createdAt: string;
  updatedAt: string;
}

export interface MediaRecord {
  id: string;
  clientId: string;
  title: string;
  kind: MediaKind;
  fileName: string;
  originalName: string;
  mimeType: string;
  durationSeconds: number;
  hasAudio: boolean;
  status: "draft" | "published";
  tags: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemRecord {
  id: string;
  playlistId: string;
  mediaId: string;
  sortOrder: number;
  loopCount: number;
  volumePercent: number;
  createdAt: string;
  updatedAt: string;
  media: MediaRecord | null;
}

export interface PlaylistRecord {
  id: string;
  clientId: string;
  channelId: string;
  name: string;
  isActive: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItemRecord[];
}

export interface ScheduleRecord {
  id: string;
  clientId: string;
  channelId: string;
  playlistId: string;
  label: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  daysOfWeek: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceRecord {
  id: string;
  serial: string;
  secret: string;
  approvalStatus: DeviceApprovalStatus;
  name: string;
  clientId: string;
  channelId: string;
  locationLabel: string;
  notes: string;
  platform: string;
  appVersion: string;
  deviceModel: string;
  playerType: DevicePlayerType;
  desiredDisplayState: DeviceDisplayState;
  volumePercent: number;
  playerState: DevicePlayerState;
  playerMessage: string;
  activeItemTitle: string;
  lastSeenAt: string;
  lastSyncAt: string;
  lastPlaybackAt: string;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  channelName: string;
  online: boolean;
}

export interface DeviceCommandRecord {
  id: string;
  deviceId: string;
  type: DeviceCommandType;
  status: DeviceCommandStatus;
  payload: Record<string, unknown>;
  message: string;
  requestedByUserId: string;
  requestedAt: string;
  sentAt: string;
  ackedAt: string;
  createdAt: string;
  updatedAt: string;
  deviceName: string;
  deviceSerial: string;
}

export interface InstallationInfo {
  apiBaseUrl: string;
  apkUrl: string;
}

export interface BootstrapPayload {
  user: UserRecord;
  users: UserRecord[];
  installation: InstallationInfo;
  clients: ClientRecord[];
  channels: ChannelRecord[];
  media: MediaRecord[];
  playlists: PlaylistRecord[];
  schedules: ScheduleRecord[];
  devices: DeviceRecord[];
  deviceCommands: DeviceCommandRecord[];
}
