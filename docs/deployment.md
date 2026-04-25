# Wdrożenie Signal Deck

Aktualna produkcja działa na VPS z Coolify pod:

- `https://cms.berry-secure.pl`

Ta domena jest aktualnym production defaultem. Kod nadal korzysta z envów (`PUBLIC_BASE_URL`, `DATABASE_URL`, później `API_BASE_URL` / `UPDATE_BASE_URL`), żeby w przyszłości dało się zmienić domenę albo przenieść platformę na inny VPS bez przepisywania logiki aplikacji.

## 1. Coolify Resource

W Coolify trzymaj jeden główny serwis dla CMS + API:

- Repository: `https://github.com/berry-secure/digital-signage.git`
- Branch: docelowo `main`
- Build Pack: `Dockerfile`
- Dockerfile location: `/Dockerfile`
- Port aplikacji: `3000`
- Public domain: `https://cms.berry-secure.pl`

Repo zawiera `Dockerfile` oparty o oficjalny obraz `node:22-bookworm-slim`. To omija problem Nixpacks, który potrafi wybrać Node `22.11.0`, a Prisma 7 wymaga minimum `22.12.0`.

Backend serwuje:

- API pod `/api/*`
- CMS z `apps/cms/dist`
- APK pod `/app/maasck.apk`
- uploady pod `/uploads/*`

## 2. Env W Coolify

Minimalne envy dla obecnej produkcji:

```bash
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://cms.berry-secure.pl
ADMIN_EMAIL=owner@berry-secure.pl
ADMIN_PASSWORD=TU_MOCNE_HASLO_ADMINA
ADMIN_NAME=Berry Secure Owner
DATA_DIR=/data
```

Jeśli uruchamiasz już PostgreSQL w Coolify, dodaj:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
```

Bez `DATABASE_URL` backend działa w trybie JSON storage i czyta/zapisuje:

```bash
/data/app-db.json
/data/uploads
```

Z `DATABASE_URL` backend przełącza się na Prisma/PostgreSQL. Pliki media nadal zostają lokalnie w `DATA_DIR/uploads`, więc dla produkcji wolumen `/data` nadal musi być trwały.

## 3. PostgreSQL W Coolify

Bezpieczna kolejność przejścia z JSON storage na PostgreSQL:

1. Zrób backup wolumenu `/data`, szczególnie:

```bash
/data/app-db.json
/data/uploads
```

2. Utwórz PostgreSQL resource w Coolify.
3. Skopiuj connection string do `DATABASE_URL`.
4. Przed deployem z `DATABASE_URL` uruchom migrację schematu jako one-off command w tym samym środowisku/envie:

```bash
npm run prisma:migrate:deploy --workspace @ds/server
```

Na produkcji używamy `migrate deploy`, nie `migrate dev`. `migrate dev` jest tylko lokalnie do tworzenia nowych migracji.

5. Najpierw zrób dry-run importu obecnego JSON:

```bash
npm run migrate:json:postgres -- --data /data/app-db.json
```

6. Dopiero jeśli liczby wyglądają dobrze, wykonaj import:

```bash
npm run migrate:json:postgres -- --data /data/app-db.json --apply
```

`--apply` wymaga `DATABASE_URL`. Skrypt usuwa zawartość tabel zarządzanych przez Signal Deck i wstawia dane z JSON, więc używaj go tylko w kontrolowanym oknie migracji po backupie.

## 4. Build APK

Player siedzi w `apps/player`.

Lokalny debug build:

```bash
cd /Users/przeczacyklif/Movies/digital-signage
npm run build:android:debug
```

Publikacja APK do CMS:

```bash
npm run publish:apk
```

To kopiuje build do:

```bash
apps/cms/public/app/maasck.apk
```

Po deployu CMS link będzie dostępny pod:

```bash
https://cms.berry-secure.pl/app/maasck.apk
```

## 5. Player Android TV

Obecny player produkcyjnie łączy się z:

```bash
https://cms.berry-secure.pl
```

Flow pozostaje bez zmian:

1. Player generuje stały serial i lokalny secret.
2. Wysyła `/api/player/session`.
3. Jeśli jest nowy, trafia do kolejki jako `pending`.
4. CMS zatwierdza urządzenie i przypina klienta/kanał.
5. Player pobiera playlistę i emituje treści.

## 6. Ważne Zasady

- Nie zmieniaj domeny produkcyjnej teraz; trzymaj `PUBLIC_BASE_URL=https://cms.berry-secure.pl`.
- Nie ustawiaj `DATABASE_URL` bez `npm run prisma:migrate:deploy --workspace @ds/server` i dry-run importu JSON.
- Nie uruchamiaj `migrate:json:postgres -- --apply` bez backupu `/data`.
- Uploady zostają na trwałym wolumenie `/data/uploads`, dopóki nie przejdziemy na storage S3-ready.
- `blackout` to aplikacyjne wygaszenie ekranu, nie gwarantowane fizyczne wyłączenie panelu TV.
