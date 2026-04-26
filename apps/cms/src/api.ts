import type { BootstrapPayload, DeviceCommandType } from "./types";

const localApiBase =
  typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "http://localhost:3000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getStoredToken() {
  return localStorage.getItem("signal-deck-token") || "";
}

export function storeToken(token: string) {
  localStorage.setItem("signal-deck-token", token);
}

export function clearToken() {
  localStorage.removeItem("signal-deck-token");
}

export function getApiBaseUrl() {
  return localApiBase;
}

type RequestOptions = {
  method?: string;
  token?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
};

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${localApiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(payload?.message || "Serwer nie mógł obsłużyć żądania.", response.status);
  }

  return payload as T;
}

export async function login(email: string, password: string) {
  return requestJson<{ token: string; user: BootstrapPayload["user"] }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function logout(token: string) {
  return requestJson<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    token
  });
}

export async function fetchBootstrap(token: string) {
  return requestJson<BootstrapPayload>("/api/bootstrap", { token });
}

export async function createUser(
  token: string,
  payload: {
    email: string;
    password: string;
    name: string;
    role: string;
    clientIds?: string[];
    allLocations?: boolean;
    locationIds?: string[];
  }
) {
  return requestJson<{ user: BootstrapPayload["users"][number] }>("/api/users", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateUser(
  token: string,
  userId: string,
  payload: {
    email: string;
    password?: string;
    name: string;
    role: string;
    clientIds?: string[];
    allLocations?: boolean;
    locationIds?: string[];
  }
) {
  return requestJson<{ user: BootstrapPayload["users"][number] }>(`/api/users/${userId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteUser(token: string, userId: string) {
  return requestJson<{ ok: true }>(`/api/users/${userId}`, {
    method: "DELETE",
    token
  });
}

export async function createClient(token: string, payload: { name: string; slug: string; brandColor: string }) {
  return requestJson<{ client: BootstrapPayload["clients"][number] }>("/api/clients", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateClient(
  token: string,
  clientId: string,
  payload: { name: string; slug: string; brandColor: string }
) {
  return requestJson<{ client: BootstrapPayload["clients"][number] }>(`/api/clients/${clientId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteClient(token: string, clientId: string) {
  return requestJson<{ ok: true }>(`/api/clients/${clientId}`, {
    method: "DELETE",
    token
  });
}

export async function createLocation(
  token: string,
  payload: { clientId: string; name: string; city: string; address: string; notes: string }
) {
  return requestJson<{ location: BootstrapPayload["locations"][number] }>("/api/locations", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateLocation(
  token: string,
  locationId: string,
  payload: { clientId: string; name: string; city: string; address: string; notes: string }
) {
  return requestJson<{ location: BootstrapPayload["locations"][number] }>(`/api/locations/${locationId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteLocation(token: string, locationId: string) {
  return requestJson<{ ok: true }>(`/api/locations/${locationId}`, {
    method: "DELETE",
    token
  });
}

export async function createChannel(
  token: string,
  payload: {
    clientId: string;
    name: string;
    slug: string;
    description: string;
    orientation: string;
    locationIds?: string[];
  }
) {
  return requestJson<{ channel: BootstrapPayload["channels"][number] }>("/api/channels", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateChannel(
  token: string,
  channelId: string,
  payload: {
    clientId: string;
    name: string;
    slug: string;
    description: string;
    orientation: string;
    locationIds?: string[];
  }
) {
  return requestJson<{ channel: BootstrapPayload["channels"][number] }>(`/api/channels/${channelId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteChannel(token: string, channelId: string) {
  return requestJson<{ ok: true }>(`/api/channels/${channelId}`, {
    method: "DELETE",
    token
  });
}

export async function uploadMedia(token: string, payload: FormData) {
  return requestJson<{ media: BootstrapPayload["media"][number] }>("/api/media", {
    method: "POST",
    token,
    body: payload
  });
}

export async function deleteMedia(token: string, mediaId: string) {
  return requestJson<{ ok: true }>(`/api/media/${mediaId}`, {
    method: "DELETE",
    token
  });
}

export async function createPlaylist(
  token: string,
  payload: { clientId: string; channelId: string; name: string; isActive: boolean; notes: string }
) {
  return requestJson<{ playlist: BootstrapPayload["playlists"][number] }>("/api/playlists", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updatePlaylist(
  token: string,
  playlistId: string,
  payload: { clientId: string; channelId: string; name: string; isActive: boolean; notes: string }
) {
  return requestJson<{ playlist: BootstrapPayload["playlists"][number] }>(`/api/playlists/${playlistId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deletePlaylist(token: string, playlistId: string) {
  return requestJson<{ ok: true }>(`/api/playlists/${playlistId}`, {
    method: "DELETE",
    token
  });
}

export async function createPlaylistItem(
  token: string,
  playlistId: string,
  payload: { mediaId: string; sortOrder: number; loopCount: number; volumePercent: number; locationIds?: string[] }
) {
  return requestJson<{ playlistItem: unknown }>(`/api/playlists/${playlistId}/items`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deletePlaylistItem(token: string, playlistId: string, itemId: string) {
  return requestJson<{ ok: true }>(`/api/playlists/${playlistId}/items/${itemId}`, {
    method: "DELETE",
    token
  });
}

export async function createSchedule(
  token: string,
  payload: {
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
  }
) {
  return requestJson<{ schedule: BootstrapPayload["schedules"][number] }>("/api/schedules", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateSchedule(
  token: string,
  scheduleId: string,
  payload: {
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
  }
) {
  return requestJson<{ schedule: BootstrapPayload["schedules"][number] }>(`/api/schedules/${scheduleId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteSchedule(token: string, scheduleId: string) {
  return requestJson<{ ok: true }>(`/api/schedules/${scheduleId}`, {
    method: "DELETE",
    token
  });
}

export async function createPlaybackEvent(
  token: string,
  payload: {
    clientId: string;
    channelId: string;
    mediaId: string;
    name: string;
    eventType: string;
    triggerMode: string;
    intervalItems: number;
    intervalMinutes: number;
    priority: number;
    isActive: boolean;
  }
) {
  return requestJson<{ playbackEvent: BootstrapPayload["playbackEvents"][number] }>("/api/playback-events", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updatePlaybackEvent(
  token: string,
  eventId: string,
  payload: {
    clientId: string;
    channelId: string;
    mediaId: string;
    name: string;
    eventType: string;
    triggerMode: string;
    intervalItems: number;
    intervalMinutes: number;
    priority: number;
    isActive: boolean;
  }
) {
  return requestJson<{ playbackEvent: BootstrapPayload["playbackEvents"][number] }>(`/api/playback-events/${eventId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deletePlaybackEvent(token: string, eventId: string) {
  return requestJson<{ ok: true }>(`/api/playback-events/${eventId}`, {
    method: "DELETE",
    token
  });
}

export async function approveDevice(
  token: string,
  payload: {
    deviceId: string;
    serial: string;
    name: string;
    clientId: string;
    channelId: string;
    locationId: string;
    playerType: string;
    locationLabel: string;
    notes: string;
    desiredDisplayState: string;
    volumePercent: number;
  }
) {
  return requestJson<{ device: BootstrapPayload["devices"][number] }>("/api/devices/approve", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateDevice(
  token: string,
  deviceId: string,
  payload: {
    name: string;
    clientId: string;
    channelId: string;
    locationId: string;
    playerType: string;
    locationLabel: string;
    notes: string;
    desiredDisplayState: string;
    volumePercent: number;
    approvalStatus?: string;
  }
) {
  return requestJson<{ device: BootstrapPayload["devices"][number] }>(`/api/devices/${deviceId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload)
  });
}

export async function issueDeviceCommand(
  token: string,
  deviceId: string,
  payload: {
    type: DeviceCommandType;
    payload?: Record<string, unknown>;
  }
) {
  return requestJson<{
    command: BootstrapPayload["deviceCommands"][number];
    device: BootstrapPayload["devices"][number];
  }>(`/api/devices/${deviceId}/commands`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function resetDevice(token: string, deviceId: string) {
  return requestJson<{ device: BootstrapPayload["devices"][number] }>(`/api/devices/${deviceId}/reset`, {
    method: "POST",
    token
  });
}

export async function deleteDevice(token: string, deviceId: string) {
  return requestJson<{ ok: true }>(`/api/devices/${deviceId}`, {
    method: "DELETE",
    token
  });
}
