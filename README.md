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
- player loguje się przez kolekcję `screen_users`
- scheduling i eventy wybierają playlistę na podstawie kanału, daty, godzin i priorytetu
- pliki media są chronione file tokenem PocketBase
- pierwszy start odtwarzania w playerze wymaga jednego kliknięcia, żeby Android/WebView pozwolił grać wideo z dźwiękiem

## Co dalej po setupie

1. Wejdź na `https://cms.berry-secure.pl`
2. Zaloguj się kontem `owner@berry-secure.pl` albo tym, które podałeś w setupie
3. Dodaj klienta, kanał, media, playlistę, regułę schedule i konto ekranu
4. W playerze wpisz dane konta ekranu z `screen_users`

Szczegóły wdrożenia są w [docs/deployment.md](/Users/przeczacyklif/Movies/digital-signage/docs/deployment.md).
