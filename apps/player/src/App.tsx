import { Capacitor } from "@capacitor/core";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPocketBaseClient, defaultPocketBaseUrl } from "./lib/pocketbase";
import type {
  ChannelRecord,
  ClientRecord,
  DeviceCommandRecord,
  DevicePairingRecord,
  EventRecord,
  MediaAssetRecord,
  PlaybackEntry,
  PlaylistItemRecord,
  PlaylistRecord,
  ScheduleRuleRecord,
  ScreenUserRecord
} from "./types";

const settingsStorageKey = "signal-deck-player-settings";
const pairingStorageKey = "signal-deck-player-pairing";
const appVersion = "0.3.2";

type Settings = {
  pocketbaseUrl: string;
  email: string;
  password: string;
};

type PairingSession = {
  recordId: string;
  installerId: string;
  pairingCode: string;
  createdAt: string;
};

type SyncState = {
  screen: ScreenUserRecord | null;
  queue: PlaybackEntry[];
  activeSchedule: ScheduleRuleRecord | null;
  activeEvent: EventRecord | null;
  pendingCommands: DeviceCommandRecord[];
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
  pendingCommands: [],
  lastSyncAt: ""
};

const initialSettings = loadSettings();

function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [draftSettings, setDraftSettings] = useState<Settings>(initialSettings);
  const [client, setClient] = useState(() =>
    createPocketBaseClient(initialSettings.pocketbaseUrl || defaultPocketBaseUrl)
  );
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(loadPairingSession());
  const [pairingRecord, setPairingRecord] = useState<DevicePairingRecord | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(emptySyncState);
  const [playbackUnlocked, setPlaybackUnlocked] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [syncing, setSyncing] = useState(client.authStore.isValid);
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isConnected, setIsConnected] = useState(client.authStore.isValid);
  const [isAuthenticated, setIsAuthenticated] = useState(client.authStore.isValid);
  const [displayMode, setDisplayMode] = useState<"active" | "blackout">("active");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release?: () => Promise<void> } | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});

  const queueSignature = useMemo(
    () => syncState.queue.map((item) => item.queueKey).join("|"),
    [syncState.queue]
  );

  const commandSignature = useMemo(
    () => syncState.pendingCommands.map((item) => `${item.id}:${item.updated}`).join("|"),
    [syncState.pendingCommands]
  );

  const currentItem = syncState.queue[currentIndex] ?? null;
  const nowLabel = useNowLabel();

  useEffect(() => {
    setIsAuthenticated(client.authStore.isValid);
    setIsConnected(client.authStore.isValid);

    return client.authStore.onChange(() => {
      setIsAuthenticated(client.authStore.isValid);
      setIsConnected(client.authStore.isValid);
    });
  }, [client]);

  useEffect(() => {
    if (!queueSignature) {
      setCurrentIndex(0);
      return;
    }

    setCurrentIndex((current) => Math.min(current, Math.max(syncState.queue.length - 1, 0)));
  }, [queueSignature, syncState.queue.length]);

  useEffect(() => {
    if (!settings.email || !settings.password || isAuthenticated) {
      return;
    }

    let cancelled = false;

    const reconnect = async () => {
      try {
        await client.collection("screen_users").authWithPassword(settings.email, settings.password);
        if (!cancelled) {
          setIsConnected(true);
          setShowConfig(false);
        }
      } catch {
        if (pairingSession?.recordId && pairingSession.installerId) {
          try {
            const pairing = await refreshPairingRecord(client, pairingSession);
            if (cancelled) {
              return;
            }

            if (
              pairing.assignedEmail &&
              pairing.screen &&
              pairing.status !== "expired"
            ) {
              await completePairingLogin({
                client,
                record: pairing,
                session: pairingSession,
                settings,
                setSettings,
                setDraftSettings,
                setIsAuthenticated,
                setIsConnected,
                setPairingRecord,
                setPairingSession,
                setShowConfig,
                setFlash,
                setPlaybackUnlocked,
                setCurrentIndex
              });

              if (!cancelled) {
                setIsConnected(true);
                setShowConfig(false);
              }

              return;
            }
          } catch {
            // Fall back to config mode below.
          }
        }

        if (!cancelled) {
          setIsConnected(false);
        }
      }
    };

    void reconnect();

    return () => {
      cancelled = true;
    };
  }, [client, isAuthenticated, pairingSession, settings, settings.email, settings.password]);

  useEffect(() => {
    if (isAuthenticated || settings.email.trim()) {
      setPairingRecord(null);
      return;
    }

    let cancelled = false;
    let poller = 0;

    const boot = async () => {
      try {
        const ensured = await ensurePairingSession(client, pairingSession);
        if (cancelled) {
          return;
        }

        setPairingSession(ensured.session);
        setPairingRecord(ensured.record);
        savePairingSession(ensured.session);
        setIsConnected(true);

        const poll = async () => {
          try {
            const refreshed = await refreshPairingRecord(client, ensured.session);
            if (cancelled) {
              return;
            }

            setPairingRecord(refreshed);

            if (
              refreshed.assignedEmail &&
              (refreshed.status === "paired" || refreshed.status === "claimed")
            ) {
              await completePairingLogin({
                client,
                record: refreshed,
                session: ensured.session,
                settings,
                setSettings,
                setDraftSettings,
                setIsAuthenticated,
                setIsConnected,
                setPairingRecord,
                setPairingSession,
                setShowConfig,
                setFlash,
                setPlaybackUnlocked,
                setCurrentIndex
              });
            }
          } catch (error) {
            if (!cancelled) {
              setIsConnected(false);
              showFlash(setFlash, {
                kind: "error",
                text: readError(error, "Nie udało się odświeżyć zgłoszenia urządzenia.")
              });
            }
          }
        };

        void poll();
        poller = window.setInterval(() => {
          void poll();
        }, 10000);
      } catch (error) {
        if (!cancelled) {
          setIsConnected(false);
          showFlash(setFlash, {
            kind: "error",
            text: readError(error, "Nie udało się uruchomić trybu rejestracji urządzenia.")
          });
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [client, isAuthenticated, pairingSession, settings]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSyncState(emptySyncState);
      setSyncing(false);
      return;
    }

    let cancelled = false;
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
        setDisplayMode(nextState.screen?.desiredDisplayState || "active");
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

    syncRef.current = runSync;
    void runSync();

    const poller = window.setInterval(() => {
      void runSync();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [client, isAuthenticated]);

  useEffect(() => {
    if (!syncState.screen || !isAuthenticated) {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        await client.collection("screen_users").update(syncState.screen!.id, {
          status: syncState.screen!.status === "maintenance" ? "maintenance" : "online",
          lastSeenAt: new Date().toISOString(),
          lastPlaybackAt: currentItem ? new Date().toISOString() : syncState.screen!.lastPlaybackAt,
          desiredDisplayState: displayMode,
          deviceModel: getDeviceDescriptor(),
          appVersion
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
  }, [client, currentItem, displayMode, isAuthenticated, syncState.screen]);

  useEffect(() => {
    if (!currentItem || !playbackUnlocked || displayMode === "blackout") {
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
  }, [currentItem, playbackUnlocked, displayMode, syncState.queue]);

  useEffect(() => {
    if (!syncState.screen || !commandSignature) {
      return;
    }

    const screen = syncState.screen;
    let cancelled = false;

    const process = async () => {
      for (const command of syncState.pendingCommands) {
        if (cancelled) {
          return;
        }

        try {
          await client.collection("device_commands").update(command.id, {
            status: "processing"
          });

          switch (command.commandType) {
            case "blackout":
              setDisplayMode("blackout");
              break;
            case "wake":
              setDisplayMode("active");
              break;
            case "sync":
              await syncRef.current();
              break;
            case "capture_screenshot":
              await captureSnapshot(client, screen, {
                currentItem,
                displayMode,
                imageElement: imageRef.current,
                nowLabel,
                playbackUnlocked,
                videoElement: videoRef.current
              });
              break;
            case "restart_app":
              await client.collection("device_commands").update(command.id, {
                status: "done",
                processedAt: new Date().toISOString(),
                resultMessage: "Aplikacja restartuje się."
              });
              window.setTimeout(() => window.location.reload(), 250);
              return;
            default:
              break;
          }

          await client.collection("device_commands").update(command.id, {
            status: "done",
            processedAt: new Date().toISOString(),
            resultMessage: "Komenda wykonana."
          });
        } catch (error) {
          await client.collection("device_commands").update(command.id, {
            status: "failed",
            processedAt: new Date().toISOString(),
            resultMessage: readError(error, "Urządzenie nie wykonało polecenia.")
          });
        }
      }

      await syncRef.current();
    };

    void process();

    return () => {
      cancelled = true;
    };
  }, [client, commandSignature, currentItem, displayMode, nowLabel, playbackUnlocked, syncState.pendingCommands, syncState.screen]);

  useEffect(() => {
    if (!syncState.screen || !isAuthenticated) {
      return;
    }

    const screen = syncState.screen;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        void captureSnapshot(client, screen, {
          currentItem,
          displayMode,
          imageElement: imageRef.current,
          nowLabel,
          playbackUnlocked,
          videoElement: videoRef.current
        }).catch(() => {
          // Best effort only.
        });
      }
    }, currentItem ? 3500 : 1200);

    const interval = window.setInterval(() => {
      void captureSnapshot(client, screen, {
        currentItem,
        displayMode,
        imageElement: imageRef.current,
        nowLabel,
        playbackUnlocked,
        videoElement: videoRef.current
      }).catch(() => {
        // ignore
      });
    }, 180000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [client, currentItem, displayMode, isAuthenticated, nowLabel, playbackUnlocked, syncState.screen]);

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

    const nextClient = createPocketBaseClient(draftSettings.pocketbaseUrl.trim() || defaultPocketBaseUrl);

    if (draftSettings.email.trim() && draftSettings.password) {
      try {
        await nextClient.collection("screen_users").authWithPassword(
          draftSettings.email.trim(),
          draftSettings.password
        );

        setPairingRecord(null);
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

      return;
    }

    const nextSettings = {
      pocketbaseUrl: draftSettings.pocketbaseUrl.trim() || defaultPocketBaseUrl,
      email: "",
      password: ""
    };

    nextClient.authStore.clear();
    saveSettings(nextSettings);
    setSettings(nextSettings);
    setDraftSettings(nextSettings);
    setClient(nextClient);
    setShowConfig(false);
    showFlash(setFlash, {
      kind: "success",
      text: "Adres PocketBase zapisany. Urządzenie zgłosi się do CMS jako oczekujące."
    });
  }

  async function handleLogout() {
    if (pairingSession?.recordId) {
      try {
        const refreshed = await client.collection("device_pairings").update<DevicePairingRecord>(
          pairingSession.recordId,
          {
            status: "waiting",
            screen: "",
            assignedEmail: "",
            claimedAt: "",
            lastSeenAt: new Date().toISOString(),
            deviceName: getDeviceDescriptor(),
            platform: Capacitor.getPlatform(),
            appVersion
          }
        );
        setPairingRecord(refreshed);
      } catch {
        setPairingRecord(null);
      }
    }

    client.authStore.clear();
    const resetSettings = {
      pocketbaseUrl: settings.pocketbaseUrl,
      email: "",
      password: ""
    };

    saveSettings(resetSettings);
    setSettings(resetSettings);
    setDraftSettings(resetSettings);
    setSyncState(emptySyncState);
    setPlaybackUnlocked(false);
    setDisplayMode("active");
    setIsConnected(false);
    setShowConfig(false);
    showFlash(setFlash, {
      kind: "success",
      text: "Urządzenie zostało rozłączone i wróciło do kolejki oczekujących w CMS."
    });
  }

  async function refreshDeviceRegistration() {
    try {
      const ensured = await ensurePairingSession(client, pairingSession);
      setPairingSession(ensured.session);
      setPairingRecord(ensured.record);
      savePairingSession(ensured.session);
      showFlash(setFlash, {
        kind: "success",
        text: "Zgłoszenie urządzenia zostało odświeżone w CMS."
      });
    } catch (error) {
      showFlash(setFlash, {
        kind: "error",
        text: readError(error, "Nie udało się odświeżyć zgłoszenia urządzenia.")
      });
    }
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
          crossOrigin="anonymous"
          autoPlay={playbackUnlocked}
          preload="auto"
          onEnded={() => moveNext(syncState.queue, setCurrentIndex)}
        />
      ) : null}

      {currentItem?.kind === "image" ? (
        <img
          ref={imageRef}
          className="player-media image"
          src={currentItem.url}
          alt={currentItem.title}
          crossOrigin="anonymous"
        />
      ) : null}

      {!currentItem && isAuthenticated ? (
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
          <strong>
            {syncState.screen?.locationLabel ||
              syncState.screen?.name ||
              pairingRecord?.deviceName ||
              getDeviceDescriptor()}
          </strong>
          <small>
            {syncState.screen?.expand?.client?.name ||
              (pairingRecord ? `ID ${pairingRecord.pairingCode}` : "Urządzenie oczekujące")}{" "}
            • {syncState.screen?.expand?.channel?.name || Capacitor.getPlatform()}
          </small>
        </div>

        <div className="top-actions">
          <button className="ghost-button" onClick={() => setShowConfig((value) => !value)} type="button">
            {showConfig ? "Ukryj panel" : "Konfiguracja"}
          </button>
          <button className="ghost-button danger" onClick={() => void handleLogout()} type="button">
            Reset / rozłącz
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
          {displayMode === "blackout" ? <span className="chip warning">blackout</span> : null}
        </div>

        <div className="meta-copy">
          <strong>{currentItem?.playlistName || syncState.activeSchedule?.label || "Brak emisji"}</strong>
          <span>
            {syncState.activeEvent
              ? `Event: ${syncState.activeEvent.title}`
              : syncState.activeSchedule
                ? `Schedule: ${syncState.activeSchedule.label}`
                : pairingRecord
                  ? "Czeka na zatwierdzenie w CMS"
                  : "Standby"}
          </span>
          <small>
            sync {formatDateTime(syncState.lastSyncAt)} • {nowLabel}
          </small>
        </div>
      </div>

      {!isAuthenticated ? (
        <div className="pairing-overlay">
          <div className="pairing-card">
            <span className="eyebrow">android tv waiting room</span>
            <h2>{pairingRecord?.pairingCode || "..."}</h2>
            <p>
              To stały identyfikator tej instalacji. W CMS przejdź do sekcji
              <strong> Urządzenia</strong>, wybierz to zgłoszenie z kolejki i kliknij
              <strong> Zatwierdź</strong>. Po przypisaniu klienta i kanału player zaloguje się sam.
            </p>
            <div className="pairing-meta">
              <span>ID urządzenia</span>
              <strong>{pairingRecord?.pairingCode || "..."}</strong>
              <small>{pairingRecord?.deviceName || getDeviceDescriptor()}</small>
            </div>
            <div className="pairing-meta">
              <span>APK</span>
              <strong>{appVersion}</strong>
              <small>{Capacitor.getPlatform()}</small>
            </div>
            <div className="pairing-actions">
              <button className="ghost-button" onClick={() => void refreshDeviceRegistration()} type="button">
                Odśwież zgłoszenie
              </button>
              <button className="ghost-button" onClick={() => setShowConfig(true)} type="button">
                PocketBase URL
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {displayMode === "blackout" ? (
        <div className="blackout-overlay">
          <div className="blackout-card">
            <span className="eyebrow">remote control</span>
            <h2>Ekran został zdalnie wygaszony</h2>
            <p>CMS ustawił tryb blackout. Po komendzie wake emisja wróci bez potrzeby ponownej konfiguracji.</p>
          </div>
        </div>
      ) : null}

      {!playbackUnlocked && currentItem && displayMode !== "blackout" ? (
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
              Wpisz tylko adres PocketBase, a player sam zgłosi się do CMS jako urządzenie
              oczekujące. Pola email/hasło są opcjonalne i służą głównie do ręcznego trybu
              serwisowego.
            </p>

            <label className="field">
              <span>PocketBase URL</span>
              <input
                id="player-pocketbase-url"
                name="pocketbaseUrl"
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
              <span>Email ekranu (opcjonalnie)</span>
              <input
                id="player-screen-email"
                name="screenEmail"
                type="email"
                value={draftSettings.email}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    email: event.target.value
                  }))
                }
                placeholder="tv-lobby-01@berry-secure.pl"
              />
            </label>

            <label className="field">
              <span>Hasło (opcjonalnie)</span>
              <input
                id="player-screen-password"
                name="screenPassword"
                type="password"
                value={draftSettings.password}
                onChange={(event) =>
                  setDraftSettings((current) => ({
                    ...current,
                    password: event.target.value
                  }))
                }
                placeholder="Hasło przypisane w CMS"
              />
            </label>

            <div className="config-info">
              <span>Aktualnie zapisane</span>
              <strong>{settings.email || (pairingRecord ? `ID ${pairingRecord.pairingCode}` : "urządzenie oczekujące")}</strong>
              <small>{settings.pocketbaseUrl || defaultPocketBaseUrl}</small>
            </div>

            {flash ? <div className={flash.kind === "success" ? "flash success" : "flash error"}>{flash.text}</div> : null}

            <button className="primary-button" type="submit">
              Zapisz konfigurację
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

  const screen = await client.collection("screen_users").getOne<ScreenUserRecord>(authRecord.id);

  const [fileToken, clients, channels, playlists, mediaAssets, schedules, events, playlistItems, pendingCommands] =
    await Promise.all([
      safeGetFileToken(client),
      safeGetFullList<ClientRecord>(client, "clients", {
        filter: `id="${escapeFilterValue(screen.client)}"`
      }),
      safeGetFullList<ChannelRecord>(client, "channels", {
        filter: `client="${escapeFilterValue(screen.client)}"`
      }),
      safeGetFullList<PlaylistRecord>(client, "playlists", {
        filter: `client="${escapeFilterValue(screen.client)}"`
      }),
      safeGetFullList<MediaAssetRecord>(client, "media_assets", {
        filter: `client="${escapeFilterValue(screen.client)}"`
      }),
      safeGetFullList<ScheduleRuleRecord>(client, "schedule_rules", {
        filter: `client="${escapeFilterValue(screen.client)}" && isActive=true`
      }),
      safeGetFullList<EventRecord>(client, "events", {
        filter: `client="${escapeFilterValue(screen.client)}" && isActive=true`
      }),
      safeGetFullList<PlaylistItemRecord>(client, "playlist_items", {
        filter: `client="${escapeFilterValue(screen.client)}"`
      }),
      safeGetFullList<DeviceCommandRecord>(client, "device_commands", {
        filter: `screen="${escapeFilterValue(screen.id)}" && status="queued"`
      })
    ]);

  const hydrated = hydratePlayerData({
    clients,
    channels,
    playlists,
    mediaAssets,
    schedules,
    events,
    playlistItems,
    pendingCommands,
    screen
  });

  const activeEvent =
    hydrated.events
      .filter((event) => eventMatches(event, screen))
      .sort((left, right) => right.priority - left.priority)[0] || null;

  const activeSchedule =
    hydrated.schedules
      .filter((schedule) => scheduleMatches(schedule, screen))
      .sort((left, right) => right.priority - left.priority)[0] || null;

  const activePlaylistId = activeEvent?.playlist || activeSchedule?.playlist || "";
  const activePlaylistName =
    activeEvent?.expand?.playlist?.name ||
    activeSchedule?.expand?.playlist?.name ||
    "Brak playlisty";

  const queue = activePlaylistId
    ? buildQueue(
        hydrated.playlistItems.filter((item) => item.playlist === activePlaylistId),
        client,
        fileToken,
        activePlaylistId,
        activePlaylistName,
        activeEvent?.title || activeSchedule?.label || activePlaylistName
      )
    : [];

  return {
    screen: hydrated.screen,
    queue,
    activeSchedule,
    activeEvent,
    pendingCommands: hydrated.pendingCommands,
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

async function ensurePairingSession(
  client: ReturnType<typeof createPocketBaseClient>,
  existing: PairingSession | null
): Promise<{ session: PairingSession; record: DevicePairingRecord }> {
  if (existing?.recordId && existing.installerId) {
    try {
      const record = await refreshPairingRecord(client, existing);
      return {
        session: {
          ...existing,
          pairingCode: record.pairingCode || existing.pairingCode
        },
        record
      };
    } catch {
      // Try to recover the record by the stable installer id before creating a new one.
    }
  }

  if (existing?.installerId) {
    try {
      const record = await client
        .collection("device_pairings")
        .getFirstListItem<DevicePairingRecord>(
          `installerId="${escapeFilterValue(existing.installerId)}"`
        );

      const refreshed = await client.collection("device_pairings").update<DevicePairingRecord>(record.id, {
        status: record.status === "expired" ? "waiting" : record.status,
        lastSeenAt: new Date().toISOString(),
        deviceName: getDeviceDescriptor(),
        platform: Capacitor.getPlatform(),
        appVersion
      });

      return {
        session: {
          ...existing,
          recordId: refreshed.id,
          pairingCode: refreshed.pairingCode || existing.pairingCode
        },
        record: refreshed
      };
    } catch {
      // ignore and create a new session
    }
  }

  const preservedPairingCode =
    existing && typeof existing.pairingCode === "string" && existing.pairingCode.length >= 8
      ? existing.pairingCode
      : generatePairingCode();

  const session: PairingSession = {
    recordId: existing?.recordId || "",
    installerId: existing?.installerId || crypto.randomUUID(),
    pairingCode: preservedPairingCode,
    createdAt: existing?.createdAt || new Date().toISOString()
  };

  const record = await client.collection("device_pairings").create<DevicePairingRecord>({
    installerId: session.installerId,
    pairingCode: session.pairingCode,
    status: "waiting",
    deviceName: getDeviceDescriptor(),
    platform: Capacitor.getPlatform(),
    appVersion,
    pairingExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: new Date().toISOString()
  });

  return {
    session: {
      ...session,
      recordId: record.id
    },
    record
  };
}

async function refreshPairingRecord(
  client: ReturnType<typeof createPocketBaseClient>,
  session: PairingSession
) {
  await client.collection("device_pairings").update(session.recordId, {
    lastSeenAt: new Date().toISOString(),
    deviceName: getDeviceDescriptor(),
    platform: Capacitor.getPlatform(),
    appVersion
  });

  return client.collection("device_pairings").getOne<DevicePairingRecord>(session.recordId);
}

async function completePairingLogin(params: {
  client: ReturnType<typeof createPocketBaseClient>;
  record: DevicePairingRecord;
  session: PairingSession;
  settings: Settings;
  setSettings: (value: Settings) => void;
  setDraftSettings: (value: Settings) => void;
  setIsAuthenticated: (value: boolean) => void;
  setIsConnected: (value: boolean) => void;
  setPairingRecord: (value: DevicePairingRecord | null) => void;
  setPairingSession: (value: PairingSession | null) => void;
  setShowConfig: (value: boolean) => void;
  setFlash: (value: { kind: "success" | "error"; text: string } | null) => void;
  setPlaybackUnlocked: (value: boolean) => void;
  setCurrentIndex: (value: number) => void;
}) {
  let resolvedPassword = params.session.installerId;
  let authRecordId = "";

  try {
    const authResponse = await params.client
      .collection("screen_users")
      .authWithPassword(params.record.assignedEmail, params.session.installerId);
    params.client.authStore.save(authResponse.token, authResponse.record);
    authRecordId = authResponse.record.id;
  } catch (primaryError) {
    try {
      const fallbackResponse = await params.client
        .collection("screen_users")
        .authWithPassword(params.record.assignedEmail, params.session.pairingCode);
      params.client.authStore.save(fallbackResponse.token, fallbackResponse.record);
      resolvedPassword = params.session.pairingCode;
      authRecordId = fallbackResponse.record.id;
    } catch {
      throw primaryError;
    }
  }

  if (authRecordId) {
    await params.client.collection("screen_users").update(authRecordId, {
      status: "online",
      lastSeenAt: new Date().toISOString(),
      deviceModel: getDeviceDescriptor(),
      appVersion
    });
  }

  const nextSettings = {
    pocketbaseUrl: params.settings.pocketbaseUrl,
    email: params.record.assignedEmail,
    password: resolvedPassword
  };

  await params.client.collection("device_pairings").update(params.record.id, {
    status: "claimed",
    claimedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });

  saveSettings(nextSettings);
  savePairingSession({
    ...params.session,
    recordId: params.record.id,
    pairingCode: params.record.pairingCode || params.session.pairingCode
  });
  params.setSettings(nextSettings);
  params.setDraftSettings(nextSettings);
  params.setIsAuthenticated(true);
  params.setIsConnected(true);
  params.setPairingRecord(null);
  params.setPairingSession({
    ...params.session,
    recordId: params.record.id,
    pairingCode: params.record.pairingCode || params.session.pairingCode
  });
  params.setShowConfig(false);
  params.setPlaybackUnlocked(false);
  params.setCurrentIndex(0);
  showFlash(params.setFlash, {
    kind: "success",
    text: "Urządzenie zostało sparowane i zalogowane do playera."
  });
}

async function captureSnapshot(
  client: ReturnType<typeof createPocketBaseClient>,
  screen: ScreenUserRecord,
  snapshotState: {
    currentItem: PlaybackEntry | null;
    displayMode: "active" | "blackout";
    imageElement: HTMLImageElement | null;
    nowLabel: string;
    playbackUnlocked: boolean;
    videoElement: HTMLVideoElement | null;
  }
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#171717");
  gradient.addColorStop(1, "#0a0a0d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  let mediaDrawn = false;

  if (snapshotState.displayMode !== "blackout" && snapshotState.currentItem) {
    try {
      if (
        snapshotState.currentItem.kind === "image" &&
        snapshotState.imageElement?.complete &&
        snapshotState.imageElement.naturalWidth > 0
      ) {
        context.drawImage(snapshotState.imageElement, 0, 0, canvas.width, canvas.height);
        mediaDrawn = true;
      }

      if (
        snapshotState.currentItem.kind === "video" &&
        snapshotState.videoElement &&
        snapshotState.videoElement.readyState >= 2
      ) {
        context.drawImage(snapshotState.videoElement, 0, 0, canvas.width, canvas.height);
        mediaDrawn = true;
      }
    } catch {
      mediaDrawn = false;
    }
  }

  if (!mediaDrawn) {
    context.fillStyle = snapshotState.displayMode === "blackout" ? "#050505" : "#101014";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = '700 54px "Arial"';
    context.fillText(
      snapshotState.displayMode === "blackout" ? "Blackout aktywny" : "Signal Deck Player",
      80,
      170
    );
    context.font = '500 30px "Arial"';
    context.fillStyle = "rgba(255,255,255,0.7)";
    context.fillText(
      snapshotState.currentItem?.title || "Brak aktywnego materiału",
      80,
      230
    );
  }

  context.fillStyle = "rgba(0,0,0,0.56)";
  context.fillRect(0, canvas.height - 110, canvas.width, 110);
  context.fillStyle = "#ffffff";
  context.font = '700 28px "Arial"';
  context.fillText(screen.locationLabel || screen.name, 50, canvas.height - 58);
  context.font = '500 22px "Arial"';
  context.fillStyle = "rgba(255,255,255,0.76)";
  context.fillText(
    `${snapshotState.currentItem?.playlistName || "Standby"} • ${snapshotState.nowLabel}`,
    50,
    canvas.height - 24
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.82);
  });

  const formData = new FormData();
  if (blob) {
    formData.append(
      "lastScreenshot",
      new File([blob], `snapshot-${screen.id}.jpg`, { type: "image/jpeg" })
    );
  }
  formData.append("lastScreenshotAt", new Date().toISOString());
  await client.collection("screen_users").update(screen.id, formData);
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

function loadPairingSession() {
  const raw = window.localStorage.getItem(pairingStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PairingSession;
  } catch {
    return null;
  }
}

function savePairingSession(session: PairingSession) {
  window.localStorage.setItem(pairingStorageKey, JSON.stringify(session));
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

function getDeviceDescriptor() {
  if (typeof navigator === "undefined") {
    return "Android TV";
  }

  const userAgent = navigator.userAgent || "";
  if (userAgent.includes("Android")) {
    return "Android TV";
  }

  return userAgent.slice(0, 80) || "Signal Deck Player";
}

function generatePairingCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

async function safeGetFileToken(client: ReturnType<typeof createPocketBaseClient>) {
  try {
    return await client.files.getToken();
  } catch {
    return "";
  }
}

async function safeGetFullList<T>(
  client: ReturnType<typeof createPocketBaseClient>,
  collectionName: string,
  options?: Record<string, unknown>
) {
  try {
    return await client.collection(collectionName).getFullList<T>(options);
  } catch {
    return [] as T[];
  }
}

function hydratePlayerData(data: {
  clients: ClientRecord[];
  channels: ChannelRecord[];
  playlists: PlaylistRecord[];
  mediaAssets: MediaAssetRecord[];
  schedules: ScheduleRuleRecord[];
  events: EventRecord[];
  playlistItems: PlaylistItemRecord[];
  pendingCommands: DeviceCommandRecord[];
  screen: ScreenUserRecord;
}) {
  const clientsById = new Map(data.clients.map((client) => [client.id, client]));
  const channelsById = new Map(data.channels.map((channel) => [channel.id, channel]));
  const playlistsById = new Map(
    data.playlists.map((playlist) => [
      playlist.id,
      {
        ...playlist,
        expand: {
          client: clientsById.get(playlist.client),
          channel: channelsById.get(playlist.channel)
        }
      }
    ])
  );
  const mediaAssetsById = new Map(
    data.mediaAssets.map((asset) => [
      asset.id,
      {
        ...asset,
        expand: {
          client: clientsById.get(asset.client)
        }
      }
    ])
  );

  const screen = {
    ...data.screen,
    expand: {
      ...data.screen.expand,
      client: clientsById.get(data.screen.client),
      channel: channelsById.get(data.screen.channel)
    }
  };

  const schedules = [...data.schedules]
    .map((schedule) => ({
      ...schedule,
      expand: {
        ...schedule.expand,
        playlist: playlistsById.get(schedule.playlist),
        channel: channelsById.get(schedule.channel)
      }
    }))
    .sort((left, right) => right.priority - left.priority || compareText(left.label, right.label));

  const events = [...data.events]
    .map((event) => ({
      ...event,
      expand: {
        ...event.expand,
        playlist: playlistsById.get(event.playlist),
        channel: channelsById.get(event.channel)
      }
    }))
    .sort(
      (left, right) =>
        right.priority - left.priority || compareDateDesc(left.startsAt, right.startsAt)
    );

  const playlistItems = [...data.playlistItems]
    .map((item) => ({
      ...item,
      expand: {
        ...item.expand,
        playlist: playlistsById.get(item.playlist),
        mediaAsset: mediaAssetsById.get(item.mediaAsset)
      }
    }))
    .sort(
      (left, right) =>
        compareText(left.playlist, right.playlist) || left.sortOrder - right.sortOrder
    );

  const pendingCommands = [...data.pendingCommands].sort((left, right) =>
    compareDateAsc(left.created, right.created)
  );

  return {
    screen,
    schedules,
    events,
    playlistItems,
    pendingCommands
  };
}

function compareText(left: string, right: string) {
  return String(left || "").localeCompare(String(right || ""), "pl", {
    sensitivity: "base",
    numeric: true
  });
}

function compareDateAsc(left: string, right: string) {
  const leftValue = left ? new Date(left).getTime() : 0;
  const rightValue = right ? new Date(right).getTime() : 0;
  return leftValue - rightValue;
}

function compareDateDesc(left: string, right: string) {
  const leftValue = left ? new Date(left).getTime() : 0;
  const rightValue = right ? new Date(right).getTime() : 0;
  return rightValue - leftValue;
}

function escapeFilterValue(value: string) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export default App;
