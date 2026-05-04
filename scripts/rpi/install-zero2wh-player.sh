#!/usr/bin/env bash
set -euo pipefail

SIGNALDECK_REF="${SIGNALDECK_REF:-codex/rpi-zero-2wh-player}"
BASE_INSTALLER_URL="${SIGNALDECK_BASE_INSTALLER_URL:-https://raw.githubusercontent.com/berry-secure/digital-signage/${SIGNALDECK_REF}/scripts/rpi/install-video-premium.sh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_BASE_INSTALLER_DIR=""

cleanup_zero2wh_installer() {
  if [[ -n "${TEMP_BASE_INSTALLER_DIR}" ]]; then
    rm -rf "${TEMP_BASE_INSTALLER_DIR}"
  fi
}
trap cleanup_zero2wh_installer EXIT

source_base_installer() {
  local local_base="${SCRIPT_DIR}/install-video-premium.sh"
  if [[ -f "${local_base}" ]]; then
    # shellcheck source=scripts/rpi/install-video-premium.sh
    source "${local_base}"
    return
  fi

  TEMP_BASE_INSTALLER_DIR="$(mktemp -d)"
  curl -fL --retry 3 "${BASE_INSTALLER_URL}" -o "${TEMP_BASE_INSTALLER_DIR}/install-video-premium.sh"
  # shellcheck source=/dev/null
  source "${TEMP_BASE_INSTALLER_DIR}/install-video-premium.sh"
}

source_base_installer

require_raspberry_pi_5() {
  if [[ "${SIGNALDECK_SKIP_HARDWARE_CHECK:-0}" == "1" ]]; then
    log "Skipping Raspberry Pi hardware checks."
    return
  fi

  if [[ "$(uname -m)" != "aarch64" ]]; then
    printf 'This installer requires Raspberry Pi OS Lite 64-bit on aarch64.\n' >&2
    exit 1
  fi

  local model=""
  if [[ -r /proc/device-tree/model ]]; then
    model="$(tr -d '\0' </proc/device-tree/model)"
  fi
  if [[ "${model}" != *"Raspberry Pi Zero 2 W"* ]] && [[ "${model}" != *"Raspberry Pi Zero 2 WH"* ]]; then
    printf 'This installer requires Raspberry Pi Zero 2 W / Zero 2 WH hardware.\n' >&2
    printf 'Detected model: %s\n' "${model:-unknown}" >&2
    exit 1
  fi

  if [[ ! -d "${BOOT_DIR}" ]]; then
    printf 'Expected boot firmware directory at %s.\n' "${BOOT_DIR}" >&2
    exit 1
  fi
}

write_default_config() {
  if [[ -f "${CONFIG_DIR}/player.toml" ]]; then
    log "Keeping existing ${CONFIG_DIR}/player.toml."
    if [[ -n "${SIGNALDECK_SERVER_URL:-}" ]]; then
      log "Updating player server URL to ${SERVER_URL}."
      update_config_server_url "${CONFIG_DIR}/player.toml" "${SERVER_URL}"
    fi
  else
    log "Writing default Raspberry Pi Zero 2 WH player config."
    cat >"${CONFIG_DIR}/player.toml" <<TOML
server_url = "${SERVER_URL}"
device_model = "Raspberry Pi Zero 2 WH"
player_type = "video_premium"
app_version = "rpi-zero2wh-0.1.0"
cache_limit_mb = 40960
heartbeat_interval_seconds = 15
audio_enabled = false

[sync]
mode = "single"
group = "single-hdmi"
policy = "best_effort"
tolerance_ms = 0
group_blackout = false

[[outputs]]
name = "HDMI-A-1"
serial_suffix = ""
enabled = true
TOML
  fi

  write_webui_secret
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

print_summary() {
  log "Raspberry Pi Zero 2 WH install complete."
  printf '\nWebUI: http://player.local:8080 or http://10.42.0.1:8080 in setup mode\n'
  printf 'Server URL: %s\n' "$(grep -E '^server_url[[:space:]]*=' "${CONFIG_DIR}/player.toml" | head -1 | cut -d '"' -f 2)"
  printf 'WebUI secret: %s\n' "$(cat "${CONFIG_DIR}/webui.secret")"
  printf 'Hotspot secret: %s\n' "$(cat "${CONFIG_DIR}/hotspot.secret")"
  printf '\nZero 2 WH profile: HDMI-A-1 only, 1080p30 target, audio disabled.\n'
  printf 'Reset setup mode with:\n  sudo rm %s/SIGNALDECK_LOCK && sudo reboot\n' "${BOOT_DIR}"
}

main "$@"
