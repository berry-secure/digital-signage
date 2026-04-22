# Model PocketBase

## Kolekcje

### `clients`

Tenant systemu.

Pola:

- `name`
- `slug`
- `brandColor`

### `channels`

Grupy ekranów danego klienta.

Pola:

- `client`
- `name`
- `slug`
- `description`
- `orientation`

### `cms_users`

Użytkownicy panelu CMS.

Pola:

- `name`
- `role`
- `client`

### `screen_users`

Konta logowania dla playerów.

Pola:

- `name`
- `client`
- `channel`
- `locationLabel`
- `status`
- `volumePercent`
- `lastSeenAt`
- `lastPlaybackAt`
- `notes`

### `media_assets`

Biblioteka plików.

Pola:

- `client`
- `title`
- `kind`
- `asset`
- `durationSeconds`
- `hasAudio`
- `status`
- `tags`

### `playlists`

Logiczne listy emisji.

Pola:

- `client`
- `channel`
- `name`
- `isActive`
- `notes`

### `playlist_items`

Elementy playlisty z kolejnością i loopami.

Pola:

- `client`
- `playlist`
- `mediaAsset`
- `sortOrder`
- `loopCount`
- `volumePercent`

### `schedule_rules`

Reguły harmonogramu.

Pola:

- `client`
- `channel`
- `playlist`
- `label`
- `startDate`
- `endDate`
- `startTime`
- `endTime`
- `daysOfWeek`
- `priority`
- `isActive`

### `events`

Override nad harmonogramem.

Pola:

- `client`
- `channel`
- `screen`
- `playlist`
- `title`
- `message`
- `startsAt`
- `endsAt`
- `priority`
- `isActive`

## Logika playera

Player działa tak:

1. Loguje się kontem z `screen_users`.
2. Pobiera swój ekran i przypięty kanał.
3. Pobiera `schedule_rules` klienta.
4. Pobiera `events` klienta.
5. Jeśli jest aktywny event z najwyższym priorytetem, gra playlistę eventu.
6. Jeśli nie ma eventu, wybiera najwyższy priorytet pasującej reguły schedule.
7. Pobiera `playlist_items` i protected file token z PocketBase.
8. Odtwarza wideo lub obrazy w pętli.
9. Co minutę aktualizuje heartbeat ekranu.

## Multi-tenant

Podział na klientów jest realizowany przez pole `client` we wszystkich głównych kolekcjach.
Owner CMS może widzieć wszystko, a użytkownik przypięty do klienta widzi własny tenant.
