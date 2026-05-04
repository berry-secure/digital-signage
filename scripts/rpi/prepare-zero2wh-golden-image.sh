#!/usr/bin/env bash
set -euo pipefail

ADMIN_USER="${SIGNALDECK_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${SIGNALDECK_ADMIN_PASSWORD:-Maasck23646}"
WEBUI_PASSWORD="${SIGNALDECK_WEBUI_PASSWORD:-${ADMIN_PASSWORD}}"
APP_USER="${SIGNALDECK_USER:-signaldeck}"
CONFIG_DIR="${SIGNALDECK_CONFIG_DIR:-/etc/signaldeck}"
STATE_DIR="${SIGNALDECK_STATE_DIR:-/var/lib/signaldeck}"
BOOT_DIR="${SIGNALDECK_BOOT_DIR:-/boot/firmware}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log() {
  printf '[signaldeck-zero2wh-golden] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'Run this script with sudo on the Raspberry Pi Zero 2 WH golden image source card.\n' >&2
    exit 1
  fi
}

install_base_packages() {
  log "Installing SSH and base fulfillment packages."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server sudo
}

ensure_admin_user() {
  log "Configuring ${ADMIN_USER} SSH user."
  if ! id -u "${ADMIN_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${ADMIN_USER}"
  fi
  usermod -aG sudo,video,render,input "${ADMIN_USER}" 2>/dev/null || usermod -aG sudo "${ADMIN_USER}"
  printf '%s:%s\n' "${ADMIN_USER}" "${ADMIN_PASSWORD}" | chpasswd
  systemctl enable ssh.service >/dev/null 2>&1 || systemctl enable ssh >/dev/null 2>&1 || true
}

install_player() {
  log "Installing Signal Deck Raspberry Pi Zero 2 WH player from local repository."
  SIGNALDECK_SOURCE_DIR="${REPO_ROOT}" \
  SIGNALDECK_REF="${SIGNALDECK_REF:-codex/rpi-zero-2wh-player}" \
  SIGNALDECK_WEBUI_PASSWORD="${WEBUI_PASSWORD}" \
    bash "${SCRIPT_DIR}/install-zero2wh-player.sh"
}

reset_clone_specific_state() {
  log "Resetting clone-specific state before image capture."
  systemctl stop signaldeck-agent.service signaldeck-webui.service signaldeck-setup-mode.service signaldeck-hotkeys.service >/dev/null 2>&1 || true

  install -d -m 0755 "${CONFIG_DIR}" "${BOOT_DIR}"
  install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${STATE_DIR}"
  printf '%s\n' "${WEBUI_PASSWORD}" >"${CONFIG_DIR}/webui.secret"
  chmod 600 "${CONFIG_DIR}/webui.secret"

  rm -f \
    "${CONFIG_DIR}/hotspot.secret" \
    "${STATE_DIR}/identity.json" \
    "${STATE_DIR}/firstboot.done" \
    "${BOOT_DIR}/SIGNALDECK_LOCK" \
    "${BOOT_DIR}/SIGNALDECK_HOTSPOT.txt"

  rm -rf "${STATE_DIR}/cache" "${STATE_DIR}/manifests" "${STATE_DIR}/proof-of-play" "${STATE_DIR}/queue"
  install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 \
    "${STATE_DIR}" \
    "${STATE_DIR}/cache" \
    "${STATE_DIR}/cache/media" \
    "${STATE_DIR}/manifests" \
    "${STATE_DIR}/proof-of-play" \
    "${STATE_DIR}/queue" \
    "${STATE_DIR}/queue/logs"
  chown -R "${APP_USER}:${APP_USER}" \
    "${STATE_DIR}" \
    "${STATE_DIR}/cache" \
    "${STATE_DIR}/manifests" \
    "${STATE_DIR}/proof-of-play" \
    "${STATE_DIR}/queue"

  if command -v nmcli >/dev/null 2>&1; then
    nmcli connection delete SignalDeck-Setup >/dev/null 2>&1 || true
  fi

  truncate -s 0 /etc/machine-id || true
  rm -f /var/lib/dbus/machine-id
  journalctl --rotate >/dev/null 2>&1 || true
  journalctl --vacuum-time=1s >/dev/null 2>&1 || true
  rm -f /var/log/signaldeck/* 2>/dev/null || true
}

enable_first_boot() {
  log "Enabling first boot provisioning."
  systemctl enable signaldeck-firstboot.service
  systemctl enable signaldeck-webui.service signaldeck-agent.service signaldeck-setup-mode.service signaldeck-hotkeys.service
}

print_summary() {
  log "Raspberry Pi Zero 2 WH golden image source is ready."
  printf '\nStatic service credentials for cloned images:\n'
  printf '  SSH/WebUI login: %s\n' "${ADMIN_USER}"
  printf '  SSH/WebUI password: %s\n' "${ADMIN_PASSWORD}"
  printf '\nOn each cloned first boot, Signal Deck will generate:\n'
  printf '  - unique player serial from Raspberry Pi CPU serial or machine-id\n'
  printf '  - random hotspot SSID\n'
  printf '  - random hotspot password\n'
  printf '  - fresh device secret\n'
  printf '\nNow shut down this Raspberry Pi and capture the SD card image.\n'
  printf 'Recommended next command:\n  sudo shutdown now\n'
}

main() {
  require_root
  install_base_packages
  ensure_admin_user
  install_player
  reset_clone_specific_state
  enable_first_boot
  print_summary
}

main "$@"
