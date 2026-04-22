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
  status: "online" | "offline" | "maintenance";
  volumePercent: number;
  lastSeenAt: string;
  lastPlaybackAt: string;
  notes: string;
  expand?: {
    client?: ClientRecord;
    channel?: ChannelRecord;
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
  screens: ScreenUserRecord[];
  mediaAssets: MediaAssetRecord[];
  playlists: PlaylistRecord[];
  playlistItems: PlaylistItemRecord[];
  schedules: ScheduleRuleRecord[];
  events: EventRecord[];
}
