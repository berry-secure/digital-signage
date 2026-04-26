from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
import argparse
import curses
import subprocess

from .webui import WebUiApp, create_provider


@dataclass(frozen=True)
class ServiceMenuItem:
    key: str
    label: str
    action: str


class ServicePlaybackController:
    def pause(self) -> None:
        _run(["systemctl", "stop", "signaldeck-agent.service"], allow_failure=True)

    def resume(self) -> None:
        _run(["systemctl", "restart", "signaldeck-agent.service"], allow_failure=True)


def build_service_menu() -> list[ServiceMenuItem]:
    return [
        ServiceMenuItem("r", "Refresh status", "refresh"),
        ServiceMenuItem("p", "Restart playback", "restart_playback"),
        ServiceMenuItem("c", "CMS and sync settings", "cms"),
        ServiceMenuItem("w", "Wi-Fi and IPv4 settings", "wifi"),
        ServiceMenuItem("t", "Time settings", "time"),
        ServiceMenuItem("u", "Update player", "update"),
        ServiceMenuItem("l", "Mark setup complete", "lock_setup"),
        ServiceMenuItem("b", "Reboot OS", "reboot"),
        ServiceMenuItem("q", "Exit and resume playback", "exit"),
    ]


def summarize_status(status: dict[str, Any]) -> list[str]:
    system = status.get("system") if isinstance(status.get("system"), dict) else {}
    memory = system.get("memory") if isinstance(system.get("memory"), dict) else {}
    disk = system.get("disk") if isinstance(system.get("disk"), dict) else {}
    sync = status.get("sync") if isinstance(status.get("sync"), dict) else {}
    outputs = status.get("outputs") if isinstance(status.get("outputs"), dict) else {}

    lines = [
        f"Serial: {status.get('baseSerial', 'unknown')}",
        f"Server: {status.get('serverUrl', 'unknown')}",
        f"Sync: {sync.get('mode', 'unknown')}",
        f"Hostname: {system.get('hostname', 'unknown')}",
        f"IP: {system.get('ipAddresses') or 'unknown'}",
        f"Timezone: {system.get('timezone', 'unknown')}",
        f"CPU load: {system.get('cpuLoad', 'unknown')}",
        f"RAM: {memory.get('usedMb', 0)} MB / {memory.get('totalMb', 0)} MB",
        f"Disk: {disk.get('usedPercent', 0)}% used",
        f"Cache: {system.get('cacheMb', 0)} MB",
        f"Agent: {system.get('agentService', 'unknown')}",
        f"WebUI: {system.get('webuiService', 'unknown')}",
    ]
    for name in sorted(outputs):
        output = outputs[name] if isinstance(outputs[name], dict) else {}
        connector = output.get("connector") or "not detected"
        connector_status = output.get("connectorStatus") or "unknown"
        enabled = output.get("enabled")
        manifests = output.get("manifestItems", 0)
        serial = output.get("serial") or "unknown"
        lines.append(f"{name}: {connector_status} ({connector}) serial {serial}, enabled {enabled}, manifest items {manifests}")
    return lines


class ServiceConsole:
    def __init__(
        self,
        app: WebUiApp | None,
        pause_playback: Callable[[], None] | None = None,
        resume_playback: Callable[[], None] | None = None,
    ):
        controller = ServicePlaybackController()
        self.app = app
        self.menu = build_service_menu()
        self.message = "Ctrl+Alt+S opens this console. Choose action with arrows/Enter."
        self.pause_playback = pause_playback or controller.pause
        self.resume_playback = resume_playback or controller.resume

    def run(self) -> None:
        def guarded_loop(screen) -> None:
            self.pause_playback()
            try:
                self._loop(screen)
            finally:
                self.resume_playback()

        curses.wrapper(guarded_loop)

    def _loop(self, screen) -> None:
        curses.curs_set(0)
        selected = 0
        while True:
            status = self.app.render_status_json()
            self._draw(screen, status, selected)
            key = screen.getch()
            if key in (ord("q"), ord("Q")):
                return
            if key in (curses.KEY_UP, ord("k")):
                selected = (selected - 1) % len(self.menu)
                continue
            if key in (curses.KEY_DOWN, ord("j")):
                selected = (selected + 1) % len(self.menu)
                continue
            if key in (10, 13, curses.KEY_ENTER):
                if self._run_action(screen, self.menu[selected].action):
                    return
                continue
            for index, item in enumerate(self.menu):
                if key in (ord(item.key), ord(item.key.upper())):
                    if self._run_action(screen, item.action):
                        return
                    selected = index
                    break

    def _draw(self, screen, status: dict[str, Any], selected: int) -> None:
        screen.erase()
        height, width = screen.getmaxyx()
        screen.addnstr(0, 0, "Signal Deck HDMI Service Console", width - 1, curses.A_BOLD)
        screen.addnstr(1, 0, self.message, width - 1)
        screen.hline(2, 0, "-", max(width - 1, 1))

        split = max(min(width // 2, 58), 36)
        for row, line in enumerate(summarize_status(status), start=4):
            if row >= height - 2:
                break
            screen.addnstr(row, 0, line, split - 2)

        screen.addnstr(4, split, "Actions", max(width - split - 1, 1), curses.A_BOLD)
        for index, item in enumerate(self.menu):
            row = 6 + index
            if row >= height - 2:
                break
            prefix = "> " if index == selected else "  "
            mode = curses.A_REVERSE if index == selected else curses.A_NORMAL
            screen.addnstr(row, split, f"{prefix}{item.key.upper()}  {item.label}", max(width - split - 1, 1), mode)

        screen.addnstr(height - 1, 0, "Arrows/j/k move, Enter chooses, q exits and resumes playback.", width - 1)
        screen.refresh()

    def _run_action(self, screen, action: str) -> bool:
        if action == "exit":
            return True
        if action == "refresh":
            self.message = "Status refreshed."
            return False
        try:
            if action == "restart_playback":
                self.message = self.app.force_playlist_update()
            elif action == "cms":
                self.message = self._edit_cms(screen)
            elif action == "wifi":
                self.message = self._edit_wifi(screen)
            elif action == "time":
                self.message = self._edit_time(screen)
            elif action == "update":
                self.message = self._update_player(screen)
            elif action == "lock_setup":
                self.message = self.app.mark_setup_complete()
            elif action == "reboot":
                if self._confirm(screen, "Reboot OS now? Type YES"):
                    self.message = self.app.reboot_os()
                else:
                    self.message = "Reboot canceled."
        except Exception as error:
            self.message = f"Action failed: {error}"
        return False

    def _edit_cms(self, screen) -> str:
        assert self.app is not None
        status = self.app.render_status_json()
        sync = status.get("sync") if isinstance(status.get("sync"), dict) else {}
        fields = {
            "server_url": self._prompt(screen, "Server URL", str(status.get("serverUrl") or "")),
            "sync_mode": self._prompt(screen, "Sync mode", str(sync.get("mode") or "independent")),
            "sync_policy": self._prompt(screen, "Sync policy", str(sync.get("policy") or "best_effort")),
            "tolerance_ms": self._prompt(screen, "Tolerance ms", str(sync.get("toleranceMs") or 250)),
        }
        return self.app.save_config(fields)

    def _edit_wifi(self, screen) -> str:
        assert self.app is not None
        fields = {
            "ssid": self._prompt(screen, "Wi-Fi SSID", ""),
            "password": self._prompt(screen, "Wi-Fi password", "", secret=True),
            "ipv4_method": self._prompt(screen, "IPv4 method auto/manual", "auto"),
        }
        if fields["ipv4_method"] == "manual":
            fields["address"] = self._prompt(screen, "Static address/CIDR", "")
            fields["gateway"] = self._prompt(screen, "Gateway", "")
            fields["dns"] = self._prompt(screen, "DNS", "")
        fields["apply_now"] = "1" if self._confirm(screen, "Apply Wi-Fi now? Type YES") else "0"
        return self.app.save_wifi(fields)

    def _edit_time(self, screen) -> str:
        assert self.app is not None
        status = self.app.render_status_json()
        system = status.get("system") if isinstance(status.get("system"), dict) else {}
        fields = {
            "timezone": self._prompt(screen, "Timezone", str(system.get("timezone") or "Europe/Warsaw")),
            "ntp": "1" if self._confirm(screen, "Use NTP? Type YES") else "0",
            "datetime": self._prompt(screen, "Manual datetime, blank to skip", ""),
        }
        return self.app.save_time(fields)

    def _update_player(self, screen) -> str:
        assert self.app is not None
        ref = self._prompt(screen, "Git branch/ref", "codex/rpi-video-premium-player")
        return self.app.update_player({"ref": ref})

    def _prompt(self, screen, label: str, default: str, secret: bool = False) -> str:
        height, width = screen.getmaxyx()
        row = height - 3
        screen.move(row, 0)
        screen.clrtoeol()
        prompt = f"{label} [{default}]: " if default else f"{label}: "
        screen.addnstr(row, 0, prompt, width - 1)
        curses.echo()
        if secret:
            curses.noecho()
        curses.curs_set(1)
        try:
            raw = screen.getstr(row, min(len(prompt), width - 2), max(width - len(prompt) - 1, 1))
        finally:
            curses.noecho()
            curses.curs_set(0)
        value = raw.decode("utf-8", errors="ignore").strip()
        return value or default

    def _confirm(self, screen, label: str) -> bool:
        return self._prompt(screen, label, "") == "YES"


def create_console(
    config_path: str = "/etc/signaldeck/player.toml",
    identity_path: str = "/var/lib/signaldeck/identity.json",
    state_root: str = "/var/lib/signaldeck",
    boot_dir: str = "/boot/firmware",
) -> ServiceConsole:
    return ServiceConsole(WebUiApp(create_provider(config_path, identity_path, state_root, boot_dir)))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/signaldeck/player.toml")
    parser.add_argument("--identity", default="/var/lib/signaldeck/identity.json")
    parser.add_argument("--state-root", default="/var/lib/signaldeck")
    parser.add_argument("--boot-dir", default="/boot/firmware")
    args = parser.parse_args(argv)
    create_console(args.config, args.identity, args.state_root, args.boot_dir).run()


def _run(command: list[str], allow_failure: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 and not allow_failure:
        detail = (result.stderr or result.stdout or "command failed").strip()
        raise RuntimeError(f"{' '.join(command)}: {detail}")
    return result
