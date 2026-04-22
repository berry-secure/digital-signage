import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPocketBaseClient, pocketbaseUrl } from "./lib/pocketbase";
import type {
  ChannelRecord,
  ClientRecord,
  CmsUserRecord,
  DashboardData,
  EventRecord,
  MediaAssetRecord,
  PlaylistItemRecord,
  PlaylistRecord,
  ScheduleRuleRecord,
  ScreenUserRecord
} from "./types";

const pb = createPocketBaseClient();

const collectionNames = [
  "clients",
  "channels",
  "screen_users",
  "media_assets",
  "playlists",
  "playlist_items",
  "schedule_rules",
  "events"
] as const;

type SectionKey =
  | "overview"
  | "clients"
  | "channels"
  | "screens"
  | "media"
  | "playlists"
  | "schedule"
  | "events";

type FlashMessage = {
  kind: "success" | "error";
  text: string;
};

const emptyDashboard: DashboardData = {
  clients: [],
  channels: [],
  screens: [],
  mediaAssets: [],
  playlists: [],
  playlistItems: [],
  schedules: [],
  events: []
};

const navItems: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: "overview", label: "Overview", hint: "status i szybkie KPI" },
  { key: "clients", label: "Klienci", hint: "tenanci i branding" },
  { key: "channels", label: "Kanały", hint: "grupy ekranów" },
  { key: "screens", label: "Ekrany", hint: "urządzenia i dostępy" },
  { key: "media", label: "Media", hint: "wideo i assety" },
  { key: "playlists", label: "Playlisty", hint: "kolejność emisji" },
  { key: "schedule", label: "Scheduling", hint: "czas emisji" },
  { key: "events", label: "Eventy", hint: "awaryjne override" }
];

const defaultClientForm = {
  name: "",
  slug: "",
  brandColor: "#D46A3B"
};

const defaultChannelForm = {
  client: "",
  name: "",
  slug: "",
  description: "",
  orientation: "landscape"
};

const defaultScreenForm = {
  name: "",
  client: "",
  channel: "",
  locationLabel: "",
  email: "",
  password: "",
  volumePercent: "80",
  notes: ""
};

const defaultMediaForm = {
  client: "",
  title: "",
  kind: "video",
  durationSeconds: "0",
  hasAudio: true,
  status: "published",
  tags: ""
};

const defaultPlaylistForm = {
  client: "",
  channel: "",
  name: "",
  isActive: true,
  notes: ""
};

const defaultPlaylistItemForm = {
  playlist: "",
  mediaAsset: "",
  sortOrder: "10",
  loopCount: "1",
  volumePercent: "100"
};

const defaultScheduleForm = {
  client: "",
  channel: "",
  playlist: "",
  label: "",
  startDate: "",
  endDate: "",
  startTime: "08:00",
  endTime: "22:00",
  daysOfWeek: "1,2,3,4,5,6,0",
  priority: "100",
  isActive: true
};

const defaultEventForm = {
  client: "",
  channel: "",
  screen: "",
  playlist: "",
  title: "",
  message: "",
  startsAt: "",
  endsAt: "",
  priority: "300",
  isActive: true
};

function App() {
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [authRecord, setAuthRecord] = useState<CmsUserRecord | null>(
    (pb.authStore.record as CmsUserRecord | null) ?? null
  );
  const [isLoading, setIsLoading] = useState<boolean>(pb.authStore.isValid);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [fileToken, setFileToken] = useState<string>("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [clientForm, setClientForm] = useState(defaultClientForm);
  const [channelForm, setChannelForm] = useState(defaultChannelForm);
  const [screenForm, setScreenForm] = useState(defaultScreenForm);
  const [mediaForm, setMediaForm] = useState(defaultMediaForm);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [playlistForm, setPlaylistForm] = useState(defaultPlaylistForm);
  const [playlistItemForm, setPlaylistItemForm] = useState(defaultPlaylistItemForm);
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);
  const [eventForm, setEventForm] = useState(defaultEventForm);

  useEffect(() => {
    return pb.authStore.onChange(() => {
      setAuthRecord((pb.authStore.record as CmsUserRecord | null) ?? null);
    });
  }, []);

  useEffect(() => {
    if (!pb.authStore.isValid) {
      setDashboard(emptyDashboard);
      setFileToken("");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const load = async () => {
      setIsLoading(true);

      try {
        const [token, clients, channels, screens, mediaAssets, playlists, playlistItems, schedules, events] =
          await Promise.all([
            pb.files.getToken(),
            pb.collection("clients").getFullList<ClientRecord>({ sort: "name" }),
            pb.collection("channels").getFullList<ChannelRecord>({
              sort: "name",
              expand: "client"
            }),
            pb.collection("screen_users").getFullList<ScreenUserRecord>({
              sort: "locationLabel",
              expand: "client,channel"
            }),
            pb.collection("media_assets").getFullList<MediaAssetRecord>({
              sort: "-created",
              expand: "client"
            }),
            pb.collection("playlists").getFullList<PlaylistRecord>({
              sort: "name",
              expand: "client,channel"
            }),
            pb.collection("playlist_items").getFullList<PlaylistItemRecord>({
              sort: "playlist,sortOrder",
              expand: "playlist,mediaAsset"
            }),
            pb.collection("schedule_rules").getFullList<ScheduleRuleRecord>({
              sort: "-priority,label",
              expand: "client,channel,playlist"
            }),
            pb.collection("events").getFullList<EventRecord>({
              sort: "-priority,-startsAt",
              expand: "client,channel,screen,playlist"
            })
          ]);

        if (cancelled) {
          return;
        }

        setFileToken(token);
        setDashboard(
          scopeDashboard(
            {
              clients,
              channels,
              screens,
              mediaAssets,
              playlists,
              playlistItems,
              schedules,
              events
            },
            authRecord
          )
        );
      } catch (error) {
        showFlash(setFlash, {
          kind: "error",
          text: readError(error, "Nie udało się pobrać danych z PocketBase.")
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    const subscribe = async () => {
      await Promise.all(
        collectionNames.map((name) =>
          pb.collection(name).subscribe("*", () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              void load();
            }, 180);
          })
        )
      );
    };

    void subscribe();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      collectionNames.forEach((name) => {
        pb.collection(name).unsubscribe("*");
      });
    };
  }, [authRecord?.id, authRecord?.client, authRecord?.role]);

  const onlineScreens = useMemo(
    () => dashboard.screens.filter((screen) => isOnline(screen.lastSeenAt)).length,
    [dashboard.screens]
  );

  const scheduledToday = useMemo(
    () => dashboard.schedules.filter((schedule) => isScheduledToday(schedule.daysOfWeek)).length,
    [dashboard.schedules]
  );

  const activeEvents = useMemo(
    () => dashboard.events.filter((event) => isCurrentEvent(event.startsAt, event.endsAt) && event.isActive)
      .length,
    [dashboard.events]
  );

  const playlistCards = useMemo(
    () =>
      dashboard.playlists.map((playlist) => ({
        playlist,
        items: dashboard.playlistItems
          .filter((item) => item.playlist === playlist.id)
          .sort((left, right) => left.sortOrder - right.sortOrder)
      })),
    [dashboard.playlists, dashboard.playlistItems]
  );

  const canSeeAllClients = authRecord?.role === "owner" || !authRecord?.client;

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFlash(null);

    try {
      await pb.collection("cms_users").authWithPassword(loginForm.email, loginForm.password);
      setLoginForm({ email: "", password: "" });
      showFlash(setFlash, {
        kind: "success",
        text: "Sesja CMS została otwarta poprawnie."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zalogować do kolekcji cms_users.")
      });
    }
  }

  function handleLogout() {
    pb.authStore.clear();
    setActiveSection("overview");
    showFlash(setFlash, {
      kind: "success",
      text: "Wylogowano z panelu CMS."
    });
  }

  async function handleCreateClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("clients").create({
        name: clientForm.name,
        slug: slugify(clientForm.slug || clientForm.name),
        brandColor: clientForm.brandColor
      });
      setClientForm(defaultClientForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Dodano nowego klienta."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zapisać klienta.")
      });
    }
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("channels").create({
        client: channelForm.client,
        name: channelForm.name,
        slug: slugify(channelForm.slug || channelForm.name),
        description: channelForm.description,
        orientation: channelForm.orientation
      });
      setChannelForm(defaultChannelForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Kanał został zapisany."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się dodać kanału.")
      });
    }
  }

  async function handleCreateScreen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("screen_users").create({
        email: screenForm.email.trim(),
        password: screenForm.password,
        passwordConfirm: screenForm.password,
        name: screenForm.name,
        client: screenForm.client,
        channel: screenForm.channel,
        locationLabel: screenForm.locationLabel,
        volumePercent: Number(screenForm.volumePercent) || 80,
        status: "offline",
        notes: screenForm.notes
      });

      setScreenForm(defaultScreenForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Ekran i konto logowania dla playera zostały utworzone."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się utworzyć ekranu.")
      });
    }
  }

  async function handleCreateMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!mediaFile) {
      showFlash(setFlash, {
        kind: "error",
        text: "Najpierw wybierz plik wideo lub grafikę."
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append("client", mediaForm.client);
      formData.append("title", mediaForm.title);
      formData.append("kind", mediaForm.kind);
      formData.append("asset", mediaFile);
      formData.append("durationSeconds", mediaForm.durationSeconds);
      formData.append("hasAudio", String(mediaForm.hasAudio));
      formData.append("status", mediaForm.status);
      formData.append("tags", mediaForm.tags);
      await pb.collection("media_assets").create(formData);
      setMediaFile(null);
      setMediaForm(defaultMediaForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Media zostały dodane do biblioteki."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się wgrać pliku.")
      });
    }
  }

  async function handleCreatePlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("playlists").create(compactRecord({
        client: playlistForm.client,
        channel: playlistForm.channel || undefined,
        name: playlistForm.name,
        isActive: playlistForm.isActive,
        notes: playlistForm.notes
      }));
      setPlaylistForm(defaultPlaylistForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Playlista została utworzona."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zapisać playlisty.")
      });
    }
  }

  async function handleCreatePlaylistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const playlist = dashboard.playlists.find((entry) => entry.id === playlistItemForm.playlist);
      if (!playlist) {
        throw new Error("Wybierz istniejącą playlistę.");
      }

      await pb.collection("playlist_items").create({
        client: playlist.client,
        playlist: playlistItemForm.playlist,
        mediaAsset: playlistItemForm.mediaAsset,
        sortOrder: Number(playlistItemForm.sortOrder) || 10,
        loopCount: Number(playlistItemForm.loopCount) || 1,
        volumePercent: Number(playlistItemForm.volumePercent) || 100
      });

      setPlaylistItemForm(defaultPlaylistItemForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Element playlisty został dodany."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się dodać elementu playlisty.")
      });
    }
  }

  async function handleCreateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("schedule_rules").create(compactRecord({
        client: scheduleForm.client,
        channel: scheduleForm.channel,
        playlist: scheduleForm.playlist,
        label: scheduleForm.label,
        startDate: toIsoDate(scheduleForm.startDate) || undefined,
        endDate: toIsoDate(scheduleForm.endDate) || undefined,
        startTime: scheduleForm.startTime,
        endTime: scheduleForm.endTime,
        daysOfWeek: scheduleForm.daysOfWeek,
        priority: Number(scheduleForm.priority) || 100,
        isActive: scheduleForm.isActive
      }));
      setScheduleForm(defaultScheduleForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Reguła harmonogramu została zapisana."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zapisać harmonogramu.")
      });
    }
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await pb.collection("events").create(compactRecord({
        client: eventForm.client,
        channel: eventForm.channel || undefined,
        screen: eventForm.screen || undefined,
        playlist: eventForm.playlist,
        title: eventForm.title,
        message: eventForm.message,
        startsAt: toIsoDateTime(eventForm.startsAt),
        endsAt: toIsoDateTime(eventForm.endsAt),
        priority: Number(eventForm.priority) || 300,
        isActive: eventForm.isActive
      }));
      setEventForm(defaultEventForm);
      showFlash(setFlash, {
        kind: "success",
        text: "Event override został dodany."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zapisać eventu.")
      });
    }
  }

  async function handleDelete(collection: string, id: string, label: string) {
    const confirmed = window.confirm(`Usunąć ${label}?`);
    if (!confirmed) {
      return;
    }

    try {
      await pb.collection(collection).delete(id);
      showFlash(setFlash, {
        kind: "success",
        text: `${label} zostało usunięte.`
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, `Nie udało się usunąć: ${label}.`)
      });
    }
  }

  async function handleMediaFileSelection(file: File | null) {
    setMediaFile(file);
    if (!file) {
      return;
    }

    setMediaForm((current) => ({
      ...current,
      title: current.title || stripExtension(file.name),
      kind: file.type.startsWith("image/") ? "image" : "video"
    }));

    if (file.type.startsWith("video/")) {
      const duration = await readVideoDuration(file);
      setMediaForm((current) => ({
        ...current,
        durationSeconds: String(Math.ceil(duration || 0))
      }));
    }
  }

  if (!pb.authStore.isValid) {
    return (
      <div className="auth-shell">
        <div className="auth-copy">
          <span className="eyebrow">Signal Deck</span>
          <h1>Zgrabny CMS pod Twoje DS, od razu gotowy pod `cms.berry-secure.pl`.</h1>
          <p>
            Panel loguje się do kolekcji <code>cms_users</code> w PocketBase i po zalogowaniu
            obsługuje klientów, kanały, ekrany, media, playlisty, scheduling oraz eventy override.
          </p>
          <div className="auth-note">
            <span>API</span>
            <strong>{pocketbaseUrl}</strong>
          </div>
        </div>

        <form className="auth-card" onSubmit={handleLogin}>
          <h2>Logowanie CMS</h2>
          <p>Użyj konta z kolekcji <code>cms_users</code>.</p>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="owner@berry-secure.pl"
              required
            />
          </label>

          <label className="field">
            <span>Hasło</span>
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="••••••••"
              required
            />
          </label>

          {flash ? <FlashBanner flash={flash} /> : null}

          <button className="primary-button" type="submit">
            Wejdź do panelu
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="eyebrow">Signal Deck</span>
          <h2>CMS</h2>
          <p>
            {authRecord?.name || authRecord?.email}
            <span className="muted-line">
              {authRecord?.role || "operator"}
              {authRecord?.expand?.client ? ` • ${authRecord.expand.client.name}` : ""}
            </span>
          </p>
        </div>

        <nav className="nav-stack">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={item.key === activeSection ? "nav-item active" : "nav-item"}
              onClick={() => setActiveSection(item.key)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="endpoint-pill">
            <span>PocketBase</span>
            <strong>{pocketbaseUrl}</strong>
          </div>
          <button className="ghost-button" onClick={handleLogout} type="button">
            Wyloguj
          </button>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">berry-secure</span>
            <h1>Minimalistyczny panel operacyjny</h1>
          </div>
          <div className="topbar-meta">
            <MetricBadge label="Online" value={`${onlineScreens}/${dashboard.screens.length}`} />
            <MetricBadge label="Schedule today" value={String(scheduledToday)} />
            <MetricBadge label="Active events" value={String(activeEvents)} />
          </div>
        </header>

        {flash ? <FlashBanner flash={flash} /> : null}

        {isLoading ? (
          <section className="loading-state">Ładuję dane z PocketBase…</section>
        ) : null}

        {activeSection === "overview" ? (
          <section className="section-grid">
            <Panel title="Sieć ekranów" subtitle="Stan na żywo i szybki pogląd na całą sieć">
              <div className="stats-grid">
                <StatCard label="Klienci" value={String(dashboard.clients.length)} />
                <StatCard label="Kanały" value={String(dashboard.channels.length)} />
                <StatCard label="Ekrany online" value={String(onlineScreens)} />
                <StatCard label="Biblioteka media" value={String(dashboard.mediaAssets.length)} />
              </div>
            </Panel>

            <Panel title="Ekrany" subtitle="Ostatni heartbeat i przypięte kanały">
              <div className="list-stack">
                {dashboard.screens.map((screen) => (
                  <RecordRow
                    key={screen.id}
                    title={screen.locationLabel || screen.name}
                    subtitle={`${screen.expand?.client?.name || "Brak klienta"} • ${
                      screen.expand?.channel?.name || "Brak kanału"
                    }`}
                    meta={screen.email}
                    badge={<StatusBadge status={statusFromHeartbeat(screen)} />}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("screen_users", screen.id, screen.name)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.screens.length ? <EmptyState text="Brak ekranów w sieci." /> : null}
              </div>
            </Panel>

            <Panel title="Eventy override" subtitle="Najwyższy priorytet zbliża się lub już gra">
              <div className="list-stack">
                {dashboard.events.slice(0, 6).map((event) => (
                  <RecordRow
                    key={event.id}
                    title={event.title}
                    subtitle={`${event.expand?.client?.name || "Brak klienta"} • ${
                      event.expand?.playlist?.name || "Brak playlisty"
                    }`}
                    meta={`${formatDateTime(event.startsAt)} → ${formatDateTime(event.endsAt)}`}
                    badge={<PriorityBadge value={event.priority} />}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("events", event.id, event.title)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.events.length ? (
                  <EmptyState text="Brak eventów override. Harmonogram działa samodzielnie." />
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "clients" ? (
          <section className="section-grid">
            <Panel title="Nowy klient" subtitle="Nowy tenant w systemie">
              <form className="form-grid" onSubmit={handleCreateClient}>
                <TextField
                  label="Nazwa"
                  value={clientForm.name}
                  onChange={(value) => setClientForm((current) => ({ ...current, name: value }))}
                  placeholder="Berry Secure"
                  required
                />
                <TextField
                  label="Slug"
                  value={clientForm.slug}
                  onChange={(value) => setClientForm((current) => ({ ...current, slug: value }))}
                  placeholder="berry-secure"
                />
                <TextField
                  label="Kolor marki"
                  value={clientForm.brandColor}
                  onChange={(value) =>
                    setClientForm((current) => ({ ...current, brandColor: value }))
                  }
                  type="color"
                  required
                />
                <button className="primary-button" type="submit">
                  Dodaj klienta
                </button>
              </form>
            </Panel>

            <Panel title="Klienci" subtitle="Podział na firmy i tenantów">
              <div className="card-grid">
                {dashboard.clients.map((client) => (
                  <article className="mini-card" key={client.id}>
                    <div className="mini-card-head">
                      <span
                        className="color-dot"
                        style={{ backgroundColor: client.brandColor || "#D46A3B" }}
                      />
                      <h3>{client.name}</h3>
                    </div>
                    <p>{client.slug}</p>
                    <button
                      className="danger-button"
                      onClick={() => handleDelete("clients", client.id, client.name)}
                      type="button"
                    >
                      Usuń
                    </button>
                  </article>
                ))}
                {!dashboard.clients.length ? <EmptyState text="Nie ma jeszcze żadnych klientów." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "channels" ? (
          <section className="section-grid">
            <Panel title="Nowy kanał" subtitle="Kanały grupują ekrany i harmonogram">
              <form className="form-grid" onSubmit={handleCreateChannel}>
                <SelectField
                  label="Klient"
                  value={channelForm.client}
                  onChange={(value) => setChannelForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <TextField
                  label="Nazwa kanału"
                  value={channelForm.name}
                  onChange={(value) => setChannelForm((current) => ({ ...current, name: value }))}
                  placeholder="Lobby"
                  required
                />
                <TextField
                  label="Slug"
                  value={channelForm.slug}
                  onChange={(value) => setChannelForm((current) => ({ ...current, slug: value }))}
                  placeholder="lobby"
                />
                <TextField
                  label="Opis"
                  value={channelForm.description}
                  onChange={(value) =>
                    setChannelForm((current) => ({ ...current, description: value }))
                  }
                  placeholder="Strefa wejściowa / recepcja"
                />
                <SelectField
                  label="Orientacja"
                  value={channelForm.orientation}
                  onChange={(value) =>
                    setChannelForm((current) => ({
                      ...current,
                      orientation: value as "landscape" | "portrait"
                    }))
                  }
                  options={[
                    { value: "landscape", label: "Landscape" },
                    { value: "portrait", label: "Portrait" }
                  ]}
                  required
                />
                <button className="primary-button" type="submit">
                  Dodaj kanał
                </button>
              </form>
            </Panel>

            <Panel title="Kanały" subtitle="Struktura logiczna sieci DS">
              <div className="list-stack">
                {dashboard.channels.map((channel) => (
                  <RecordRow
                    key={channel.id}
                    title={channel.name}
                    subtitle={channel.description || "Bez opisu"}
                    meta={`${channel.expand?.client?.name || "Brak klienta"} • ${channel.orientation}`}
                    badge={<span className="soft-badge">{channel.slug}</span>}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("channels", channel.id, channel.name)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.channels.length ? <EmptyState text="Brak kanałów do wyświetlenia." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "screens" ? (
          <section className="section-grid">
            <Panel title="Nowy ekran" subtitle="Tworzy konto logowania dla playera">
              <form className="form-grid" onSubmit={handleCreateScreen}>
                <TextField
                  label="Nazwa konta"
                  value={screenForm.name}
                  onChange={(value) => setScreenForm((current) => ({ ...current, name: value }))}
                  placeholder="TV Lobby 01"
                  required
                />
                <TextField
                  label="Lokalizacja"
                  value={screenForm.locationLabel}
                  onChange={(value) =>
                    setScreenForm((current) => ({ ...current, locationLabel: value }))
                  }
                  placeholder="Warszawa / recepcja"
                  required
                />
                <SelectField
                  label="Klient"
                  value={screenForm.client}
                  onChange={(value) => setScreenForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <SelectField
                  label="Kanał"
                  value={screenForm.channel}
                  onChange={(value) => setScreenForm((current) => ({ ...current, channel: value }))}
                  options={dashboard.channels
                    .filter((channel) => !screenForm.client || channel.client === screenForm.client)
                    .map((channel) => ({ value: channel.id, label: channel.name }))}
                  required
                />
                <TextField
                  label="Email loginu"
                  value={screenForm.email}
                  onChange={(value) => setScreenForm((current) => ({ ...current, email: value }))}
                  type="email"
                  placeholder="tv-lobby-01@berry-secure.pl"
                  required
                />
                <TextField
                  label="Hasło"
                  value={screenForm.password}
                  onChange={(value) =>
                    setScreenForm((current) => ({ ...current, password: value }))
                  }
                  type="password"
                  placeholder="Mocne hasło dla playera"
                  required
                />
                <TextField
                  label="Głośność %"
                  value={screenForm.volumePercent}
                  onChange={(value) =>
                    setScreenForm((current) => ({ ...current, volumePercent: value }))
                  }
                  type="number"
                  required
                />
                <TextAreaField
                  label="Notatki"
                  value={screenForm.notes}
                  onChange={(value) => setScreenForm((current) => ({ ...current, notes: value }))}
                  placeholder="Android TV Philips, zasilanie z listwy UPS"
                />
                <button className="primary-button" type="submit">
                  Dodaj ekran
                </button>
              </form>
            </Panel>

            <Panel title="Ekrany i dostępy" subtitle="Te dane wpiszesz później do playera">
              <div className="list-stack">
                {dashboard.screens.map((screen) => (
                  <RecordRow
                    key={screen.id}
                    title={screen.locationLabel || screen.name}
                    subtitle={`${screen.email} • ${
                      screen.expand?.channel?.name || "Brak kanału"
                    }`}
                    meta={`Głośność ${screen.volumePercent}% • ostatni heartbeat ${
                      formatHeartbeat(screen.lastSeenAt) || "brak"
                    }`}
                    badge={<StatusBadge status={statusFromHeartbeat(screen)} />}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("screen_users", screen.id, screen.name)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.screens.length ? <EmptyState text="Nie ma jeszcze żadnych ekranów." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "media" ? (
          <section className="section-grid">
            <Panel title="Nowe media" subtitle="Wgrywanie wideo z dźwiękiem albo grafik">
              <form className="form-grid" onSubmit={handleCreateMedia}>
                <SelectField
                  label="Klient"
                  value={mediaForm.client}
                  onChange={(value) => setMediaForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <TextField
                  label="Tytuł"
                  value={mediaForm.title}
                  onChange={(value) => setMediaForm((current) => ({ ...current, title: value }))}
                  placeholder="Wiosenna kampania 15s"
                  required
                />
                <SelectField
                  label="Typ"
                  value={mediaForm.kind}
                  onChange={(value) =>
                    setMediaForm((current) => ({
                      ...current,
                      kind: value as "video" | "image"
                    }))
                  }
                  options={[
                    { value: "video", label: "Video" },
                    { value: "image", label: "Image" }
                  ]}
                  required
                />
                <TextField
                  label="Czas trwania (sekundy)"
                  value={mediaForm.durationSeconds}
                  onChange={(value) =>
                    setMediaForm((current) => ({ ...current, durationSeconds: value }))
                  }
                  type="number"
                  required
                />
                <SelectField
                  label="Status"
                  value={mediaForm.status}
                  onChange={(value) =>
                    setMediaForm((current) => ({
                      ...current,
                      status: value as "draft" | "published"
                    }))
                  }
                  options={[
                    { value: "published", label: "Published" },
                    { value: "draft", label: "Draft" }
                  ]}
                  required
                />
                <ToggleField
                  label="Plik ma dźwięk"
                  checked={mediaForm.hasAudio}
                  onChange={(value) =>
                    setMediaForm((current) => ({ ...current, hasAudio: value }))
                  }
                />
                <TextField
                  label="Tagi"
                  value={mediaForm.tags}
                  onChange={(value) => setMediaForm((current) => ({ ...current, tags: value }))}
                  placeholder="promo,main-screen,spring"
                />
                <label className="field">
                  <span>Plik</span>
                  <input
                    type="file"
                    accept="video/*,image/*"
                    onChange={(event) =>
                      void handleMediaFileSelection(event.target.files?.[0] ?? null)
                    }
                    required
                  />
                </label>
                <button className="primary-button" type="submit">
                  Wgraj media
                </button>
              </form>
            </Panel>

            <Panel title="Biblioteka media" subtitle="Assety gotowe do playlist i schedule">
              <div className="card-grid">
                {dashboard.mediaAssets.map((asset) => (
                  <article className="media-card" key={asset.id}>
                    <div className="media-preview">
                      {asset.kind === "video" ? (
                        <video
                          src={getProtectedFileUrl(asset, fileToken)}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img alt={asset.title} src={getProtectedFileUrl(asset, fileToken)} />
                      )}
                    </div>
                    <div className="media-copy">
                      <h3>{asset.title}</h3>
                      <p>
                        {asset.expand?.client?.name || "Brak klienta"} • {asset.durationSeconds || 0}s •{" "}
                        {asset.hasAudio ? "z dźwiękiem" : "bez dźwięku"}
                      </p>
                      <div className="media-tags">
                        <span className="soft-badge">{asset.kind}</span>
                        <span className="soft-badge">{asset.status}</span>
                      </div>
                    </div>
                    <button
                      className="danger-button"
                      onClick={() => handleDelete("media_assets", asset.id, asset.title)}
                      type="button"
                    >
                      Usuń
                    </button>
                  </article>
                ))}
                {!dashboard.mediaAssets.length ? (
                  <EmptyState text="Biblioteka mediów jest jeszcze pusta." />
                ) : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "playlists" ? (
          <section className="section-grid">
            <Panel title="Nowa playlista" subtitle="Zbiór mediów pod konkretny kanał lub klienta">
              <form className="form-grid" onSubmit={handleCreatePlaylist}>
                <SelectField
                  label="Klient"
                  value={playlistForm.client}
                  onChange={(value) => setPlaylistForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <SelectField
                  label="Kanał"
                  value={playlistForm.channel}
                  onChange={(value) =>
                    setPlaylistForm((current) => ({ ...current, channel: value }))
                  }
                  options={[
                    { value: "", label: "Brak przypięcia na sztywno" },
                    ...dashboard.channels
                      .filter((channel) => !playlistForm.client || channel.client === playlistForm.client)
                      .map((channel) => ({
                        value: channel.id,
                        label: channel.name
                      }))
                  ]}
                />
                <TextField
                  label="Nazwa"
                  value={playlistForm.name}
                  onChange={(value) => setPlaylistForm((current) => ({ ...current, name: value }))}
                  placeholder="Main lobby loop"
                  required
                />
                <TextAreaField
                  label="Notatki"
                  value={playlistForm.notes}
                  onChange={(value) => setPlaylistForm((current) => ({ ...current, notes: value }))}
                  placeholder="Loop na wejście główne, wersja z dźwiękiem."
                />
                <ToggleField
                  label="Aktywna"
                  checked={playlistForm.isActive}
                  onChange={(value) =>
                    setPlaylistForm((current) => ({ ...current, isActive: value }))
                  }
                />
                <button className="primary-button" type="submit">
                  Dodaj playlistę
                </button>
              </form>
            </Panel>

            <Panel title="Dodaj element do playlisty" subtitle="Kolejność, loop i poziom głośności">
              <form className="form-grid" onSubmit={handleCreatePlaylistItem}>
                <SelectField
                  label="Playlista"
                  value={playlistItemForm.playlist}
                  onChange={(value) =>
                    setPlaylistItemForm((current) => ({ ...current, playlist: value }))
                  }
                  options={dashboard.playlists.map((playlist) => ({
                    value: playlist.id,
                    label: playlist.name
                  }))}
                  required
                />
                <SelectField
                  label="Media"
                  value={playlistItemForm.mediaAsset}
                  onChange={(value) =>
                    setPlaylistItemForm((current) => ({ ...current, mediaAsset: value }))
                  }
                  options={dashboard.mediaAssets.map((asset) => ({
                    value: asset.id,
                    label: asset.title
                  }))}
                  required
                />
                <TextField
                  label="Sort order"
                  value={playlistItemForm.sortOrder}
                  onChange={(value) =>
                    setPlaylistItemForm((current) => ({ ...current, sortOrder: value }))
                  }
                  type="number"
                  required
                />
                <TextField
                  label="Loop count"
                  value={playlistItemForm.loopCount}
                  onChange={(value) =>
                    setPlaylistItemForm((current) => ({ ...current, loopCount: value }))
                  }
                  type="number"
                  required
                />
                <TextField
                  label="Głośność %"
                  value={playlistItemForm.volumePercent}
                  onChange={(value) =>
                    setPlaylistItemForm((current) => ({ ...current, volumePercent: value }))
                  }
                  type="number"
                  required
                />
                <button className="primary-button" type="submit">
                  Dodaj element
                </button>
              </form>
            </Panel>

            <Panel title="Playlisty" subtitle="Pełna zawartość i kolejność emisji">
              <div className="card-grid playlist-grid">
                {playlistCards.map(({ playlist, items }) => (
                  <article className="playlist-card" key={playlist.id}>
                    <div className="playlist-head">
                      <div>
                        <h3>{playlist.name}</h3>
                        <p>
                          {playlist.expand?.client?.name || "Brak klienta"}
                          {playlist.expand?.channel ? ` • ${playlist.expand.channel.name}` : ""}
                        </p>
                      </div>
                      <span className={playlist.isActive ? "status-dot success" : "status-dot idle"}>
                        {playlist.isActive ? "active" : "paused"}
                      </span>
                    </div>

                    <div className="playlist-items">
                      {items.map((item) => (
                        <div className="playlist-item-line" key={item.id}>
                          <strong>{item.expand?.mediaAsset?.title || "Brak media"}</strong>
                          <span>
                            #{item.sortOrder} • x{item.loopCount} • vol {item.volumePercent}%
                          </span>
                          <button
                            className="mini-danger"
                            onClick={() =>
                              handleDelete("playlist_items", item.id, item.expand?.mediaAsset?.title || "element")
                            }
                            type="button"
                          >
                            usuń
                          </button>
                        </div>
                      ))}
                      {!items.length ? <EmptyState text="Ta playlista nie ma jeszcze żadnych pozycji." /> : null}
                    </div>

                    <button
                      className="danger-button"
                      onClick={() => handleDelete("playlists", playlist.id, playlist.name)}
                      type="button"
                    >
                      Usuń playlistę
                    </button>
                  </article>
                ))}
                {!playlistCards.length ? <EmptyState text="Nie utworzono jeszcze żadnych playlist." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "schedule" ? (
          <section className="section-grid">
            <Panel title="Nowa reguła harmonogramu" subtitle="To ona mówi playerowi co ma grać i kiedy">
              <form className="form-grid" onSubmit={handleCreateSchedule}>
                <SelectField
                  label="Klient"
                  value={scheduleForm.client}
                  onChange={(value) => setScheduleForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <SelectField
                  label="Kanał"
                  value={scheduleForm.channel}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, channel: value }))
                  }
                  options={dashboard.channels
                    .filter((channel) => !scheduleForm.client || channel.client === scheduleForm.client)
                    .map((channel) => ({
                      value: channel.id,
                      label: channel.name
                    }))}
                  required
                />
                <SelectField
                  label="Playlista"
                  value={scheduleForm.playlist}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, playlist: value }))
                  }
                  options={dashboard.playlists
                    .filter((playlist) => !scheduleForm.client || playlist.client === scheduleForm.client)
                    .map((playlist) => ({
                      value: playlist.id,
                      label: playlist.name
                    }))}
                  required
                />
                <TextField
                  label="Etykieta"
                  value={scheduleForm.label}
                  onChange={(value) => setScheduleForm((current) => ({ ...current, label: value }))}
                  placeholder="Weekday morning loop"
                  required
                />
                <TextField
                  label="Start daty"
                  value={scheduleForm.startDate}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, startDate: value }))
                  }
                  type="date"
                />
                <TextField
                  label="Koniec daty"
                  value={scheduleForm.endDate}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, endDate: value }))
                  }
                  type="date"
                />
                <TextField
                  label="Start godziny"
                  value={scheduleForm.startTime}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, startTime: value }))
                  }
                  type="time"
                  required
                />
                <TextField
                  label="Koniec godziny"
                  value={scheduleForm.endTime}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, endTime: value }))
                  }
                  type="time"
                  required
                />
                <TextField
                  label="Dni tygodnia"
                  value={scheduleForm.daysOfWeek}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, daysOfWeek: value }))
                  }
                  placeholder="1,2,3,4,5"
                  required
                />
                <TextField
                  label="Priorytet"
                  value={scheduleForm.priority}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, priority: value }))
                  }
                  type="number"
                  required
                />
                <ToggleField
                  label="Aktywna"
                  checked={scheduleForm.isActive}
                  onChange={(value) =>
                    setScheduleForm((current) => ({ ...current, isActive: value }))
                  }
                />
                <button className="primary-button" type="submit">
                  Dodaj regułę
                </button>
              </form>
            </Panel>

            <Panel title="Reguły harmonogramu" subtitle="Najwyższy priorytet wygrywa na danym kanale">
              <div className="list-stack">
                {dashboard.schedules.map((schedule) => (
                  <RecordRow
                    key={schedule.id}
                    title={schedule.label}
                    subtitle={`${schedule.expand?.channel?.name || "Brak kanału"} • ${
                      schedule.expand?.playlist?.name || "Brak playlisty"
                    }`}
                    meta={`${schedule.daysOfWeek || "all days"} • ${schedule.startTime} → ${schedule.endTime}`}
                    badge={<PriorityBadge value={schedule.priority} />}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("schedule_rules", schedule.id, schedule.label)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.schedules.length ? <EmptyState text="Brak reguł schedulingowych." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "events" ? (
          <section className="section-grid">
            <Panel title="Nowy event override" subtitle="Na przykład pilny komunikat, specjalna emisja lub takeover">
              <form className="form-grid" onSubmit={handleCreateEvent}>
                <SelectField
                  label="Klient"
                  value={eventForm.client}
                  onChange={(value) => setEventForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required
                />
                <SelectField
                  label="Kanał"
                  value={eventForm.channel}
                  onChange={(value) => setEventForm((current) => ({ ...current, channel: value }))}
                  options={[
                    { value: "", label: "Wszystkie kanały klienta" },
                    ...dashboard.channels
                      .filter((channel) => !eventForm.client || channel.client === eventForm.client)
                      .map((channel) => ({
                        value: channel.id,
                        label: channel.name
                      }))
                  ]}
                />
                <SelectField
                  label="Ekran"
                  value={eventForm.screen}
                  onChange={(value) => setEventForm((current) => ({ ...current, screen: value }))}
                  options={[
                    { value: "", label: "Wszystkie ekrany z kanału" },
                    ...dashboard.screens
                      .filter((screen) => !eventForm.client || screen.client === eventForm.client)
                      .map((screen) => ({
                        value: screen.id,
                        label: screen.locationLabel || screen.name
                      }))
                  ]}
                />
                <SelectField
                  label="Playlista override"
                  value={eventForm.playlist}
                  onChange={(value) => setEventForm((current) => ({ ...current, playlist: value }))}
                  options={dashboard.playlists
                    .filter((playlist) => !eventForm.client || playlist.client === eventForm.client)
                    .map((playlist) => ({
                      value: playlist.id,
                      label: playlist.name
                    }))}
                  required
                />
                <TextField
                  label="Tytuł eventu"
                  value={eventForm.title}
                  onChange={(value) => setEventForm((current) => ({ ...current, title: value }))}
                  placeholder="Weekend sale"
                  required
                />
                <TextAreaField
                  label="Opis"
                  value={eventForm.message}
                  onChange={(value) => setEventForm((current) => ({ ...current, message: value }))}
                  placeholder="Podmienia standardowy loop na kampanię specjalną."
                />
                <TextField
                  label="Start"
                  value={eventForm.startsAt}
                  onChange={(value) => setEventForm((current) => ({ ...current, startsAt: value }))}
                  type="datetime-local"
                  required
                />
                <TextField
                  label="Koniec"
                  value={eventForm.endsAt}
                  onChange={(value) => setEventForm((current) => ({ ...current, endsAt: value }))}
                  type="datetime-local"
                  required
                />
                <TextField
                  label="Priorytet"
                  value={eventForm.priority}
                  onChange={(value) =>
                    setEventForm((current) => ({ ...current, priority: value }))
                  }
                  type="number"
                  required
                />
                <ToggleField
                  label="Aktywny"
                  checked={eventForm.isActive}
                  onChange={(value) => setEventForm((current) => ({ ...current, isActive: value }))}
                />
                <button className="primary-button" type="submit">
                  Dodaj event
                </button>
              </form>
            </Panel>

            <Panel title="Eventy" subtitle="Reakcje natychmiastowe i przejęcia kanałów">
              <div className="list-stack">
                {dashboard.events.map((event) => (
                  <RecordRow
                    key={event.id}
                    title={event.title}
                    subtitle={`${event.expand?.playlist?.name || "Brak playlisty"} • ${
                      event.expand?.channel?.name || "Kanał globalny"
                    }`}
                    meta={`${formatDateTime(event.startsAt)} → ${formatDateTime(event.endsAt)}`}
                    badge={<PriorityBadge value={event.priority} />}
                    action={
                      <button
                        className="danger-button"
                        onClick={() => handleDelete("events", event.id, event.title)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.events.length ? <EmptyState text="Nie skonfigurowano żadnych eventów." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {!canSeeAllClients ? (
          <footer className="scope-note">
            Widok jest zawężony do klienta: <strong>{authRecord?.expand?.client?.name || authRecord?.client}</strong>
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function scopeDashboard(data: DashboardData, authRecord: CmsUserRecord | null): DashboardData {
  if (!authRecord?.client || authRecord.role === "owner") {
    return data;
  }

  const clientId = authRecord.client;

  return {
    clients: data.clients.filter((client) => client.id === clientId),
    channels: data.channels.filter((channel) => channel.client === clientId),
    screens: data.screens.filter((screen) => screen.client === clientId),
    mediaAssets: data.mediaAssets.filter((asset) => asset.client === clientId),
    playlists: data.playlists.filter((playlist) => playlist.client === clientId),
    playlistItems: data.playlistItems.filter((item) => item.client === clientId),
    schedules: data.schedules.filter((schedule) => schedule.client === clientId),
    events: data.events.filter((event) => event.client === clientId)
  };
}

function FlashBanner({ flash }: { flash: FlashMessage }) {
  return <div className={flash.kind === "success" ? "flash success" : "flash error"}>{flash.text}</div>;
}

function Panel(props: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-badge">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecordRow(props: {
  title: string;
  subtitle: string;
  meta: string;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <article className="record-row">
      <div className="record-row-main">
        <div className="record-row-top">
          <h3>{props.title}</h3>
          {props.badge}
        </div>
        <p>{props.subtitle}</p>
        <small>{props.meta}</small>
      </div>
      {props.action}
    </article>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type || "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        required={props.required}
      />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field field-full">
      <span>{props.label}</span>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={4}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)} required={props.required}>
        {!props.required ? null : <option value="">Wybierz…</option>}
        {props.options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function StatusBadge({ status }: { status: "online" | "offline" | "maintenance" }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

function PriorityBadge({ value }: { value: number }) {
  return <span className="priority-badge">prio {value}</span>;
}

function getProtectedFileUrl(record: MediaAssetRecord, token: string) {
  return pb.files.getURL(record, record.asset, token ? { token } : {});
}

function statusFromHeartbeat(screen: ScreenUserRecord): "online" | "offline" | "maintenance" {
  if (screen.status === "maintenance") {
    return "maintenance";
  }

  return isOnline(screen.lastSeenAt) ? "online" : "offline";
}

function isOnline(lastSeenAt: string) {
  if (!lastSeenAt) {
    return false;
  }

  const diff = Date.now() - new Date(lastSeenAt).getTime();
  return diff <= 5 * 60 * 1000;
}

function isScheduledToday(daysOfWeek: string) {
  if (!daysOfWeek) {
    return true;
  }

  const day = new Date().getDay();
  return daysOfWeek
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => !Number.isNaN(value))
    .includes(day);
}

function isCurrentEvent(startsAt: string, endsAt: string) {
  const now = Date.now();
  const start = startsAt ? new Date(startsAt).getTime() : now;
  const end = endsAt ? new Date(endsAt).getTime() : now;
  return now >= start && now <= end;
}

function toIsoDate(value: string) {
  if (!value) {
    return "";
  }

  return new Date(`${value}T00:00:00`).toISOString();
}

function toIsoDateTime(value: string) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString();
}

function formatDateTime(value: string) {
  if (!value) {
    return "brak daty";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatHeartbeat(value: string) {
  if (!value) {
    return "";
  }

  return new Intl.RelativeTimeFormat("pl", { numeric: "auto" }).format(
    Math.round((new Date(value).getTime() - Date.now()) / 60000),
    "minute"
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stripExtension(name: string) {
  return name.replace(/\.[^/.]+$/, "");
}

function compactRecord<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

async function readVideoDuration(file: File) {
  return new Promise<number>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

function readError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function showFlash(setter: (value: FlashMessage | null) => void, flash: FlashMessage) {
  setter(flash);
  window.clearTimeout((showFlash as { timer?: number }).timer);
  (showFlash as { timer?: number }).timer = window.setTimeout(() => setter(null), 4200);
}

export default App;
