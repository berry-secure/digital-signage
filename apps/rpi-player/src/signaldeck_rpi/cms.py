from __future__ import annotations

from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json


class CmsClient:
    def __init__(self, server_url: str, timeout_seconds: int = 10):
        self.server_url = server_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def post_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._post("/api/player/session", payload)

    def ack_command(self, command_id: str, serial: str, secret: str, status: str, message: str) -> dict[str, Any]:
        return self._post(
            f"/api/player/commands/{command_id}/ack",
            {"serial": serial, "secret": secret, "status": status, "message": message},
        )

    def post_log(
        self,
        serial: str,
        secret: str,
        severity: str,
        component: str,
        message: str,
        **extra: Any,
    ) -> dict[str, Any]:
        payload = {
            "serial": serial,
            "secret": secret,
            "severity": severity,
            "component": component,
            "message": message,
            "stack": str(extra.pop("stack", "")),
            "context": extra.pop("context", {}),
            "appVersion": str(extra.pop("app_version", extra.pop("appVersion", ""))),
            "osVersion": str(extra.pop("os_version", extra.pop("osVersion", ""))),
            "networkStatus": str(extra.pop("network_status", extra.pop("networkStatus", ""))),
        }
        payload.update(extra)
        return self._post("/api/player/logs", payload)

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.server_url}{path}",
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return _decode_response(response.read())
        except HTTPError as error:
            detail = _decode_response(error.read())
            message = detail.get("message") if isinstance(detail, dict) else ""
            raise RuntimeError(message or f"CMS request failed with HTTP {error.code}") from error


def _decode_response(data: bytes) -> dict[str, Any]:
    if not data:
        return {}
    parsed = json.loads(data.decode("utf-8"))
    return parsed if isinstance(parsed, dict) else {"data": parsed}
