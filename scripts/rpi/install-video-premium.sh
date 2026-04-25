#!/usr/bin/env bash
set -euo pipefail

APP_USER="${SIGNALDECK_USER:-signaldeck}"
INSTALL_DIR="${SIGNALDECK_INSTALL_DIR:-/opt/signaldeck}"
APP_DIR="${INSTALL_DIR}/apps/rpi-player"
CONFIG_DIR="${SIGNALDECK_CONFIG_DIR:-/etc/signaldeck}"
STATE_DIR="${SIGNALDECK_STATE_DIR:-/var/lib/signaldeck}"
LOG_DIR="${SIGNALDECK_LOG_DIR:-/var/log/signaldeck}"
BACKUP_DIR="${STATE_DIR}/backups"
REPO_URL="${SIGNALDECK_REPO_URL:-https://github.com/berry-secure/digital-signage.git}"
REPO_REF="${SIGNALDECK_REF:-main}"
BOOT_DIR="${SIGNALDECK_BOOT_DIR:-/boot/firmware}"
HOTSPOT_CONNECTION="SignalDeck-Setup"

log() {
  printf '[signaldeck] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'Run this installer with sudo.\n' >&2
    exit 1
  fi
}

require_raspberry_pi_5() {
  if [[ "${SIGNALDECK_SKIP_HARDWARE_CHECK:-0}" == "1" ]]; then
    log "Skipping Raspberry Pi hardware checks."
    return
  fi

  if [[ "$(uname -m)" != "aarch64" ]]; then
    printf 'This installer requires Raspberry Pi OS Lite 64-bit on aarch64.\n' >&2
    exit 1
  fi

  if [[ ! -r /proc/device-tree/model ]] || ! tr -d '\0' </proc/device-tree/model | grep -q 'Raspberry Pi 5'; then
    printf 'This installer requires Raspberry Pi 5 hardware.\n' >&2
    exit 1
  fi

  if [[ ! -d "${BOOT_DIR}" ]]; then
    printf 'Expected boot firmware directory at %s.\n' "${BOOT_DIR}" >&2
    exit 1
  fi
}

install_packages() {
  log "Installing system packages."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl jq openssl git \
    python3 python3-venv python3-pip \
    network-manager avahi-daemon \
    mpv \
    unclutter \
    unattended-upgrades \
    ufw
}

ensure_user() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Creating ${APP_USER} user."
    useradd --system --create-home --home-dir "/var/lib/${APP_USER}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
  usermod -aG video,render,input "${APP_USER}" 2>/dev/null || true

  install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}" "${BACKUP_DIR}"
  install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${STATE_DIR}/cache" "${STATE_DIR}/manifests" "${LOG_DIR}"
}

install_application() {
  log "Installing Signal Deck Raspberry Pi player package."
  local source_dir="${SIGNALDECK_SOURCE_DIR:-}"
  local temp_dir=""

  if [[ -z "${source_dir}" ]]; then
    temp_dir="$(mktemp -d)"
    git clone --depth 1 --branch "${REPO_REF}" "${REPO_URL}" "${temp_dir}/repo"
    source_dir="${temp_dir}/repo"
  fi

  if [[ ! -d "${source_dir}/apps/rpi-player" ]]; then
    printf 'Could not find apps/rpi-player in %s.\n' "${source_dir}" >&2
    exit 1
  fi

  mkdir -p "${INSTALL_DIR}/apps"
  rm -rf "${APP_DIR}.new"
  mkdir -p "${APP_DIR}.new"
  (cd "${source_dir}/apps/rpi-player" && tar --exclude '__pycache__' --exclude '*.pyc' -cf - .) | (cd "${APP_DIR}.new" && tar -xf -)
  if [[ -d "${APP_DIR}" ]]; then
    mv "${APP_DIR}" "${BACKUP_DIR}/rpi-player.$(date +%Y%m%d%H%M%S)"
  fi
  mv "${APP_DIR}.new" "${APP_DIR}"
  chown -R root:root "${APP_DIR}"

  python3 -m venv "${INSTALL_DIR}/venv"
  "${INSTALL_DIR}/venv/bin/python" -m pip install --upgrade pip setuptools
  "${INSTALL_DIR}/venv/bin/python" -m pip install -e "${APP_DIR}"

  if [[ -n "${temp_dir}" ]]; then
    rm -rf "${temp_dir}"
  fi
}

write_default_config() {
  if [[ -f "${CONFIG_DIR}/player.toml" ]]; then
    log "Keeping existing ${CONFIG_DIR}/player.toml."
  else
    log "Writing default player config."
    cat >"${CONFIG_DIR}/player.toml" <<'TOML'
server_url = "https://cms.berry-secure.pl"
device_model = "Raspberry Pi 5"
player_type = "video_premium"
app_version = "rpi-video-premium-0.1.0"
cache_limit_mb = 20480
heartbeat_interval_seconds = 15

[sync]
mode = "independent"
group = "dual-hdmi"
policy = "best_effort"
tolerance_ms = 250
group_blackout = true

[[outputs]]
name = "HDMI-A-1"
serial_suffix = "A"
enabled = true

[[outputs]]
name = "HDMI-A-2"
serial_suffix = "B"
enabled = true
TOML
  fi

  write_secret_once "${CONFIG_DIR}/webui.secret" 32
  write_secret_once "${CONFIG_DIR}/hotspot.secret" 16
  chown -R root:"${APP_USER}" "${CONFIG_DIR}"
  chmod 640 "${CONFIG_DIR}/player.toml" "${CONFIG_DIR}/webui.secret" "${CONFIG_DIR}/hotspot.secret"
  if [[ -d "${BOOT_DIR}" ]]; then
    {
      printf 'Signal Deck hotspot password:\n'
      cat "${CONFIG_DIR}/hotspot.secret"
    } >"${BOOT_DIR}/SIGNALDECK_HOTSPOT.txt" || true
  fi
}

write_secret_once() {
  local path="$1"
  local bytes="$2"
  if [[ ! -f "${path}" ]]; then
    openssl rand -base64 "${bytes}" >"${path}"
    chmod 600 "${path}"
  fi
}

write_systemd_units() {
  log "Installing systemd units."
  install -m 0644 "${APP_DIR}/systemd/signaldeck-agent.service" /etc/systemd/system/signaldeck-agent.service
  install -m 0644 "${APP_DIR}/systemd/signaldeck-webui.service" /etc/systemd/system/signaldeck-webui.service
  install -m 0644 "${APP_DIR}/systemd/signaldeck-setup-mode.service" /etc/systemd/system/signaldeck-setup-mode.service
  systemctl daemon-reload
}

configure_kiosk_console() {
  log "Configuring kiosk console behavior."
  systemctl disable --now getty@tty1.service >/dev/null 2>&1 || true
  if [[ -f /boot/firmware/cmdline.txt ]] && ! grep -q 'vt.global_cursor_default=0' /boot/firmware/cmdline.txt; then
    cp /boot/firmware/cmdline.txt "${BACKUP_DIR}/cmdline.txt.$(date +%Y%m%d%H%M%S)"
    sed -i '1 s/$/ quiet loglevel=1 vt.global_cursor_default=0/' /boot/firmware/cmdline.txt
  fi
}

configure_hotspot_profile() {
  if ! command -v nmcli >/dev/null 2>&1; then
    log "nmcli not available; skipping hotspot profile."
    return
  fi

  local suffix
  suffix="$(tr '[:lower:]' '[:upper:]' < /etc/machine-id | tr -dc 'A-Z0-9' | tail -c 4 || true)"
  if [[ -z "${suffix}" ]]; then
    suffix="$(openssl rand -hex 2 | tr '[:lower:]' '[:upper:]')"
  fi

  local ssid="SignalDeck-${suffix}"
  local password
  password="$(cat "${CONFIG_DIR}/hotspot.secret")"

  if ! nmcli -t -f NAME connection show | grep -Fxq "${HOTSPOT_CONNECTION}"; then
    nmcli connection add type wifi ifname wlan0 con-name "${HOTSPOT_CONNECTION}" autoconnect no ssid "${ssid}"
  fi

  nmcli connection modify "${HOTSPOT_CONNECTION}" \
    connection.autoconnect no \
    802-11-wireless.mode ap \
    802-11-wireless.band bg \
    802-11-wireless.ssid "${ssid}" \
    ipv4.method shared \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "${password}"
}

enable_services() {
  log "Enabling services."
  systemctl enable signaldeck-webui.service signaldeck-agent.service signaldeck-setup-mode.service
  systemctl restart signaldeck-webui.service
  systemctl restart signaldeck-agent.service || true
  systemctl restart signaldeck-setup-mode.service || true
  systemctl enable unattended-upgrades.service >/dev/null 2>&1 || true
  ufw allow 8080/tcp >/dev/null 2>&1 || true
}

print_summary() {
  log "Install complete."
  printf '\nWebUI: http://player.local:8080 or http://10.42.0.1:8080 in setup mode\n'
  printf 'WebUI secret: %s\n' "$(cat "${CONFIG_DIR}/webui.secret")"
  printf 'Hotspot secret: %s\n' "$(cat "${CONFIG_DIR}/hotspot.secret")"
  printf '\nReset setup mode with:\n  sudo rm %s/SIGNALDECK_LOCK && sudo reboot\n' "${BOOT_DIR}"
}

main() {
  require_root
  require_raspberry_pi_5
  install_packages
  ensure_user
  install_application
  write_default_config
  write_systemd_units
  configure_kiosk_console
  configure_hotspot_profile
  enable_services
  print_summary
}

main "$@"
