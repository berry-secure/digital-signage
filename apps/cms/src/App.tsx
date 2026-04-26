import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  approveDevice,
  clearToken,
  createChannel,
  createClient,
  createLocation,
  createPlaylist,
  createPlaylistItem,
  createPlaybackEvent,
  createSchedule,
  createUser,
  deleteChannel,
  deleteClient,
  deleteDevice,
  deleteLocation,
  deleteMedia,
  deletePlaylist,
  deletePlaylistItem,
  deletePlaybackEvent,
  deleteSchedule,
  deleteUser,
  fetchBootstrap,
  getApiBaseUrl,
  getStoredToken,
  issueDeviceCommand,
  login,
  logout,
  resetDevice,
  storeToken,
  updateChannel,
  updateClient,
  updateDevice,
  updateLocation,
  updatePlaybackEvent,
  updatePlaylist,
  updateSchedule,
  updateUser,
  uploadMedia
} from "./api";
import {
  filterDeviceCenterDevices,
  getDeviceConnection,
  getDeviceType,
  getDeviceTypeLabel,
  getOfflineDeviceAlerts,
  summarizeDeviceFleet,
  type DeviceCenterFilters
} from "./deviceCenter";
import {
  buildProofOfPlayCsv,
  filterProofOfPlay,
  summarizeProofOfPlay,
  type ProofOfPlayFilters
} from "./proofOfPlay";
import type {
  BootstrapPayload,
  ChannelRecord,
  ClientRecord,
  DeviceCommandRecord,
  DeviceCommandType,
  DeviceRecord,
  InstallationInfo,
  LocationRecord,
  MediaKind,
  MediaRecord,
  PlaybackEventRecord,
  ProofOfPlayRecord,
  PlaylistRecord,
  ScheduleRecord,
  UserRecord,
  UserRole
} from "./types";

type SectionKey =
  | "overview"
  | "users"
  | "clients"
  | "channels"
  | "media"
  | "playlists"
  | "events"
  | "schedule"
  | "devices"
  | "reports"
  | "logs"
  | "install";
type FlashMessage = { kind: "success" | "error"; text: string };

type UserFormState = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  clientIds: string[];
  allLocations: boolean;
  locationIds: string[];
};

type ClientFormState = {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
};

type LocationFormState = {
  id: string;
  clientId: string;
  name: string;
  city: string;
  address: string;
  notes: string;
};

type ChannelFormState = {
  id: string;
  clientId: string;
  name: string;
  slug: string;
  description: string;
  orientation: "landscape" | "portrait";
  locationIds: string[];
};

type MediaFormState = {
  clientId: string;
  title: string;
  kind: MediaKind;
  durationSeconds: string;
  hasAudio: boolean;
  status: "draft" | "published";
  tags: string;
  file: File | null;
};

type PlaybackEventFormState = {
  id: string;
  clientId: string;
  channelId: string;
  mediaId: string;
  name: string;
  eventType: "audio" | "visual";
  triggerMode: "items" | "minutes";
  intervalItems: string;
  intervalMinutes: string;
  priority: string;
  isActive: boolean;
};

type DeviceLogFilters = {
  clientId: string;
  locationId: string;
  deviceId: string;
  severity: "" | "info" | "warn" | "error";
  component: string;
  query: string;
};

type ProofReportFilters = ProofOfPlayFilters;

type ClientDirectoryFilters = {
  clientId: string;
  locationId: string;
  query: string;
};

type PlaylistFormState = {
  id: string;
  clientId: string;
  channelId: string;
  name: string;
  isActive: boolean;
  notes: string;
};

type PlaylistItemFormState = {
  playlistId: string;
  mediaId: string;
  sortOrder: string;
  loopCount: string;
  volumePercent: string;
  locationIds: string[];
};

type ScheduleFormState = {
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
  priority: string;
  isActive: boolean;
};

type DeviceFormState = {
  id: string;
  serial: string;
  name: string;
  clientId: string;
  channelId: string;
  locationId: string;
  playerType: DeviceCenterFilters["type"];
  locationLabel: string;
  notes: string;
  desiredDisplayState: "active" | "blackout";
  volumePercent: string;
};

const navItems: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: "overview", label: "Pulpit", hint: "status systemu" },
  { key: "users", label: "Użytkownicy", hint: "konta CMS" },
  { key: "clients", label: "Klienci", hint: "firmy i lokalizacje" },
  { key: "channels", label: "Kanały", hint: "grupy emisji" },
  { key: "media", label: "Media", hint: "video i obrazy" },
  { key: "playlists", label: "Playlisty", hint: "kolejność materiałów" },
  { key: "events", label: "Eventy", hint: "komunikaty w emisji" },
  { key: "schedule", label: "Harmonogramy", hint: "emisja wg czasu" },
  { key: "devices", label: "Urządzenia", hint: "seriale i approval" },
  { key: "reports", label: "Raporty", hint: "proof of play" },
  { key: "logs", label: "Logi", hint: "błędy playerów" },
  { key: "install", label: "Instalacja", hint: "APK i adres serwera" }
];

const playerTypeOptions: Array<{ value: DeviceCenterFilters["type"]; label: string }> = [
  { value: "music_mini", label: "Music Mini" },
  { value: "music_max", label: "Music Max" },
  { value: "video_standard", label: "Video Standard" },
  { value: "video_premium", label: "Video Premium" },
  { value: "streaming", label: "Streaming" },
  { value: "android_tv", label: "AndroidTV" },
  { value: "mobile_app", label: "MobileApp" }
];

const deviceTypeOptions: Array<{ value: DeviceCenterFilters["type"] | ""; label: string }> = [
  { value: "", label: "Wszystkie typy" },
  ...playerTypeOptions
];

const liveCommandOptions: Array<{ value: DeviceCommandType; label: string }> = [
  { value: "force_sync", label: "Force sync" },
  { value: "force_playlist_update", label: "Force playlist update" },
  { value: "restart_app", label: "Restart app" },
  { value: "reboot_os", label: "Reboot OS" },
  { value: "force_app_update", label: "Force firmware/app update" },
  { value: "clear_cache", label: "Clear cache" },
  { value: "screenshot", label: "Screenshot" },
  { value: "network_diagnostics", label: "Network diagnostics" },
  { value: "upload_logs", label: "Upload logs" },
  { value: "rotate_secret", label: "Rotate secret" },
  { value: "set_volume", label: "Apply volume" }
];

const playbackEventTypeOptions: Array<{ value: PlaybackEventFormState["eventType"]; label: string }> = [
  { value: "visual", label: "Graficzny / wizualny" },
  { value: "audio", label: "Głosowy / audio" }
];

const playbackEventTriggerOptions: Array<{ value: PlaybackEventFormState["triggerMode"]; label: string }> = [
  { value: "items", label: "Co X odtworzonych mediów" },
  { value: "minutes", label: "Co X minut emisji" }
];

const emptyBootstrap: BootstrapPayload = {
  user: { id: "", email: "", name: "", role: "owner", clientIds: [], locationAccesses: [] },
  users: [],
  installation: { apiBaseUrl: "", apkUrl: "" },
  clients: [],
  locations: [],
  channels: [],
  media: [],
  playlists: [],
  schedules: [],
  devices: [],
  deviceCommands: [],
  playbackEvents: [],
  deviceLogs: [],
  proofOfPlay: []
};

const emptyUserForm: UserFormState = {
  id: "",
  email: "",
  password: "",
  name: "",
  role: "editor",
  clientIds: [],
  allLocations: true,
  locationIds: []
};

const emptyClientForm: ClientFormState = {
  id: "",
  name: "",
  slug: "",
  brandColor: "#ff6a3d"
};

const emptyLocationForm: LocationFormState = {
  id: "",
  clientId: "",
  name: "",
  city: "",
  address: "",
  notes: ""
};

const emptyChannelForm: ChannelFormState = {
  id: "",
  clientId: "",
  name: "",
  slug: "",
  description: "",
  orientation: "landscape",
  locationIds: []
};

const emptyMediaForm: MediaFormState = {
  clientId: "",
  title: "",
  kind: "video",
  durationSeconds: "10",
  hasAudio: true,
  status: "published",
  tags: "",
  file: null
};

const emptyPlaylistForm: PlaylistFormState = {
  id: "",
  clientId: "",
  channelId: "",
  name: "",
  isActive: true,
  notes: ""
};

const emptyPlaylistItemForm: PlaylistItemFormState = {
  playlistId: "",
  mediaId: "",
  sortOrder: "10",
  loopCount: "1",
  volumePercent: "100",
  locationIds: []
};

const emptyScheduleForm: ScheduleFormState = {
  id: "",
  clientId: "",
  channelId: "",
  playlistId: "",
  label: "",
  startDate: "",
  endDate: "",
  startTime: "08:00",
  endTime: "18:00",
  daysOfWeek: "1,2,3,4,5",
  priority: "100",
  isActive: true
};

const emptyPlaybackEventForm: PlaybackEventFormState = {
  id: "",
  clientId: "",
  channelId: "",
  mediaId: "",
  name: "",
  eventType: "visual",
  triggerMode: "items",
  intervalItems: "1",
  intervalMinutes: "5",
  priority: "100",
  isActive: true
};

const emptyDeviceForm: DeviceFormState = {
  id: "",
  serial: "",
  name: "",
  clientId: "",
  channelId: "",
  locationId: "",
  playerType: "video_standard",
  locationLabel: "",
  notes: "",
  desiredDisplayState: "active",
  volumePercent: "80"
};

const emptyClientDirectoryFilters: ClientDirectoryFilters = {
  clientId: "",
  locationId: "",
  query: ""
};

const emptyDeviceLogFilters: DeviceLogFilters = {
  clientId: "",
  locationId: "",
  deviceId: "",
  severity: "",
  component: "",
  query: ""
};

const emptyProofReportFilters: ProofReportFilters = {
  clientId: "",
  locationId: "",
  deviceId: "",
  status: "",
  query: ""
};

const weekdayOptions = [
  { value: 1, label: "Pon" },
  { value: 2, label: "Wt" },
  { value: 3, label: "Śr" },
  { value: 4, label: "Czw" },
  { value: 5, label: "Pt" },
  { value: 6, label: "Sob" },
  { value: 0, label: "Nd" }
];

function App() {
  const [token, setToken] = useState(() => getStoredToken());
  const [dashboard, setDashboard] = useState<BootstrapPayload>(emptyBootstrap);
  const [loading, setLoading] = useState(Boolean(getStoredToken()));
  const [submitting, setSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "admin@berry-secure.pl", password: "berry-secure-admin" });
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [clientForm, setClientForm] = useState<ClientFormState>(emptyClientForm);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [clientDirectoryFilters, setClientDirectoryFilters] = useState<ClientDirectoryFilters>(emptyClientDirectoryFilters);
  const [locationForm, setLocationForm] = useState<LocationFormState>(emptyLocationForm);
  const [channelForm, setChannelForm] = useState<ChannelFormState>(emptyChannelForm);
  const [mediaForm, setMediaForm] = useState<MediaFormState>(emptyMediaForm);
  const [mediaInputKey, setMediaInputKey] = useState(0);
  const [playlistForm, setPlaylistForm] = useState<PlaylistFormState>(emptyPlaylistForm);
  const [playlistItemForm, setPlaylistItemForm] = useState<PlaylistItemFormState>(emptyPlaylistItemForm);
  const [playbackEventForm, setPlaybackEventForm] = useState<PlaybackEventFormState>(emptyPlaybackEventForm);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(emptyScheduleForm);
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(emptyDeviceForm);
  const [deviceFilters, setDeviceFilters] = useState<DeviceCenterFilters>({ clientId: "", locationId: "", query: "", type: "" });
  const [deviceLogFilters, setDeviceLogFilters] = useState<DeviceLogFilters>(emptyDeviceLogFilters);
  const [appliedDeviceLogFilters, setAppliedDeviceLogFilters] = useState<DeviceLogFilters>(emptyDeviceLogFilters);
  const [deviceLogsRequested, setDeviceLogsRequested] = useState(false);
  const [proofReportFilters, setProofReportFilters] = useState<ProofReportFilters>(emptyProofReportFilters);
  const [appliedProofReportFilters, setAppliedProofReportFilters] = useState<ProofReportFilters>(emptyProofReportFilters);
  const [proofReportsRequested, setProofReportsRequested] = useState(false);
  const [deviceCommandDrafts, setDeviceCommandDrafts] = useState<Record<string, DeviceCommandType>>({});

  const clients = dashboard.clients;
  const locations = dashboard.locations || [];
  const channels = dashboard.channels;
  const media = dashboard.media;
  const playlists = dashboard.playlists;
  const schedules = dashboard.schedules;
  const devices = dashboard.devices;
  const deviceCommands = dashboard.deviceCommands || [];
  const playbackEvents = dashboard.playbackEvents || [];
  const deviceLogs = dashboard.deviceLogs || [];
  const proofOfPlay = dashboard.proofOfPlay || [];
  const allPendingDevices = devices.filter((device) => device.approvalStatus === "pending");
  const allApprovedDevices = devices.filter((device) => device.approvalStatus === "approved");
  const deviceFilterActive = Boolean(deviceFilters.clientId || deviceFilters.locationId || deviceFilters.query.trim() || deviceFilters.type);
  const filteredDevices = useMemo(() => filterDeviceCenterDevices(devices, deviceFilters), [devices, deviceFilters]);
  const pendingDevices = filteredDevices.filter((device) => device.approvalStatus === "pending");
  const approvedDevices = filteredDevices.filter((device) => device.approvalStatus === "approved");
  const deviceFleet = useMemo(() => summarizeDeviceFleet(filteredDevices), [filteredDevices]);
  const offlineAlerts = useMemo(() => getOfflineDeviceAlerts(devices), [devices]);
  const deviceFormIsPending = devices.some((device) => device.id === deviceForm.id && device.approvalStatus === "pending");
  const deviceFormIsApproved = devices.some((device) => device.id === deviceForm.id && device.approvalStatus === "approved");
  const selectedApprovedDevice = approvedDevices.find((device) => device.id === deviceForm.id) || null;
  const latestCommandByDevice = useMemo(() => buildLatestCommandLookup(deviceCommands), [deviceCommands]);
  const filteredDeviceLogs = useMemo(
    () => (deviceLogsRequested ? filterDeviceLogs(deviceLogs, devices, appliedDeviceLogFilters) : []),
    [appliedDeviceLogFilters, deviceLogs, deviceLogsRequested, devices]
  );
  const visibleDeviceLogs = filteredDeviceLogs.slice(0, 250);
  const filteredProofOfPlay = useMemo(
    () => (proofReportsRequested ? filterProofOfPlay(proofOfPlay, appliedProofReportFilters) : []),
    [appliedProofReportFilters, proofOfPlay, proofReportsRequested]
  );
  const visibleProofOfPlay = filteredProofOfPlay.slice(0, 250);
  const proofSummary = useMemo(() => summarizeProofOfPlay(filteredProofOfPlay), [filteredProofOfPlay]);

  const clientLookup = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const locationLookup = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const channelLookup = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  const mediaLookup = useMemo(() => new Map(media.map((entry) => [entry.id, entry])), [media]);
  const locationsForUserForm = useMemo(
    () => locations.filter((location) => !userForm.clientIds.length || userForm.clientIds.includes(location.clientId)),
    [locations, userForm.clientIds]
  );
  const locationsForChannel = useMemo(
    () => locations.filter((location) => !channelForm.clientId || location.clientId === channelForm.clientId),
    [channelForm.clientId, locations]
  );
  const selectedPlaylistForItem = useMemo(
    () => playlists.find((playlist) => playlist.id === playlistItemForm.playlistId) || null,
    [playlistItemForm.playlistId, playlists]
  );
  const locationsForPlaylistItem = useMemo(
    () => locations.filter((location) => !selectedPlaylistForItem || location.clientId === selectedPlaylistForItem.clientId),
    [locations, selectedPlaylistForItem]
  );
  const mediaForPlaylistItem = useMemo(
    () => media.filter((entry) => !selectedPlaylistForItem || entry.clientId === selectedPlaylistForItem.clientId),
    [media, selectedPlaylistForItem]
  );

  const filteredChannelsForPlaylist = useMemo(
    () => channels.filter((channel) => !playlistForm.clientId || channel.clientId === playlistForm.clientId),
    [channels, playlistForm.clientId]
  );
  const filteredChannelsForSchedule = useMemo(
    () => channels.filter((channel) => !scheduleForm.clientId || channel.clientId === scheduleForm.clientId),
    [channels, scheduleForm.clientId]
  );
  const filteredChannelsForEvent = useMemo(
    () => channels.filter((channel) => !playbackEventForm.clientId || channel.clientId === playbackEventForm.clientId),
    [channels, playbackEventForm.clientId]
  );
  const filteredMediaForEvent = useMemo(
    () =>
      media.filter(
        (entry) =>
          (!playbackEventForm.clientId || entry.clientId === playbackEventForm.clientId) &&
          (playbackEventForm.eventType === "audio" ? entry.kind === "audio" : entry.kind !== "audio")
      ),
    [media, playbackEventForm.clientId, playbackEventForm.eventType]
  );
  const filteredPlaylistsForSchedule = useMemo(
    () =>
      playlists.filter(
        (playlist) =>
          (!scheduleForm.clientId || playlist.clientId === scheduleForm.clientId) &&
          (!scheduleForm.channelId || !playlist.channelId || playlist.channelId === scheduleForm.channelId)
      ),
    [playlists, scheduleForm.channelId, scheduleForm.clientId]
  );
  const filteredChannelsForDevice = useMemo(
    () => channels.filter((channel) => !deviceForm.clientId || channel.clientId === deviceForm.clientId),
    [channels, deviceForm.clientId]
  );
  const filteredLocationsForDevice = useMemo(
    () => locations.filter((location) => !deviceForm.clientId || location.clientId === deviceForm.clientId),
    [deviceForm.clientId, locations]
  );
  const filteredLocationsForDeviceFilter = useMemo(
    () => locations.filter((location) => !deviceFilters.clientId || location.clientId === deviceFilters.clientId),
    [deviceFilters.clientId, locations]
  );
  const filteredLocationsForProofFilter = useMemo(
    () => locations.filter((location) => !proofReportFilters.clientId || location.clientId === proofReportFilters.clientId),
    [locations, proofReportFilters.clientId]
  );
  const filteredDevicesForProofFilter = useMemo(
    () =>
      devices.filter(
        (device) =>
          (!proofReportFilters.clientId || device.clientId === proofReportFilters.clientId) &&
          (!proofReportFilters.locationId || device.locationId === proofReportFilters.locationId)
      ),
    [devices, proofReportFilters.clientId, proofReportFilters.locationId]
  );
  const filteredLocationsForLogFilter = useMemo(
    () => locations.filter((location) => !deviceLogFilters.clientId || location.clientId === deviceLogFilters.clientId),
    [deviceLogFilters.clientId, locations]
  );
  const filteredDevicesForLogFilter = useMemo(
    () =>
      devices.filter(
        (device) =>
          (!deviceLogFilters.clientId || device.clientId === deviceLogFilters.clientId) &&
          (!deviceLogFilters.locationId || device.locationId === deviceLogFilters.locationId)
      ),
    [deviceLogFilters.clientId, deviceLogFilters.locationId, devices]
  );
  const clientDirectory = useMemo(
    () => filterClientDirectory(clients, locations, clientDirectoryFilters),
    [clientDirectoryFilters, clients, locations]
  );
  const filteredClientsForDirectory = clientDirectory.clients;
  const filteredLocationsForDirectory = clientDirectory.locations;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void refreshDashboard(token);
  }, [token]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  async function refreshDashboard(nextToken = token) {
    if (!nextToken) {
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchBootstrap(nextToken);
      setDashboard(payload);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      setToken("");
      setDashboard(emptyBootstrap);
      setFlash({ kind: "error", text: "Sesja wygasła. Zaloguj się ponownie." });
      return;
    }

    const message = error instanceof Error ? error.message : "Nie udało się obsłużyć żądania.";
    setFlash({ kind: "error", text: message });
  }

  async function runMutation(action: () => Promise<unknown>, successText: string, afterSuccess?: () => void) {
    if (!token) {
      return;
    }

    setSubmitting(true);
    try {
      await action();
      await refreshDashboard(token);
      afterSuccess?.();
      setFlash({ kind: "success", text: successText });
    } catch (error) {
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await login(loginForm.email, loginForm.password);
      storeToken(response.token);
      setToken(response.token);
      setFlash({ kind: "success", text: "Zalogowano do nowego CMS." });
    } catch (error) {
      handleError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (token) {
      try {
        await logout(token);
      } catch {
        // ignore
      }
    }

    clearToken();
    setToken("");
    setDashboard(emptyBootstrap);
  }

  function beginUserEdit(user: UserRecord) {
    setUserForm({
      id: user.id,
      email: user.email,
      password: "",
      name: user.name,
      role: user.role,
      clientIds: user.clientIds || [],
      allLocations: user.locationAccesses.every((entry) => entry.allLocations),
      locationIds: user.locationAccesses.flatMap((entry) => entry.locationIds)
    });
    setActiveSection("users");
  }

  function beginClientEdit(client: ClientRecord) {
    setClientForm({
      id: client.id,
      name: client.name,
      slug: client.slug,
      brandColor: client.brandColor
    });
    setClientModalOpen(true);
    setActiveSection("clients");
  }

  function beginLocationEdit(location: LocationRecord) {
    setLocationForm({
      id: location.id,
      clientId: location.clientId,
      name: location.name,
      city: location.city,
      address: location.address,
      notes: location.notes
    });
    setLocationModalOpen(true);
    setActiveSection("clients");
  }

  function beginChannelEdit(channel: ChannelRecord) {
    setChannelForm({
      id: channel.id,
      clientId: channel.clientId,
      name: channel.name,
      slug: channel.slug,
      description: channel.description,
      orientation: channel.orientation,
      locationIds: channel.locationIds || []
    });
    setActiveSection("channels");
  }

  function beginPlaylistEdit(playlist: PlaylistRecord) {
    setPlaylistForm({
      id: playlist.id,
      clientId: playlist.clientId,
      channelId: playlist.channelId,
      name: playlist.name,
      isActive: playlist.isActive,
      notes: playlist.notes
    });
    setPlaylistItemForm((current) => ({
      ...current,
      playlistId: playlist.id,
      sortOrder: String((playlist.items.at(-1)?.sortOrder || 0) + 10)
    }));
    setActiveSection("playlists");
  }

  function beginScheduleEdit(schedule: ScheduleRecord) {
    setScheduleForm({
      id: schedule.id,
      clientId: schedule.clientId,
      channelId: schedule.channelId,
      playlistId: schedule.playlistId,
      label: schedule.label,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      daysOfWeek: schedule.daysOfWeek,
      priority: String(schedule.priority),
      isActive: schedule.isActive
    });
    setActiveSection("schedule");
  }

  function beginPlaybackEventEdit(event: PlaybackEventRecord) {
    setPlaybackEventForm({
      id: event.id,
      clientId: event.clientId,
      channelId: event.channelId,
      mediaId: event.mediaId,
      name: event.name,
      eventType: event.eventType,
      triggerMode: event.triggerMode,
      intervalItems: String(event.intervalItems || 1),
      intervalMinutes: String(event.intervalMinutes || 5),
      priority: String(event.priority || 100),
      isActive: event.isActive
    });
    setActiveSection("events");
  }

  function beginDeviceApproval(device: DeviceRecord) {
    setDeviceForm({
      id: device.id,
      serial: device.serial,
      name: device.name === "Android TV" ? `Ekran ${device.serial}` : device.name,
      clientId: device.clientId,
      channelId: device.channelId,
      locationId: device.locationId,
      playerType: getDeviceType(device),
      locationLabel: device.locationLabel,
      notes: device.notes,
      desiredDisplayState: device.desiredDisplayState,
      volumePercent: String(device.volumePercent || 80)
    });
    setActiveSection("devices");
  }

  function beginDeviceEdit(device: DeviceRecord) {
    setDeviceForm({
      id: device.id,
      serial: device.serial,
      name: device.name,
      clientId: device.clientId,
      channelId: device.channelId,
      locationId: device.locationId,
      playerType: getDeviceType(device),
      locationLabel: device.locationLabel,
      notes: device.notes,
      desiredDisplayState: device.desiredDisplayState,
      volumePercent: String(device.volumePercent || 80)
    });
    setActiveSection("devices");
  }

  function quickUpdateDevice(device: DeviceRecord, action: "blackout" | "wake") {
    if (!token) {
      return;
    }

    const successText = action === "blackout" ? `Blackout wysłany do ${device.name}.` : `Wake wysłany do ${device.name}.`;
    void runMutation(async () => issueDeviceCommand(token, device.id, { type: action }), successText);
  }

  function sendLiveCommand(device: DeviceRecord, type: DeviceCommandType) {
    if (!token) {
      return;
    }

    const payload = type === "set_volume" ? { volumePercent: device.volumePercent } : undefined;
    void runMutation(
      async () => issueDeviceCommand(token, device.id, { type, payload }),
      `Komenda ${commandLabel(type)} wysłana do ${device.name}.`
    );
  }

  function downloadProofOfPlayCsv() {
    const csv = buildProofOfPlayCsv(filteredProofOfPlay);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proof-of-play-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleScheduleDay(day: number) {
    const current = new Set(
      scheduleForm.daysOfWeek
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => !Number.isNaN(value))
    );
    if (current.has(day)) {
      current.delete(day);
    } else {
      current.add(day);
    }

    const nextDays = [...current].sort((left, right) => left - right).join(",");
    setScheduleForm((entry) => ({ ...entry, daysOfWeek: nextDays }));
  }

  function toggleValue(values: string[], value: string) {
    return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
  }

  const stats = [
    { label: "Klienci", value: clients.length, hint: "konta firmowe" },
    { label: "Lokalizacje", value: locations.length, hint: "site’y" },
    { label: "Kanały", value: channels.length, hint: "emisja" },
    { label: "Media", value: media.length, hint: "pliki" },
    { label: "Playlisty", value: playlists.length, hint: "kolejki" },
    { label: "Eventy", value: playbackEvents.length, hint: "komunikaty" },
    { label: "Harmonogramy", value: schedules.length, hint: "reguły czasu" },
    { label: "Proof of Play", value: proofOfPlay.length, hint: "zdarzenia" },
    { label: "Alerty offline", value: offlineAlerts.length, hint: "brak heartbeat" },
    { label: "Logi błędów", value: deviceLogs.filter((log) => log.severity === "error").length, hint: "severity error" },
    { label: "Urządzenia online", value: allApprovedDevices.filter((device) => device.online).length, hint: "approved" }
  ];

  if (!token) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <span className="eyebrow">Digital Signage Control</span>
          <h1>Signal Deck CMS</h1>
          <form className="stack-form" onSubmit={handleLogin}>
            <label>
              <span>Email</span>
              <input
                id="login-email"
                name="login-email"
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                autoComplete="username"
                required
              />
            </label>
            <label>
              <span>Hasło</span>
              <input
                id="login-password"
                name="login-password"
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="current-password"
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Logowanie..." : "Wejdź do CMS"}
            </button>
          </form>
          {flash ? <div className={`flash ${flash.kind}`}>{flash.text}</div> : null}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">Berry Secure</span>
          <h1>Signage CMS</h1>
        </div>

        <nav className="sidebar-nav" aria-label="Sekcje CMS">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-button ${activeSection === item.key ? "active" : ""}`}
              type="button"
              onClick={() => setActiveSection(item.key)}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div>
            <strong>{dashboard.user.name || "Admin"}</strong>
            <span>{dashboard.user.email}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => void handleLogout()}>
            Wyloguj
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <span className="eyebrow">CMS</span>
            <h2>{sectionTitle(activeSection)}</h2>
          </div>
          <div className="header-actions">
            <span className="server-pill">API: {dashboard.installation.apiBaseUrl || getApiBaseUrl()}</span>
            <button className="secondary-button" type="button" onClick={() => void refreshDashboard()} disabled={loading}>
              {loading ? "Ładowanie..." : "Odśwież dane"}
            </button>
          </div>
        </header>

        {flash ? <div className={`flash ${flash.kind}`}>{flash.text}</div> : null}

        {activeSection === "overview" ? (
          <section className="section-stack">
            <div className="stats-grid">
              {stats.map((item) => (
                <article key={item.label} className="stat-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.hint}</small>
                </article>
              ))}
            </div>

            {offlineAlerts.length ? (
              <article className="panel offline-alert-panel">
                <header className="panel-header">
                  <h3>Alerty offline</h3>
                  <span>{offlineAlerts.length} urządzeń po progu 5 minut</span>
                </header>
                <div className="list-stack">
                  {offlineAlerts.slice(0, 5).map((alert) => (
                    <button
                      key={alert.device.id}
                      className="list-card interactive"
                      type="button"
                      onClick={() => beginDeviceEdit(alert.device)}
                    >
                      <div>
                        <strong>{alert.device.name || alert.device.serial}</strong>
                        <span>
                          {alert.device.clientName || "bez klienta"} · {alert.device.channelName || "bez kanału"} ·{" "}
                          {alert.device.serial}
                        </span>
                      </div>
                      <div className="align-right">
                        <span className="status-pill offline">offline</span>
                        <small>{alert.minutesOffline} min bez heartbeat</small>
                      </div>
                    </button>
                  ))}
                </div>
              </article>
            ) : null}

            <div className="card-grid two-columns">
              <article className="panel">
                <header className="panel-header">
                  <h3>Pending approval</h3>
                  <span>{allPendingDevices.length} szt.</span>
                </header>
                {allPendingDevices.length ? (
                  <div className="list-stack">
                    {allPendingDevices.map((device) => (
                      <button key={device.id} className="list-card interactive" type="button" onClick={() => beginDeviceApproval(device)}>
                        <div>
                          <strong>{device.serial}</strong>
                          <span>{device.deviceModel}</span>
                        </div>
                        <div className="align-right">
                          <span className="status-pill pending">waiting</span>
                          <small>{formatDateTime(device.lastSeenAt)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Brak nowych urządzeń oczekujących na approval." />
                )}
              </article>

              <article className="panel">
                <header className="panel-header">
                  <h3>Ostatnio widziane urządzenia</h3>
                  <span>{allApprovedDevices.length} zatwierdzonych</span>
                </header>
                {allApprovedDevices.length ? (
                  <div className="list-stack">
                    {allApprovedDevices.slice(0, 6).map((device) => (
                      <div key={device.id} className="list-card">
                        <div>
                          <strong>{device.name}</strong>
                          <span>
                            {device.clientName || "bez klienta"} · {device.channelName || "bez kanału"}
                          </span>
                        </div>
                        <div className="align-right">
                          <span className={`status-pill ${device.online ? "online" : "offline"}`}>
                            {device.online ? "online" : "offline"}
                          </span>
                          <small>{device.playerState}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Nie ma jeszcze żadnego zatwierdzonego playera." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "users" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runMutation(
                    async () => {
                      if (!token) {
                        return;
                      }
                      if (userForm.id) {
                        await updateUser(token, userForm.id, {
                          email: userForm.email,
                          password: userForm.password || undefined,
                          name: userForm.name,
                          role: userForm.role,
                          clientIds: userForm.clientIds,
                          allLocations: userForm.allLocations,
                          locationIds: userForm.locationIds
                        });
                      } else {
                        await createUser(token, userForm);
                      }
                    },
                    userForm.id ? "Zapisano zmiany użytkownika." : "Dodano nowe konto CMS.",
                    () => setUserForm(emptyUserForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{userForm.id ? "Edytuj użytkownika" : "Dodaj użytkownika"}</h3>
                  {userForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setUserForm(emptyUserForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Imię i nazwisko" htmlFor="user-name">
                  <input
                    id="user-name"
                    name="user-name"
                    value={userForm.name}
                    onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="Email" htmlFor="user-email">
                  <input
                    id="user-email"
                    name="user-email"
                    type="email"
                    value={userForm.email}
                    onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                    required
                  />
                </Field>
                <Field label={userForm.id ? "Nowe hasło (opcjonalnie)" : "Hasło"} htmlFor="user-password">
                  <input
                    id="user-password"
                    name="user-password"
                    type="password"
                    minLength={userForm.id ? 0 : 8}
                    value={userForm.password}
                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                    required={!userForm.id}
                  />
                </Field>
                <Field label="Rola" htmlFor="user-role">
                  <select
                    id="user-role"
                    name="user-role"
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, role: event.target.value as UserRole }))
                    }
                  >
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="editor">Editor</option>
                  </select>
                </Field>
                {userForm.role !== "owner" ? (
                  <>
                    <Field label="Klienci" htmlFor="user-client-access">
                      <div id="user-client-access" className="checkbox-grid">
                        {clients.map((client) => (
                          <label key={client.id} className="checkbox-row compact">
                            <input
                              type="checkbox"
                              checked={userForm.clientIds.includes(client.id)}
                              onChange={() =>
                                setUserForm((current) => {
                                  const clientIds = toggleValue(current.clientIds, client.id);
                                  return {
                                    ...current,
                                    clientIds,
                                    locationIds: current.locationIds.filter((locationId) => {
                                      const location = locationLookup.get(locationId);
                                      return location && clientIds.includes(location.clientId);
                                    })
                                  };
                                })
                              }
                            />
                            <span>{client.name}</span>
                          </label>
                        ))}
                      </div>
                    </Field>
                    <label className="checkbox-row" htmlFor="user-all-locations">
                      <input
                        id="user-all-locations"
                        name="user-all-locations"
                        type="checkbox"
                        checked={userForm.allLocations}
                        onChange={(event) =>
                          setUserForm((current) => ({
                            ...current,
                            allLocations: event.target.checked,
                            locationIds: event.target.checked ? [] : current.locationIds
                          }))
                        }
                      />
                      <span>Dostęp do wszystkich lokalizacji wybranych klientów</span>
                    </label>
                    {!userForm.allLocations ? (
                      <Field label="Lokalizacje" htmlFor="user-location-access">
                        <div id="user-location-access" className="checkbox-grid">
                          {locationsForUserForm.map((location) => (
                            <label key={location.id} className="checkbox-row compact">
                              <input
                                type="checkbox"
                                checked={userForm.locationIds.includes(location.id)}
                                onChange={() =>
                                  setUserForm((current) => ({
                                    ...current,
                                    locationIds: toggleValue(current.locationIds, location.id)
                                  }))
                                }
                              />
                              <span>{location.name}</span>
                            </label>
                          ))}
                        </div>
                      </Field>
                    ) : null}
                  </>
                ) : null}
                <button className="primary-button" type="submit" disabled={submitting}>
                  {submitting ? "Zapisywanie..." : userForm.id ? "Zapisz użytkownika" : "Dodaj konto"}
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Aktywne konta</h3>
                  <span>{dashboard.users.length}</span>
                </header>
                {dashboard.users.length ? (
                  <div className="list-stack">
                    {dashboard.users.map((user) => (
                      <div key={user.id} className="list-card">
                        <div>
                          <strong>{user.name}</strong>
                          <span>{user.email}</span>
                        </div>
                        <div className="card-actions">
                          <span className="status-pill neutral">{user.role}</span>
                          <button className="ghost-button" type="button" onClick={() => beginUserEdit(user)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={user.id === dashboard.user.id}
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć konto ${user.email}?`)) {
                                return;
                              }
                              void runMutation(
                                async () => deleteUser(token, user.id),
                                "Usunięto konto CMS."
                              );
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Nie ma jeszcze żadnych kont." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "clients" ? (
          <section className="section-stack">
            <div className="panel directory-filter-bar">
              <Field label="Klient" htmlFor="client-directory-client">
                <select
                  id="client-directory-client"
                  name="client-directory-client"
                  value={clientDirectoryFilters.clientId}
                  onChange={(event) =>
                    setClientDirectoryFilters((current) => ({ ...current, clientId: event.target.value, locationId: "" }))
                  }
                >
                  <option value="">Wszyscy klienci</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lokalizacja" htmlFor="client-directory-location">
                <select
                  id="client-directory-location"
                  name="client-directory-location"
                  value={clientDirectoryFilters.locationId}
                  onChange={(event) => setClientDirectoryFilters((current) => ({ ...current, locationId: event.target.value }))}
                >
                  <option value="">Wszystkie lokalizacje</option>
                  {locations
                    .filter((location) => !clientDirectoryFilters.clientId || location.clientId === clientDirectoryFilters.clientId)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} {location.city ? `· ${location.city}` : ""}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Szukaj" htmlFor="client-directory-query">
                <input
                  id="client-directory-query"
                  name="client-directory-query"
                  type="search"
                  value={clientDirectoryFilters.query}
                  onChange={(event) => setClientDirectoryFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Klient, site, miasto, adres..."
                />
              </Field>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setClientForm(emptyClientForm);
                  setClientModalOpen(true);
                }}
              >
                Utwórz klienta
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setLocationForm({ ...emptyLocationForm, clientId: clientDirectoryFilters.clientId });
                  setLocationModalOpen(true);
                }}
              >
                Utwórz lokalizację
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setClientDirectoryFilters(emptyClientDirectoryFilters)}
                disabled={!clientDirectoryFilters.clientId && !clientDirectoryFilters.locationId && !clientDirectoryFilters.query}
              >
                Wyczyść
              </button>
            </div>

            <div className="card-grid two-columns">
              <article className="panel">
                <header className="panel-header">
                  <h3>Klienci</h3>
                  <span>
                    {filteredClientsForDirectory.length} / {clients.length}
                  </span>
                </header>
                {filteredClientsForDirectory.length ? (
                  <div className="list-stack">
                    {filteredClientsForDirectory.map((client) => (
                      <div key={client.id} className="list-card">
                        <div>
                          <strong>{client.name}</strong>
                          <span>
                            {client.slug} · {locations.filter((location) => location.clientId === client.id).length} site
                          </span>
                          <div className="mini-chip-row">
                            {locations
                              .filter((location) => location.clientId === client.id)
                              .slice(0, 4)
                              .map((location) => (
                                <button
                                  key={location.id}
                                  className="mini-chip"
                                  type="button"
                                  onClick={() => beginLocationEdit(location)}
                                >
                                  {location.name}
                                </button>
                              ))}
                          </div>
                        </div>
                        <div className="card-actions">
                          <span className="color-chip" style={{ backgroundColor: client.brandColor }} />
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => {
                              setLocationForm({ ...emptyLocationForm, clientId: client.id });
                              setLocationModalOpen(true);
                            }}
                          >
                            Site
                          </button>
                          <button className="ghost-button" type="button" onClick={() => beginClientEdit(client)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć klienta ${client.name}?`)) {
                                return;
                              }
                              void runMutation(async () => deleteClient(token, client.id), "Usunięto klienta.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Brak klientów dla wybranych filtrów." />
                )}
              </article>

              <article className="panel">
                <header className="panel-header">
                  <h3>Lokalizacje</h3>
                  <span>
                    {filteredLocationsForDirectory.length} / {locations.length}
                  </span>
                </header>
                {filteredLocationsForDirectory.length ? (
                  <div className="list-stack compact-list">
                    {filteredLocationsForDirectory.map((location) => (
                      <div key={location.id} className="list-card location-row">
                        <div>
                          <strong>{location.name}</strong>
                          <span>
                            {clientLookup.get(location.clientId)?.name || "bez klienta"} · {location.city || "bez miasta"}
                          </span>
                          <small>{location.address || "brak adresu"}</small>
                        </div>
                        <div className="card-actions">
                          <button className="ghost-button" type="button" onClick={() => beginLocationEdit(location)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć lokalizację ${location.name}?`)) {
                                return;
                              }
                              void runMutation(async () => deleteLocation(token, location.id), "Usunięto lokalizację.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Brak lokalizacji dla wybranych filtrów." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "channels" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runMutation(
                    async () => {
                      if (!token) {
                        return;
                      }
                      const payload = {
                        clientId: channelForm.clientId,
                        name: channelForm.name,
                        slug: channelForm.slug,
                        description: channelForm.description,
                        orientation: channelForm.orientation,
                        locationIds: channelForm.locationIds
                      };
                      if (channelForm.id) {
                        await updateChannel(token, channelForm.id, payload);
                      } else {
                        await createChannel(token, payload);
                      }
                    },
                    channelForm.id ? "Zapisano kanał." : "Dodano kanał.",
                    () => setChannelForm(emptyChannelForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{channelForm.id ? "Edytuj kanał" : "Nowy kanał"}</h3>
                  {channelForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setChannelForm(emptyChannelForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Klient" htmlFor="channel-client">
                  <select
                    id="channel-client"
                    name="channel-client"
                    value={channelForm.clientId}
                    onChange={(event) =>
                      setChannelForm((current) => ({ ...current, clientId: event.target.value, locationIds: [] }))
                    }
                    required
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nazwa" htmlFor="channel-name">
                  <input
                    id="channel-name"
                    name="channel-name"
                    value={channelForm.name}
                    onChange={(event) =>
                      setChannelForm((current) => ({
                        ...current,
                        name: event.target.value,
                        slug: current.id ? current.slug : toSlug(event.target.value)
                      }))
                    }
                    required
                  />
                </Field>
                <Field label="Slug" htmlFor="channel-slug">
                  <input
                    id="channel-slug"
                    name="channel-slug"
                    value={channelForm.slug}
                    onChange={(event) => setChannelForm((current) => ({ ...current, slug: toSlug(event.target.value) }))}
                    required
                  />
                </Field>
                <Field label="Orientacja" htmlFor="channel-orientation">
                  <select
                    id="channel-orientation"
                    name="channel-orientation"
                    value={channelForm.orientation}
                    onChange={(event) =>
                      setChannelForm((current) => ({
                        ...current,
                        orientation: event.target.value as "landscape" | "portrait"
                      }))
                    }
                  >
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                  </select>
                </Field>
                <Field label="Site’y kanału" htmlFor="channel-locations">
                  <div id="channel-locations" className="checkbox-grid">
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={!channelForm.locationIds.length}
                        onChange={() => setChannelForm((current) => ({ ...current, locationIds: [] }))}
                      />
                      <span>Wszystkie lokalizacje</span>
                    </label>
                    {locationsForChannel.map((location) => (
                      <label key={location.id} className="checkbox-row compact">
                        <input
                          type="checkbox"
                          checked={channelForm.locationIds.includes(location.id)}
                          onChange={() =>
                            setChannelForm((current) => ({
                              ...current,
                              locationIds: toggleValue(current.locationIds, location.id)
                            }))
                          }
                        />
                        <span>{location.name}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Opis" htmlFor="channel-description">
                  <textarea
                    id="channel-description"
                    name="channel-description"
                    rows={4}
                    value={channelForm.description}
                    onChange={(event) => setChannelForm((current) => ({ ...current, description: event.target.value }))}
                  />
                </Field>
                <button className="primary-button" type="submit" disabled={submitting}>
                  {channelForm.id ? "Zapisz kanał" : "Dodaj kanał"}
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Lista kanałów</h3>
                  <span>{channels.length}</span>
                </header>
                {channels.length ? (
                  <div className="list-stack">
                    {channels.map((channel) => (
                      <div key={channel.id} className="list-card">
                        <div>
                          <strong>{channel.name}</strong>
                          <span>
                            {clientLookup.get(channel.clientId)?.name || "bez klienta"} · {channel.orientation} ·{" "}
                            {channel.locationIds.length
                              ? channel.locationIds.map((id) => locationLookup.get(id)?.name).filter(Boolean).join(", ")
                              : "wszystkie site’y"}
                          </span>
                        </div>
                        <div className="card-actions">
                          <button className="ghost-button" type="button" onClick={() => beginChannelEdit(channel)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć kanał ${channel.name}?`)) {
                                return;
                              }
                              void runMutation(async () => deleteChannel(token, channel.id), "Usunięto kanał.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Dodaj pierwszy kanał dla klienta." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "media" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!token || !mediaForm.file) {
                    setFlash({ kind: "error", text: "Wybierz plik media przed wysłaniem." });
                    return;
                  }
                  const formData = new FormData();
                  formData.append("clientId", mediaForm.clientId);
                  formData.append("title", mediaForm.title);
                  formData.append("kind", mediaForm.kind);
                  formData.append("durationSeconds", mediaForm.durationSeconds);
                  formData.append("hasAudio", String(mediaForm.hasAudio));
                  formData.append("status", mediaForm.status);
                  formData.append("tags", mediaForm.tags);
                  formData.append("file", mediaForm.file);
                  void runMutation(
                    async () => {
                      await uploadMedia(token, formData);
                    },
                    "Plik media został dodany do biblioteki.",
                    () => {
                      setMediaForm(emptyMediaForm);
                      setMediaInputKey((current) => current + 1);
                    }
                  );
                }}
              >
                <header className="panel-header">
                  <h3>Dodaj plik</h3>
                  <span>jeden backend, jeden storage</span>
                </header>
                <Field label="Klient" htmlFor="media-client">
                  <select
                    id="media-client"
                    name="media-client"
                    value={mediaForm.clientId}
                    onChange={(event) => setMediaForm((current) => ({ ...current, clientId: event.target.value }))}
                    required
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tytuł" htmlFor="media-title">
                  <input
                    id="media-title"
                    name="media-title"
                    value={mediaForm.title}
                    onChange={(event) => setMediaForm((current) => ({ ...current, title: event.target.value }))}
                    required
                  />
                </Field>
                <div className="inline-grid">
                  <Field label="Typ" htmlFor="media-kind">
                    <select
                      id="media-kind"
                      name="media-kind"
                      value={mediaForm.kind}
                      onChange={(event) =>
                        setMediaForm((current) => ({
                          ...current,
                          kind: event.target.value as MediaKind,
                          hasAudio: event.target.value !== "image"
                        }))
                      }
                    >
                      <option value="video">Video</option>
                      <option value="image">Obraz</option>
                      <option value="audio">Audio</option>
                    </select>
                  </Field>
                  <Field label="Sekundy" htmlFor="media-duration">
                    <input
                      id="media-duration"
                      name="media-duration"
                      type="number"
                      min="1"
                      value={mediaForm.durationSeconds}
                      onChange={(event) => setMediaForm((current) => ({ ...current, durationSeconds: event.target.value }))}
                    />
                  </Field>
                </div>
                <div className="inline-grid">
                  <Field label="Status" htmlFor="media-status">
                    <select
                      id="media-status"
                      name="media-status"
                      value={mediaForm.status}
                      onChange={(event) =>
                        setMediaForm((current) => ({
                          ...current,
                          status: event.target.value as "draft" | "published"
                        }))
                      }
                    >
                      <option value="published">Published</option>
                      <option value="draft">Draft</option>
                    </select>
                  </Field>
                  <Field label="Audio" htmlFor="media-audio">
                    <select
                      id="media-audio"
                      name="media-audio"
                      value={mediaForm.hasAudio ? "yes" : "no"}
                      onChange={(event) =>
                        setMediaForm((current) => ({ ...current, hasAudio: event.target.value === "yes" }))
                      }
                    >
                      <option value="yes">Tak</option>
                      <option value="no">Nie</option>
                    </select>
                  </Field>
                </div>
                <Field label="Tagi" htmlFor="media-tags">
                  <input
                    id="media-tags"
                    name="media-tags"
                    value={mediaForm.tags}
                    onChange={(event) => setMediaForm((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="promo, menu, hero"
                  />
                </Field>
                <Field label="Plik" htmlFor="media-file">
                  <input
                    key={mediaInputKey}
                    id="media-file"
                    name="media-file"
                    type="file"
                    accept="video/*,image/*,audio/*"
                    onChange={(event) =>
                      setMediaForm((current) => ({ ...current, file: event.target.files?.[0] || null }))
                    }
                    required
                  />
                </Field>
                <button className="primary-button" type="submit" disabled={submitting}>
                  Dodaj media
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Biblioteka</h3>
                  <span>{media.length}</span>
                </header>
                {media.length ? (
                  <div className="list-stack">
                    {media.map((entry) => (
                      <div key={entry.id} className="list-card">
                        <div>
                          <strong>{entry.title}</strong>
                          <span>
                            {clientLookup.get(entry.clientId)?.name || "bez klienta"} · {entry.kind} · {entry.status}
                          </span>
                          <small>{entry.originalName}</small>
                        </div>
                        <div className="card-actions">
                          <a className="ghost-button" href={entry.url} target="_blank" rel="noreferrer">
                            Otwórz
                          </a>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć plik ${entry.title}?`)) {
                                return;
                              }
                              void runMutation(async () => deleteMedia(token, entry.id), "Usunięto media.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Biblioteka jest pusta. Wrzuć pierwszy plik video albo obraz." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "playlists" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runMutation(
                    async () => {
                      if (!token) {
                        return;
                      }
                      const payload = {
                        clientId: playlistForm.clientId,
                        channelId: playlistForm.channelId,
                        name: playlistForm.name,
                        isActive: playlistForm.isActive,
                        notes: playlistForm.notes
                      };
                      if (playlistForm.id) {
                        await updatePlaylist(token, playlistForm.id, payload);
                      } else {
                        await createPlaylist(token, payload);
                      }
                    },
                    playlistForm.id ? "Zapisano playlistę." : "Dodano playlistę.",
                    () => setPlaylistForm(emptyPlaylistForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{playlistForm.id ? "Edytuj playlistę" : "Nowa playlista"}</h3>
                  {playlistForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setPlaylistForm(emptyPlaylistForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Klient" htmlFor="playlist-client">
                  <select
                    id="playlist-client"
                    name="playlist-client"
                    value={playlistForm.clientId}
                    onChange={(event) =>
                      setPlaylistForm((current) => ({
                        ...current,
                        clientId: event.target.value,
                        channelId: ""
                      }))
                    }
                    required
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kanał" htmlFor="playlist-channel">
                  <select
                    id="playlist-channel"
                    name="playlist-channel"
                    value={playlistForm.channelId}
                    onChange={(event) => setPlaylistForm((current) => ({ ...current, channelId: event.target.value }))}
                  >
                    <option value="">Kanał opcjonalny</option>
                    {filteredChannelsForPlaylist.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nazwa playlisty" htmlFor="playlist-name">
                  <input
                    id="playlist-name"
                    name="playlist-name"
                    value={playlistForm.name}
                    onChange={(event) => setPlaylistForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="Notatki" htmlFor="playlist-notes">
                  <textarea
                    id="playlist-notes"
                    name="playlist-notes"
                    rows={4}
                    value={playlistForm.notes}
                    onChange={(event) => setPlaylistForm((current) => ({ ...current, notes: event.target.value }))}
                  />
                </Field>
                <label className="checkbox-row" htmlFor="playlist-active">
                  <input
                    id="playlist-active"
                    name="playlist-active"
                    type="checkbox"
                    checked={playlistForm.isActive}
                    onChange={(event) => setPlaylistForm((current) => ({ ...current, isActive: event.target.checked }))}
                  />
                  <span>Playlista aktywna</span>
                </label>
                <button className="primary-button" type="submit" disabled={submitting}>
                  {playlistForm.id ? "Zapisz playlistę" : "Dodaj playlistę"}
                </button>
              </form>

              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!token) {
                    return;
                  }
                  void runMutation(
                    async () => {
                      await createPlaylistItem(token, playlistItemForm.playlistId, {
                        mediaId: playlistItemForm.mediaId,
                        sortOrder: Number(playlistItemForm.sortOrder || 10),
                        loopCount: Number(playlistItemForm.loopCount || 1),
                        volumePercent: Number(playlistItemForm.volumePercent || 100),
                        locationIds: playlistItemForm.locationIds
                      });
                    },
                    "Dodano materiał do playlisty.",
                    () => setPlaylistItemForm(emptyPlaylistItemForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>Dodaj element do playlisty</h3>
                  <span>bezpośrednio z biblioteki</span>
                </header>
                <Field label="Playlista" htmlFor="playlist-item-playlist">
                  <select
                    id="playlist-item-playlist"
                    name="playlist-item-playlist"
                    value={playlistItemForm.playlistId}
                    onChange={(event) =>
                      setPlaylistItemForm((current) => ({
                        ...current,
                        playlistId: event.target.value,
                        mediaId: "",
                        locationIds: []
                      }))
                    }
                    required
                  >
                    <option value="">Wybierz playlistę</option>
                    {playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Media" htmlFor="playlist-item-media">
                  <select
                    id="playlist-item-media"
                    name="playlist-item-media"
                    value={playlistItemForm.mediaId}
                    onChange={(event) => setPlaylistItemForm((current) => ({ ...current, mediaId: event.target.value }))}
                    required
                  >
                    <option value="">Wybierz media</option>
                    {mediaForPlaylistItem.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Site’y elementu" htmlFor="playlist-item-locations">
                  <div id="playlist-item-locations" className="checkbox-grid">
                    <label className="checkbox-row compact">
                      <input
                        type="checkbox"
                        checked={!playlistItemForm.locationIds.length}
                        onChange={() => setPlaylistItemForm((current) => ({ ...current, locationIds: [] }))}
                      />
                      <span>Wszystkie lokalizacje</span>
                    </label>
                    {locationsForPlaylistItem.map((location) => (
                      <label key={location.id} className="checkbox-row compact">
                        <input
                          type="checkbox"
                          checked={playlistItemForm.locationIds.includes(location.id)}
                          onChange={() =>
                            setPlaylistItemForm((current) => ({
                              ...current,
                              locationIds: toggleValue(current.locationIds, location.id)
                            }))
                          }
                        />
                        <span>{location.name}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="inline-grid triple">
                  <Field label="Sort" htmlFor="playlist-item-sort">
                    <input
                      id="playlist-item-sort"
                      name="playlist-item-sort"
                      type="number"
                      value={playlistItemForm.sortOrder}
                      onChange={(event) => setPlaylistItemForm((current) => ({ ...current, sortOrder: event.target.value }))}
                    />
                  </Field>
                  <Field label="Loop" htmlFor="playlist-item-loop">
                    <input
                      id="playlist-item-loop"
                      name="playlist-item-loop"
                      type="number"
                      min="1"
                      value={playlistItemForm.loopCount}
                      onChange={(event) => setPlaylistItemForm((current) => ({ ...current, loopCount: event.target.value }))}
                    />
                  </Field>
                  <Field label="Głośność" htmlFor="playlist-item-volume">
                    <input
                      id="playlist-item-volume"
                      name="playlist-item-volume"
                      type="number"
                      min="0"
                      max="100"
                      value={playlistItemForm.volumePercent}
                      onChange={(event) =>
                        setPlaylistItemForm((current) => ({ ...current, volumePercent: event.target.value }))
                      }
                    />
                  </Field>
                </div>
                <button className="primary-button" type="submit" disabled={submitting}>
                  Dodaj element
                </button>
              </form>
            </div>

            <article className="panel">
              <header className="panel-header">
                <h3>Wszystkie playlisty</h3>
                <span>{playlists.length}</span>
              </header>
              {playlists.length ? (
                <div className="list-stack">
                  {playlists.map((playlist) => (
                    <div key={playlist.id} className="playlist-card">
                      <div className="playlist-card-header">
                        <div>
                          <strong>{playlist.name}</strong>
                          <span>
                            {clientLookup.get(playlist.clientId)?.name || "bez klienta"} ·{" "}
                            {channelLookup.get(playlist.channelId)?.name || "fallback kanał"}
                          </span>
                        </div>
                        <div className="card-actions">
                          <span className={`status-pill ${playlist.isActive ? "online" : "offline"}`}>
                            {playlist.isActive ? "active" : "paused"}
                          </span>
                          <button className="ghost-button" type="button" onClick={() => beginPlaylistEdit(playlist)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć playlistę ${playlist.name}?`)) {
                                return;
                              }
                              void runMutation(async () => deletePlaylist(token, playlist.id), "Usunięto playlistę.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                      {playlist.items.length ? (
                        <div className="playlist-items">
                          {playlist.items.map((item) => (
                            <div key={item.id} className="playlist-item-row">
                              <div>
                                <strong>{item.media?.title || mediaLookup.get(item.mediaId)?.title || "Brak media"}</strong>
                                <span>
                                  sort {item.sortOrder} · loop {item.loopCount} · vol {item.volumePercent} ·{" "}
                                  {item.locationIds.length
                                    ? item.locationIds.map((id) => locationLookup.get(id)?.name).filter(Boolean).join(", ")
                                    : "wszystkie site’y"}
                                </span>
                              </div>
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => {
                                  if (!token || !window.confirm("Usunąć ten element playlisty?")) {
                                    return;
                                  }
                                  void runMutation(
                                    async () => deletePlaylistItem(token, playlist.id, item.id),
                                    "Usunięto element playlisty."
                                  );
                                }}
                              >
                                Usuń
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState text="Ta playlista jest jeszcze pusta." />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Stwórz pierwszą playlistę i dodaj do niej media." />
              )}
            </article>
          </section>
        ) : null}

        {activeSection === "events" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!token) {
                    return;
                  }
                  const payload = {
                    clientId: playbackEventForm.clientId,
                    channelId: playbackEventForm.channelId,
                    mediaId: playbackEventForm.mediaId,
                    name: playbackEventForm.name,
                    eventType: playbackEventForm.eventType,
                    triggerMode: playbackEventForm.triggerMode,
                    intervalItems: Number(playbackEventForm.intervalItems || 1),
                    intervalMinutes: Number(playbackEventForm.intervalMinutes || 0),
                    priority: Number(playbackEventForm.priority || 100),
                    isActive: playbackEventForm.isActive
                  };

                  void runMutation(
                    async () => {
                      if (playbackEventForm.id) {
                        await updatePlaybackEvent(token, playbackEventForm.id, payload);
                      } else {
                        await createPlaybackEvent(token, payload);
                      }
                    },
                    playbackEventForm.id ? "Zapisano event emisji." : "Dodano event emisji.",
                    () => setPlaybackEventForm(emptyPlaybackEventForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{playbackEventForm.id ? "Edytuj event" : "Nowy event"}</h3>
                  {playbackEventForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setPlaybackEventForm(emptyPlaybackEventForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Klient" htmlFor="event-client">
                  <select
                    id="event-client"
                    name="event-client"
                    value={playbackEventForm.clientId}
                    onChange={(event) =>
                      setPlaybackEventForm((current) => ({
                        ...current,
                        clientId: event.target.value,
                        channelId: "",
                        mediaId: ""
                      }))
                    }
                    required
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kanał" htmlFor="event-channel">
                  <select
                    id="event-channel"
                    name="event-channel"
                    value={playbackEventForm.channelId}
                    onChange={(event) =>
                      setPlaybackEventForm((current) => ({ ...current, channelId: event.target.value }))
                    }
                  >
                    <option value="">Wszystkie kanały klienta</option>
                    {filteredChannelsForEvent.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nazwa eventu" htmlFor="event-name">
                  <input
                    id="event-name"
                    name="event-name"
                    value={playbackEventForm.name}
                    onChange={(event) => setPlaybackEventForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </Field>
                <div className="inline-grid">
                  <Field label="Typ eventu" htmlFor="event-type">
                    <select
                      id="event-type"
                      name="event-type"
                      value={playbackEventForm.eventType}
                      onChange={(event) =>
                        setPlaybackEventForm((current) => ({
                          ...current,
                          eventType: event.target.value as PlaybackEventFormState["eventType"],
                          mediaId: ""
                        }))
                      }
                    >
                      {playbackEventTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Wyzwalacz" htmlFor="event-trigger">
                    <select
                      id="event-trigger"
                      name="event-trigger"
                      value={playbackEventForm.triggerMode}
                      onChange={(event) =>
                        setPlaybackEventForm((current) => ({
                          ...current,
                          triggerMode: event.target.value as PlaybackEventFormState["triggerMode"]
                        }))
                      }
                    >
                      {playbackEventTriggerOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Media eventu" htmlFor="event-media">
                  <select
                    id="event-media"
                    name="event-media"
                    value={playbackEventForm.mediaId}
                    onChange={(event) => setPlaybackEventForm((current) => ({ ...current, mediaId: event.target.value }))}
                    required
                  >
                    <option value="">Wybierz media</option>
                    {filteredMediaForEvent.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title} · {entry.kind}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="inline-grid triple">
                  <Field label="Co ile mediów" htmlFor="event-interval-items">
                    <input
                      id="event-interval-items"
                      name="event-interval-items"
                      type="number"
                      min="1"
                      value={playbackEventForm.intervalItems}
                      disabled={playbackEventForm.triggerMode !== "items"}
                      onChange={(event) =>
                        setPlaybackEventForm((current) => ({ ...current, intervalItems: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Co ile minut" htmlFor="event-interval-minutes">
                    <input
                      id="event-interval-minutes"
                      name="event-interval-minutes"
                      type="number"
                      min="1"
                      value={playbackEventForm.intervalMinutes}
                      disabled={playbackEventForm.triggerMode !== "minutes"}
                      onChange={(event) =>
                        setPlaybackEventForm((current) => ({ ...current, intervalMinutes: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Priorytet" htmlFor="event-priority">
                    <input
                      id="event-priority"
                      name="event-priority"
                      type="number"
                      value={playbackEventForm.priority}
                      onChange={(event) =>
                        setPlaybackEventForm((current) => ({ ...current, priority: event.target.value }))
                      }
                    />
                  </Field>
                </div>
                <label className="checkbox-row" htmlFor="event-active">
                  <input
                    id="event-active"
                    name="event-active"
                    type="checkbox"
                    checked={playbackEventForm.isActive}
                    onChange={(event) =>
                      setPlaybackEventForm((current) => ({ ...current, isActive: event.target.checked }))
                    }
                  />
                  <span>Event aktywny</span>
                </label>
                <button className="primary-button" type="submit" disabled={submitting}>
                  {playbackEventForm.id ? "Zapisz event" : "Dodaj event"}
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Aktywne eventy</h3>
                  <span>{playbackEvents.length}</span>
                </header>
                {playbackEvents.length ? (
                  <div className="list-stack">
                    {playbackEvents.map((event) => (
                      <div key={event.id} className="list-card">
                        <div>
                          <strong>{event.name}</strong>
                          <span>
                            {event.clientName || clientLookup.get(event.clientId)?.name || "bez klienta"} ·{" "}
                            {event.channelName || channelLookup.get(event.channelId)?.name || "wszystkie kanały"} ·{" "}
                            {eventTypeLabel(event.eventType)}
                          </span>
                          <small>
                            {event.mediaTitle || mediaLookup.get(event.mediaId)?.title || "brak media"} ·{" "}
                            {event.triggerMode === "items"
                              ? `co ${event.intervalItems} mediów`
                              : `co ${event.intervalMinutes} min`}
                          </small>
                        </div>
                        <div className="card-actions">
                          <span className={`status-pill ${event.isActive ? "online" : "offline"}`}>
                            {event.isActive ? "active" : "paused"}
                          </span>
                          <button className="ghost-button" type="button" onClick={() => beginPlaybackEventEdit(event)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć event ${event.name}?`)) {
                                return;
                              }
                              void runMutation(async () => deletePlaybackEvent(token, event.id), "Usunięto event emisji.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Nie ma jeszcze eventów wplatanych w emisję." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "schedule" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runMutation(
                    async () => {
                      if (!token) {
                        return;
                      }
                      const payload = {
                        clientId: scheduleForm.clientId,
                        channelId: scheduleForm.channelId,
                        playlistId: scheduleForm.playlistId,
                        label: scheduleForm.label,
                        startDate: scheduleForm.startDate,
                        endDate: scheduleForm.endDate,
                        startTime: scheduleForm.startTime,
                        endTime: scheduleForm.endTime,
                        daysOfWeek: scheduleForm.daysOfWeek,
                        priority: Number(scheduleForm.priority || 100),
                        isActive: scheduleForm.isActive
                      };
                      if (scheduleForm.id) {
                        await updateSchedule(token, scheduleForm.id, payload);
                      } else {
                        await createSchedule(token, payload);
                      }
                    },
                    scheduleForm.id ? "Zapisano harmonogram." : "Dodano harmonogram.",
                    () => setScheduleForm(emptyScheduleForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{scheduleForm.id ? "Edytuj harmonogram" : "Nowy harmonogram"}</h3>
                  {scheduleForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setScheduleForm(emptyScheduleForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Klient" htmlFor="schedule-client">
                  <select
                    id="schedule-client"
                    name="schedule-client"
                    value={scheduleForm.clientId}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        clientId: event.target.value,
                        channelId: "",
                        playlistId: ""
                      }))
                    }
                    required
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kanał" htmlFor="schedule-channel">
                  <select
                    id="schedule-channel"
                    name="schedule-channel"
                    value={scheduleForm.channelId}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        channelId: event.target.value,
                        playlistId: ""
                      }))
                    }
                    required
                  >
                    <option value="">Wybierz kanał</option>
                    {filteredChannelsForSchedule.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Playlista" htmlFor="schedule-playlist">
                  <select
                    id="schedule-playlist"
                    name="schedule-playlist"
                    value={scheduleForm.playlistId}
                    onChange={(event) => setScheduleForm((current) => ({ ...current, playlistId: event.target.value }))}
                    required
                  >
                    <option value="">Wybierz playlistę</option>
                    {filteredPlaylistsForSchedule.map((playlist) => (
                      <option key={playlist.id} value={playlist.id}>
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Etykieta" htmlFor="schedule-label">
                  <input
                    id="schedule-label"
                    name="schedule-label"
                    value={scheduleForm.label}
                    onChange={(event) => setScheduleForm((current) => ({ ...current, label: event.target.value }))}
                    required
                  />
                </Field>
                <div className="inline-grid">
                  <Field label="Data startu" htmlFor="schedule-start-date">
                    <input
                      id="schedule-start-date"
                      name="schedule-start-date"
                      type="date"
                      value={scheduleForm.startDate}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, startDate: event.target.value }))}
                    />
                  </Field>
                  <Field label="Data końca" htmlFor="schedule-end-date">
                    <input
                      id="schedule-end-date"
                      name="schedule-end-date"
                      type="date"
                      value={scheduleForm.endDate}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </Field>
                </div>
                <div className="inline-grid triple">
                  <Field label="Start" htmlFor="schedule-start-time">
                    <input
                      id="schedule-start-time"
                      name="schedule-start-time"
                      type="time"
                      value={scheduleForm.startTime}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, startTime: event.target.value }))}
                    />
                  </Field>
                  <Field label="Koniec" htmlFor="schedule-end-time">
                    <input
                      id="schedule-end-time"
                      name="schedule-end-time"
                      type="time"
                      value={scheduleForm.endTime}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, endTime: event.target.value }))}
                    />
                  </Field>
                  <Field label="Priorytet" htmlFor="schedule-priority">
                    <input
                      id="schedule-priority"
                      name="schedule-priority"
                      type="number"
                      value={scheduleForm.priority}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, priority: event.target.value }))}
                    />
                  </Field>
                </div>
                <fieldset className="days-fieldset">
                  <legend>Dni tygodnia</legend>
                  <div className="day-toggle-grid">
                    {weekdayOptions.map((option) => {
                      const checked = scheduleForm.daysOfWeek
                        .split(",")
                        .map((value) => Number(value))
                        .includes(option.value);
                      return (
                        <label key={option.value} className={`day-pill ${checked ? "active" : ""}`}>
                          <input
                            type="checkbox"
                            name={`weekday-${option.value}`}
                            checked={checked}
                            onChange={() => toggleScheduleDay(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="checkbox-row" htmlFor="schedule-active">
                  <input
                    id="schedule-active"
                    name="schedule-active"
                    type="checkbox"
                    checked={scheduleForm.isActive}
                    onChange={(event) => setScheduleForm((current) => ({ ...current, isActive: event.target.checked }))}
                  />
                  <span>Harmonogram aktywny</span>
                </label>
                <button className="primary-button" type="submit" disabled={submitting}>
                  {scheduleForm.id ? "Zapisz harmonogram" : "Dodaj harmonogram"}
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Aktywne i zapisane reguły</h3>
                  <span>{schedules.length}</span>
                </header>
                {schedules.length ? (
                  <div className="list-stack">
                    {schedules.map((schedule) => (
                      <div key={schedule.id} className="list-card">
                        <div>
                          <strong>{schedule.label}</strong>
                          <span>
                            {channelLookup.get(schedule.channelId)?.name || "bez kanału"} ·{" "}
                            {playlists.find((playlist) => playlist.id === schedule.playlistId)?.name || "bez playlisty"}
                          </span>
                          <small>
                            {schedule.startTime} - {schedule.endTime} · dni {schedule.daysOfWeek || "0,1,2,3,4,5,6"}
                          </small>
                        </div>
                        <div className="card-actions">
                          <span className={`status-pill ${schedule.isActive ? "online" : "offline"}`}>
                            {schedule.isActive ? "active" : "paused"}
                          </span>
                          <button className="ghost-button" type="button" onClick={() => beginScheduleEdit(schedule)}>
                            Edytuj
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (!token || !window.confirm(`Usunąć harmonogram ${schedule.label}?`)) {
                                return;
                              }
                              void runMutation(async () => deleteSchedule(token, schedule.id), "Usunięto harmonogram.");
                            }}
                          >
                            Usuń
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Dodaj harmonogram albo zostaw fallback do pierwszej aktywnej playlisty." />
                )}
              </article>
            </div>
          </section>
        ) : null}

        {activeSection === "devices" ? (
          <section className="section-stack">
            <div className="panel device-filter-bar">
              <Field label="Klient" htmlFor="device-filter-client">
                <select
                  id="device-filter-client"
                  name="device-filter-client"
                  value={deviceFilters.clientId}
                  onChange={(event) =>
                    setDeviceFilters((current) => ({ ...current, clientId: event.target.value, locationId: "" }))
                  }
                >
                  <option value="">Wszyscy klienci</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lokalizacja" htmlFor="device-filter-location">
                <select
                  id="device-filter-location"
                  name="device-filter-location"
                  value={deviceFilters.locationId}
                  onChange={(event) => setDeviceFilters((current) => ({ ...current, locationId: event.target.value }))}
                >
                  <option value="">Wszystkie lokalizacje</option>
                  {filteredLocationsForDeviceFilter.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Szukaj" htmlFor="device-filter-query">
                <input
                  id="device-filter-query"
                  name="device-filter-query"
                  type="search"
                  value={deviceFilters.query}
                  onChange={(event) => setDeviceFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Serial, nazwa, lokalizacja, APK..."
                />
              </Field>
              <Field label="Typ playera" htmlFor="device-filter-type">
                <select
                  id="device-filter-type"
                  name="device-filter-type"
                  value={deviceFilters.type}
                  onChange={(event) =>
                    setDeviceFilters((current) => ({
                      ...current,
                      type: event.target.value as DeviceCenterFilters["type"]
                    }))
                  }
                >
                  {deviceTypeOptions.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setDeviceFilters({ clientId: "", locationId: "", query: "", type: "" })}
                disabled={!deviceFilters.clientId && !deviceFilters.locationId && !deviceFilters.query && !deviceFilters.type}
              >
                Wyczyść
              </button>
            </div>

            <div className="stats-grid device-stats">
              <article className="stat-card">
                <span>Łącznie</span>
                <strong>{deviceFleet.total}</strong>
                <small>{deviceFleet.approved} zatwierdzonych</small>
              </article>
              <article className="stat-card">
                <span>Online</span>
                <strong>{deviceFleet.online}</strong>
                <small>{deviceFleet.stale} z heartbeat w ostatnie 5 minut</small>
              </article>
              <article className="stat-card">
                <span>Offline</span>
                <strong>{deviceFleet.offline}</strong>
                <small>próg 5 minut bez heartbeat</small>
              </article>
              <article className="stat-card">
                <span>Blackout</span>
                <strong>{deviceFleet.blackout}</strong>
                <small>{deviceFleet.pending} czeka na approval</small>
              </article>
            </div>

            <div className="card-grid two-columns">
              <article className="panel">
                <header className="panel-header">
                  <h3>Oczekujące na approval</h3>
                  <span>{deviceFilterActive ? pendingDevices.length : "filtr wymagany"}</span>
                </header>
                {deviceFilterActive && pendingDevices.length ? (
                  <div className="list-stack">
                    {pendingDevices.map((device) => (
                      <button key={device.id} className="list-card interactive device-pending-row" type="button" onClick={() => beginDeviceApproval(device)}>
                        <div>
                          <strong>{device.serial}</strong>
                          <span>
                            {device.deviceModel} · {device.platform || "android"} · APK {device.appVersion || "brak"}
                          </span>
                          <small>{device.playerMessage || "Czeka na approval."}</small>
                        </div>
                        <div className="align-right">
                          <span className="status-pill pending">{device.playerState}</span>
                          <small>{formatDateTime(device.lastSeenAt)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : !deviceFilterActive ? (
                  <EmptyState text="Wybierz klienta, lokalizację albo wpisz serial, żeby pokazać urządzenia." />
                ) : (
                  <EmptyState text="Żadne nowe urządzenie nie czeka teraz na approval." />
                )}
              </article>

              <form
                className="panel stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!token) {
                    return;
                  }
                  const payload = {
                    name: deviceForm.name,
                    clientId: deviceForm.clientId,
                    channelId: deviceForm.channelId,
                    locationId: deviceForm.locationId,
                    playerType: deviceForm.playerType || "video_standard",
                    locationLabel: deviceForm.locationLabel,
                    notes: deviceForm.notes,
                    desiredDisplayState: deviceForm.desiredDisplayState,
                    volumePercent: Number(deviceForm.volumePercent || 80)
                  };

                  const successText =
                    deviceFormIsPending || !deviceFormIsApproved
                      ? "Urządzenie zostało zatwierdzone."
                      : "Zapisano zmiany urządzenia.";

                  void runMutation(
                    async () => {
                      if (deviceFormIsPending) {
                        await approveDevice(token, {
                          deviceId: deviceForm.id,
                          serial: deviceForm.serial,
                          ...payload
                        });
                      } else {
                        await updateDevice(token, deviceForm.id, payload);
                      }
                    },
                    successText,
                    () => setDeviceForm(emptyDeviceForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>
                    {deviceFormIsPending
                      ? "Zatwierdź urządzenie"
                      : deviceForm.id
                        ? "Konfiguracja urządzenia"
                        : "Wybierz urządzenie"}
                  </h3>
                  {deviceForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setDeviceForm(emptyDeviceForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
                <Field label="Numer seryjny" htmlFor="device-serial">
                  <input id="device-serial" name="device-serial" value={deviceForm.serial} readOnly />
                </Field>
                <Field label="Nazwa w CMS" htmlFor="device-name">
                  <input
                    id="device-name"
                    name="device-name"
                    value={deviceForm.name}
                    onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </Field>
                <div className="inline-grid">
                  <Field label="Klient" htmlFor="device-client">
                    <select
                      id="device-client"
                      name="device-client"
                      value={deviceForm.clientId}
                      onChange={(event) =>
                        setDeviceForm((current) => ({
                          ...current,
                          clientId: event.target.value,
                          channelId: "",
                          locationId: ""
                        }))
                      }
                      required
                    >
                      <option value="">Wybierz klienta</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kanał" htmlFor="device-channel">
                    <select
                      id="device-channel"
                      name="device-channel"
                      value={deviceForm.channelId}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, channelId: event.target.value }))}
                      required
                    >
                      <option value="">Wybierz kanał</option>
                      {filteredChannelsForDevice.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Lokalizacja" htmlFor="device-location-id">
                  <select
                    id="device-location-id"
                    name="device-location-id"
                    value={deviceForm.locationId}
                    onChange={(event) =>
                      setDeviceForm((current) => {
                        const location = locationLookup.get(event.target.value);
                        return {
                          ...current,
                          locationId: event.target.value,
                          locationLabel: location?.name || current.locationLabel
                        };
                      })
                    }
                  >
                    <option value="">Bez lokalizacji</option>
                    {filteredLocationsForDevice.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Opis miejsca" htmlFor="device-location">
                  <input
                    id="device-location"
                    name="device-location"
                    value={deviceForm.locationLabel}
                    onChange={(event) => setDeviceForm((current) => ({ ...current, locationLabel: event.target.value }))}
                  />
                </Field>
                <Field label="Typ playera" htmlFor="device-player-type">
                  <select
                    id="device-player-type"
                    name="device-player-type"
                    value={deviceForm.playerType}
                    onChange={(event) =>
                      setDeviceForm((current) => ({
                        ...current,
                        playerType: event.target.value as DeviceCenterFilters["type"]
                      }))
                    }
                  >
                    {playerTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="inline-grid">
                  <Field label="Tryb ekranu" htmlFor="device-display-state">
                    <select
                      id="device-display-state"
                      name="device-display-state"
                      value={deviceForm.desiredDisplayState}
                      onChange={(event) =>
                        setDeviceForm((current) => ({
                          ...current,
                          desiredDisplayState: event.target.value as "active" | "blackout"
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="blackout">Blackout</option>
                    </select>
                  </Field>
                  <Field label="Głośność %" htmlFor="device-volume">
                    <input
                      id="device-volume"
                      name="device-volume"
                      type="number"
                      min="0"
                      max="100"
                      value={deviceForm.volumePercent}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, volumePercent: event.target.value }))}
                    />
                  </Field>
                </div>
                <Field label="Notatki" htmlFor="device-notes">
                  <textarea
                    id="device-notes"
                    name="device-notes"
                    rows={3}
                    value={deviceForm.notes}
                    onChange={(event) => setDeviceForm((current) => ({ ...current, notes: event.target.value }))}
                  />
                </Field>
                <button className="primary-button" type="submit" disabled={submitting || !deviceForm.id}>
                  {deviceFormIsPending ? "Zatwierdź urządzenie" : "Zapisz konfigurację"}
                </button>
              </form>
            </div>

            <article className="panel">
              <header className="panel-header">
                <h3>Zatwierdzone urządzenia</h3>
                <span>{deviceFilterActive ? approvedDevices.length : "filtr wymagany"}</span>
              </header>
              {deviceFilterActive && approvedDevices.length ? (
                <div className="device-master-grid">
                  <div className="device-list-table">
                    {approvedDevices.map((device) => (
                      <button
                        key={device.id}
                        className={`device-row ${selectedApprovedDevice?.id === device.id ? "active" : ""}`}
                        type="button"
                        onClick={() => beginDeviceEdit(device)}
                      >
                        <span className={`status-dot ${getDeviceConnection(device)}`} />
                        <strong>{device.name}</strong>
                        <span>{device.serial}</span>
                        <span>{device.locationName || device.locationLabel || "bez site"}</span>
                        <span>{getDeviceTypeLabel(device)}</span>
                        <span>{device.playerState}</span>
                      </button>
                    ))}
                  </div>

                  {selectedApprovedDevice ? (
                    <div className={`device-properties ${selectedApprovedDevice.desiredDisplayState === "blackout" ? "is-blackout" : ""}`}>
                      <header className="panel-header">
                        <div>
                          <h3>{selectedApprovedDevice.name}</h3>
                          <span>{selectedApprovedDevice.serial}</span>
                        </div>
                        <span className={`status-pill ${getDeviceConnection(selectedApprovedDevice)}`}>
                          {connectionLabel(getDeviceConnection(selectedApprovedDevice))}
                        </span>
                      </header>
                      <div className="device-detail-grid">
                        <div>
                          <span>Klient</span>
                          <strong>{selectedApprovedDevice.clientName || "brak"}</strong>
                        </div>
                        <div>
                          <span>Kanał</span>
                          <strong>{selectedApprovedDevice.channelName || "brak"}</strong>
                        </div>
                        <div>
                          <span>Site</span>
                          <strong>{selectedApprovedDevice.locationName || selectedApprovedDevice.locationLabel || "brak"}</strong>
                        </div>
                        <div>
                          <span>Heartbeat</span>
                          <strong>{formatDateTime(selectedApprovedDevice.lastSeenAt)}</strong>
                        </div>
                        <div>
                          <span>Sync</span>
                          <strong>{formatDateTime(selectedApprovedDevice.lastSyncAt)}</strong>
                        </div>
                        <div>
                          <span>Platforma</span>
                          <strong>{selectedApprovedDevice.platform || "brak"} · APK {selectedApprovedDevice.appVersion || "brak"}</strong>
                        </div>
                        <div>
                          <span>Typ</span>
                          <strong>{getDeviceTypeLabel(selectedApprovedDevice)}</strong>
                        </div>
                        <div>
                          <span>Volume</span>
                          <strong>{selectedApprovedDevice.volumePercent}%</strong>
                        </div>
                      </div>
                      <div className="live-command-panel">
                        <div>
                          <span>Live command</span>
                          <strong>
                            {latestCommandByDevice.get(selectedApprovedDevice.id)
                              ? `${commandLabel(latestCommandByDevice.get(selectedApprovedDevice.id)!.type)} · ${commandStatusLabel(latestCommandByDevice.get(selectedApprovedDevice.id)!.status)}`
                              : "Brak komend"}
                          </strong>
                        </div>
                        <select
                          value={deviceCommandDrafts[selectedApprovedDevice.id] || "force_sync"}
                          onChange={(event) =>
                            setDeviceCommandDrafts((current) => ({
                              ...current,
                              [selectedApprovedDevice.id]: event.target.value as DeviceCommandType
                            }))
                          }
                        >
                          {liveCommandOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => sendLiveCommand(selectedApprovedDevice, deviceCommandDrafts[selectedApprovedDevice.id] || "force_sync")}
                          disabled={submitting}
                        >
                          Wyślij
                        </button>
                      </div>
                      <div className="card-actions">
                        {selectedApprovedDevice.desiredDisplayState === "blackout" ? (
                          <button className="primary-button" type="button" onClick={() => quickUpdateDevice(selectedApprovedDevice, "wake")} disabled={submitting}>
                            Wake
                          </button>
                        ) : (
                          <button className="ghost-button" type="button" onClick={() => quickUpdateDevice(selectedApprovedDevice, "blackout")} disabled={submitting}>
                            Blackout
                          </button>
                        )}
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            if (!token || !window.confirm(`Zresetować approval urządzenia ${selectedApprovedDevice.name}?`)) {
                              return;
                            }
                            void runMutation(async () => resetDevice(token, selectedApprovedDevice.id), "Urządzenie wróciło do kolejki pending.");
                          }}
                        >
                          Reset / rozłącz
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => {
                            if (!token || !window.confirm(`Usunąć urządzenie ${selectedApprovedDevice.name}?`)) {
                              return;
                            }
                            void runMutation(async () => deleteDevice(token, selectedApprovedDevice.id), "Usunięto urządzenie.");
                          }}
                        >
                          Usuń
                        </button>
                      </div>
                    </div>
                  ) : (
                    <EmptyState text="Wybierz urządzenie z listy." />
                  )}
                </div>
              ) : !deviceFilterActive ? (
                <EmptyState text="Wybierz klienta, lokalizację albo wpisz serial, żeby pokazać listę urządzeń." />
              ) : (
                <EmptyState text="Jeszcze żadne urządzenie nie zostało zatwierdzone." />
              )}
            </article>
          </section>
        ) : null}

        {activeSection === "reports" ? (
          <section className="section-stack">
            <div className="panel device-filter-bar report-filter-bar">
              <Field label="Klient" htmlFor="proof-filter-client">
                <select
                  id="proof-filter-client"
                  name="proof-filter-client"
                  value={proofReportFilters.clientId}
                  onChange={(event) =>
                    setProofReportFilters((current) => ({ ...current, clientId: event.target.value, locationId: "", deviceId: "" }))
                  }
                >
                  <option value="">Wszyscy klienci</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lokalizacja" htmlFor="proof-filter-location">
                <select
                  id="proof-filter-location"
                  name="proof-filter-location"
                  value={proofReportFilters.locationId}
                  onChange={(event) =>
                    setProofReportFilters((current) => ({ ...current, locationId: event.target.value, deviceId: "" }))
                  }
                >
                  <option value="">Wszystkie lokalizacje</option>
                  {filteredLocationsForProofFilter.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Urządzenie" htmlFor="proof-filter-device">
                <select
                  id="proof-filter-device"
                  name="proof-filter-device"
                  value={proofReportFilters.deviceId}
                  onChange={(event) => setProofReportFilters((current) => ({ ...current, deviceId: event.target.value }))}
                >
                  <option value="">Wszystkie urządzenia</option>
                  {filteredDevicesForProofFilter.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name || device.serial}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status" htmlFor="proof-filter-status">
                <select
                  id="proof-filter-status"
                  name="proof-filter-status"
                  value={proofReportFilters.status}
                  onChange={(event) =>
                    setProofReportFilters((current) => ({
                      ...current,
                      status: event.target.value as ProofReportFilters["status"]
                    }))
                  }
                >
                  <option value="">Wszystkie</option>
                  <option value="started">Started</option>
                  <option value="finished">Finished</option>
                  <option value="interrupted">Interrupted</option>
                  <option value="error">Error</option>
                </select>
              </Field>
              <Field label="Szukaj" htmlFor="proof-filter-query">
                <input
                  id="proof-filter-query"
                  name="proof-filter-query"
                  type="search"
                  value={proofReportFilters.query}
                  onChange={(event) => setProofReportFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Media, serial, checksum, playlist..."
                />
              </Field>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setAppliedProofReportFilters(proofReportFilters);
                  setProofReportsRequested(true);
                }}
              >
                Pokaż logi
              </button>
              <button className="secondary-button" type="button" onClick={downloadProofOfPlayCsv} disabled={!filteredProofOfPlay.length}>
                CSV
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setProofReportFilters(emptyProofReportFilters);
                  setAppliedProofReportFilters(emptyProofReportFilters);
                  setProofReportsRequested(false);
                }}
                disabled={
                  !proofReportFilters.clientId &&
                  !proofReportFilters.locationId &&
                  !proofReportFilters.deviceId &&
                  !proofReportFilters.status &&
                  !proofReportFilters.query
                }
              >
                Wyczyść
              </button>
            </div>

            <div className="stats-grid device-stats">
              <article className="stat-card">
                <span>Zdarzenia</span>
                <strong>{proofSummary.total}</strong>
                <small>{proofReportsRequested ? `${filteredProofOfPlay.length} / ${proofOfPlay.length} po filtrach` : "wybierz zakres i pokaż"}</small>
              </article>
              <article className="stat-card">
                <span>Started</span>
                <strong>{proofSummary.started}</strong>
                <small>raport startu assetu</small>
              </article>
              <article className="stat-card">
                <span>Finished</span>
                <strong>{proofSummary.finished}</strong>
                <small>raport zakończenia assetu</small>
              </article>
              <article className="stat-card">
                <span>Interrupted</span>
                <strong>{proofSummary.interrupted}</strong>
                <small>{proofSummary.uniqueDevices} urządzeń · {proofSummary.uniqueMedia} mediów</small>
              </article>
              <article className="stat-card">
                <span>Error</span>
                <strong>{proofSummary.error}</strong>
                <small>błędy raportowane przez player</small>
              </article>
            </div>

            <article className="panel">
              <header className="panel-header">
                <h3>Proof of Play</h3>
                <span>{proofReportsRequested ? `${visibleProofOfPlay.length} z ${filteredProofOfPlay.length}` : "czeka na filtr"}</span>
              </header>
              {proofReportsRequested && visibleProofOfPlay.length ? (
                <div className="list-stack">
                  {visibleProofOfPlay.map((record) => (
                    <div key={record.id} className="list-card proof-card">
                      <div>
                        <strong>{record.mediaTitle || record.mediaId || "nieznane media"}</strong>
                        <span>
                          {record.deviceName || record.deviceSerial || "nieznane urządzenie"} · {record.clientName || "bez klienta"} ·{" "}
                          {record.locationName || record.locationLabel || "bez site"} · {record.channelName || "bez kanału"}
                        </span>
                        <small>
                          {record.sourceType} · {record.mediaKind} · v{record.contentVersion} ·{" "}
                          {record.durationSeconds || 0}s · {formatDateTime(record.occurredAt)}
                        </small>
                        <code className="log-stack">
                          checksum {record.checksum || "brak"} · playlist {record.playlistId || "brak"} · schedule{" "}
                          {record.scheduleId || "brak"}
                        </code>
                        {record.errorMessage ? <small>{record.errorMessage}</small> : null}
                      </div>
                      <div className="align-right">
                        <span className={`status-pill ${proofStatusClass(record.status)}`}>{record.status}</span>
                        <small>APK {record.appVersion || "brak"}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !proofReportsRequested ? (
                <EmptyState text="Wybierz klienta, lokalizację lub urządzenie i kliknij Pokaż logi." />
              ) : (
                <EmptyState text="Brak zdarzeń Proof of Play pasujących do filtrów." />
              )}
            </article>
          </section>
        ) : null}

        {activeSection === "logs" ? (
          <section className="section-stack">
            <div className="panel device-filter-bar logs-filter-bar">
              <Field label="Klient" htmlFor="log-filter-client">
                <select
                  id="log-filter-client"
                  name="log-filter-client"
                  value={deviceLogFilters.clientId}
                  onChange={(event) =>
                    setDeviceLogFilters((current) => ({ ...current, clientId: event.target.value, locationId: "", deviceId: "" }))
                  }
                >
                  <option value="">Wszyscy klienci</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Lokalizacja" htmlFor="log-filter-location">
                <select
                  id="log-filter-location"
                  name="log-filter-location"
                  value={deviceLogFilters.locationId}
                  onChange={(event) =>
                    setDeviceLogFilters((current) => ({ ...current, locationId: event.target.value, deviceId: "" }))
                  }
                >
                  <option value="">Wszystkie lokalizacje</option>
                  {filteredLocationsForLogFilter.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Urządzenie" htmlFor="log-filter-device">
                <select
                  id="log-filter-device"
                  name="log-filter-device"
                  value={deviceLogFilters.deviceId}
                  onChange={(event) => setDeviceLogFilters((current) => ({ ...current, deviceId: event.target.value }))}
                >
                  <option value="">Wszystkie urządzenia</option>
                  {filteredDevicesForLogFilter.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name || device.serial}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Severity" htmlFor="log-filter-severity">
                <select
                  id="log-filter-severity"
                  name="log-filter-severity"
                  value={deviceLogFilters.severity}
                  onChange={(event) =>
                    setDeviceLogFilters((current) => ({
                      ...current,
                      severity: event.target.value as DeviceLogFilters["severity"]
                    }))
                  }
                >
                  <option value="">Wszystkie</option>
                  <option value="error">Error</option>
                  <option value="warn">Warn</option>
                  <option value="info">Info</option>
                </select>
              </Field>
              <Field label="Szukaj" htmlFor="log-filter-query">
                <input
                  id="log-filter-query"
                  name="log-filter-query"
                  type="search"
                  value={deviceLogFilters.query}
                  onChange={(event) => setDeviceLogFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Komponent, wiadomość, serial, wersja..."
                />
              </Field>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setAppliedDeviceLogFilters(deviceLogFilters);
                  setDeviceLogsRequested(true);
                }}
              >
                Wyświetl logi
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setDeviceLogFilters(emptyDeviceLogFilters);
                  setAppliedDeviceLogFilters(emptyDeviceLogFilters);
                  setDeviceLogsRequested(false);
                }}
                disabled={
                  !deviceLogFilters.clientId &&
                  !deviceLogFilters.locationId &&
                  !deviceLogFilters.deviceId &&
                  !deviceLogFilters.severity &&
                  !deviceLogFilters.component &&
                  !deviceLogFilters.query
                }
              >
                Wyczyść
              </button>
            </div>

            <article className="panel">
              <header className="panel-header">
                <h3>Logi playerów</h3>
                <span>{deviceLogsRequested ? `${visibleDeviceLogs.length} z ${filteredDeviceLogs.length}` : "czeka na filtr"}</span>
              </header>
              {deviceLogsRequested && visibleDeviceLogs.length ? (
                <div className="list-stack">
                  {visibleDeviceLogs.map((log) => (
                    <div key={log.id} className="list-card log-card">
                      <div>
                        <strong>{log.message}</strong>
                        <span>
                          {log.deviceName || log.deviceSerial || "nieznane urządzenie"} · {log.clientName || "bez klienta"} ·{" "}
                          {log.locationName || log.locationLabel || "bez site"} · {log.component}
                        </span>
                        <small>
                          APK {log.appVersion || "brak"} · OS {log.osVersion || "brak"} · sieć {log.networkStatus || "brak"} ·{" "}
                          {formatDateTime(log.createdAt)}
                        </small>
                        {log.stack ? <code className="log-stack">{log.stack}</code> : null}
                      </div>
                      <div className="align-right">
                        <span className={`status-pill ${logSeverityClass(log.severity)}`}>{log.severity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !deviceLogsRequested ? (
                <EmptyState text="Wybierz klienta, lokalizację lub urządzenie i kliknij Wyświetl logi." />
              ) : (
                <EmptyState text="Brak logów pasujących do filtrów." />
              )}
            </article>
          </section>
        ) : null}

        {activeSection === "install" ? (
          <section className="section-stack">
            <div className="card-grid two-columns">
              <article className="panel">
                <header className="panel-header">
                  <h3>Adresy systemowe</h3>
                  <span>konfiguracja</span>
                </header>
                <div className="info-block">
                  <strong>Adres API / CMS</strong>
                  <code>{dashboard.installation.apiBaseUrl || getApiBaseUrl()}</code>
                </div>
                <div className="info-block">
                  <strong>Link do APK</strong>
                  <a href={dashboard.installation.apkUrl} target="_blank" rel="noreferrer">
                    {dashboard.installation.apkUrl}
                  </a>
                </div>
                <div className="info-block">
                  <strong>Storage</strong>
                  <code>
                    {dashboard.installation.storageMode === "prisma"
                      ? "PostgreSQL / Prisma"
                      : `JSON ${dashboard.installation.dataDir ? `(${dashboard.installation.dataDir})` : ""}`}
                  </code>
                </div>
              </article>

              <article className="panel">
                <header className="panel-header">
                  <h3>Flow onboardingu</h3>
                  <span>player</span>
                </header>
                <ol className="steps-list">
                  <li>Zainstaluj playera z linku APK.</li>
                  <li>Na ekranie TV pojawi się stały numer seryjny, np. MK192473021G.</li>
                  <li>Urządzenie pokaże się w sekcji Urządzenia jako pending.</li>
                  <li>W CMS kliknij wpis z kolejki, nadaj nazwę, klienta i kanał, potem zatwierdź.</li>
                  <li>Player sam pobierze playlistę z jednego serwera i zacznie emisję.</li>
                </ol>
              </article>
            </div>
          </section>
        ) : null}

        {clientModalOpen ? (
          <Modal
            title={clientForm.id ? "Edytuj klienta" : "Utwórz klienta"}
            onClose={() => {
              setClientModalOpen(false);
              setClientForm(emptyClientForm);
            }}
          >
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runMutation(
                  async () => {
                    if (!token) {
                      return;
                    }
                    const payload = {
                      name: clientForm.name,
                      slug: clientForm.slug,
                      brandColor: clientForm.brandColor
                    };
                    if (clientForm.id) {
                      await updateClient(token, clientForm.id, payload);
                    } else {
                      await createClient(token, payload);
                    }
                  },
                  clientForm.id ? "Zapisano klienta." : "Dodano klienta.",
                  () => {
                    setClientForm(emptyClientForm);
                    setClientModalOpen(false);
                  }
                );
              }}
            >
              <Field label="Nazwa" htmlFor="client-name">
                <input
                  id="client-name"
                  name="client-name"
                  value={clientForm.name}
                  onChange={(event) =>
                    setClientForm((current) => ({
                      ...current,
                      name: event.target.value,
                      slug: current.id ? current.slug : toSlug(event.target.value)
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Slug" htmlFor="client-slug">
                <input
                  id="client-slug"
                  name="client-slug"
                  value={clientForm.slug}
                  onChange={(event) => setClientForm((current) => ({ ...current, slug: toSlug(event.target.value) }))}
                  required
                />
              </Field>
              <Field label="Kolor marki" htmlFor="client-color">
                <input
                  id="client-color"
                  name="client-color"
                  type="color"
                  value={clientForm.brandColor}
                  onChange={(event) => setClientForm((current) => ({ ...current, brandColor: event.target.value }))}
                />
              </Field>
              <div className="modal-actions">
                <button className="primary-button" type="submit" disabled={submitting}>
                  {clientForm.id ? "Zapisz klienta" : "Dodaj klienta"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setClientModalOpen(false);
                    setClientForm(emptyClientForm);
                  }}
                >
                  Anuluj
                </button>
              </div>
            </form>
          </Modal>
        ) : null}

        {locationModalOpen ? (
          <Modal
            title={locationForm.id ? "Edytuj lokalizację" : "Utwórz lokalizację"}
            onClose={() => {
              setLocationModalOpen(false);
              setLocationForm(emptyLocationForm);
            }}
          >
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runMutation(
                  async () => {
                    if (!token) {
                      return;
                    }
                    const payload = {
                      clientId: locationForm.clientId,
                      name: locationForm.name,
                      city: locationForm.city,
                      address: locationForm.address,
                      notes: locationForm.notes
                    };
                    if (locationForm.id) {
                      await updateLocation(token, locationForm.id, payload);
                    } else {
                      await createLocation(token, payload);
                    }
                  },
                  locationForm.id ? "Zapisano lokalizację." : "Dodano lokalizację.",
                  () => {
                    setLocationForm(emptyLocationForm);
                    setLocationModalOpen(false);
                  }
                );
              }}
            >
              <Field label="Klient" htmlFor="location-client">
                <select
                  id="location-client"
                  name="location-client"
                  value={locationForm.clientId}
                  onChange={(event) => setLocationForm((current) => ({ ...current, clientId: event.target.value }))}
                  required
                >
                  <option value="">Wybierz klienta</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nazwa site’u" htmlFor="location-name">
                <input
                  id="location-name"
                  name="location-name"
                  value={locationForm.name}
                  onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </Field>
              <div className="inline-grid">
                <Field label="Miasto" htmlFor="location-city">
                  <input
                    id="location-city"
                    name="location-city"
                    value={locationForm.city}
                    onChange={(event) => setLocationForm((current) => ({ ...current, city: event.target.value }))}
                  />
                </Field>
                <Field label="Adres" htmlFor="location-address">
                  <input
                    id="location-address"
                    name="location-address"
                    value={locationForm.address}
                    onChange={(event) => setLocationForm((current) => ({ ...current, address: event.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Notatki" htmlFor="location-notes">
                <textarea
                  id="location-notes"
                  name="location-notes"
                  rows={3}
                  value={locationForm.notes}
                  onChange={(event) => setLocationForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </Field>
              <div className="modal-actions">
                <button className="primary-button" type="submit" disabled={submitting}>
                  {locationForm.id ? "Zapisz lokalizację" : "Dodaj lokalizację"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setLocationModalOpen(false);
                    setLocationForm(emptyLocationForm);
                  }}
                >
                  Anuluj
                </button>
                {locationForm.id ? (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      if (!token || !window.confirm(`Usunąć lokalizację ${locationForm.name}?`)) {
                        return;
                      }
                      void runMutation(
                        async () => deleteLocation(token, locationForm.id),
                        "Usunięto lokalizację.",
                        () => {
                          setLocationForm(emptyLocationForm);
                          setLocationModalOpen(false);
                        }
                      );
                    }}
                  >
                    Usuń
                  </button>
                ) : null}
              </div>
            </form>
          </Modal>
        ) : null}
      </main>
    </div>
  );
}

function sectionTitle(section: SectionKey) {
  return navItems.find((item) => item.key === section)?.label || "Pulpit";
}

function toSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDateTime(value: string) {
  if (!value) {
    return "brak";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function connectionLabel(value: ReturnType<typeof getDeviceConnection>) {
  if (value === "stale") {
    return "świeży";
  }
  return value;
}

function commandLabel(type: DeviceCommandType) {
  return liveCommandOptions.find((option) => option.value === type)?.label || type;
}

function commandStatusLabel(status: DeviceCommandRecord["status"]) {
  if (status === "pending") {
    return "czeka";
  }
  if (status === "sent") {
    return "wysłana";
  }
  if (status === "acked") {
    return "ACK";
  }
  return "błąd";
}

function eventTypeLabel(type: PlaybackEventRecord["eventType"]) {
  return type === "audio" ? "audio" : "wizualny";
}

function logSeverityClass(severity: "info" | "warn" | "error") {
  if (severity === "error") {
    return "offline";
  }
  if (severity === "warn") {
    return "pending";
  }
  return "neutral";
}

function proofStatusClass(status: ProofOfPlayRecord["status"]) {
  if (status === "finished") {
    return "online";
  }
  if (status === "error") {
    return "offline";
  }
  if (status === "interrupted") {
    return "stale";
  }
  return "pending";
}

function buildLatestCommandLookup(commands: DeviceCommandRecord[]) {
  const lookup = new Map<string, DeviceCommandRecord>();
  for (const command of [...commands].sort(sortCommandsByUpdatedDesc)) {
    if (!lookup.has(command.deviceId)) {
      lookup.set(command.deviceId, command);
    }
  }
  return lookup;
}

function sortCommandsByUpdatedDesc(left: DeviceCommandRecord, right: DeviceCommandRecord) {
  return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
}

function filterDeviceLogs(
  logs: BootstrapPayload["deviceLogs"],
  devices: DeviceRecord[],
  filters: DeviceLogFilters
) {
  const deviceLookup = new Map(devices.map((device) => [device.id, device]));
  const query = filters.query.trim().toLowerCase();

  return logs.filter((log) => {
    const device = deviceLookup.get(log.deviceId);
    if (filters.clientId && log.clientId !== filters.clientId && device?.clientId !== filters.clientId) {
      return false;
    }
    if (filters.locationId && log.locationId !== filters.locationId && device?.locationId !== filters.locationId) {
      return false;
    }
    if (filters.deviceId && log.deviceId !== filters.deviceId) {
      return false;
    }
    if (filters.severity && log.severity !== filters.severity) {
      return false;
    }
    if (filters.component && log.component !== filters.component) {
      return false;
    }
    if (!query) {
      return true;
    }

    return [
      log.message,
      log.component,
      log.deviceName,
      log.deviceSerial,
      log.clientName,
      log.locationName,
      log.locationLabel,
      log.appVersion,
      log.osVersion,
      log.networkStatus
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function filterClientDirectory(clients: ClientRecord[], locations: LocationRecord[], filters: ClientDirectoryFilters) {
  const query = filters.query.trim().toLowerCase();
  const selectedLocation = filters.locationId ? locations.find((location) => location.id === filters.locationId) : null;
  const clientIdsByLocation = new Set<string>();

  for (const location of locations) {
    if (filters.locationId && location.id !== filters.locationId) {
      continue;
    }
    if (query && !matchesClientLocationQuery(location, query)) {
      continue;
    }
    clientIdsByLocation.add(location.clientId);
  }

  const filteredClients = clients.filter((client) => {
    if (filters.clientId && client.id !== filters.clientId) {
      return false;
    }
    if (selectedLocation && client.id !== selectedLocation.clientId) {
      return false;
    }
    if (!query) {
      return !filters.locationId || clientIdsByLocation.has(client.id);
    }
    return matchesClientQuery(client, query) || clientIdsByLocation.has(client.id);
  });

  const filteredClientIds = new Set(filteredClients.map((client) => client.id));
  const filteredLocations = locations.filter((location) => {
    if (filters.clientId && location.clientId !== filters.clientId) {
      return false;
    }
    if (filters.locationId && location.id !== filters.locationId) {
      return false;
    }
    if (!filteredClientIds.has(location.clientId)) {
      return false;
    }
    return !query || matchesClientLocationQuery(location, query) || matchesClientQuery(clients.find((client) => client.id === location.clientId), query);
  });

  return {
    clients: filteredClients,
    locations: filteredLocations
  };
}

function matchesClientQuery(client: ClientRecord | undefined, query: string) {
  if (!client) {
    return false;
  }
  return [client.name, client.slug].join(" ").toLowerCase().includes(query);
}

function matchesClientLocationQuery(location: LocationRecord, query: string) {
  return [location.name, location.city, location.address, location.notes].join(" ").toLowerCase().includes(query);
}

function Modal(props: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <h3>{props.title}</h3>
          <button className="ghost-button" type="button" onClick={props.onClose}>
            Zamknij
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}

function Field(props: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <label className="field" htmlFor={props.htmlFor}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function EmptyState(props: { text: string }) {
  return <div className="empty-state">{props.text}</div>;
}

export default App;
