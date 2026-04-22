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
3. Dodaj media.
4. Dodaj playlistę.
5. Dodaj elementy do playlisty.
6. Dodaj regułę harmonogramu.
7. Dodaj ekran w sekcji `Ekrany`.

Przy tworzeniu ekranu CMS zapisze konto w kolekcji `screen_users`.
Te dane wpisujesz później do aplikacji player.

## 4. Build `.apk`

Player siedzi w `apps/player`.

Przygotowanie:

```bash
cd /Users/przeczacyklif/Movies/digital-signage/apps/player
npm install
npm run build
npm run cap:add:android
npm run cap:sync
npm run android:open
```

To otworzy projekt w Android Studio.

Potem:

1. Poczekaj, aż Gradle dociągnie zależności.
2. Podłącz urządzenie albo emulator.
3. Zrób test przez `Run`.
4. Dla gotowego `.apk` wybierz `Build > Build APK(s)`.
5. Dla wersji produkcyjnej podpisz release key i zbuduj release build.

## 5. Pierwsze uruchomienie playera

Na ekranie konfiguracji wpisujesz:

- PocketBase URL: `https://pb.berry-secure.pl`
- Email ekranu: z `screen_users`
- Hasło ekranu: z `screen_users`

Po pierwszym zalogowaniu player pobiera:

- dane ekranu i kanału
- schedule
- eventy override
- playlistę i media

## 6. Ważna uwaga o autoplay z dźwiękiem

Player jest przygotowany pod wideo z dźwiękiem, ale pierwszy start na Android TV/WebView może wymagać jednego kliknięcia przycisku `Uruchom odtwarzanie`.
To normalne zabezpieczenie autoplay w webview.
Po pierwszym odblokowaniu kolejne materiały lecą już automatycznie.
