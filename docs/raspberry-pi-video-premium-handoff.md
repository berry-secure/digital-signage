# Signal Deck Raspberry Pi 5 Video Premium Handoff

Ten dokument jest instrukcja do nowego watku, w ktorym ma powstac skrypt przygotowujacy Raspberry Pi OS Lite 64-bit pod fizyczny player Signal Deck `Video Premium`.

## Kontekst projektu

- Repozytorium lokalne: `/Users/przeczacyklif/Movies/digital-signage`
- Repozytorium GitHub: `https://github.com/berry-secure/digital-signage.git`
- Produkcyjny CMS/API: `https://cms.berry-secure.pl`
- Aktualny player Android TV juz dziala z CMS, a backend ma endpointy device session, live commands, device logs i playback events.
- Ten etap dotyczy nowego fizycznego playera Raspberry Pi 5, bez psucia Android TV/APK.

## Cel

Przygotowac skrypt instalacyjny dla swiezego Raspberry Pi OS Lite 64-bit na Raspberry Pi 5, ktory zamienia system w zarzadzany player `Video Premium`:

- dwa wyjscia HDMI jako dwa kanaly wideo, domyslnie niezalezne, ale z opcja lokalnej synchronizacji,
- lokalny cache mediow,
- outbound HTTPS do CMS,
- local WebUI do konfiguracji,
- hotspot setup, kiedy brakuje konfiguracji albo usunieto marker konfiguracji,
- systemd agent i watchdog,
- integracja z obecnym CMS przez istniejace endpointy,
- brak osobnego kanalu audio w tym etapie.

Raspberry Pi 5 nie ma analogowego jacka audio. Oficjalne materialy Raspberry Pi potwierdzaja, ze analog audio/composite jack zostal usuniety z Pi 5, a konfiguracja audio przewiduje HDMI i USB audio. W tym wariancie rezygnujemy z osobnej playlisty audio/USB audio. Player ma byc dual HDMI video.

Zrodla sprzetowe do uwzglednienia:

- Raspberry Pi 5 ma dual micro HDMI i obsluge dwoch ekranow: https://www.raspberrypi.com/documentation/computers/configuration.html
- Raspberry Pi 5 nie ma analogowego jacka audio: https://www.raspberrypi.com/news/introducing-raspberry-pi-5/
- Raspberry Pi OS Lite jest sensowna baza pod headless playera: https://www.raspberrypi.com/documentation/setup/raspberry-pi.html

## Zakres v1

Zrobic:

- `scripts/rpi/install-video-premium.sh` jako idempotentny instalator uruchamiany przez `sudo`.
- Agent playera pod RPi 5 jako lekki serwis systemd, najlepiej Python albo Go.
- Dwa logiczne urzadzenia CMS z jednego fizycznego Raspberry Pi:
  - `SERIALA` dla `HDMI-A-1`,
  - `SERIALB` dla `HDMI-A-2`.
- Kazde logiczne urzadzenie wysyla osobny heartbeat do `/api/player/session`.
- Kazde logiczne urzadzenie jest zatwierdzane osobno w CMS jako `Video Premium` i przypisywane do swojego kanalu.
- Kazde wyjscie HDMI odtwarza wlasna kolejke z CMS.
- Agent ma miec tryb synchronizacji obu wyjsc HDMI pod menuboardy i proste videowalle.
- Hotspot `SignalDeck-XXXX` i WebUI, gdy konfiguracji nie ma.
- Reset setupu przez usuniecie `/boot/firmware/SIGNALDECK_LOCK`.
- Logowanie bledow do `/api/player/logs`.
- Live commands minimum:
  - `force_sync`,
  - `force_playlist_update`,
  - `restart_app`,
  - `reboot_os`,
  - `blackout`,
  - `wake`,
  - `clear_cache`,
  - `upload_logs`,
  - `set_volume` jako no-op albo per-output volume, jesli runtime to obsluzy.

Nie robic jeszcze:

- osobnego kanalu audio,
- USB audio,
- Proof of Play,
- podpisanych auto-update paczek,
- natywnych screenshotow, jesli wymagaja dodatkowego DRM/kmsgrab researchu,
- zmian w CMS modelu na `outputs[]`; v1 ma dzialac z obecnym `Device.channelId`.

## Wymagany sprzet

- Raspberry Pi 5, najlepiej 8 GB RAM, z aktywnym chlodzeniem.
- Oficjalny albo pewny zasilacz USB-C dla RPi 5.
- Karta microSD 32 GB lub wieksza, albo SSD NVMe/USB po pierwszym prototypie.
- Dwa kable micro-HDMI -> HDMI.
- Dwa ekrany HDMI.
- Ethernet podczas pierwszych testow jest zalecany, Wi-Fi ma byc konfigurowalne przez WebUI.

## Obraz systemu

Baza:

- Raspberry Pi OS Lite 64-bit.
- Hostname docelowy: `signaldeck-rpi5`.
- SSH moze byc wlaczone tylko na czas serwisu; docelowo opcjonalne.
- Uzytkownik techniczny: `signaldeck`.

Instalator ma wykrywac:

- architekture `aarch64`,
- Raspberry Pi 5 przez `/proc/device-tree/model`,
- uprawnienia roota,
- istnienie `/boot/firmware`,
- czy system uzywa NetworkManager.

Jesli warunki nie sa spelnione, skrypt ma przerwac z czytelnym komunikatem.

## Model urzadzen w obecnym CMS

Obecny CMS ma jedno `channelId` na `Device`. Zamiast przebudowywac model bazy, fizyczny RPi 5 ma rejestrowac dwa logiczne playery:

- output 1:
  - connector: `HDMI-A-1`
  - serial: `MK<BASE>A`
  - playerType: `video_premium`
- output 2:
  - connector: `HDMI-A-2`
  - serial: `MK<BASE>B`
  - playerType: `video_premium`

`<BASE>` powinien byc deterministyczny dla plytki, np. z:

- `/proc/cpuinfo` serial,
- `/etc/machine-id`,
- albo wygenerowanego UUID zapisanego w `/var/lib/signaldeck/identity.json`.

Wazne: seriale musza zawierac tylko wielkie litery i cyfry, bo backend normalizuje serial do `A-Z0-9`.

W CMS uzytkownik zobaczy dwa pending devices i zatwierdzi je osobno:

- np. `Lobby Left`,
- np. `Lobby Right`.

## Aktualny protokol CMS

Agent ma korzystac z tych endpointow:

### Session / heartbeat

`POST https://cms.berry-secure.pl/api/player/session`

Body per output:

```json
{
  "serial": "MK12345678A",
  "secret": "persistent-device-secret",
  "platform": "raspberrypi",
  "appVersion": "rpi-video-premium-0.1.0",
  "deviceModel": "Raspberry Pi 5",
  "playerState": "waiting",
  "playerMessage": "HDMI-A-1 waiting for approval",
  "activeItemTitle": ""
}
```

Response:

```json
{
  "device": {
    "id": "...",
    "approvalStatus": "approved",
    "desiredDisplayState": "active",
    "volumePercent": 80
  },
  "approvalStatus": "approved",
  "playback": {
    "mode": "playlist",
    "queue": [
      {
        "id": "playlist-item-id:0",
        "playlistId": "...",
        "title": "Clip",
        "kind": "video",
        "url": "https://cms.berry-secure.pl/uploads/file.mp4",
        "durationSeconds": 30,
        "volumePercent": 100,
        "hasAudio": true,
        "sourceType": "playlist"
      }
    ],
    "label": "Main schedule",
    "reason": "Aktywny harmonogram...",
    "fallbackUsed": false
  },
  "commands": [],
  "serverTime": "2026-04-25T00:00:00.000Z"
}
```

### Command ACK

`POST /api/player/commands/:id/ack`

```json
{
  "serial": "MK12345678A",
  "secret": "persistent-device-secret",
  "status": "acked",
  "message": "Command applied"
}
```

### Device logs

`POST /api/player/logs`

```json
{
  "serial": "MK12345678A",
  "secret": "persistent-device-secret",
  "severity": "error",
  "component": "playback",
  "message": "mpv failed to start media",
  "stack": "",
  "context": {
    "output": "HDMI-A-1",
    "mediaId": "playlist-item-id:0",
    "url": "https://cms.berry-secure.pl/uploads/file.mp4"
  },
  "appVersion": "rpi-video-premium-0.1.0",
  "osVersion": "Raspberry Pi OS Lite 64-bit",
  "networkStatus": "online"
}
```

### Reset

`POST /api/player/reset` moze byc dostepne z WebUI jako przycisk rozlaczenia logicznego outputu, ale v1 moze ograniczyc sie do resetu lokalnej konfiguracji przez marker boot.

## Playback runtime

Rekomendowany runtime dla v1:

- Python/Go agent do protokolu, cache i sterowania procesami.
- `mpv` jako odtwarzacz per output.
- Kazdy output ma osobny proces albo kontrolowany subprocess `mpv`.
- Agent pobiera media do cache przed odtworzeniem.
- Agent nigdy nie streamuje stale z CMS, jesli plik jest juz w cache.

Minimalna logika:

- `kind=video`: odtwarzaj przez `mpv`.
- `kind=image`: pokaz obraz przez `mpv` z czasem `durationSeconds`.
- `kind=audio`: w v1 pomin i zglos `warn` do `/api/player/logs`, bo ten player nie obsluguje osobnej playlisty audio.
- `desiredDisplayState=blackout`: zatrzymaj/ukryj output i pokaz czarny ekran.
- Brak playlisty: czarny ekran albo subtelny ekran idle lokalny.

Do sprawdzenia podczas implementacji:

- Jak najlepiej przypiac `mpv` do konkretnego connectora na Raspberry Pi OS Lite 64:
  - preferowane: DRM/KMS connector `HDMI-A-1` i `HDMI-A-2`,
  - fallback: minimalny compositor/Wayland/X11 i dwa fullscreen windows.

Implementacja ma najpierw zrobic probe connectorow:

```bash
ls /sys/class/drm/
```

Oczekiwane nazwy:

- `card1-HDMI-A-1`,
- `card1-HDMI-A-2`,

ale skrypt nie moze zakladac `card1` na sztywno. Ma wykryc connector przez suffix `HDMI-A-1` i `HDMI-A-2`.

## HDMI output synchronization

Dwa wyjscia HDMI w `Video Premium` beda kusily klientow do menuboardow i prostych videowalli, dlatego synchronizacja musi byc uwzgledniona od pierwszego projektu agenta.

Aktualny CMS nadal widzi dwa logiczne urzadzenia, bo ma jedno `channelId` na `Device`. Synchronizacja w v1 dzieje sie lokalnie na RPi:

- `HDMI-A-1` i `HDMI-A-2` pobieraja osobne sesje/playlisty z CMS.
- Agent grupuje oba outputy w lokalny `sync_group`.
- Agent czeka, az oba outputy maja approval, aktualna kolejke i pobrane pliki startowe w cache.
- Agent uruchamia oba outputy z jednego monotonicznego zegara systemowego.
- Kazdy kolejny slot playlisty jest liczony wzgledem wspolnej osi czasu, a nie tylko przez `onEnded` pojedynczego procesu.

Tryby:

- `independent`: domyslnie, outputy dzialaja osobno.
- `paired_start`: outputy startuja razem po pobraniu materialow, potem kazdy idzie swoim playbackiem.
- `clocked_playlist`: outputy startuja razem i przechodza przez kolejne sloty wedlug wspolnego timeline'u.

Wymagania dla `clocked_playlist`:

- Obie playlisty powinny miec taka sama liczbe slotow w petli.
- Sloty o tym samym indeksie powinny miec taki sam `durationSeconds`.
- Agent toleruje mala roznice, np. `sync_tolerance_ms = 250`.
- Jesli czasy slotow albo liczba slotow sie nie zgadzaja, agent raportuje `warn` do `/api/player/logs`.
- Przy `sync_policy = "best_effort"` agent gra dalej i probuje dosynchronizowac kolejny slot.
- Przy `sync_policy = "strict"` agent pokazuje czarny ekran na grupie i czeka na zgodne playlisty.

To nie jest broadcastowy genlock ani gwarancja frame-perfect. Celem v1 jest praktyczna synchronizacja menuboard/videowall na jednym RPi 5, najlepiej ponizej 250 ms roznicy startu slotow, z mozliwoscia dalszego strojenia po testach na fizycznym sprzecie.

WebUI ma pokazac:

- status sync group,
- roznice startu ostatniego slotu per output,
- czy playlisty sa zgodne czasowo,
- przycisk `Resync group`.

Live commands w trybie sync:

- `force_sync`: synchronizuje cala grupe, jesli output nalezy do `sync_group`.
- `force_playlist_update`: odswieza kolejki obu outputow w grupie.
- `blackout` i `wake`: w v1 moga dzialac per output, ale WebUI powinno miec opcje `group_blackout = true`, ktora stosuje blackout/wake na oba HDMI.

## Cache

Katalogi:

- `/var/lib/signaldeck/cache/HDMI-A-1`
- `/var/lib/signaldeck/cache/HDMI-A-2`
- `/var/lib/signaldeck/manifests`
- `/var/log/signaldeck`

Cache key:

- najlepiej checksum/contentVersion, jesli API juz je zwraca,
- fallback: hash z URL + `id`.

Zasady:

- pobierz plik do `*.partial`,
- po udanym pobraniu atomowo przenies na docelowa nazwe,
- nie kasuj pliku aktualnie odtwarzanego,
- utrzymuj limit cache, np. 20 GB albo 70% partycji,
- jezeli CMS jest offline, graj ostatnia poprawna kolejke z cache.

## Local WebUI

WebUI ma dzialac lokalnie:

- `http://player.local:8080`, jesli mDNS dziala,
- `http://10.42.0.1:8080` w trybie hotspot,
- `http://<adres-lan>:8080` w LAN.

Minimalne ekrany:

- status:
  - base serial,
  - serial HDMI-A-1,
  - serial HDMI-A-2,
  - sync mode,
  - sync group status,
  - server URL,
  - network status,
  - CMS approval status obu outputow,
  - aktualny material per output,
  - wersja agenta,
  - temperatura RPi,
  - miejsce na dysku/cache.
- konfiguracja:
  - server URL, domyslnie `https://cms.berry-secure.pl`,
  - Wi-Fi SSID i haslo,
  - DHCP/static LAN,
  - test polaczenia z CMS,
  - reset lokalnej konfiguracji,
  - restart agenta,
  - reboot OS.

Haslo WebUI:

- wygenerowac przy instalacji,
- zapisac w `/etc/signaldeck/webui.secret`,
- pokazac w konsoli po instalacji,
- w trybie hotspot mozna dopuscic pierwszy setup bez hasla tylko do momentu zapisania konfiguracji.

## Hotspot setup

Warunek wejscia w setup mode:

- brak `/etc/signaldeck/player.toml`,
- albo brak `/boot/firmware/SIGNALDECK_LOCK`,
- albo jawne `sudo signaldeck-setup-mode`.

Hotspot:

- SSID: `SignalDeck-XXXX`, gdzie `XXXX` to koncowka base serial.
- IP: `10.42.0.1/24`.
- DHCP dla klientow hotspotu.
- WebUI: `http://10.42.0.1:8080`.

Po zapisaniu poprawnej konfiguracji:

- utworz `/boot/firmware/SIGNALDECK_LOCK`,
- wylacz hotspot,
- wlacz normalny network mode,
- restart `signaldeck-agent`.

Reset configu:

```bash
sudo rm /boot/firmware/SIGNALDECK_LOCK
sudo reboot
```

Po restarcie ma wystartowac hotspot/WebUI setup.

## Instalator

Docelowy plik w repo:

`scripts/rpi/install-video-premium.sh`

Uruchomienie na RPi:

```bash
curl -fsSL https://raw.githubusercontent.com/berry-secure/digital-signage/main/scripts/rpi/install-video-premium.sh -o install-signaldeck.sh
sudo bash install-signaldeck.sh
```

Na czas dev mozna kopiowac lokalnie:

```bash
scp scripts/rpi/install-video-premium.sh pi@raspberrypi.local:/tmp/install-signaldeck.sh
ssh pi@raspberrypi.local
sudo bash /tmp/install-signaldeck.sh
```

Instalator ma byc idempotentny:

- mozna go odpalic drugi raz bez psucia konfiguracji,
- nie nadpisuje `player.toml`, jesli istnieje,
- aktualizuje tylko pliki zarzadzane w oznaczonych blokach,
- robi backup zmienianych plikow do `/var/lib/signaldeck/backups`.

Pakiety startowe:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl jq openssl git \
  python3 python3-venv python3-pip \
  network-manager avahi-daemon \
  mpv \
  unclutter \
  unattended-upgrades \
  ufw
```

Pakiety moga sie zmienic po probe runtime. Jesli implementacja wybierze Go, instalator moze pobierac gotowy binary zamiast instalowac zaleznosci Python.

## Pliki konfiguracyjne

`/etc/signaldeck/player.toml`:

```toml
server_url = "https://cms.berry-secure.pl"
device_model = "Raspberry Pi 5"
player_type = "video_premium"
app_version = "rpi-video-premium-0.1.0"
cache_limit_mb = 20480
heartbeat_interval_seconds = 15

[sync]
mode = "clocked_playlist"
group = "dual-hdmi"
policy = "best_effort"
tolerance_ms = 250
group_blackout = true

[[outputs]]
name = "HDMI-A-1"
serial_suffix = "A"
enabled = true

[[outputs]]
name = "HDMI-A-2"
serial_suffix = "B"
enabled = true
```

`/var/lib/signaldeck/identity.json`:

```json
{
  "baseSerial": "MK5AB12CD34",
  "outputs": {
    "HDMI-A-1": {
      "serial": "MK5AB12CD34A",
      "secret": "uuid-or-random-token"
    },
    "HDMI-A-2": {
      "serial": "MK5AB12CD34B",
      "secret": "uuid-or-random-token"
    }
  }
}
```

Permissions:

```bash
sudo chown -R signaldeck:signaldeck /var/lib/signaldeck /var/log/signaldeck
sudo chmod 600 /var/lib/signaldeck/identity.json
sudo chmod 600 /etc/signaldeck/player.toml
```

## Systemd

`/etc/systemd/system/signaldeck-agent.service`:

```ini
[Unit]
Description=Signal Deck Raspberry Pi Video Premium Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=signaldeck
Group=signaldeck
WorkingDirectory=/opt/signaldeck
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/signaldeck/venv/bin/python -m signaldeck_agent
Restart=always
RestartSec=3
WatchdogSec=30

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/signaldeck-webui.service`:

```ini
[Unit]
Description=Signal Deck Local Setup WebUI
After=network.target

[Service]
Type=simple
User=signaldeck
Group=signaldeck
WorkingDirectory=/opt/signaldeck
ExecStart=/opt/signaldeck/venv/bin/python -m signaldeck_webui --host 0.0.0.0 --port 8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Setup/hotspot moze byc osobnym service albo funkcja WebUI/agentu, ale musi byc kontrolowany przez systemd i logowany przez journald.

## NetworkManager hotspot

Instalator powinien utworzyc profil hotspotu, ale aktywowac go tylko w setup mode:

```bash
sudo nmcli connection add type wifi ifname wlan0 con-name SignalDeck-Setup autoconnect no ssid SignalDeck-XXXX
sudo nmcli connection modify SignalDeck-Setup 802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared
sudo nmcli connection modify SignalDeck-Setup wifi-sec.key-mgmt wpa-psk wifi-sec.psk "GENERATED-PASSWORD"
```

Haslo hotspotu zapisac w:

`/etc/signaldeck/hotspot.secret`

## Hardening

W v1 wystarczy praktyczny baseline:

- `unattended-upgrades` wlaczone dla security updates,
- `ufw`:
  - allow 8080 tylko z LAN/hotspot,
  - allow SSH tylko jesli uzytkownik jawnie wlaczy,
  - outbound HTTPS do CMS,
- pliki sekretow `0600`,
- agent jako nie-root,
- brak zapisywania hasel Wi-Fi w logach,
- journald z rotacja.

Nie blokowac sobie serwisu zbyt agresywnie na pierwszym prototypie. Najpierw ma dzialac stabilny playback.

## Live commands mapping

Per-output:

- `force_sync`: natychmiast pobierz session dla danego outputu.
- `force_playlist_update`: wyczysc manifest outputu i pobierz kolejke.
- `blackout`: zatrzymaj playback outputu i pokaz czarny ekran.
- `wake`: wznow playback outputu.
- `set_volume`: jezeli mpv per-output volume dziala, ustaw; jesli nie, ACK z komunikatem no-op.

Globalne, jesli przyjda na ktorykolwiek output:

- `restart_app`: restart `signaldeck-agent`.
- `reboot_os`: `systemctl reboot`.
- `clear_cache`: wyczysc cache obu outputow, ale nie kasuj aktualnie odtwarzanego pliku.
- `upload_logs`: w v1 ACK i wpis w device logs, pelny upload moze poczekac.

Nieobslugiwane w v1:

- `screenshot`: ACK failed albo `requires agent v2 screenshot support`, chyba ze implementacja doda stabilny capture.
- `rotate_secret`: dopiero po zaprojektowaniu bezpiecznego flow po stronie CMS.

## Logi i diagnostyka

Lokalnie:

```bash
journalctl -u signaldeck-agent -f
journalctl -u signaldeck-webui -f
systemctl status signaldeck-agent
systemctl status signaldeck-webui
```

Do CMS raportowac:

- `severity`: `info`, `warn`, `error`,
- `component`: `agent`, `network`, `playback`, `cache`, `hotspot`, `webui`, `display`,
- `message`: czytelny komunikat,
- `context.output`: `HDMI-A-1` albo `HDMI-A-2`,
- `appVersion`,
- `osVersion`,
- `networkStatus`.

## Acceptance checklist

Player jest gotowy do pierwszego testu, gdy:

1. Swiezy Raspberry Pi OS Lite 64 po instalacji startuje bez desktopu.
2. Gdy nie ma konfiguracji, pojawia sie hotspot `SignalDeck-XXXX`.
3. WebUI jest dostepne pod `http://10.42.0.1:8080`.
4. Po zapisaniu `server_url=https://cms.berry-secure.pl` i restarcie hotspot gasnie.
5. W CMS pojawiaja sie dwa pending devices.
6. Oba pending devices mozna zatwierdzic jako `Video Premium`.
7. Kazdy output mozna przypisac do innego kanalu CMS.
8. HDMI-A-1 odtwarza playliste przypisana do pierwszego logicznego device.
9. HDMI-A-2 odtwarza playliste przypisana do drugiego logicznego device.
10. Po wlaczeniu `clocked_playlist` oba outputy czekaja na cache i startuja wspolnie.
11. Dwie zgodne czasowo playlisty utrzymuja sloty w synchronizacji.
12. Niezgodne playlisty generuja `warn` w CMS `Logi`.
13. Blackout/wake dziala osobno per output albo grupowo, zaleznie od `group_blackout`.
14. Po odlaczeniu internetu player gra ostatnia poprawna kolejke z cache.
15. Bledy playbacku widac w CMS w sekcji `Logi`.
16. Usuniecie `/boot/firmware/SIGNALDECK_LOCK` i reboot wraca do setup mode.

## Prompt do nowego watku

Wklej ponizszy tekst do nowego watku:

```text
Pracujemy nad repo:
/Users/przeczacyklif/Movies/digital-signage

GitHub:
https://github.com/berry-secure/digital-signage.git

Produkcyjny CMS/API:
https://cms.berry-secure.pl

Zadanie:
Zaimplementuj pierwszy pakiet Raspberry Pi 5 Video Premium player. Ma powstac skrypt `scripts/rpi/install-video-premium.sh` dla swiezego Raspberry Pi OS Lite 64-bit oraz minimalny agent/WebUI, jezeli repo jeszcze ich nie ma.

Wymagania:
- RPi 5, dwa wyjscia HDMI, domyslnie niezalezne, z opcja lokalnej synchronizacji pod menuboard/videowall.
- Bez osobnego audio/USB audio w v1.
- Obecny CMS ma jedno `channelId` na Device, wiec fizyczny RPi 5 ma rejestrowac dwa logiczne urzadzenia:
  - `HDMI-A-1` jako serial bazowy + `A`,
  - `HDMI-A-2` jako serial bazowy + `B`.
- Oba logiczne urzadzenia korzystaja z istniejacych endpointow:
  - `POST /api/player/session`,
  - `POST /api/player/commands/:id/ack`,
  - `POST /api/player/logs`.
- `playerType` w CMS: `video_premium`.
- Hotspot setup `SignalDeck-XXXX`, WebUI na `http://10.42.0.1:8080` i `http://player.local:8080`.
- Reset setupu przez usuniecie `/boot/firmware/SIGNALDECK_LOCK`.
- Lokalny cache mediow.
- Tryb sync dla obu HDMI:
  - `independent`,
  - `paired_start`,
  - `clocked_playlist`.
- Synchronizacja ma byc lokalna w RPi agencie, mimo ze CMS widzi dwa logiczne devices.
- W `clocked_playlist` agent ma czekac na cache obu outputow i startowac sloty wedlug wspolnego monotonicznego zegara.
- Jesli playlisty nie maja zgodnych slotow/czasow, agent raportuje `warn` do `/api/player/logs`.
- systemd services, watchdog, unattended security updates.
- Playback przez mpv albo inny stabilny runtime, po jednym runtime/procesie na output.
- `kind=video` i `kind=image` obslugiwane.
- `kind=audio` w v1 pomijane z warningiem do device logs.
- Nie psuj obecnego Android TV playera i APK.

Najpierw przeczytaj:
docs/raspberry-pi-video-premium-handoff.md

Przed kodowaniem sprawdz aktualny backend contract i przygotuj plan. Potem implementuj malymi krokami z testami tam, gdzie da sie testowac bez fizycznego RPi.
```

## Otwarte decyzje dla implementacji

- Czy agent piszemy w Pythonie czy Go. Python bedzie szybszy do prototypu WebUI; Go bedzie latwiejszy jako pojedynczy binary.
- Czy playback runtime finalnie idzie przez czysty DRM/KMS `mpv`, czy przez minimalny compositor. Pierwszy prototyp powinien zrobic probe na realnym RPi 5.
- Czy w nastepnym etapie CMS dostanie natywne `DeviceOutput[]`, zamiast dwoch logicznych devices.
