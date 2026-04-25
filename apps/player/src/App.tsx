import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceIdentity, MediaKind, PlaybackEntry, PlayerState, SessionResponse } from "./types";

const identityStorageKey = "signal-deck-device-v1";
const appVersion = "1.0.1";
const apiBaseUrl = (
  import.meta.env.DEV
    ? "http://localhost:3000"
    : String(import.meta.env.VITE_API_BASE_URL || "https://cms.berry-secure.pl")
).replace(/\/$/, "");

type AppPhase = "booting" | "waiting" | "idle" | "playing" | "error";

function App() {
  const [identity, setIdentity] = useState<DeviceIdentity>(() => loadOrCreateIdentity());
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [phase, setPhase] = useState<AppPhase>("booting");
  const [statusMessage, setStatusMessage] = useState("Łączenie z serwerem CMS...");
  const [lastError, setLastError] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef({
    playerState: "waiting" as PlayerState,
    playerMessage: "Player startuje i czeka na pierwszą odpowiedź serwera.",
    activeItemTitle: ""
  });

  const device = session?.device ?? null;
  const queue = session?.playback.queue ?? [];
  const currentItem = queue[currentIndex] ?? null;
  const queueSignature = useMemo(() => queue.map((item) => item.id).join("|"), [queue]);
  const deviceTitle = device?.name || "Android TV";
  const playbackLabel = session?.playback.label || "";
  const showHud = !(phase === "playing" && currentItem && device?.desiredDisplayState !== "blackout");

  useEffect(() => {
    heartbeatRef.current = {
      playerState: phaseToHeartbeatState(phase, currentItem?.kind),
      playerMessage: statusMessage,
      activeItemTitle: currentItem?.title || ""
    };
  }, [currentItem?.kind, currentItem?.title, phase, statusMessage]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [queueSignature]);

  useEffect(() => {
    void syncSession("start");
    const interval = window.setInterval(() => {
      void syncSession("heartbeat");
    }, 15000);
    return () => window.clearInterval(interval);
  }, [identity.secret, identity.serial]);

  useEffect(() => {
    if (imageTimerRef.current) {
      window.clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }

    if (phase !== "playing" || !currentItem || currentItem.kind !== "image") {
      return;
    }

    imageTimerRef.current = window.setTimeout(() => {
      advanceQueue();
    }, Math.max(currentItem.durationSeconds, 3) * 1000);

    return () => {
      if (imageTimerRef.current) {
        window.clearTimeout(imageTimerRef.current);
        imageTimerRef.current = null;
      }
    };
  }, [currentItem, phase]);

  useEffect(() => {
    if (!currentItem || currentItem.kind !== "video" || !videoRef.current) {
      return;
    }

    const player = videoRef.current;
    player.volume = clamp(currentItem.volumePercent / 100, 0, 1);
    player.muted = !currentItem.hasAudio;
    void player.play().catch(() => {
      setStatusMessage("Video czeka na możliwość startu w WebView.");
    });
  }, [currentItem]);

  async function syncSession(reason: "start" | "heartbeat" | "reset") {
    const platform = safePlatform();
    if (reason !== "heartbeat") {
      setBusy(true);
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/player/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: identity.serial,
          secret: identity.secret,
          platform,
          appVersion,
          deviceModel: safeDeviceModel(),
          playerState: heartbeatRef.current.playerState,
          playerMessage: heartbeatRef.current.playerMessage,
          activeItemTitle: heartbeatRef.current.activeItemTitle
        })
      });

      const payload = (await response.json()) as { message?: string } & SessionResponse;
      if (!response.ok) {
        throw new Error(payload.message || "Serwer odrzucił sesję urządzenia.");
      }

      setSession(payload);
      setLastSyncAt(payload.serverTime);
      setLastError("");

      if (payload.approvalStatus === "pending") {
        setPhase("waiting");
        setStatusMessage("Urządzenie czeka na zatwierdzenie w CMS.");
        return;
      }

      if (payload.device.desiredDisplayState === "blackout") {
        setPhase("idle");
        setStatusMessage("Ekran został wygaszony przez CMS.");
        return;
      }

      if (payload.playback.mode === "playlist" && payload.playback.queue.length) {
        setPhase("playing");
        setStatusMessage(payload.playback.reason || "Emisja aktywna.");
        return;
      }

      setPhase("idle");
      setStatusMessage(payload.playback.reason || "Brak treści do emisji.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nie udało się połączyć z serwerem.";
      setLastError(message);
      setPhase("error");
      setStatusMessage(message);
    } finally {
      if (reason !== "heartbeat") {
        setBusy(false);
      }
    }
  }

  async function resetApproval() {
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/player/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: identity.serial,
          secret: identity.secret
        })
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "Nie udało się zresetować urządzenia.");
      }

      setStatusMessage("Urządzenie wróciło do kolejki i czeka na ponowny approval.");
      setPhase("waiting");
      await syncSession("reset");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reset urządzenia nie powiódł się.";
      setLastError(message);
      setPhase("error");
      setStatusMessage(message);
    } finally {
      setBusy(false);
    }
  }

  function regenerateIdentity() {
    const next = createIdentity();
    localStorage.setItem(identityStorageKey, JSON.stringify(next));
    setIdentity(next);
    setSession(null);
    setPhase("booting");
    setStatusMessage("Generuję nowy numer seryjny i ponawiam zgłoszenie.");
  }

  function advanceQueue() {
    setCurrentIndex((current) => {
      if (!queue.length) {
        return 0;
      }
      return (current + 1) % queue.length;
    });
  }

  const waitingScreen = (
    <section className="hero-stage waiting">
      <div className="hero-card">
        <span className="eyebrow">Android TV Waiting Room</span>
        <h1 className="serial-code hero-serial">{identity.serial}</h1>
        <p>
          To stały numer seryjny tej instalacji. W CMS wejdź do sekcji <strong>Urządzenia</strong>, wybierz pozycję z
          kolejki i kliknij <strong>Zatwierdź</strong>.
        </p>
        <div className="hero-meta">
          <div>
            <strong>Serwer</strong>
            <span>{apiBaseUrl}</span>
          </div>
          <div>
            <strong>APK</strong>
            <span>{appVersion}</span>
          </div>
          <div>
            <strong>Status</strong>
            <span>{statusMessage}</span>
          </div>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" type="button" onClick={() => void syncSession("start")} disabled={busy}>
            Odśwież zgłoszenie
          </button>
          <button className="ghost-button" type="button" onClick={regenerateIdentity} disabled={busy}>
            Nowy serial
          </button>
        </div>
      </div>
    </section>
  );

  const idleScreen = (
    <section className="hero-stage idle">
      <div className="hero-card compact">
        <span className="eyebrow">Brak emisji</span>
        <h1>{deviceTitle}</h1>
        <p>{statusMessage}</p>
        <div className="hero-meta">
          <div>
            <strong>Klient</strong>
            <span>{device?.clientName || "nie przypisano"}</span>
          </div>
          <div>
            <strong>Kanał</strong>
            <span>{device?.channelName || "nie przypisano"}</span>
          </div>
          <div>
            <strong>Serial</strong>
            <span className="serial-code">{identity.serial}</span>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className={`player-shell ${device?.desiredDisplayState === "blackout" ? "blackout" : ""}`}>
      {showHud ? (
        <header className="hud top">
          <div className="identity-block">
            <span className="eyebrow">Player</span>
            <strong>{deviceTitle}</strong>
            <small>
              ID <span className="serial-code inline-serial">{identity.serial}</span> · {device?.platform || safePlatform()} · APK{" "}
              {appVersion}
            </small>
          </div>
          <div className="hud-actions">
            <span className={`badge ${lastError ? "error" : device?.online || phase !== "error" ? "online" : "idle"}`}>
              {lastError ? "problem" : phase}
            </span>
            <button className="ghost-button" type="button" onClick={() => void resetApproval()} disabled={busy}>
              Reset / rozłącz
            </button>
          </div>
        </header>
      ) : null}

      {phase === "playing" && currentItem && device?.desiredDisplayState !== "blackout" ? (
        <main className="media-stage">
          {currentItem.kind === "video" ? (
            <video
              key={currentItem.id}
              ref={videoRef}
              className="media-surface"
              src={currentItem.url}
              playsInline
              autoPlay
              preload="auto"
              onEnded={advanceQueue}
              onError={() => {
                setStatusMessage(`Nie udało się odtworzyć pliku ${currentItem.title}.`);
                advanceQueue();
              }}
            />
          ) : (
            <img
              key={currentItem.id}
              className="media-surface"
              src={currentItem.url}
              alt={currentItem.title}
              onError={() => {
                setStatusMessage(`Nie udało się wczytać obrazu ${currentItem.title}.`);
                advanceQueue();
              }}
            />
          )}
        </main>
      ) : phase === "waiting" ? (
        waitingScreen
      ) : (
        idleScreen
      )}

      {showHud ? (
        <footer className="hud bottom">
          <div className="status-block">
            <strong>{phase === "playing" ? playbackLabel || currentItem?.title || "Emisja" : statusMessage}</strong>
            <small>
              {phase === "playing"
                ? session?.playback.reason || "Player emituje treść z serwera."
                : lastError || statusMessage}
            </small>
          </div>
          <div className="status-meta">
            <span>{device?.clientName || "bez klienta"}</span>
            <span>{device?.channelName || "bez kanału"}</span>
            <span>{lastSyncAt ? `sync ${formatTime(lastSyncAt)}` : "sync brak"}</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function loadOrCreateIdentity() {
  const raw = localStorage.getItem(identityStorageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DeviceIdentity;
      if (parsed.serial && parsed.secret) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  const next = createIdentity();
  localStorage.setItem(identityStorageKey, JSON.stringify(next));
  return next;
}

function createIdentity(): DeviceIdentity {
  return {
    serial: generateSerial(),
    secret: randomSecret(),
    createdAt: new Date().toISOString()
  };
}

function generateSerial() {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  const suffix = Array.from({ length: 2 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(
    ""
  );
  return `MK${digits}${suffix}`;
}

function randomSecret() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safePlatform() {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "android";
  }
}

function safeDeviceModel() {
  if (typeof navigator === "undefined") {
    return "Android TV";
  }
  return navigator.userAgent.includes("Android") ? "Android TV" : navigator.userAgent;
}

function phaseToHeartbeatState(phase: AppPhase, kind?: MediaKind): PlayerState {
  if (phase === "playing" && kind) {
    return "playing";
  }
  if (phase === "idle") {
    return "idle";
  }
  return "waiting";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export default App;
