from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import argparse
import logging
import os
import selectors
import struct
import subprocess
import time

LOGGER = logging.getLogger("signaldeck.hotkeys")

INPUT_EVENT_FORMAT = "qqHHI"
INPUT_EVENT_SIZE = struct.calcsize(INPUT_EVENT_FORMAT)

EV_KEY = 1
KEY_LEFTCTRL = 29
KEY_LEFTALT = 56
KEY_RIGHTCTRL = 97
KEY_RIGHTALT = 100
KEY_S = 31
KEY_F12 = 88


@dataclass(frozen=True)
class InputEvent:
    seconds: int
    microseconds: int
    type: int
    code: int
    value: int


@dataclass
class HotkeyState:
    ctrl_down: bool = False
    alt_down: bool = False

    def handle_event(self, event: InputEvent) -> bool:
        if event.type != EV_KEY:
            return False
        return self.handle_key_event(event.code, event.value)

    def handle_key_event(self, code: int, value: int) -> bool:
        if code in {KEY_LEFTCTRL, KEY_RIGHTCTRL}:
            self.ctrl_down = value != 0
            return False
        if code in {KEY_LEFTALT, KEY_RIGHTALT}:
            self.alt_down = value != 0
            return False
        if code in {KEY_S, KEY_F12} and value == 1:
            return self.ctrl_down and self.alt_down
        return False


def parse_input_event(raw: bytes) -> InputEvent | None:
    if len(raw) < INPUT_EVENT_SIZE:
        return None
    seconds, microseconds, event_type, code, value = struct.unpack(INPUT_EVENT_FORMAT, raw[:INPUT_EVENT_SIZE])
    return InputEvent(seconds, microseconds, event_type, code, value)


def find_input_devices(root: str | Path = "/dev/input") -> list[Path]:
    input_root = Path(root)
    if not input_root.exists():
        return []
    return sorted(path for path in input_root.glob("event*") if path.is_char_device())


class HotkeyDaemon:
    def __init__(self, device_root: str | Path = "/dev/input", service_name: str = "signaldeck-service-console.service"):
        self.device_root = Path(device_root)
        self.service_name = service_name
        self.state = HotkeyState()

    def run_forever(self) -> None:
        while True:
            devices = find_input_devices(self.device_root)
            if not devices:
                LOGGER.warning("no input devices found in %s", self.device_root)
                time.sleep(5)
                continue
            self._watch_devices(devices)

    def _watch_devices(self, devices: list[Path]) -> None:
        selector = selectors.DefaultSelector()
        handles: list[int] = []
        try:
            for device in devices:
                try:
                    fd = os.open(device, os.O_RDONLY | os.O_NONBLOCK)
                except OSError as error:
                    LOGGER.debug("cannot open input device %s: %s", device, error)
                    continue
                handles.append(fd)
                selector.register(fd, selectors.EVENT_READ, str(device))

            if not handles:
                time.sleep(5)
                return

            while True:
                for key, _ in selector.select(timeout=5):
                    try:
                        raw = os.read(key.fd, INPUT_EVENT_SIZE)
                    except OSError as error:
                        LOGGER.debug("input device read failed for %s: %s", key.data, error)
                        return
                    event = parse_input_event(raw)
                    if event and self.state.handle_event(event):
                        self.open_service_console()
        finally:
            for fd in handles:
                try:
                    selector.unregister(fd)
                except Exception:
                    pass
                try:
                    os.close(fd)
                except OSError:
                    pass
            selector.close()

    def open_service_console(self) -> None:
        if _systemctl_is_active(self.service_name):
            return
        subprocess.run(["systemctl", "start", self.service_name], check=False)


def _systemctl_is_active(service_name: str) -> bool:
    result = subprocess.run(["systemctl", "is-active", "--quiet", service_name], check=False)
    return result.returncode == 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-root", default="/dev/input")
    parser.add_argument("--service-name", default="signaldeck-service-console.service")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    HotkeyDaemon(args.device_root, args.service_name).run_forever()
