# Raspberry Pi Zero 2 WH Player

This flow prepares a Signal Deck player for Raspberry Pi Zero 2 WH on Raspberry Pi OS Lite 64-bit.
The profile is intentionally lightweight: one HDMI output, local cached playback, WebUI on port 8080,
HDMI service mode, NetworkManager setup hotspot, and no audio.

## Recommended OS Image

Use Raspberry Pi OS Lite 64-bit on the 64 GB microSD card.
Raspberry Pi Zero 2 W has a 64-bit Cortex-A53 CPU, and the 64-bit Lite image keeps the runtime aligned
with the RPi player package while avoiding desktop/Chromium memory pressure.

Use 32-bit only as a fallback test image if the Zero 2 WH shows a device-specific regression in the
DRM/mpv stack. The player profile does not depend on a desktop environment.

## Runtime Profile

- Device model: `Raspberry Pi Zero 2 WH`
- Player type: `video_premium`
- App version: `rpi-zero2wh-0.1.0`
- Output: `HDMI-A-1`
- Serial suffix: empty, so the single logical device keeps the base serial
- CMS/API URL: `https://maasck-ds.online`
- Cache limit: `40960` MB
- Audio: disabled with `audio_enabled = false`
- Media target: MP4/H.264 or images, 1920x1080 max, 30 fps max

## Remote Install

On a freshly booted Raspberry Pi OS Lite 64-bit card:

```bash
cd ~
curl -fL --retry 3 \
  https://raw.githubusercontent.com/berry-secure/digital-signage/codex/rpi-zero-2wh-player/scripts/rpi/install-zero2wh-player.sh \
  -o install-signaldeck-zero2wh.sh

sudo SIGNALDECK_REF=codex/rpi-zero-2wh-player \
  SIGNALDECK_SERVER_URL=https://maasck-ds.online \
  SIGNALDECK_WEBUI_PASSWORD=Maasck23646 \
  bash ~/install-signaldeck-zero2wh.sh
```

The installer checks for Raspberry Pi Zero 2 W / Zero 2 WH hardware. For a dry run on other hardware:

```bash
sudo SIGNALDECK_SKIP_HARDWARE_CHECK=1 \
  SIGNALDECK_SOURCE_DIR=/path/to/digital-signage \
  SIGNALDECK_SERVER_URL=https://maasck-ds.online \
  SIGNALDECK_WEBUI_PASSWORD=Maasck23646 \
  bash scripts/rpi/install-zero2wh-player.sh
```

## Golden Image

From a local checkout on the prepared source card:

```bash
cd /path/to/digital-signage
sudo SIGNALDECK_REF=codex/rpi-zero-2wh-player \
  SIGNALDECK_WEBUI_PASSWORD=Maasck23646 \
  scripts/rpi/prepare-zero2wh-golden-image.sh
sudo shutdown now
```

The golden image helper installs the Zero 2 WH profile, keeps the static fulfillment credentials, then
clears clone-specific state before capture:

- `/var/lib/signaldeck/identity.json`
- `/var/lib/signaldeck/firstboot.done`
- cache and manifests
- Proof of Play and log queues
- `SIGNALDECK_LOCK`
- `SIGNALDECK_HOTSPOT.txt`
- NetworkManager `SignalDeck-Setup`
- `/etc/machine-id`

On first boot after cloning, the device generates a fresh serial, device secret, setup hotspot SSID,
and hotspot password.
