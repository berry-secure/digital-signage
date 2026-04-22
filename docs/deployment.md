# Wdrożenie

## 1. PocketBase

Zakładam, że PocketBase działa już w Coolify pod:

- `https://pb.berry-secure.pl`

Zanim odpalisz CMS i player:

1. Ustaw w PocketBase poprawny App URL na `https://pb.berry-secure.pl`.
2. W ustawieniach CORS dodaj co najmniej:
   - `https://cms.berry-secure.pl`
   - `http://localhost`
3. Jeśli kiedyś będziesz robił wersję iOS, dodaj też `capacitor://localhost`.
4. Uruchom skrypt setupu kolekcji z głównego katalogu repo:

```bash
cd /Users/przeczacyklif/Movies/digital-signage
npm install
npm run pocketbase:setup -- \
  --url https://pb.berry-secure.pl \
  --superuserEmail TWOJ_SUPERUSER_EMAIL \
  --superuserPassword 'TWOJE_SUPERUSER_HASLO' \
  --ownerEmail owner@berry-secure.pl \
  --ownerPassword 'MOCNE_HASLO_DO_CMS' \
  --ownerName 'Berry Secure Owner'
```

Jesli uzywasz `zsh`, pamietaj:

- nie wklejaj cudzyslowow `„ ”`, tylko zwykle ASCII `'` albo `"`
- jesli haslo ma znak `!`, wpisz je w apostrofach, np. `'17Grudnia1897!'`

Po tym kroku będziesz mieć gotowe kolekcje:

- `clients`
- `channels`
- `cms_users`
- `screen_users`
- `device_pairings`
- `device_commands`
- `media_assets`
- `playlists`
- `playlist_items`
- `schedule_rules`
- `events`

## 2. CMS w Coolify

Panel ma iść pod:

- `https://cms.berry-secure.pl`

W Coolify utwórz nowy resource z repozytorium i ustaw:

- Base Directory: `apps/cms`
- Install Command: `npm install`
- Build Command: `npm run build`
- Publish Directory: `dist`

Zmienne środowiskowe:

```bash
VITE_POCKETBASE_URL=https://pb.berry-secure.pl
```

Potem przypnij domenę:

- `https://cms.berry-secure.pl`

Po deployu logujesz się kontem z `cms_users`.

## 3. Pierwsza konfiguracja w CMS

Kolejność pracy w panelu:

1. Dodaj klienta.
2. Dodaj kanał dla klienta.
3. Dodaj konto operatora w sekcji `Użytkownicy`, jeśli potrzebujesz dodatkowych loginów.
4. Dodaj media.
5. Dodaj playlistę.
6. Dodaj elementy do playlisty.
7. Dodaj regułę harmonogramu.
8. Zainstaluj playera na Android TV.
9. W sekcji `Urządzenia > Add New Device` wpisz kod pokazany przez TV.

Po sparowaniu CMS utworzy rekord w `screen_users`, a player zaloguje się już sam.

## 4. Build `.apk`

Player siedzi w `apps/player`.

Najpierw potrzebujesz działającej Javy i Android SDK.
Jeśli ich nie masz, sam projekt Android jest już gotowy, ale finalny `.apk` nie zbuduje się lokalnie.

Przygotowanie projektu:

```bash
cd /Users/przeczacyklif/Movies/digital-signage/apps/player
npm install
npm run build
npm run cap:sync
```

Jeśli katalog `android/` dopiero powstaje, jednorazowo uruchom:

```bash
npm run cap:add:android
```

Potem możesz:

```bash
npm run android:open
```

albo bez Android Studio:

```bash
cd /Users/przeczacyklif/Movies/digital-signage
npm run build:android:debug
```

Po buildzie opublikuj plik dokładnie tam, skąd CMS go linkuje:

```bash
cd /Users/przeczacyklif/Movies/digital-signage
npm run publish:apk
```

To skopiuje gotowy build do:

- `apps/cms/public/app/maasck.apk`

Potem:

1. Poczekaj, aż Gradle dociągnie zależności.
2. Podłącz urządzenie albo emulator.
3. Zrób test przez `Run`.
4. Dla gotowego `.apk` wybierz `Build > Build APK(s)`.
5. Dla wersji produkcyjnej podpisz release key i zbuduj release build.
6. Po każdym nowym buildzie znowu uruchom `npm run publish:apk`.

## 5. Pierwsze uruchomienie playera

Na ekranie konfiguracji wpisujesz tylko:

- PocketBase URL: `https://pb.berry-secure.pl`

Potem player:

- generuje kod parowania
- czeka, aż wpiszesz ten kod w CMS
- po sparowaniu sam loguje się do `screen_users`
- zaczyna wysyłać heartbeat, screenshoty i odbierać komendy

Po pierwszym zalogowaniu player pobiera:

- dane ekranu i kanału
- schedule
- eventy override
- playlistę i media

W CMS znajdziesz też:

- status online/offline urządzeń
- ostatni screenshot
- zdalny `sync`
- zdalny `blackout/wake`
- formularz profilu sieciowego urządzenia

Ważne:

- `blackout` to aplikacyjne wygaszenie ekranu, nie zawsze fizyczne wyłączenie panelu TV
- pola sieciowe w CMS są bezpiecznym profilem operacyjnym; na stock Android TV bez MDM / device owner nie da się ich zwykle zastosować całkiem bezdotykowo

## 6. Ważna uwaga o autoplay z dźwiękiem

Player jest przygotowany pod wideo z dźwiękiem, ale pierwszy start na Android TV/WebView może wymagać jednego kliknięcia przycisku `Uruchom odtwarzanie`.
To normalne zabezpieczenie autoplay w webview.
Po pierwszym odblokowaniu kolejne materiały lecą już automatycznie.
