# Raspberry Pi Golden Image

This flow prepares one Raspberry Pi OS Lite 64-bit card as a golden image source.
After cloning the image to other cards, each device gets a unique Signal Deck identity
and random setup hotspot credentials on first boot.

## Static fulfillment credentials

- SSH user: `admin`
- SSH password: `Maasck23646`
- WebUI user: `admin`
- WebUI password: `Maasck23646`

## First boot generated values

Each cloned Raspberry Pi generates:

- Signal Deck serial from the Raspberry Pi CPU serial.
- Random setup hotspot SSID, for example `SignalDeck-A1B2C3`.
- Random setup hotspot password.
- Fresh local player identity secrets.

Fresh cloned images use `https://maask-ds.online` as the default CMS/API URL.

The first boot handoff file is written to the boot partition:

```text
SIGNALDECK_HOTSPOT.txt
```

It contains the hotspot SSID/password plus WebUI and SSH credentials.

## Build the golden image source card

On a freshly flashed Raspberry Pi OS Lite 64-bit card, boot the Raspberry Pi, clone or copy
this repository onto the device, then run:

```bash
cd /path/to/digital-signage
sudo SIGNALDECK_REF=codex/rpi-video-premium-player scripts/rpi/prepare-golden-image.sh
sudo shutdown now
```

After shutdown, remove the card and capture it as the production image.

## Runtime setup behavior

On each cloned device:

1. `signaldeck-firstboot.service` runs once.
2. The setup hotspot profile is regenerated with random credentials.
3. `/boot/firmware/SIGNALDECK_LOCK` is removed so setup mode starts.
4. The local identity file is removed so the player derives a serial from that Pi.
5. `SIGNALDECK_HOTSPOT.txt` is rewritten on the boot partition.
6. The first boot service disables itself.

Normal operation does not keep the hotspot permanently active after setup is locked.
Technicians can start it manually from HDMI service mode or WebUI when needed.
