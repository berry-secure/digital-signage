import { Capacitor } from "@capacitor/core";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPocketBaseClient, defaultPocketBaseUrl } from "./lib/pocketbase";
import type {
  EventRecord,
  PlaybackEntry,
  PlaylistItemRecord,
  ScheduleRuleRecord,
  ScreenUserRecord
} from "./types";

const settingsStorageKey = "signal-deck-player-settings";
const subscriptions = [
  "screen_users",
  "schedule_rules",
  "events",
  "playlists",
  "playlist_items",
  "media_assets"
] as const;

type Settings = {
  pocketbaseUrl: string;
  email: string;
  password: string;
};

type SyncState = {
  screen: ScreenUserRecord | null;
  queue: PlaybackEntry[];
  activeSchedule: ScheduleRuleRecord | null;
  activeEvent: EventRecord | null;
  lastSyncAt: string;
};

const defaultSettings: Settings = {
  pocketbaseUrl: defaultPocketBaseUrl,
  email: "",
  password: ""
};

const emptySyncState: SyncState = {
  screen: null,
  queue: [],
  activeSchedule: null,
  activeEvent: null,
  lastSyncAt: ""
};

const initialSettings = loadSettings();

function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [draftSettings, setDraftSettings] = useState<Settings>(initialSettings);
  const [client, setClient] = useState(() =>
    createPocketBaseClient(initialSettings.pocketbaseUrl || defaultPocketBaseUrl)
  );
  const [showConfig, setShowConfig] = useState<boolean>(!client.authStore.isValid);
  const [syncState, setSyncState] = useState<SyncState>(emptySyncState);
  const [playbackUnlocked, setPlaybackUnlocked] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [syncing, setSyncing] = useState(client.authStore.isValid);
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isConnected, setIsConnected] = useState(client.authStore.isValid);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release?: () => Promise<void> } | null>(null);

  const queueSignature = useMemo(
    () => syncState.queue.map((item) => item.queueKey).join("|"),
    [syncState.queue]
  );

  const currentItem = syncState.queue[currentIndex] ?? null;
  const nowLabel = useNowLabel();

  useEffect(() => {
    if (!queueSignature) {
      setCurrentIndex(0);
      return;
    }

    setCurrentIndex((current) => Math.min(current, Math.max(syncState.queue.length - 1, 0)));
  }, [queueSignature, syncState.queue.length]);

  useEffect(() => {
    if (!client.authStore.isValid) {
      setSyncState(emptySyncState);
      setSyncing(false);
      return;
    }

    let cancelled = false;
    let debounceTimer = 0;

    const runSync = async () => {
      if (cancelled) {
        return;
      }

      setSyncing(true);

      try {
        const nextState = await syncPlayer(client);

        if (cancelled) {
          return;
        }

        setSyncState(nextState);
        setIsConnected(true);
      } catch (error) {
        if (!cancelled) {
          showFlash(setFlash, {
            kind: "error",
            text: readError(error, "Player nie mógł zsynchronizować danych.")
          });
          setIsConnected(false);
        }
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
      }
    };

    void runSync();
    const poller = window.setInterval(() => {
      void runSync();
    }, 30000);

    const subscribeRealtime = async () => {
      await Promise.all(
        subscriptions.map((collectionName) =>
          client.collection(collectionName).subscribe("*", () => {
            window.clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => void runSync(), 220);
          })
        )
      );
    };

    void subscribeRealtime();

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
      window.clearInterval(poller);
      subscriptions.forEach((collectionName) => client.collection(collectionName).unsubscribe("*"));
    };
  }, [client]);

  useEffect(() => {
    if (!syncState.screen || !client.authStore.isValid) {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        await client.collection("screen_users").update(syncState.screen!.id, {
          status: "online",
          lastSeenAt: new Date().toISOString(),
          lastPlaybackAt: currentItem ? new Date().toISOString() : syncState.screen!.lastPlaybackAt
        });
      } catch {
        setIsConnected(false);
      }
    };

    void sendHeartbeat();

    const heartbeat = window.setInterval(() => {
      void sendHeartbeat();
    }, 60000);

    return () => {
      window.clearInterval(heartbeat);
    };
  }, [client, currentItem, syncState.screen]);

  useEffect(() => {
    if (!currentItem || !playbackUnlocked) {
      return;
    }

    void requestWakeLock(wakeLockRef);

    if (currentItem.kind === "image") {
      if (imageTimerRef.current) {
        window.clearTimeout(imageTimerRef.current);
      }

      imageTimerRef.current = window.setTimeout(() => {
        moveNext(syncState.queue, setCurrentIndex);
      }, Math.max(currentItem.durationSeconds || 10, 4) * 1000);

      return () => {
        if (imageTimerRef.current) {
          window.clearTimeout(imageTimerRef.current);
        }
      };
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    videoElement.currentTime = 0;
    videoElement.volume = clamp((currentItem.volumePercent || 100) / 100, 0, 1);
    videoElement.muted = !currentItem.hasAudio;

    void videoElement.play().catch(() => {
      showFlash(setFlash, {
        kind: "error",
        text: "Android/WebView zablokował autoplay. Kliknij „Uruchom odtwarzanie”."
      });
      setPlaybackUnlocked(false);
    });
  }, [currentItem, playbackUnlocked, syncState.queue]);

  useEffect(() => {
    return () => {
      if (imageTimerRef.current) {
        window.clearTimeout(imageTimerRef.current);
      }

      void releaseWakeLock(wakeLockRef);
    };
  }, []);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextClient = createPocketBaseClient(draftSettings.pocketbaseUrl.trim());

    try {
      await nextClient.collection("screen_users").authWithPassword(
        draftSettings.email.trim(),
        draftSettings.password
      );

      saveSettings(draftSettings);
      setSettings(draftSettings);
      setClient(nextClient);
      setShowConfig(false);
      setPlaybackUnlocked(false);
      setCurrentIndex(0);
      showFlash(setFlash, {
        kind: "success",
        text: "Player został połączony z PocketBase."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się zalogować kontem screen_users.")
      });
    }
  }

  function handleLogout() {
    client.authStore.clear();
    setSyncState(emptySyncState);
    setPlaybackUnlocked(false);
    setIsConnected(false);
    setShowConfig(true);
  }

  async function unlockPlayback() {
    setPlaybackUnlocked(true);
    void requestWakeLock(wakeLockRef);

    if (currentItem?.kind === "video" && videoRef.current) {
      try {
        await videoRef.current.play();
      } catch {
        setPlaybackUnlocked(false);
      }
    }
  }

  return (
    <div className="player-shell">
      {currentItem?.kind === "video" ? (
        <video
          ref={videoRef}
          className="player-media"
          src={currentItem.url}
          playsInline
          autoPlay={playbackUnlocked}
          preload="auto"
          onEnded={() => moveNext(syncState.queue, setCurrentIndex)}
        />
      ) : null}

      {currentItem?.kind === "image" ? (
        <img className="player-media image" src={currentItem.url} alt={currentItem.title} />
      ) : null}

      {!currentItem ? (
        <div className="standby-overlay">
          <span className="eyebrow">Signal Deck Player</span>
          <h1>Brak aktywnej playlisty na ten moment.</h1>
          <p>
            Player jest zalogowany, ale nie znalazł dopasowanej reguły schedule ani aktywnego
            eventu override dla tego ekranu.
          </p>
        </div>
      ) : null}

      <div className="glass-topbar">
        <div className="status-column">
          <span className="eyebrow">player</span>
          <strong>{syncState.screen?.locationLabel || syncState.screen?.name || "niepołączony ekran"}</strong>
          <small>
            {syncState.screen?.expand?.client?.name || "Brak klienta"} •{" "}
            {syncState.screen?.expand?.channel?.name || "Brak kanału"}
          </small>
        </div>

        <div className="top-actions">
          <button className="ghost-button" onClick={() => setShowConfig((value) => !value)} type="button">
            {showConfig ? "Ukryj panel" : "Konfiguracja"}
          </button>
          <button className="ghost-button danger" onClick={handleLogout} type="button">
            Rozłącz
          </button>
        </div>
      </div>

      <div className="glass-bottom">
        <div>
          <span className="chip">{Capacitor.getPlatform()}</span>
          <span className={isConnected ? "chip success" : "chip warning"}>
            {isConnected ? "connected" : "offline"}
          </span>
          <span className="chip">{syncing ? "syncing" : "ready"}</span>
        </div>

        <div className="meta-copy">
          <strong>{currentItem?.playlistName || syncState.activeSchedule?.label || "Brak emisji"}</strong>
          <span>
            {syncState.activeEvent
              ? `Event: ${syncState.activeEvent.title}`
              : syncState.activeSchedule
                ? `Schedule: ${syncState.activeSchedule.label}`
                : "Standby"}
          </span>
          <small>
            sync {formatDateTime(syncState.lastSyncAt)} • {nowLabel}
          </small>
        </div>
      </div>

      {!playbackUnlocked && currentItem ? (
        <div className="unlock-overlay">
          <div className="unlock-card">
            <span className="eyebrow">autoplay</span>
            <h2>Uruchom odtwarzanie z dźwiękiem</h2>
            <p>
              Na niektórych Android TV/WebView pierwszy start wymaga jednego kliknięcia. Po tym
              player przechodzi już automatycznie między materiałami.
            </p>
            <button className="primary-button" onClick={() => void unlockPlayback()} type="button">
              Uruchom odtwarzanie
            </button>
          </div>
        </div>
      ) : null}

      {showConfig ? (
        <aside className="config-drawer">
          <form className="config-card" onSubmit={handleConnect}>
            <span className="eyebrow">setup</span>
            <h2>Konfiguracja playera</h2>
            <p>
              Wpisz dane konta z kolekcji <code>screen_users</code>. To konto tworzysz wcześniej w
              CMS.
            </p>

            <label className="field">
              <span>PocketBase URL</span>
              <input
                type="url"
                value={draftSettings.pocketbaseUrl}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    pocketbaseUrl: event.target.value
                  }))
                }
                placeholder="https://pb.berry-secure.pl"
                required
              />
            </label>

            <label className="field">
              <span>Email ekranu</span>
              <input
                type="email"
                value={draftSettings.email}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    email: event.target.value
                  }))
                }
                placeholder="tv-lobby-01@berry-secure.pl"
                required
              />
            </label>

            <label className="field">
              <span>Hasło</span>
              <input
                type="password"
                value={draftSettings.password}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    password: event.target.value
                  }))
                }
                placeholder="Hasło przypisane w CMS"
                required
              />
            </label>

            <div className="config-info">
              <span>Aktualnie zapisane</span>
              <strong>{settings.email || "brak"}</strong>
              <small>{settings.pocketbaseUrl || defaultPocketBaseUrl}</small>
            </div>

            {flash ? <div className={flash.kind === "success" ? "flash success" : "flash error"}>{flash.text}</div> : null}

            <button className="primary-button" type="submit">
              Połącz i zapisz
            </button>
          </form>
        </aside>
      ) : null}
    </div>
  );
}

async function syncPlayer(client: ReturnType<typeof createPocketBaseClient>): Promise<SyncState> {
  const authRecord = client.authStore.record;
  if (!authRecord?.id) {
    return emptySyncState;
  }

  const screen = await client.collection("screen_users").getOne<ScreenUserRecord>(authRecord.id, {
    expand: "client,channel"
  });

  const [fileToken, schedules, events, playlistItems] = await Promise.all([
    client.files.getToken(),
    client.collection("schedule_rules").getFullList<ScheduleRuleRecord>({
      filter: `client="${screen.client}" && isActive=true`,
      sort: "-priority",
      expand: "playlist,channel"
    }),
    client.collection("events").getFullList<EventRecord>({
      filter: `client="${screen.client}" && isActive=true`,
      sort: "-priority,-startsAt",
      expand: "playlist,channel"
    }),
    client.collection("playlist_items").getFullList<PlaylistItemRecord>({
      filter: `client="${screen.client}"`,
      sort: "playlist,sortOrder",
      expand: "playlist,mediaAsset"
    })
  ]);

  const activeEvent =
    events
      .filter((event) => eventMatches(event, screen))
      .sort((left, right) => right.priority - left.priority)[0] || null;

  const activeSchedule =
    schedules
      .filter((schedule) => scheduleMatches(schedule, screen))
      .sort((left, right) => right.priority - left.priority)[0] || null;

  const activePlaylistId = activeEvent?.playlist || activeSchedule?.playlist || "";
  const activePlaylistName =
    activeEvent?.expand?.playlist?.name ||
    activeSchedule?.expand?.playlist?.name ||
    "Brak playlisty";

  const queue = activePlaylistId
    ? buildQueue(
        playlistItems.filter((item) => item.playlist === activePlaylistId),
        client,
        fileToken,
        activePlaylistId,
        activePlaylistName,
        activeEvent?.title || activeSchedule?.label || activePlaylistName
      )
    : [];

  return {
    screen,
    queue,
    activeSchedule,
    activeEvent,
    lastSyncAt: new Date().toISOString()
  };
}

function buildQueue(
  items: PlaylistItemRecord[],
  client: ReturnType<typeof createPocketBaseClient>,
  fileToken: string,
  playlistId: string,
  playlistName: string,
  label: string
) {
  return items
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((item) => {
      const media = item.expand?.mediaAsset;
      if (!media || media.status !== "published" || !media.asset) {
        return [];
      }

      const repeats = Math.max(item.loopCount || 1, 1);
      const entry: PlaybackEntry = {
        queueKey: `${playlistId}:${item.id}`,
        playlistId,
        playlistName,
        label,
        kind: media.kind,
        url: client.files.getURL(media, media.asset, fileToken ? { token: fileToken } : {}),
        title: media.title,
        durationSeconds: media.durationSeconds || (media.kind === "image" ? 10 : 15),
        volumePercent: item.volumePercent || 100,
        hasAudio: media.hasAudio
      };

      return Array.from({ length: repeats }, (_, index) => ({
        ...entry,
        queueKey: `${entry.queueKey}:${index}`
      }));
    });
}

function eventMatches(event: EventRecord, screen: ScreenUserRecord) {
  if (!event.isActive || !event.playlist) {
    return false;
  }

  if (event.channel && event.channel !== screen.channel) {
    return false;
  }

  if (event.screen && event.screen !== screen.id) {
    return false;
  }

  const now = Date.now();
  const startsAt = event.startsAt ? new Date(event.startsAt).getTime() : now;
  const endsAt = event.endsAt ? new Date(event.endsAt).getTime() : now;
  return now >= startsAt && now <= endsAt;
}

function scheduleMatches(schedule: ScheduleRuleRecord, screen: ScreenUserRecord) {
  if (!schedule.isActive || !schedule.playlist) {
    return false;
  }

  if (schedule.channel !== screen.channel) {
    return false;
  }

  const now = new Date();
  const nowTime = minutesFromClock(formatClock(now));

  if (schedule.startDate) {
    const startDate = new Date(schedule.startDate).setHours(0, 0, 0, 0);
    if (now.getTime() < startDate) {
      return false;
    }
  }

  if (schedule.endDate) {
    const endDate = new Date(schedule.endDate).setHours(23, 59, 59, 999);
    if (now.getTime() > endDate) {
      return false;
    }
  }

  if (schedule.daysOfWeek) {
    const allowedDays = schedule.daysOfWeek
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => !Number.isNaN(value));

    if (allowedDays.length && !allowedDays.includes(now.getDay())) {
      return false;
    }
  }

  const startTime = minutesFromClock(schedule.startTime || "00:00");
  const endTime = minutesFromClock(schedule.endTime || "23:59");

  if (startTime <= endTime) {
    return nowTime >= startTime && nowTime <= endTime;
  }

  return nowTime >= startTime || nowTime <= endTime;
}

function moveNext(queue: PlaybackEntry[], setCurrentIndex: (value: number | ((current: number) => number)) => void) {
  if (!queue.length) {
    return;
  }

  setCurrentIndex((current) => (current + 1) % queue.length);
}

function minutesFromClock(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return (hours || 0) * 60 + (minutes || 0);
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function readError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadSettings() {
  const raw = window.localStorage.getItem(settingsStorageKey);
  if (!raw) {
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      pocketbaseUrl: parsed.pocketbaseUrl || defaultPocketBaseUrl,
      email: parsed.email || "",
      password: parsed.password || ""
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: Settings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

function showFlash(
  setter: (value: { kind: "success" | "error"; text: string } | null) => void,
  flash: { kind: "success" | "error"; text: string }
) {
  setter(flash);
  window.clearTimeout((showFlash as { timer?: number }).timer);
  (showFlash as { timer?: number }).timer = window.setTimeout(() => setter(null), 4200);
}

async function requestWakeLock(ref: { current: { release?: () => Promise<void> } | null }) {
  try {
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    }).wakeLock;

    if (!wakeLockApi || ref.current) {
      return;
    }

    ref.current = await wakeLockApi.request("screen");
  } catch {
    // Best effort only.
  }
}

async function releaseWakeLock(ref: { current: { release?: () => Promise<void> } | null }) {
  try {
    await ref.current?.release?.();
  } catch {
    // ignore
  } finally {
    ref.current = null;
  }
}

function formatDateTime(value: string) {
  if (!value) {
    return "brak";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function useNowLabel() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(now);
}

export default App;
