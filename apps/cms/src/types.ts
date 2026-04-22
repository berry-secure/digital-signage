export interface BaseRecord {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  expand?: Record<string, unknown>;
}

export interface ClientRecord extends BaseRecord {
  name: string;
  slug: string;
  brandColor: string;
}

export interface ChannelRecord extends BaseRecord {
  client: string;
  name: string;
  slug: string;
  description: string;
  orientation: "landscape" | "portrait";
  expand?: {
    client?: ClientRecord;
  };
}

export interface CmsUserRecord extends BaseRecord {
  email: string;
  name: string;
  role: "owner" | "manager" | "editor";
  client: string;
  expand?: {
    client?: ClientRecord;
  };
}

export interface ScreenUserRecord extends BaseRecord {
  email: string;
  name: string;
  client: string;
  channel: string;
  locationLabel: string;
  status: "pairing" | "online" | "offline" | "maintenance";
  volumePercent: number;
  lastSeenAt: string;
  lastPlaybackAt: string;
  notes: string;
  desiredDisplayState: "active" | "blackout";
  deviceModel: string;
  appVersion: string;
  lastScreenshot: string;
  lastScreenshotAt: string;
  lastIpAddress: string;
  networkMode: "dhcp" | "manual";
  networkAddress: string;
  networkGateway: string;
  networkDns: string;
  wifiSsid: string;
  networkNotes: string;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
  };
}

export interface DevicePairingRecord extends BaseRecord {
  installerId: string;
  pairingCode: string;
  status: "waiting" | "paired" | "claimed" | "expired";
  deviceName: string;
  platform: string;
  appVersion: string;
  pairingExpiresAt: string;
  lastSeenAt: string;
  client: string;
  channel: string;
  locationLabel: string;
  screen: string;
  assignedEmail: string;
  claimedAt: string;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
    screen?: ScreenUserRecord;
  };
}

export interface DeviceCommandRecord extends BaseRecord {
  screen: string;
  commandType: "sync" | "capture_screenshot" | "blackout" | "wake" | "restart_app";
  payload: string;
  status: "queued" | "processing" | "done" | "failed";
  resultMessage: string;
  processedAt: string;
  expiresAt: string;
  issuedBy: string;
  expand?: {
    screen?: ScreenUserRecord;
    issuedBy?: CmsUserRecord;
  };
}

export interface MediaAssetRecord extends BaseRecord {
  client: string;
  title: string;
  kind: "video" | "image";
  asset: string;
  durationSeconds: number;
  hasAudio: boolean;
  status: "draft" | "published";
  tags: string;
  expand?: {
    client?: ClientRecord;
  };
}

export interface PlaylistRecord extends BaseRecord {
  client: string;
  channel: string;
  name: string;
  isActive: boolean;
  notes: string;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
  };
}

export interface PlaylistItemRecord extends BaseRecord {
  client: string;
  playlist: string;
  mediaAsset: string;
  sortOrder: number;
  loopCount: number;
  volumePercent: number;
  expand?: {
    playlist?: PlaylistRecord;
    mediaAsset?: MediaAssetRecord;
  };
}

export interface ScheduleRuleRecord extends BaseRecord {
  client: string;
  channel: string;
  playlist: string;
  label: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  daysOfWeek: string;
  priority: number;
  isActive: boolean;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
    playlist?: PlaylistRecord;
  };
}

export interface EventRecord extends BaseRecord {
  client: string;
  channel: string;
  screen: string;
  playlist: string;
  title: string;
  message: string;
  startsAt: string;
  endsAt: string;
  priority: number;
  isActive: boolean;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
    screen?: ScreenUserRecord;
    playlist?: PlaylistRecord;
  };
}

export interface DashboardData {
  clients: ClientRecord[];
  channels: ChannelRecord[];
  cmsUsers: CmsUserRecord[];
  screens: ScreenUserRecord[];
  devicePairings: DevicePairingRecord[];
  deviceCommands: DeviceCommandRecord[];
  mediaAssets: MediaAssetRecord[];
  playlists: PlaylistRecord[];
  playlistItems: PlaylistItemRecord[];
  schedules: ScheduleRuleRecord[];
  events: EventRecord[];
}
