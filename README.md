# Signal Deck

Lekki system Digital Signage pod PocketBase i prosty VPS z Coolify.

W repo są dwie gotowe aplikacje:

- `apps/cms` - minimalistyczny panel CMS pod `https://cms.berry-secure.pl`
- `apps/player` - aplikacja odbiorcza pod Android/Android TV, pakowana do `.apk` przez Capacitor

Do tego dochodzi:

- `scripts/setup-pocketbase.mjs` - skrypt zakładający kolekcje i konto startowe `cms_users`
- `docs/deployment.md` - instrukcja wdrożenia pod Twoje domeny
- `docs/pocketbase-model.md` - opis modelu danych i przepływu

## Stack

- React + Vite dla CMS
- React + Vite + Capacitor dla playera
- PocketBase jako backend, storage, auth i realtime

## Szybki start

1. Zainstaluj zależności:

```bash
cd /Users/przeczacyklif/Movies/digital-signage
npm install
```

2. Skonfiguruj PocketBase na `https://pb.berry-secure.pl`:

```bash
npm run pocketbase:setup -- \
  --url https://pb.berry-secure.pl \
  --superuserEmail TWOJ_SUPERUSER_EMAIL \
  --superuserPassword 'TWOJE_SUPERUSER_HASLO' \
  --ownerEmail owner@berry-secure.pl \
  --ownerPassword 'MOCNE_HASLO_DO_CMS' \
  --ownerName 'Berry Secure Owner'
```

Wazne przy `zsh`:

- uzywaj zwyklych znakow `'` albo `"` z klawiatury, nie typograficznych `„ ”`
- hasla ze znakiem `!` zawsze najlepiej dawaj w zwyklych apostrofach, np. `'MojeHaslo!'`

3. Uruchom lokalnie CMS:

```bash
npm run dev:cms
```

4. Uruchom lokalnie player:

```bash
npm run dev:player
```

## Najważniejsze założenia

- CMS loguje się przez kolekcję `cms_users`
- player po instalacji pokazuje kod parowania i dopiero potem loguje się do kolekcji `screen_users`
- CMS ma moduł zarządzania użytkownikami, parowania urządzeń, screenshotów i zdalnych komend
- scheduling i eventy wybierają playlistę na podstawie kanału, daty, godzin i priorytetu
- pliki media są chronione file tokenem PocketBase
- pierwszy start odtwarzania w playerze wymaga jednego kliknięcia, żeby Android/WebView pozwolił grać wideo z dźwiękiem
- polecenie "wyłącz ekran" działa jako aplikacyjny blackout; na stock Android TV nie jest to twarde odcięcie zasilania matrycy
- pola sieciowe w CMS działają jako profil operacyjny; bez uprawnień MDM / device owner aplikacja nie zmieni tych ustawień po cichu

## Co dalej po setupie

1. Wejdź na `https://cms.berry-secure.pl`
2. Zaloguj się kontem `owner@berry-secure.pl` albo tym, które podałeś w setupie
3. Dodaj klienta, kanał, użytkownika CMS i media
4. Zbuduj lub opublikuj APK playera
5. Zainstaluj APK na Android TV i odczytaj kod parowania
6. W CMS przejdź do `Urządzenia > Add New Device`, wpisz kod i przypnij klienta oraz kanał
7. Player zaloguje się sam, zacznie wysyłać heartbeat i screenshoty

Szczegóły wdrożenia są w [docs/deployment.md](/Users/przeczacyklif/Movies/digital-signage/docs/deployment.md).
