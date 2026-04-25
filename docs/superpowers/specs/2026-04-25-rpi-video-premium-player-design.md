# Raspberry Pi Video Premium Player Design

Date: 2026-04-25

## Context

Signal Deck already has a CMS/server and an Android TV player in this monorepo. The Raspberry Pi 5 Video Premium player must reuse the current player API contract without breaking the Android TV APK:

- `POST /api/player/session`
- `POST /api/player/commands/:id/ack`
- `POST /api/player/logs`
- optional local `POST /api/player/reset` usage from setup UI

The source handoff is `docs/raspberry-pi-video-premium-handoff.md`.

## Decision

Build the v1 Raspberry Pi package in this same repository on a dedicated implementation branch. Do not create a separate repository yet.

The package will live in:

- `apps/rpi-player/` for the Python agent, WebUI, tests, service templates, and packaging metadata.
- `scripts/rpi/install-video-premium.sh` for the idempotent Raspberry Pi OS Lite installer.

This keeps the player contract close to the CMS/server tests while still isolating the new runtime from `apps/player`, the Android TV app.

## Architecture

The Raspberry Pi player has four local parts:

1. Installer
   - Runs as root on Raspberry Pi OS Lite 64-bit.
   - Verifies root, `aarch64`, Raspberry Pi 5 model, `/boot/firmware`, and NetworkManager availability.
   - Creates the `signaldeck` user, directories, secrets, config, venv, managed files, systemd units, and NetworkManager hotspot profile.
   - Is idempotent and does not overwrite existing local config or identity.

2. Agent
   - Runs as non-root user `signaldeck` under systemd.
   - Loads `/etc/signaldeck/player.toml` and `/var/lib/signaldeck/identity.json`.
   - Creates two logical outputs, `HDMI-A-1` and `HDMI-A-2`, each with its own CMS serial and secret.
   - Sends separate heartbeats for each output and controls playback/cache per output.

3. Playback/cache runtime
   - Uses `mpv` subprocesses for `video` and `image` entries.
   - Downloads media into per-output cache directories via `*.partial` files and atomic rename.
   - Keeps the last valid manifest available for offline playback.
   - Skips `audio` entries in v1 and reports a warning to CMS logs.

4. Local WebUI
   - Runs on port `8080` as a separate systemd service.
   - Provides local status, setup, network configuration, reset, restart, reboot, and sync controls.
   - Uses local files and local service commands rather than adding new CMS dependencies.

## Device Model

The physical Raspberry Pi maps to two logical CMS devices:

- `HDMI-A-1`: base serial plus suffix `A`
- `HDMI-A-2`: base serial plus suffix `B`

Base identity is deterministic where possible:

1. Raspberry Pi CPU serial from `/proc/cpuinfo`
2. `/etc/machine-id`
3. generated UUID persisted in `/var/lib/signaldeck/identity.json`

Serials must contain only uppercase `A-Z` and digits because the backend normalizes serials that way.

The agent should send `playerType: "video_premium"` in the session request. If the backend currently ignores that field during first registration, make a small server-side change so new pending Raspberry Pi devices are created as `video_premium` while preserving current defaults for Android TV.

## Sync Model

Default mode is `independent`.

Supported sync modes:

- `independent`: each output follows its own CMS queue and cache lifecycle.
- `paired_start`: both outputs wait for approval, queue, and initial cache readiness, then start together once.
- `clocked_playlist`: both outputs use a shared monotonic timeline for each playlist slot.

For `clocked_playlist`, the agent validates that both queues have the same slot count and matching `durationSeconds` within `sync.tolerance_ms`. With `policy = "best_effort"`, it logs warnings and continues. With `policy = "strict"`, it blackouts the sync group until playlists are compatible.

This is not frame-perfect genlock. The v1 goal is practical menu board or simple video wall sync on one Raspberry Pi 5, targeting start deltas under 250 ms after hardware testing.

## Setup And Hotspot

Setup mode is active when:

- `/etc/signaldeck/player.toml` is missing
- `/boot/firmware/SIGNALDECK_LOCK` is missing
- `signaldeck-setup-mode` explicitly enables it

Setup mode starts the NetworkManager hotspot `SignalDeck-XXXX`, serves WebUI at `http://10.42.0.1:8080`, and lets the user save CMS/network configuration. After successful setup, the system creates `/boot/firmware/SIGNALDECK_LOCK`, disables the hotspot, and restarts the agent.

Resetting setup is intentionally simple:

```bash
sudo rm /boot/firmware/SIGNALDECK_LOCK
sudo reboot
```

## Error Handling

The agent reports meaningful local logs through journald and CMS logs when credentials are known.

CMS log components:

- `agent`
- `network`
- `playback`
- `cache`
- `hotspot`
- `webui`
- `display`

Important cases:

- CMS offline: keep playing last valid cached manifest.
- Media download failure: log error, keep previous playable item/manifest where possible.
- Missing HDMI connector: log display error and show degraded status in WebUI.
- Incompatible sync queues: log warning and follow configured sync policy.
- Unsupported audio item: skip and log warning.
- Unsupported live command: ACK failed with a clear message.

## Testing

Tests that can run without physical Raspberry Pi hardware:

- identity generation and serial normalization
- TOML/config loading defaults
- CMS API client request/response handling
- playback queue interpretation
- cache keying, partial download behavior, and manifest persistence using temp files
- sync compatibility validation and timeline planning
- live command routing and ACK payloads
- installer shell syntax and static checks

Hardware tests on Raspberry Pi 5:

- installer preflight and idempotency
- NetworkManager hotspot setup
- WebUI access from hotspot and LAN
- DRM connector probing for `HDMI-A-1` and `HDMI-A-2`
- `mpv` binding to each physical HDMI output
- dual-output playback and sync timing

## Scope For V1

In scope:

- installer script
- Python agent and WebUI
- systemd units
- dual logical device registration
- per-output cache and playback
- local sync modes
- CMS logs and command ACKs
- setup hotspot and reset marker
- targeted backend compatibility change for `playerType`, if needed

Out of scope:

- separate audio/USB audio
- Proof of Play
- signed autoupdate packages
- native screenshots
- backend `DeviceOutput[]` model
- frame-perfect genlock

## Implementation Order

1. Add backend contract tests for Raspberry Pi registration as `video_premium`, then update server behavior if needed.
2. Scaffold `apps/rpi-player` with Python package, tests, config, identity, API client, cache, sync, and command modules.
3. Add minimal agent loop that can heartbeat two outputs and process CMS playback/commands.
4. Add playback process controller around `mpv` with testable command construction and graceful fallback.
5. Add local WebUI for setup/status/control.
6. Add systemd templates and installer.
7. Run local test/build checks.
8. Leave hardware-specific DRM/mpv connector behavior behind clear probes and document the RPi 5 validation steps.

