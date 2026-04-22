import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPocketBaseClient, pocketbaseUrl } from "./lib/pocketbase";
import type {
  ChannelRecord,
  ClientRecord,
  CmsUserRecord,
  DashboardData,
  DeviceCommandRecord,
  DevicePairingRecord,
  EventRecord,
  MediaAssetRecord,
  PlaylistItemRecord,
  PlaylistRecord,
  ScheduleRuleRecord,
  ScreenUserRecord
} from "./types";

const pb = createPocketBaseClient();

type SectionKey =
  | "overview"
  | "clients"
  | "channels"
  | "users"
  | "screens"
  | "media"
  | "playlists"
  | "schedule"
  | "events"
  | "app";

type FlashMessage = {
  kind: "success" | "error";
  text: string;
};

const emptyDashboard: DashboardData = {
  clients: [],
  channels: [],
  cmsUsers: [],
  screens: [],
  devicePairings: [],
  deviceCommands: [],
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
  { key: "users", label: "Użytkownicy", hint: "konta do CMS" },
  { key: "screens", label: "Urządzenia", hint: "pairing, screenshoty, komendy" },
  { key: "media", label: "Media", hint: "wideo i assety" },
  { key: "playlists", label: "Playlisty", hint: "kolejność emisji" },
  { key: "schedule", label: "Scheduling", hint: "czas emisji" },
  { key: "events", label: "Eventy", hint: "awaryjne override" },
  { key: "app", label: "Instalacja", hint: "APK i onboarding Android TV" }
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

const defaultCmsUserForm = {
  email: "",
  password: "",
  name: "",
  role: "manager",
  client: ""
};

const defaultPairingForm = {
  pairingCode: "",
  name: "",
  client: "",
  channel: "",
  locationLabel: "",
  volumePercent: "80",
  notes: ""
};

const defaultDeviceProfileForm = {
  screen: "",
  volumePercent: "80",
  desiredDisplayState: "active",
  networkMode: "dhcp",
  networkAddress: "",
  networkGateway: "",
  networkDns: "",
  wifiSsid: "",
  networkNotes: "",
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
  const [apkAvailable, setApkAvailable] = useState<boolean | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [clientForm, setClientForm] = useState(defaultClientForm);
  const [channelForm, setChannelForm] = useState(defaultChannelForm);
  const [cmsUserForm, setCmsUserForm] = useState(defaultCmsUserForm);
  const [pairingForm, setPairingForm] = useState(defaultPairingForm);
  const [selectedScreenId, setSelectedScreenId] = useState<string>("");
  const [deviceProfileForm, setDeviceProfileForm] = useState(defaultDeviceProfileForm);
  const [mediaForm, setMediaForm] = useState(defaultMediaForm);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [playlistForm, setPlaylistForm] = useState(defaultPlaylistForm);
  const [playlistItemForm, setPlaylistItemForm] = useState(defaultPlaylistItemForm);
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);
  const [eventForm, setEventForm] = useState(defaultEventForm);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(pb.authStore.isValid);

  useEffect(() => {
    return pb.authStore.onChange(() => {
      setAuthRecord((pb.authStore.record as CmsUserRecord | null) ?? null);
    });
  }, []);

  useEffect(() => {
    if (!pb.authStore.isValid) {
      setDashboard(emptyDashboard);
      setFileToken("");
      setHasLoadedOnce(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let poller = 0;

    const load = async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent && !hasLoadedOnce) {
        setIsLoading(true);
      }

      try {
        const [
          token,
          clients,
          channels,
          cmsUsers,
          screens,
          devicePairings,
          deviceCommands,
          mediaAssets,
          playlists,
          playlistItems,
          schedules,
          events
        ] = await Promise.all([
          safeGetFileToken(),
          safeGetFullList<ClientRecord>("clients", { sort: "name" }),
          safeGetFullList<ChannelRecord>("channels", {
            sort: "name"
          }),
          safeGetFullList<CmsUserRecord>("cms_users", {
            sort: "name"
          }),
          safeGetFullList<ScreenUserRecord>("screen_users"),
          safeGetFullList<DevicePairingRecord>("device_pairings"),
          safeGetFullList<DeviceCommandRecord>("device_commands"),
          safeGetFullList<MediaAssetRecord>("media_assets"),
          safeGetFullList<PlaylistRecord>("playlists", {
            sort: "name"
          }),
          safeGetFullList<PlaylistItemRecord>("playlist_items", {
            sort: "playlist,sortOrder"
          }),
          safeGetFullList<ScheduleRuleRecord>("schedule_rules", {
            sort: "-priority,label"
          }),
          safeGetFullList<EventRecord>("events", {
            sort: "-priority,-startsAt"
          })
        ]);

        if (cancelled) {
          return;
        }

        setFileToken(token);
        setDashboard(
          hydrateDashboardRelations(
            scopeDashboard(
              {
                clients,
                channels,
                cmsUsers,
                screens,
                devicePairings,
                deviceCommands,
                mediaAssets,
                playlists,
                playlistItems,
                schedules,
                events
              },
              authRecord
            )
          )
        );
      } catch (error) {
        showFlash(setFlash, {
          kind: "error",
          text: readError(error, "Nie udało się pobrać danych z PocketBase.")
        });
      } finally {
        if (!cancelled) {
          setHasLoadedOnce(true);
          setIsLoading(false);
        }
      }
    };

    void load();
    poller = window.setInterval(() => {
      void load({ silent: true });
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [authRecord?.id, authRecord?.client, authRecord?.role, hasLoadedOnce, refreshNonce]);

  useEffect(() => {
    if (!dashboard.screens.length) {
      setSelectedScreenId("");
      setDeviceProfileForm(defaultDeviceProfileForm);
      return;
    }

    setSelectedScreenId((current) => {
      if (current && dashboard.screens.some((screen) => screen.id === current)) {
        return current;
      }

      return dashboard.screens[0].id;
    });
  }, [dashboard.screens]);

  useEffect(() => {
    const screen = dashboard.screens.find((entry) => entry.id === selectedScreenId);
    if (!screen) {
      return;
    }

    setDeviceProfileForm(toDeviceProfileForm(screen));
  }, [selectedScreenId, dashboard.screens]);

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

  const waitingPairings = useMemo(
    () => dashboard.devicePairings.filter((entry) => entry.status === "waiting").length,
    [dashboard.devicePairings]
  );

  const recentCommands = useMemo(() => dashboard.deviceCommands.slice(0, 10), [dashboard.deviceCommands]);

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

  const selectedScreen = useMemo(
    () => dashboard.screens.find((screen) => screen.id === selectedScreenId) ?? null,
    [dashboard.screens, selectedScreenId]
  );

  const canSeeAllClients = authRecord?.role === "owner" || !authRecord?.client;
  const canManageUsers = authRecord?.role === "owner" || authRecord?.role === "manager";
  const installUrl =
    typeof window === "undefined"
      ? "https://cms.berry-secure.pl/app/maasck.apk"
      : new URL("/app/maasck.apk", window.location.origin).toString();

  function triggerRefresh() {
    setRefreshNonce((current) => current + 1);
  }

  useEffect(() => {
    if (!pb.authStore.isValid || typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const checkApk = async () => {
      try {
        const response = await fetch(installUrl, {
          method: "HEAD",
          cache: "no-store"
        });

        if (!cancelled) {
          setApkAvailable(response.ok);
        }
      } catch {
        if (!cancelled) {
          setApkAvailable(false);
        }
      }
    };

    void checkApk();

    return () => {
      cancelled = true;
    };
  }, [installUrl, authRecord?.id]);

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
      triggerRefresh();
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
      triggerRefresh();
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

  async function handleCreateCmsUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManageUsers) {
      showFlash(setFlash, {
        kind: "error",
        text: "Twoja rola nie może tworzyć nowych kont CMS."
      });
      return;
    }

    if (authRecord?.role !== "owner" && cmsUserForm.role === "owner") {
      showFlash(setFlash, {
        kind: "error",
        text: "Tylko owner może tworzyć kolejnego ownera."
      });
      return;
    }

    const clientId = cmsUserForm.client || authRecord?.client || "";
    if (cmsUserForm.role !== "owner" && !clientId) {
      showFlash(setFlash, {
        kind: "error",
        text: "Manager i editor muszą być przypięci do klienta."
      });
      return;
    }

    try {
      await pb.collection("cms_users").create(
        compactRecord({
          email: cmsUserForm.email.trim(),
          password: cmsUserForm.password,
          passwordConfirm: cmsUserForm.password,
          name: cmsUserForm.name,
          role: cmsUserForm.role,
          client: cmsUserForm.role === "owner" ? undefined : clientId
        })
      );

      setCmsUserForm(defaultCmsUserForm);
      triggerRefresh();
      showFlash(setFlash, {
        kind: "success",
        text: "Nowe konto CMS zostało utworzone."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się utworzyć użytkownika CMS.")
      });
    }
  }

  async function handlePairDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const pairingCode = normalizePairingCode(pairingForm.pairingCode);
    const pairing =
      (await findWaitingPairingByCode(pairingCode)) ||
      dashboard.devicePairings.find(
        (entry) => normalizePairingCode(entry.pairingCode) === pairingCode && entry.status === "waiting"
      );

    if (!pairing) {
      showFlash(setFlash, {
        kind: "error",
        text: "Nie znaleziono aktywnego kodu parowania. Sprawdź ekran TV i spróbuj ponownie."
      });
      return;
    }

    const clientId = pairingForm.client || authRecord?.client || "";
    if (!clientId) {
      showFlash(setFlash, {
        kind: "error",
        text: "Wybierz klienta, do którego ma trafić urządzenie."
      });
      return;
    }

    if (!pairingForm.channel) {
      showFlash(setFlash, {
        kind: "error",
        text: "Wybierz kanał, do którego przypniesz urządzenie."
      });
      return;
    }

    const deviceName = pairingForm.name.trim() || pairing.deviceName || `Android TV ${pairingCode}`;
    const locationLabel =
      pairingForm.locationLabel.trim() || pairing.locationLabel || `${deviceName} / nowa instalacja`;
    const email = buildPairingEmail(deviceName, pairingCode);

    try {
      const createdScreen = await pb.collection("screen_users").create({
        email,
        password: pairingCode,
        passwordConfirm: pairingCode,
        name: deviceName,
        client: clientId,
        channel: pairingForm.channel,
        locationLabel,
        volumePercent: Number(pairingForm.volumePercent) || 80,
        status: "pairing",
        notes: pairingForm.notes,
        desiredDisplayState: "active",
        deviceModel: pairing.deviceName,
        appVersion: pairing.appVersion,
        networkMode: "dhcp"
      });

      await pb.collection("device_pairings").update(pairing.id, {
        status: "paired",
        client: clientId,
        channel: pairingForm.channel,
        locationLabel,
        screen: createdScreen.id,
        assignedEmail: email,
        claimedAt: new Date().toISOString()
      });

      setPairingForm(defaultPairingForm);
      setSelectedScreenId(createdScreen.id);
      triggerRefresh();
      showFlash(setFlash, {
        kind: "success",
        text: `Urządzenie sparowane. Player zaloguje się jako ${email}.`
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się sparować urządzenia.")
      });
    }
  }

  async function handleUpdateDeviceProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedScreen) {
      showFlash(setFlash, {
        kind: "error",
        text: "Najpierw wybierz urządzenie do edycji."
      });
      return;
    }

    const nextDisplayState = deviceProfileForm.desiredDisplayState as "active" | "blackout";

    try {
      await pb.collection("screen_users").update(selectedScreen.id, {
        volumePercent: Number(deviceProfileForm.volumePercent) || 80,
        desiredDisplayState: nextDisplayState,
        networkMode: deviceProfileForm.networkMode,
        networkAddress: deviceProfileForm.networkAddress,
        networkGateway: deviceProfileForm.networkGateway,
        networkDns: deviceProfileForm.networkDns,
        wifiSsid: deviceProfileForm.wifiSsid,
        networkNotes: deviceProfileForm.networkNotes,
        notes: deviceProfileForm.notes
      });

      if (selectedScreen.desiredDisplayState !== nextDisplayState) {
        await queueDeviceCommand(
          selectedScreen.id,
          nextDisplayState === "blackout" ? "blackout" : "wake",
          false
        );
      }

      triggerRefresh();
      showFlash(setFlash, {
        kind: "success",
        text: "Profil urządzenia został zaktualizowany."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zaktualizować urządzenia.")
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
      triggerRefresh();
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
      await pb.collection("playlists").create(
        compactRecord({
          client: playlistForm.client,
          channel: playlistForm.channel || undefined,
          name: playlistForm.name,
          isActive: playlistForm.isActive,
          notes: playlistForm.notes
        })
      );
      setPlaylistForm(defaultPlaylistForm);
      triggerRefresh();
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
      triggerRefresh();
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
      await pb.collection("schedule_rules").create(
        compactRecord({
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
        })
      );
      setScheduleForm(defaultScheduleForm);
      triggerRefresh();
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
      await pb.collection("events").create(
        compactRecord({
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
        })
      );
      setEventForm(defaultEventForm);
      triggerRefresh();
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

  async function queueDeviceCommand(
    screenId: string,
    commandType: DeviceCommandRecord["commandType"],
    mirrorDisplayState = true
  ) {
    const payload =
      commandType === "blackout" || commandType === "wake"
        ? JSON.stringify({
            desiredDisplayState: commandType === "blackout" ? "blackout" : "active"
          })
        : "";

    if (mirrorDisplayState) {
      if (commandType === "blackout") {
        await pb.collection("screen_users").update(screenId, {
          desiredDisplayState: "blackout"
        });
      }

      if (commandType === "wake") {
        await pb.collection("screen_users").update(screenId, {
          desiredDisplayState: "active"
        });
      }
    }

    await pb.collection("device_commands").create(
      compactRecord({
        screen: screenId,
        commandType,
        payload,
        status: "queued",
        issuedBy: authRecord?.id || undefined,
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
      })
    );
  }

  async function handleQueueCommand(screen: ScreenUserRecord, commandType: DeviceCommandRecord["commandType"]) {
    try {
      await queueDeviceCommand(screen.id, commandType);
      triggerRefresh();
      showFlash(setFlash, {
        kind: "success",
        text: `Komenda ${commandType} została zakolejkowana dla ${screen.locationLabel || screen.name}.`
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się wysłać komendy do urządzenia.")
      });
    }
  }

  async function handleDelete(collection: string, id: string, label: string) {
    if (collection === "cms_users" && id === authRecord?.id) {
      showFlash(setFlash, {
        kind: "error",
        text: "Nie usuwaj właśnie zalogowanego konta."
      });
      return;
    }

    const confirmed = window.confirm(`Usunąć ${label}?`);
    if (!confirmed) {
      return;
    }

    try {
      await pb.collection(collection).delete(id);
      triggerRefresh();
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

  async function handleCopyInstallUrl() {
    try {
      await navigator.clipboard.writeText(installUrl);
      showFlash(setFlash, {
        kind: "success",
        text: "Link do instalacji został skopiowany do schowka."
      });
    } catch {
      showFlash(setFlash, {
        kind: "error",
        text: "Nie udało się skopiować linku. Skopiuj go ręcznie z panelu."
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
          <h1>DS z CMS-em, parowaniem Android TV i szybką obsługą sieci ekranów.</h1>
          <p>
            Panel loguje się do kolekcji <code>cms_users</code> w PocketBase i po zalogowaniu
            obsługuje klientów, użytkowników CMS, urządzenia, screenshoty, media, playlisty,
            scheduling oraz eventy override.
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
            <MetricBadge label="Pairing queue" value={String(waitingPairings)} />
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
                <StatCard label="Użytkownicy CMS" value={String(dashboard.cmsUsers.length)} />
                <StatCard label="Ekrany online" value={String(onlineScreens)} />
                <StatCard label="Pairing w kolejce" value={String(waitingPairings)} />
                <StatCard label="Biblioteka media" value={String(dashboard.mediaAssets.length)} />
              </div>
            </Panel>

            <Panel title="Nowe urządzenia" subtitle="Kody gotowe do wpisania w sekcji Add New Device">
              <div className="list-stack">
                {dashboard.devicePairings
                  .filter((pairing) => pairing.status === "waiting")
                  .slice(0, 6)
                  .map((pairing) => (
                    <RecordRow
                      key={pairing.id}
                      title={pairing.deviceName}
                      subtitle={`${pairing.platform || "platforma?"} • ${pairing.appVersion || "brak wersji"}`}
                      meta={`kod ${pairing.pairingCode} • wygasa ${formatDateTime(pairing.pairingExpiresAt)}`}
                      badge={<span className="soft-badge">{pairing.status}</span>}
                    />
                  ))}
                {!waitingPairings ? (
                  <EmptyState text="Nie ma urządzeń czekających na sparowanie." />
                ) : null}
              </div>
            </Panel>

            <Panel title="Ostatnie komendy" subtitle="To, co poleciało do Android TV z panelu">
              <div className="list-stack">
                {recentCommands.map((command) => (
                  <RecordRow
                    key={command.id}
                    title={translateCommand(command.commandType)}
                    subtitle={command.expand?.screen?.locationLabel || command.expand?.screen?.name || "Urządzenie"}
                    meta={`${command.status} • ${formatDateTime(command.created)}`}
                    badge={<span className="soft-badge">{command.status}</span>}
                  />
                ))}
                {!recentCommands.length ? (
                  <EmptyState text="Nie ma jeszcze żadnych zdalnych komend." />
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

        {activeSection === "users" ? (
          <section className="section-grid">
            <Panel title="Nowe konto CMS" subtitle="Tworzenie i usuwanie kont operatorów panelu">
              {canManageUsers ? (
                <form className="form-grid" onSubmit={handleCreateCmsUser}>
                  <TextField
                    label="Imię / nazwa"
                    value={cmsUserForm.name}
                    onChange={(value) => setCmsUserForm((current) => ({ ...current, name: value }))}
                    placeholder="Anna Admin"
                    required
                  />
                  <TextField
                    label="Email"
                    value={cmsUserForm.email}
                    onChange={(value) => setCmsUserForm((current) => ({ ...current, email: value }))}
                    type="email"
                    placeholder="anna@berry-secure.pl"
                    required
                  />
                  <TextField
                    label="Hasło"
                    value={cmsUserForm.password}
                    onChange={(value) =>
                      setCmsUserForm((current) => ({ ...current, password: value }))
                    }
                    type="password"
                    placeholder="Mocne hasło"
                    required
                  />
                  <SelectField
                    label="Rola"
                    value={cmsUserForm.role}
                    onChange={(value) =>
                      setCmsUserForm((current) => ({
                        ...current,
                        role: value as "owner" | "manager" | "editor"
                      }))
                    }
                    options={[
                      { value: "manager", label: "Manager" },
                      { value: "editor", label: "Editor" },
                      ...(authRecord?.role === "owner"
                        ? [{ value: "owner", label: "Owner" }]
                        : [])
                    ]}
                    required
                  />
                  <SelectField
                    label="Klient"
                    value={cmsUserForm.client}
                    onChange={(value) => setCmsUserForm((current) => ({ ...current, client: value }))}
                    options={[
                      { value: "", label: "Brak przypięcia / owner globalny" },
                      ...dashboard.clients.map((client) => ({
                        value: client.id,
                        label: client.name
                      }))
                    ]}
                  />
                  <button className="primary-button" type="submit">
                    Dodaj konto CMS
                  </button>
                </form>
              ) : (
                <EmptyState text="Twoja rola może przeglądać użytkowników, ale nie tworzy nowych kont." />
              )}
            </Panel>

            <Panel title="Użytkownicy CMS" subtitle="Kto ma dostęp do panelu i do którego klienta">
              <div className="list-stack">
                {dashboard.cmsUsers.map((user) => (
                  <RecordRow
                    key={user.id}
                    title={user.name || user.email}
                    subtitle={`${user.email} • ${user.role}`}
                    meta={user.expand?.client?.name || "Globalny dostęp"}
                    badge={<span className="soft-badge">{user.role}</span>}
                    action={
                      <button
                        className="danger-button"
                        disabled={user.id === authRecord?.id}
                        onClick={() => handleDelete("cms_users", user.id, user.name || user.email)}
                        type="button"
                      >
                        Usuń
                      </button>
                    }
                  />
                ))}
                {!dashboard.cmsUsers.length ? <EmptyState text="Brak kont CMS do pokazania." /> : null}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeSection === "screens" ? (
          <section className="section-grid">
            <Panel title="Add New Device" subtitle="Wpisz kod z TV, przypnij klienta i kanał">
              <form className="form-grid" onSubmit={handlePairDevice}>
                <TextField
                  label="Kod z telewizora"
                  value={pairingForm.pairingCode}
                  onChange={(value) =>
                    setPairingForm((current) => ({
                      ...current,
                      pairingCode: normalizePairingCode(value)
                    }))
                  }
                  placeholder="A7K4P2"
                  required
                />
                <TextField
                  label="Nazwa urządzenia"
                  value={pairingForm.name}
                  onChange={(value) => setPairingForm((current) => ({ ...current, name: value }))}
                  placeholder="Android TV Lobby"
                />
                <SelectField
                  label="Klient"
                  value={pairingForm.client}
                  onChange={(value) => setPairingForm((current) => ({ ...current, client: value }))}
                  options={dashboard.clients.map((client) => ({
                    value: client.id,
                    label: client.name
                  }))}
                  required={!authRecord?.client}
                />
                <SelectField
                  label="Kanał"
                  value={pairingForm.channel}
                  onChange={(value) => setPairingForm((current) => ({ ...current, channel: value }))}
                  options={dashboard.channels
                    .filter((channel) => {
                      const clientId = pairingForm.client || authRecord?.client;
                      return !clientId || channel.client === clientId;
                    })
                    .map((channel) => ({
                      value: channel.id,
                      label: channel.name
                    }))}
                  required
                />
                <TextField
                  label="Lokalizacja"
                  value={pairingForm.locationLabel}
                  onChange={(value) =>
                    setPairingForm((current) => ({ ...current, locationLabel: value }))
                  }
                  placeholder="Warszawa / recepcja"
                />
                <TextField
                  label="Głośność %"
                  value={pairingForm.volumePercent}
                  onChange={(value) =>
                    setPairingForm((current) => ({ ...current, volumePercent: value }))
                  }
                  type="number"
                  required
                />
                <TextAreaField
                  label="Notatki do urządzenia"
                  value={pairingForm.notes}
                  onChange={(value) => setPairingForm((current) => ({ ...current, notes: value }))}
                  placeholder="Samsung Android TV, zasilanie z UPS, kiosk mode."
                />
                <button className="primary-button" type="submit">
                  Sparuj urządzenie
                </button>
              </form>
            </Panel>

            <Panel title="Kod oczekujące" subtitle="Świeże instalacje, które wyświetlają kod na TV">
              <div className="list-stack">
                {dashboard.devicePairings
                  .filter((pairing) => pairing.status === "waiting")
                  .map((pairing) => (
                    <RecordRow
                      key={pairing.id}
                      title={pairing.deviceName}
                      subtitle={`${pairing.platform || "platforma?"} • ${pairing.appVersion || "brak wersji"}`}
                      meta={`kod ${pairing.pairingCode} • ostatni heartbeat ${formatHeartbeat(pairing.lastSeenAt) || "brak"}`}
                      badge={<span className="soft-badge">waiting</span>}
                    />
                  ))}
                {!waitingPairings ? <EmptyState text="Brak kodów czekających na przypięcie." /> : null}
              </div>
            </Panel>

            <Panel title="Profil urządzenia" subtitle="Zdalny blackout, sieć i parametry wybranego ekranu">
              {selectedScreen ? (
                <form className="form-grid" onSubmit={handleUpdateDeviceProfile}>
                  <SelectField
                    label="Urządzenie"
                    value={selectedScreenId}
                    onChange={setSelectedScreenId}
                    options={dashboard.screens.map((screen) => ({
                      value: screen.id,
                      label: `${screen.locationLabel || screen.name} • ${screen.expand?.channel?.name || "bez kanału"}`
                    }))}
                    required
                  />
                  <TextField
                    label="Głośność %"
                    value={deviceProfileForm.volumePercent}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, volumePercent: value }))
                    }
                    type="number"
                    required
                  />
                  <SelectField
                    label="Tryb ekranu"
                    value={deviceProfileForm.desiredDisplayState}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({
                        ...current,
                        desiredDisplayState: value
                      }))
                    }
                    options={[
                      { value: "active", label: "Aktywny" },
                      { value: "blackout", label: "Czarny ekran / blackout" }
                    ]}
                    required
                  />
                  <SelectField
                    label="Tryb sieci"
                    value={deviceProfileForm.networkMode}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, networkMode: value }))
                    }
                    options={[
                      { value: "dhcp", label: "DHCP / automatyczny" },
                      { value: "manual", label: "Manual / statyczny" }
                    ]}
                    required
                  />
                  <TextField
                    label="Adres IP"
                    value={deviceProfileForm.networkAddress}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, networkAddress: value }))
                    }
                    placeholder="192.168.1.120"
                  />
                  <TextField
                    label="Gateway"
                    value={deviceProfileForm.networkGateway}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, networkGateway: value }))
                    }
                    placeholder="192.168.1.1"
                  />
                  <TextField
                    label="DNS"
                    value={deviceProfileForm.networkDns}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, networkDns: value }))
                    }
                    placeholder="1.1.1.1,8.8.8.8"
                  />
                  <TextField
                    label="Wi-Fi SSID"
                    value={deviceProfileForm.wifiSsid}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, wifiSsid: value }))
                    }
                    placeholder="Berry-Secure-Guest"
                  />
                  <TextAreaField
                    label="Notatki sieciowe"
                    value={deviceProfileForm.networkNotes}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, networkNotes: value }))
                    }
                    placeholder="Na stock Android TV te dane traktuj jako profil operacyjny. Bez uprawnień MDM aplikacja nie zmieni ich po cichu."
                  />
                  <TextAreaField
                    label="Notatki urządzenia"
                    value={deviceProfileForm.notes}
                    onChange={(value) =>
                      setDeviceProfileForm((current) => ({ ...current, notes: value }))
                    }
                    placeholder="Pilot w szufladzie recepcji, ekran 55 cali."
                  />
                  <button className="primary-button" type="submit">
                    Zapisz profil
                  </button>
                </form>
              ) : (
                <EmptyState text="Nie masz jeszcze żadnego urządzenia do edycji." />
              )}
            </Panel>

            <Panel title="Urządzenia i screenshoty" subtitle="Status online/offline, podgląd ostatniej klatki i zdalne akcje">
              <div className="device-grid">
                {dashboard.screens.map((screen) => (
                  <article className="device-card" key={screen.id}>
                    <div className="device-screenshot">
                      {screen.lastScreenshot ? (
                        <img
                          alt={`Screenshot ${screen.locationLabel || screen.name}`}
                          src={getProtectedFileUrl(screen, screen.lastScreenshot, fileToken)}
                        />
                      ) : (
                        <div className="device-placeholder">
                          <span className="eyebrow">no screenshot</span>
                          <strong>{screen.locationLabel || screen.name}</strong>
                          <small>Player jeszcze nie wysłał podglądu.</small>
                        </div>
                      )}
                    </div>

                    <div className="device-copy">
                      <div className="device-head">
                        <div>
                          <h3>{screen.locationLabel || screen.name}</h3>
                          <p>
                            {screen.expand?.client?.name || "Brak klienta"} •{" "}
                            {screen.expand?.channel?.name || "Brak kanału"}
                          </p>
                        </div>
                        <StatusBadge status={statusFromHeartbeat(screen)} />
                      </div>

                      <div className="device-meta">
                        <span>{screen.email}</span>
                        <span>IP: {screen.lastIpAddress || "brak"}</span>
                        <span>
                          screenshot {screen.lastScreenshotAt ? formatHeartbeat(screen.lastScreenshotAt) : "brak"}
                        </span>
                        <span>
                          heartbeat {screen.lastSeenAt ? formatHeartbeat(screen.lastSeenAt) : "brak"}
                        </span>
                      </div>

                      <div className="device-command-row">
                        <button
                          className="ghost-button"
                          onClick={() => void handleQueueCommand(screen, "sync")}
                          type="button"
                        >
                          Sync
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => void handleQueueCommand(screen, "capture_screenshot")}
                          type="button"
                        >
                          Screenshot
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            void handleQueueCommand(
                              screen,
                              screen.desiredDisplayState === "blackout" ? "wake" : "blackout"
                            )
                          }
                          type="button"
                        >
                          {screen.desiredDisplayState === "blackout" ? "Włącz ekran" : "Wyłącz ekran"}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => void handleQueueCommand(screen, "restart_app")}
                          type="button"
                        >
                          Restart appki
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => handleDelete("screen_users", screen.id, screen.name)}
                          type="button"
                        >
                          Usuń
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {!dashboard.screens.length ? <EmptyState text="Nie ma jeszcze żadnych urządzeń." /> : null}
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
                          src={getProtectedFileUrl(asset, asset.asset, fileToken)}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img alt={asset.title} src={getProtectedFileUrl(asset, asset.asset, fileToken)} />
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
                  placeholder="Loop na wejście główne i ekran sprzedażowy."
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

        {activeSection === "app" ? (
          <section className="section-grid">
            <Panel title="Instalacja Android TV" subtitle="Link do APK i prosty onboarding dla operatora">
              <div className="install-grid">
                <article className="mini-card install-card">
                  <span className="eyebrow">download</span>
                  <h3>Publiczny link do APK</h3>
                  <p className="helper-copy">{installUrl}</p>
                  <p>{apkAvailable ? "Plik APK jest już opublikowany." : "Plik APK nie jest jeszcze opublikowany."}</p>
                  <button className="primary-button" onClick={() => void handleCopyInstallUrl()} type="button">
                    Skopiuj link
                  </button>
                </article>

                <article className="mini-card install-card">
                  <span className="eyebrow">krok 1</span>
                  <h3>Na TV otwórz link</h3>
                  <p>
                    Wpisz w przeglądarce TV dokładnie: <code>{installUrl}</code>
                  </p>
                </article>

                <article className="mini-card install-card">
                  <span className="eyebrow">krok 2</span>
                  <h3>Player pokaże kod</h3>
                  <p>
                    Po pierwszym uruchomieniu apka wyświetli duży kod parowania. Wpisujesz go potem
                    w sekcji <strong>Add New Device</strong>.
                  </p>
                </article>

                <article className="mini-card install-card">
                  <span className="eyebrow">krok 3</span>
                  <h3>CMS przypina urządzenie</h3>
                  <p>
                    Po sparowaniu TV samo zaloguje się do <code>screen_users</code> i zacznie
                    raportować status, screenshoty i heartbeat.
                  </p>
                </article>
              </div>
            </Panel>

            <Panel title="Ostatnie komendy i wdrożenia" subtitle="Szybki podgląd zdalnego sterowania urządzeniami">
              <div className="list-stack">
                {recentCommands.map((command) => (
                  <RecordRow
                    key={command.id}
                    title={translateCommand(command.commandType)}
                    subtitle={command.expand?.screen?.locationLabel || command.expand?.screen?.name || "Urządzenie"}
                    meta={`${command.status} • ${formatDateTime(command.created)}${
                      command.resultMessage ? ` • ${command.resultMessage}` : ""
                    }`}
                    badge={<span className="soft-badge">{command.status}</span>}
                  />
                ))}
                {!recentCommands.length ? (
                  <EmptyState text="Po pierwszych akcjach z CMS zobaczysz tu historię komend." />
                ) : null}
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
  const screens = data.screens.filter((screen) => screen.client === clientId);
  const screenIds = new Set(screens.map((screen) => screen.id));

  return {
    clients: data.clients.filter((client) => client.id === clientId),
    channels: data.channels.filter((channel) => channel.client === clientId),
    cmsUsers: data.cmsUsers.filter(
      (user) => user.id === authRecord.id || !user.client || user.client === clientId
    ),
    screens,
    devicePairings: data.devicePairings.filter(
      (pairing) => !pairing.client || pairing.client === clientId || screenIds.has(pairing.screen)
    ),
    deviceCommands: data.deviceCommands.filter((command) => screenIds.has(command.screen)),
    mediaAssets: data.mediaAssets.filter((asset) => asset.client === clientId),
    playlists: data.playlists.filter((playlist) => playlist.client === clientId),
    playlistItems: data.playlistItems.filter((item) => item.client === clientId),
    schedules: data.schedules.filter((schedule) => schedule.client === clientId),
    events: data.events.filter((event) => event.client === clientId)
  };
}

function hydrateDashboardRelations(data: DashboardData): DashboardData {
  const clients = data.clients.map((client) => ({
    ...client
  }));
  const clientsById = new Map(clients.map((client) => [client.id, client]));

  const channels = data.channels.map((channel) => ({
    ...channel,
    expand: {
      ...channel.expand,
      client: clientsById.get(channel.client)
    }
  }));
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  const cmsUsers = data.cmsUsers.map((user) => ({
    ...user,
    expand: {
      ...user.expand,
      client: clientsById.get(user.client)
    }
  }));
  const cmsUsersById = new Map(cmsUsers.map((user) => [user.id, user]));

  const screens = data.screens.map((screen) => ({
    ...screen,
    expand: {
      ...screen.expand,
      client: clientsById.get(screen.client),
      channel: channelsById.get(screen.channel)
    }
  }));
  const screensById = new Map(screens.map((screen) => [screen.id, screen]));

  const devicePairings = data.devicePairings.map((pairing) => ({
    ...pairing,
    expand: {
      ...pairing.expand,
      client: clientsById.get(pairing.client),
      channel: channelsById.get(pairing.channel),
      screen: screensById.get(pairing.screen)
    }
  }));

  const deviceCommands = data.deviceCommands.map((command) => ({
    ...command,
    expand: {
      ...command.expand,
      screen: screensById.get(command.screen),
      issuedBy: cmsUsersById.get(command.issuedBy)
    }
  }));

  const mediaAssets = data.mediaAssets.map((asset) => ({
    ...asset,
    expand: {
      ...asset.expand,
      client: clientsById.get(asset.client)
    }
  }));
  const mediaAssetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]));

  const playlists = data.playlists.map((playlist) => ({
    ...playlist,
    expand: {
      ...playlist.expand,
      client: clientsById.get(playlist.client),
      channel: channelsById.get(playlist.channel)
    }
  }));
  const playlistsById = new Map(playlists.map((playlist) => [playlist.id, playlist]));

  const playlistItems = data.playlistItems.map((item) => ({
    ...item,
    expand: {
      ...item.expand,
      playlist: playlistsById.get(item.playlist),
      mediaAsset: mediaAssetsById.get(item.mediaAsset)
    }
  }));

  const schedules = data.schedules.map((schedule) => ({
    ...schedule,
    expand: {
      ...schedule.expand,
      client: clientsById.get(schedule.client),
      channel: channelsById.get(schedule.channel),
      playlist: playlistsById.get(schedule.playlist)
    }
  }));

  const events = data.events.map((event) => ({
    ...event,
    expand: {
      ...event.expand,
      client: clientsById.get(event.client),
      channel: channelsById.get(event.channel),
      screen: screensById.get(event.screen),
      playlist: playlistsById.get(event.playlist)
    }
  }));

  return {
    clients: [...clients].sort((left, right) => compareText(left.name, right.name)),
    channels: [...channels].sort((left, right) => compareText(left.name, right.name)),
    cmsUsers: [...cmsUsers].sort((left, right) =>
      compareText(left.name || left.email, right.name || right.email)
    ),
    screens: [...screens].sort(
      (left, right) =>
        compareDateDesc(left.lastSeenAt, right.lastSeenAt) ||
        compareText(left.locationLabel || left.name, right.locationLabel || right.name)
    ),
    devicePairings: [...devicePairings].sort(
      (left, right) =>
        compareDateDesc(left.lastSeenAt, right.lastSeenAt) ||
        compareText(left.pairingCode, right.pairingCode)
    ),
    deviceCommands: [...deviceCommands].sort(
      (left, right) =>
        compareDateDesc(left.processedAt || left.expiresAt, right.processedAt || right.expiresAt) ||
        compareText(left.commandType, right.commandType)
    ),
    mediaAssets: [...mediaAssets].sort((left, right) => compareText(left.title, right.title)),
    playlists: [...playlists].sort((left, right) => compareText(left.name, right.name)),
    playlistItems: [...playlistItems].sort((left, right) => left.sortOrder - right.sortOrder),
    schedules: [...schedules].sort((left, right) => right.priority - left.priority),
    events: [...events].sort(
      (left, right) =>
        right.priority - left.priority || compareDateDesc(left.startsAt, right.startsAt)
    )
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

function StatusBadge({
  status
}: {
  status: "pairing" | "online" | "offline" | "maintenance";
}) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}

function PriorityBadge({ value }: { value: number }) {
  return <span className="priority-badge">prio {value}</span>;
}

function toDeviceProfileForm(screen: ScreenUserRecord) {
  return {
    screen: screen.id,
    volumePercent: String(screen.volumePercent || 80),
    desiredDisplayState: screen.desiredDisplayState || "active",
    networkMode: screen.networkMode || "dhcp",
    networkAddress: screen.networkAddress || "",
    networkGateway: screen.networkGateway || "",
    networkDns: screen.networkDns || "",
    wifiSsid: screen.wifiSsid || "",
    networkNotes: screen.networkNotes || "",
    notes: screen.notes || ""
  };
}

function getProtectedFileUrl(record: object, fileName: string, token: string) {
  if (!fileName) {
    return "";
  }

  return pb.files.getURL(record as never, fileName, token ? { token } : {});
}

function statusFromHeartbeat(
  screen: ScreenUserRecord
): "pairing" | "online" | "offline" | "maintenance" {
  if (screen.status === "maintenance") {
    return "maintenance";
  }

  if (screen.status === "pairing" && !screen.lastSeenAt) {
    return "pairing";
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

function buildPairingEmail(deviceName: string, pairingCode: string) {
  const base = slugify(deviceName) || "android-tv";
  return `screen-${base}-${pairingCode.toLowerCase()}@pair.signaldeck.local`;
}

function normalizePairingCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function translateCommand(commandType: DeviceCommandRecord["commandType"]) {
  switch (commandType) {
    case "sync":
      return "Wymuś synchronizację";
    case "capture_screenshot":
      return "Pobierz screenshot";
    case "blackout":
      return "Wyłącz ekran aplikacji";
    case "wake":
      return "Włącz ekran aplikacji";
    case "restart_app":
      return "Restart appki";
    default:
      return commandType;
  }
}

function compareText(left: string, right: string) {
  return String(left || "").localeCompare(String(right || ""), "pl", {
    sensitivity: "base",
    numeric: true
  });
}

function compareDateDesc(left: string, right: string) {
  const leftValue = left ? new Date(left).getTime() : 0;
  const rightValue = right ? new Date(right).getTime() : 0;
  return rightValue - leftValue;
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
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
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

async function safeGetFileToken() {
  try {
    return await pb.files.getToken();
  } catch (error) {
    logCmsError("files.getToken", error);
    return "";
  }
}

async function safeGetFullList<T>(
  collectionName: string,
  options?: Parameters<typeof pb.collection>[0] extends never ? never : Record<string, unknown>
) {
  try {
    return await pb.collection(collectionName).getFullList<T>(options);
  } catch (error) {
    logCmsError(`getFullList:${collectionName}`, error);
    return [] as T[];
  }
}

async function findWaitingPairingByCode(pairingCode: string) {
  if (!pairingCode) {
    return null;
  }

  try {
    return await pb
      .collection("device_pairings")
      .getFirstListItem<DevicePairingRecord>(
        `pairingCode="${escapeFilterValue(pairingCode)}" && status="waiting"`
      );
  } catch (error) {
    logCmsError(`findWaitingPairingByCode:${pairingCode}`, error);
    return null;
  }
}

function logCmsError(context: string, error: unknown) {
  console.error(`[Signal Deck CMS] ${context}`);
  console.error(error);
}

function escapeFilterValue(value: string) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function readError(error: unknown, fallback: string) {
  const responseMessage =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { message?: string } }).response?.message
      : "";

  const responseData =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { data?: Record<string, { message?: string }> } }).response?.data
      : undefined;

  if (responseData && typeof responseData === "object") {
    const firstFieldError = Object.values(responseData)
      .map((entry) => entry?.message)
      .find((message) => typeof message === "string" && message.trim());

    if (firstFieldError) {
      return firstFieldError;
    }
  }

  if (typeof responseMessage === "string" && responseMessage.trim()) {
    return responseMessage;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function showFlash(
  setter: (value: FlashMessage | null) => void,
  flash: FlashMessage
) {
  setter(flash);
  window.clearTimeout((showFlash as { timer?: number }).timer);
  (showFlash as { timer?: number }).timer = window.setTimeout(() => setter(null), 4200);
}

export default App;
