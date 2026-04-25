import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  approveDevice,
  clearToken,
  createChannel,
  createClient,
  createPlaylist,
  createPlaylistItem,
  createSchedule,
  createUser,
  deleteChannel,
  deleteClient,
  deleteDevice,
  deleteMedia,
  deletePlaylist,
  deletePlaylistItem,
  deleteSchedule,
  deleteUser,
  fetchBootstrap,
  getApiBaseUrl,
  getStoredToken,
  login,
  logout,
  resetDevice,
  storeToken,
  updateChannel,
  updateClient,
  updateDevice,
  updatePlaylist,
  updateSchedule,
  updateUser,
  uploadMedia
} from "./api";
import {
  buildDeviceQuickUpdate,
  filterDeviceCenterDevices,
  getDeviceConnection,
  summarizeDeviceFleet,
  type DeviceCenterFilters,
  type DeviceQuickAction
} from "./deviceCenter";
import type {
  BootstrapPayload,
  ChannelRecord,
  ClientRecord,
  DeviceRecord,
  InstallationInfo,
  MediaRecord,
  PlaylistRecord,
  ScheduleRecord,
  UserRecord,
  UserRole
} from "./types";

type SectionKey = "overview" | "users" | "clients" | "channels" | "media" | "playlists" | "schedule" | "devices" | "install";
type FlashMessage = { kind: "success" | "error"; text: string };

type UserFormState = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
};

type ClientFormState = {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
};

type ChannelFormState = {
  id: string;
  clientId: string;
  name: string;
  slug: string;
  description: string;
  orientation: "landscape" | "portrait";
};

type MediaFormState = {
  clientId: string;
  title: string;
  kind: "video" | "image";
  durationSeconds: string;
  hasAudio: boolean;
  status: "draft" | "published";
  tags: string;
  file: File | null;
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
  locationLabel: string;
  notes: string;
  desiredDisplayState: "active" | "blackout";
  volumePercent: string;
};

const navItems: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: "overview", label: "Pulpit", hint: "status systemu" },
  { key: "users", label: "Użytkownicy", hint: "konta CMS" },
  { key: "clients", label: "Klienci", hint: "tenant i branding" },
  { key: "channels", label: "Kanały", hint: "grupy emisji" },
  { key: "media", label: "Media", hint: "video i obrazy" },
  { key: "playlists", label: "Playlisty", hint: "kolejność materiałów" },
  { key: "schedule", label: "Harmonogramy", hint: "emisja wg czasu" },
  { key: "devices", label: "Urządzenia", hint: "seriale i approval" },
  { key: "install", label: "Instalacja", hint: "APK i adres serwera" }
];

const deviceTypeOptions: Array<{ value: DeviceCenterFilters["type"]; label: string }> = [
  { value: "", label: "Wszystkie typy" },
  { value: "android", label: "Android / TV" },
  { value: "rpi", label: "Android na RPi" },
  { value: "web", label: "Web / przeglądarka" },
  { value: "other", label: "Inne" }
];

const emptyBootstrap: BootstrapPayload = {
  user: { id: "", email: "", name: "", role: "owner" },
  users: [],
  installation: { apiBaseUrl: "", apkUrl: "" },
  clients: [],
  channels: [],
  media: [],
  playlists: [],
  schedules: [],
  devices: []
};

const emptyUserForm: UserFormState = {
  id: "",
  email: "",
  password: "",
  name: "",
  role: "editor"
};

const emptyClientForm: ClientFormState = {
  id: "",
  name: "",
  slug: "",
  brandColor: "#ff6a3d"
};

const emptyChannelForm: ChannelFormState = {
  id: "",
  clientId: "",
  name: "",
  slug: "",
  description: "",
  orientation: "landscape"
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
  volumePercent: "100"
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

const emptyDeviceForm: DeviceFormState = {
  id: "",
  serial: "",
  name: "",
  clientId: "",
  channelId: "",
  locationLabel: "",
  notes: "",
  desiredDisplayState: "active",
  volumePercent: "80"
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
  const [channelForm, setChannelForm] = useState<ChannelFormState>(emptyChannelForm);
  const [mediaForm, setMediaForm] = useState<MediaFormState>(emptyMediaForm);
  const [mediaInputKey, setMediaInputKey] = useState(0);
  const [playlistForm, setPlaylistForm] = useState<PlaylistFormState>(emptyPlaylistForm);
  const [playlistItemForm, setPlaylistItemForm] = useState<PlaylistItemFormState>(emptyPlaylistItemForm);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(emptyScheduleForm);
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(emptyDeviceForm);
  const [deviceFilters, setDeviceFilters] = useState<DeviceCenterFilters>({ clientId: "", query: "", type: "" });

  const clients = dashboard.clients;
  const channels = dashboard.channels;
  const media = dashboard.media;
  const playlists = dashboard.playlists;
  const schedules = dashboard.schedules;
  const devices = dashboard.devices;
  const filteredDevices = useMemo(() => filterDeviceCenterDevices(devices, deviceFilters), [devices, deviceFilters]);
  const pendingDevices = filteredDevices.filter((device) => device.approvalStatus === "pending");
  const approvedDevices = filteredDevices.filter((device) => device.approvalStatus === "approved");
  const deviceFleet = useMemo(() => summarizeDeviceFleet(filteredDevices), [filteredDevices]);
  const deviceFormIsPending = devices.some((device) => device.id === deviceForm.id && device.approvalStatus === "pending");
  const deviceFormIsApproved = devices.some((device) => device.id === deviceForm.id && device.approvalStatus === "approved");

  const clientLookup = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const channelLookup = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  const mediaLookup = useMemo(() => new Map(media.map((entry) => [entry.id, entry])), [media]);

  const filteredChannelsForPlaylist = useMemo(
    () => channels.filter((channel) => !playlistForm.clientId || channel.clientId === playlistForm.clientId),
    [channels, playlistForm.clientId]
  );
  const filteredChannelsForSchedule = useMemo(
    () => channels.filter((channel) => !scheduleForm.clientId || channel.clientId === scheduleForm.clientId),
    [channels, scheduleForm.clientId]
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
      role: user.role
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
    setActiveSection("clients");
  }

  function beginChannelEdit(channel: ChannelRecord) {
    setChannelForm({
      id: channel.id,
      clientId: channel.clientId,
      name: channel.name,
      slug: channel.slug,
      description: channel.description,
      orientation: channel.orientation
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

  function beginDeviceApproval(device: DeviceRecord) {
    setDeviceForm({
      id: device.id,
      serial: device.serial,
      name: device.name === "Android TV" ? `Ekran ${device.serial}` : device.name,
      clientId: device.clientId,
      channelId: device.channelId,
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
      locationLabel: device.locationLabel,
      notes: device.notes,
      desiredDisplayState: device.desiredDisplayState,
      volumePercent: String(device.volumePercent || 80)
    });
    setActiveSection("devices");
  }

  function quickUpdateDevice(device: DeviceRecord, action: DeviceQuickAction) {
    if (!token) {
      return;
    }

    const successText = action === "blackout" ? `Blackout wysłany do ${device.name}.` : `Wake wysłany do ${device.name}.`;
    void runMutation(async () => updateDevice(token, device.id, buildDeviceQuickUpdate(device, action)), successText);
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

  const stats = [
    { label: "Klienci", value: clients.length, hint: "tenanty w systemie" },
    { label: "Kanały", value: channels.length, hint: "grupy emisji" },
    { label: "Media", value: media.length, hint: "pliki opublikowane i draft" },
    { label: "Playlisty", value: playlists.length, hint: "kolejki treści" },
    { label: "Harmonogramy", value: schedules.length, hint: "aktywne reguły" },
    { label: "Urządzenia online", value: approvedDevices.filter((device) => device.online).length, hint: "serca playerów" }
  ];

  if (!token) {
    return (
      <main className="login-shell">
        <div className="login-card">
          <span className="eyebrow">Digital Signage Control</span>
          <h1>Jeden serwer. Jeden CMS. Jeden player.</h1>
          <p>
            To jest nowy panel oparty o jeden backend. Logujesz się tutaj, zarządzasz mediami i zatwierdzasz urządzenia
            po numerze seryjnym.
          </p>
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
          <p className="sidebar-copy">
            Prosty panel operacyjny do demo i wdrożeń. Approval urządzeń działa po stałym numerze seryjnym.
          </p>
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
              <span>{item.hint}</span>
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
            <span className="eyebrow">Nowa architektura</span>
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

            <div className="card-grid two-columns">
              <article className="panel">
                <header className="panel-header">
                  <h3>Pending approval</h3>
                  <span>{pendingDevices.length} szt.</span>
                </header>
                {pendingDevices.length ? (
                  <div className="list-stack">
                    {pendingDevices.map((device) => (
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
                  <span>{approvedDevices.length} zatwierdzonych</span>
                </header>
                {approvedDevices.length ? (
                  <div className="list-stack">
                    {approvedDevices.slice(0, 6).map((device) => (
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
                          role: userForm.role
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
                    () => setClientForm(emptyClientForm)
                  );
                }}
              >
                <header className="panel-header">
                  <h3>{clientForm.id ? "Edytuj klienta" : "Nowy klient"}</h3>
                  {clientForm.id ? (
                    <button className="ghost-button" type="button" onClick={() => setClientForm(emptyClientForm)}>
                      Anuluj
                    </button>
                  ) : null}
                </header>
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
                <button className="primary-button" type="submit" disabled={submitting}>
                  {clientForm.id ? "Zapisz klienta" : "Dodaj klienta"}
                </button>
              </form>

              <article className="panel">
                <header className="panel-header">
                  <h3>Lista klientów</h3>
                  <span>{clients.length}</span>
                </header>
                {clients.length ? (
                  <div className="list-stack">
                    {clients.map((client) => (
                      <div key={client.id} className="list-card">
                        <div>
                          <strong>{client.name}</strong>
                          <span>{client.slug}</span>
                        </div>
                        <div className="card-actions">
                          <span className="color-chip" style={{ backgroundColor: client.brandColor }} />
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
                  <EmptyState text="Dodaj pierwszego klienta, żeby ruszyć dalej." />
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
                        orientation: channelForm.orientation
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
                    onChange={(event) => setChannelForm((current) => ({ ...current, clientId: event.target.value }))}
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
                            {clientLookup.get(channel.clientId)?.name || "bez klienta"} · {channel.orientation}
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
                        setMediaForm((current) => ({ ...current, kind: event.target.value as "video" | "image" }))
                      }
                    >
                      <option value="video">Video</option>
                      <option value="image">Obraz</option>
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
                    accept="video/*,image/*"
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
                        volumePercent: Number(playlistItemForm.volumePercent || 100)
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
                      setPlaylistItemForm((current) => ({ ...current, playlistId: event.target.value }))
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
                    {media.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title}
                      </option>
                    ))}
                  </select>
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
                                  sort {item.sortOrder} · loop {item.loopCount} · vol {item.volumePercent}
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
                  onChange={(event) => setDeviceFilters((current) => ({ ...current, clientId: event.target.value }))}
                >
                  <option value="">Wszyscy klienci</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
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
                onClick={() => setDeviceFilters({ clientId: "", query: "", type: "" })}
                disabled={!deviceFilters.clientId && !deviceFilters.query && !deviceFilters.type}
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
                  <span>{pendingDevices.length}</span>
                </header>
                {pendingDevices.length ? (
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
                <Field label="Lokalizacja / opis" htmlFor="device-location">
                  <input
                    id="device-location"
                    name="device-location"
                    value={deviceForm.locationLabel}
                    onChange={(event) => setDeviceForm((current) => ({ ...current, locationLabel: event.target.value }))}
                  />
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
                <span>{approvedDevices.length}</span>
              </header>
              {approvedDevices.length ? (
                <div className="device-center-grid">
                  {approvedDevices.map((device) => (
                    <div key={device.id} className={`device-card command-card ${device.desiredDisplayState === "blackout" ? "is-blackout" : ""}`}>
                      <div className="device-card-main">
                        <div>
                          <strong>{device.name}</strong>
                          <span>
                            {device.serial} · {device.clientName || "bez klienta"} · {device.channelName || "bez kanału"}
                          </span>
                          <small>
                            {device.locationLabel ? `${device.locationLabel} · ` : ""}
                            {device.playerMessage || "Brak komunikatu od playera."}
                            {device.activeItemTitle ? ` · aktualnie: ${device.activeItemTitle}` : ""}
                          </small>
                        </div>
                        <div className="device-meta">
                          <span className={`status-pill ${getDeviceConnection(device)}`}>
                            {connectionLabel(getDeviceConnection(device))}
                          </span>
                          {device.desiredDisplayState === "blackout" ? <span className="status-pill blackout">blackout</span> : null}
                          <span className="status-pill neutral">{device.playerState}</span>
                        </div>
                      </div>
                      <div className="device-detail-grid">
                        <div>
                          <span>Heartbeat</span>
                          <strong>{formatDateTime(device.lastSeenAt)}</strong>
                        </div>
                        <div>
                          <span>Sync</span>
                          <strong>{formatDateTime(device.lastSyncAt)}</strong>
                        </div>
                        <div>
                          <span>Platforma</span>
                          <strong>{device.platform || "brak"} · APK {device.appVersion || "brak"}</strong>
                        </div>
                        <div>
                          <span>Volume</span>
                          <strong>{device.volumePercent}%</strong>
                        </div>
                      </div>
                      <div className="card-actions">
                        {device.desiredDisplayState === "blackout" ? (
                          <button className="primary-button" type="button" onClick={() => quickUpdateDevice(device, "wake")} disabled={submitting}>
                            Wake
                          </button>
                        ) : (
                          <button className="ghost-button" type="button" onClick={() => quickUpdateDevice(device, "blackout")} disabled={submitting}>
                            Blackout
                          </button>
                        )}
                        <button className="ghost-button" type="button" onClick={() => beginDeviceEdit(device)}>
                          Edytuj
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            if (!token || !window.confirm(`Zresetować approval urządzenia ${device.name}?`)) {
                              return;
                            }
                            void runMutation(async () => resetDevice(token, device.id), "Urządzenie wróciło do kolejki pending.");
                          }}
                        >
                          Reset / rozłącz
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => {
                            if (!token || !window.confirm(`Usunąć urządzenie ${device.name}?`)) {
                              return;
                            }
                            void runMutation(async () => deleteDevice(token, device.id), "Usunięto urządzenie.");
                          }}
                        >
                          Usuń
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Jeszcze żadne urządzenie nie zostało zatwierdzone." />
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
                  <span>hardcoded dla playera</span>
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
              </article>

              <article className="panel">
                <header className="panel-header">
                  <h3>Flow onboardingu</h3>
                  <span>bez kodów PB</span>
                </header>
                <ol className="steps-list">
                  <li>Zainstaluj playera z linku APK.</li>
                  <li>Na ekranie TV pojawi się stały numer seryjny, np. `MK192473021G`.</li>
                  <li>Urządzenie samo pokaże się w sekcji `Urządzenia` jako `pending`.</li>
                  <li>W CMS kliknij wpis z kolejki, nadaj nazwę, klienta i kanał, potem `Zatwierdź`.</li>
                  <li>Player sam pobierze playlistę z jednego serwera i zacznie emisję.</li>
                </ol>
              </article>
            </div>
          </section>
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
