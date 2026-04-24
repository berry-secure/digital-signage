# Signal Deck Platform Handoff

Repo local path: `/Users/przeczacyklif/Movies/digital-signage`
Production URL: `https://cms.berry-secure.pl`

## Current Status

- MVP works on a single backend/CMS domain.
- Android TV APK plays assigned playlist content.
- PocketBase architecture is abandoned.
- Current server is a working demo foundation, not the final scalable architecture.

## Target Architecture

- TypeScript API.
- PostgreSQL + Prisma.
- Redis + BullMQ for jobs.
- CMS React frontend with RBAC.
- Device API for Android TV, Raspberry Pi, BYOD and stream devices.
- Configurable URLs via env: `PUBLIC_BASE_URL`, `API_BASE_URL`, `UPDATE_BASE_URL`.
- Device security through serials, device secrets, signed manifests and audit logs.

## Roadmap

1. Migrate backend to TypeScript + PostgreSQL while preserving current MVP behavior.
2. Add RBAC and client users scoped to selected clients.
3. Add Device Protocol v2: serial, secret, manifest, command queue, ACK/result handling.
4. Add live commands: reboot, app restart, force sync, force playlist update, force firmware/app update, clear cache, screenshot, blackout/wake, volume, diagnostics, upload logs, rotate secret.
5. Add proof-of-play reports with start/finish/error events per asset.
6. Add device error logs and Admin Logs UI.
7. Add offline detection and email/webhook/digest notifications.
8. Add Raspberry Pi player agent on hardened Raspberry Pi OS Lite 64.
9. Add RPi hotspot/WebUI setup and CMS config generator for static LAN, DHCP, Wi-Fi ESSID/password and server URL.
10. Add base SD card images for Raspberry Pi Imager.
11. Add audio/video channel types, music library, thematic playlists and audio/video events.
12. Add stream devices, BYOD app and AI Content Studio.

## Raspberry Pi Player Defaults

- Base OS: hardened Raspberry Pi OS Lite 64.
- Agent: lightweight Python or Go service, not MicroPython for Linux playback.
- Playback: store-and-forward with local cache.
- Setup: if config is missing or reset marker is removed, start hotspot `SignalDeck-XXXX` and local WebUI.
- Reset marker: `/boot/firmware/SIGNALDECK_LOCK`; deleting it forces setup mode.
- Network config: DHCP by default, optional static LAN IP, DNS, gateway, Wi-Fi ESSID/password.
- Updates: unattended security updates plus signed app/agent updates with rollback.
- Identity: player generates persistent serial on first boot and registers outbound to CMS.

## Next Thread First Task

Start Phase 1: migrate backend to TypeScript + PostgreSQL + RBAC, preserving current working CMS/player flow. Do not break the existing Android TV playback demo.
