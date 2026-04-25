# Raspberry Pi Video Premium Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable Raspberry Pi 5 Video Premium package: backend compatibility, Python agent/WebUI, cache/sync/playback primitives, systemd units, and an idempotent installer.

**Architecture:** Keep the Raspberry Pi runtime isolated in `apps/rpi-player` while reusing the existing CMS player API. The installer deploys the Python package to `/opt/signaldeck`, writes managed systemd/NetworkManager configuration, and preserves local identity/config between runs. Hardware-specific behavior is hidden behind connector probes and command builders so most logic is testable on macOS/Linux without a Raspberry Pi.

**Tech Stack:** Node/Express server tests, Python 3.11+ standard library, `unittest`, `mpv`, systemd, NetworkManager, Bash.

---

## File Map

- Modify `apps/server/src/api-contract.test.ts`: add contract tests proving Android remains `video_standard` and Raspberry Pi pending devices can register as `video_premium`.
- Modify `apps/server/src/app.ts`: accept `playerType` from first `/api/player/session` registration when valid.
- Create `apps/rpi-player/pyproject.toml`: package metadata and console entry points.
- Create `apps/rpi-player/src/signaldeck_rpi/config.py`: TOML config defaults and loading.
- Create `apps/rpi-player/src/signaldeck_rpi/identity.py`: base serial derivation and persisted per-output identities.
- Create `apps/rpi-player/src/signaldeck_rpi/cms.py`: CMS session/log/ACK HTTP client.
- Create `apps/rpi-player/src/signaldeck_rpi/cache.py`: media cache keys, atomic downloads, manifests, pruning helpers.
- Create `apps/rpi-player/src/signaldeck_rpi/sync.py`: queue compatibility and shared timeline planning.
- Create `apps/rpi-player/src/signaldeck_rpi/playback.py`: display connector probing and `mpv` command/process control.
- Create `apps/rpi-player/src/signaldeck_rpi/commands.py`: live command routing and side effect abstraction.
- Create `apps/rpi-player/src/signaldeck_rpi/agent.py`: dual-output heartbeat/playback orchestration.
- Create `apps/rpi-player/src/signaldeck_rpi/webui.py`: local status/setup HTTP UI.
- Create `apps/rpi-player/src/signaldeck_rpi/__main__.py`, `signaldeck_agent.py`, and `signaldeck_webui.py`: module/script entry points.
- Create `apps/rpi-player/systemd/*.service`: `signaldeck-agent`, `signaldeck-webui`, and setup-mode service templates.
- Create `apps/rpi-player/tests/*.py`: unit tests for each pure module and a fake CMS HTTP client test.
- Create `scripts/rpi/install-video-premium.sh`: Raspberry Pi OS Lite installer.

---

### Task 1: Backend Player Type Contract

**Files:**
- Modify: `apps/server/src/api-contract.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Add failing contract assertions**

Add an assertion to the existing Android TV session test:

```ts
assert.equal(playerSession.body.device.playerType, "video_standard");
```

Add this new test below it:

```ts
it("registers Raspberry Pi Video Premium logical outputs as pending video premium devices", async () => {
  const isolatedDataDir = await mkdtemp(join(tmpdir(), "signal-deck-rpi-"));
  const isolatedApp = await createApp({
    dataDir: isolatedDataDir,
    adminEmail: "rpi-owner@example.test",
    adminPassword: "strong-password",
    adminName: "Raspberry Pi Owner"
  });

  for (const suffix of ["A", "B"]) {
    const response = await request(isolatedApp)
      .post("/api/player/session")
      .send({
        serial: `MK5ABC123${suffix}`,
        secret: `secret-${suffix}`,
        platform: "raspberrypi",
        appVersion: "rpi-video-premium-0.1.0",
        deviceModel: "Raspberry Pi 5",
        playerType: "video_premium",
        playerState: "waiting",
        playerMessage: `HDMI-A-${suffix === "A" ? "1" : "2"} waiting for approval`,
        activeItemTitle: ""
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.approvalStatus, "pending");
    assert.equal(response.body.device.serial, `MK5ABC123${suffix}`);
    assert.equal(response.body.device.platform, "raspberrypi");
    assert.equal(response.body.device.deviceModel, "Raspberry Pi 5");
    assert.equal(response.body.device.playerType, "video_premium");
    assert.equal(response.body.playback.mode, "idle");
  }

  await rm(isolatedDataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the backend test and verify failure**

Run:

```bash
npm run test:server -- --test-name-pattern "Raspberry Pi Video Premium|Android TV player session"
```

Expected: the Raspberry Pi test fails because newly registered devices are created as `video_standard`.

- [ ] **Step 3: Update session creation**

In `apps/server/src/app.ts`, change the new-device record in `/api/player/session` so `playerType` is initialized from the request:

```ts
playerType: normalizeDevicePlayerType(req.body?.playerType || "video_standard"),
```

Keep the existing update path preserving the stored device type:

```ts
device.playerType = normalizeDevicePlayerType(device.playerType);
```

- [ ] **Step 4: Run focused and full backend tests**

Run:

```bash
npm run test:server -- --test-name-pattern "Raspberry Pi Video Premium|Android TV player session"
npm run test:server
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/api-contract.test.ts apps/server/src/app.ts
git commit -m "feat: register rpi video premium players"
```

---

### Task 2: Python Package Scaffold, Config, And Identity

**Files:**
- Create: `apps/rpi-player/pyproject.toml`
- Create: `apps/rpi-player/src/signaldeck_rpi/__init__.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/config.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/identity.py`
- Create: `apps/rpi-player/tests/test_config.py`
- Create: `apps/rpi-player/tests/test_identity.py`

- [ ] **Step 1: Write config and identity tests**

Create tests that prove defaults, TOML parsing, serial sanitization, and persisted two-output identity:

```python
def test_default_config_has_dual_hdmi_outputs():
    config = default_config()
    assert config.server_url == "https://cms.berry-secure.pl"
    assert [output.name for output in config.outputs] == ["HDMI-A-1", "HDMI-A-2"]
    assert [output.serial_suffix for output in config.outputs] == ["A", "B"]

def test_load_config_reads_sync_and_outputs(tmp_path):
    path = tmp_path / "player.toml"
    path.write_text('server_url = "https://cms.example.test"\n[sync]\nmode = "clocked_playlist"\npolicy = "strict"\ntolerance_ms = 125\n[[outputs]]\nname = "HDMI-A-1"\nserial_suffix = "A"\nenabled = true\n', encoding="utf-8")
    config = load_config(path)
    assert config.server_url == "https://cms.example.test"
    assert config.sync.mode == "clocked_playlist"
    assert config.sync.policy == "strict"
    assert config.sync.tolerance_ms == 125
    assert len(config.outputs) == 1

def test_normalize_serial_allows_only_uppercase_letters_and_digits():
    assert normalize_serial(" mk-5 abc:123 ") == "MK5ABC123"

def test_load_or_create_identity_persists_output_secrets(tmp_path):
    identity_path = tmp_path / "identity.json"
    outputs = [OutputConfig("HDMI-A-1", "A", True), OutputConfig("HDMI-A-2", "B", True)]
    identity = load_or_create_identity(identity_path, "MK5ABC123", outputs)
    assert identity.base_serial == "MK5ABC123"
    assert identity.outputs["HDMI-A-1"].serial == "MK5ABC123A"
    assert identity.outputs["HDMI-A-2"].serial == "MK5ABC123B"
    assert identity.outputs["HDMI-A-1"].secret
    assert load_or_create_identity(identity_path, "IGNORED", outputs).base_serial == "MK5ABC123"
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: import errors because modules do not exist yet.

- [ ] **Step 3: Implement scaffold/config/identity**

Implement dataclasses `OutputConfig`, `SyncConfig`, `PlayerConfig`, `OutputIdentity`, and `PlayerIdentity`. Use `tomllib` for reading config and `json` plus `uuid.uuid4().hex` for secrets. Write identity files with mode `0600` using `os.chmod`.

- [ ] **Step 4: Run tests**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: config and identity tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/rpi-player
git commit -m "feat: scaffold rpi player identity config"
```

---

### Task 3: CMS Client, Cache, Sync, Playback, And Commands

**Files:**
- Create: `apps/rpi-player/src/signaldeck_rpi/cms.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/cache.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/sync.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/playback.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/commands.py`
- Create: `apps/rpi-player/tests/test_cms.py`
- Create: `apps/rpi-player/tests/test_cache.py`
- Create: `apps/rpi-player/tests/test_sync.py`
- Create: `apps/rpi-player/tests/test_playback.py`
- Create: `apps/rpi-player/tests/test_commands.py`

- [ ] **Step 1: Write pure behavior tests**

Cover these exact behaviors:

```python
def test_sync_reports_mismatched_slot_count():
    result = validate_clocked_queues([{"durationSeconds": 10}], [{"durationSeconds": 10}, {"durationSeconds": 10}], 250)
    assert not result.compatible
    assert "slot count" in result.message

def test_sync_accepts_duration_within_tolerance():
    result = validate_clocked_queues([{"durationSeconds": 10.0}], [{"durationSeconds": 10.1}], 250)
    assert result.compatible

def test_mpv_command_targets_drm_connector_for_video():
    command = build_mpv_command("/cache/clip.mp4", "HDMI-A-1", "video", 30, 80)
    assert command[0] == "mpv"
    assert "--fs" in command
    assert "--drm-connector=HDMI-A-1" in command
    assert "/cache/clip.mp4" in command

def test_audio_items_are_skipped_with_warning():
    decision = playback_decision({"kind": "audio", "title": "Song"})
    assert decision.action == "skip"
    assert decision.severity == "warn"

def test_cache_key_uses_url_and_id_fallback():
    key = cache_key({"id": "item:0", "url": "https://cms.example.test/uploads/file.mp4"})
    assert key.endswith(".mp4")
    assert len(key.split(".")[0]) == 64

def test_route_reboot_is_global_action():
    action = route_command({"id": "1", "type": "reboot_os", "payload": {}})
    assert action.scope == "global"
    assert action.ack_status == "acked"
```

Use a local `http.server` test in `test_cms.py` to assert `CmsClient.post_session`, `ack_command`, and `post_log` send JSON and parse JSON.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: imports fail for new modules.

- [ ] **Step 3: Implement modules minimally**

Use standard-library implementations:

- `urllib.request` for HTTP JSON and downloads.
- `hashlib.sha256` for cache keys.
- `tempfile`/`.partial` path plus `Path.replace()` for atomic cache writes.
- `subprocess.Popen` for playback controller, but keep command construction separately testable.
- dataclass return values for sync results, command actions, and playback decisions.

- [ ] **Step 4: Run tests**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: all Python tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/rpi-player
git commit -m "feat: add rpi player runtime primitives"
```

---

### Task 4: Agent And WebUI

**Files:**
- Create: `apps/rpi-player/src/signaldeck_rpi/agent.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/webui.py`
- Create: `apps/rpi-player/src/signaldeck_rpi/__main__.py`
- Create: `apps/rpi-player/src/signaldeck_agent.py`
- Create: `apps/rpi-player/src/signaldeck_webui.py`
- Create: `apps/rpi-player/tests/test_agent.py`
- Create: `apps/rpi-player/tests/test_webui.py`

- [ ] **Step 1: Write orchestration tests**

Add tests for:

```python
def test_agent_builds_one_session_payload_per_enabled_output(tmp_path):
    runtime = make_test_runtime(tmp_path)
    payloads = runtime.build_session_payloads("idle", "")
    assert [payload["serial"] for payload in payloads] == ["MK5ABC123A", "MK5ABC123B"]
    assert all(payload["platform"] == "raspberrypi" for payload in payloads)
    assert all(payload["playerType"] == "video_premium" for payload in payloads)

def test_webui_status_json_contains_outputs(tmp_path):
    app = make_webui_app(make_status_provider(tmp_path))
    body = app.render_status_json()
    assert body["baseSerial"] == "MK5ABC123"
    assert "HDMI-A-1" in body["outputs"]
    assert "HDMI-A-2" in body["outputs"]
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: agent/webui helpers do not exist yet.

- [ ] **Step 3: Implement agent runtime and WebUI**

Implement:

- `AgentRuntime.build_session_payloads()`
- `AgentRuntime.poll_once()`
- command ACK handling
- cached playback queue update hooks
- `StatusProvider.snapshot()`
- `WebUiApp.render_status_json()`
- `WebUiApp.render_index_html()`
- `run_server(host, port, provider)`

The first UI can be compact HTML with forms and status tables, but must expose `/api/status` JSON for tests and local diagnostics.

- [ ] **Step 4: Run tests**

Run:

```bash
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: all Python tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/rpi-player
git commit -m "feat: add rpi player agent webui"
```

---

### Task 5: Systemd Templates And Installer

**Files:**
- Create: `apps/rpi-player/systemd/signaldeck-agent.service`
- Create: `apps/rpi-player/systemd/signaldeck-webui.service`
- Create: `apps/rpi-player/systemd/signaldeck-setup-mode.service`
- Create: `scripts/rpi/install-video-premium.sh`

- [ ] **Step 1: Write installer with functions and shell-safe defaults**

The installer must include:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_USER="${SIGNALDECK_USER:-signaldeck}"
INSTALL_DIR="${SIGNALDECK_INSTALL_DIR:-/opt/signaldeck}"
CONFIG_DIR="${SIGNALDECK_CONFIG_DIR:-/etc/signaldeck}"
STATE_DIR="${SIGNALDECK_STATE_DIR:-/var/lib/signaldeck}"
LOG_DIR="${SIGNALDECK_LOG_DIR:-/var/log/signaldeck}"
REPO_URL="${SIGNALDECK_REPO_URL:-https://github.com/berry-secure/digital-signage.git}"
REPO_REF="${SIGNALDECK_REF:-main}"
```

Required functions:

- `require_root`
- `require_raspberry_pi_5`
- `install_packages`
- `ensure_user`
- `install_application`
- `write_default_config`
- `write_systemd_units`
- `configure_hotspot_profile`
- `enable_services`
- `print_summary`

When `SIGNALDECK_SKIP_HARDWARE_CHECK=1`, hardware checks are skipped for local syntax/dev tests.

- [ ] **Step 2: Add systemd units**

Agent unit:

```ini
[Unit]
Description=Signal Deck Raspberry Pi Video Premium Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=signaldeck
Group=signaldeck
WorkingDirectory=/opt/signaldeck/apps/rpi-player
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/signaldeck/venv/bin/python -m signaldeck_agent
Restart=always
RestartSec=3
WatchdogSec=30

[Install]
WantedBy=multi-user.target
```

WebUI unit mirrors this with `ExecStart=/opt/signaldeck/venv/bin/python -m signaldeck_webui --host 0.0.0.0 --port 8080`.

- [ ] **Step 3: Run static checks**

Run:

```bash
bash -n scripts/rpi/install-video-premium.sh
python3 -m py_compile $(find apps/rpi-player/src -name '*.py' -print)
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: all checks pass.

- [ ] **Step 4: Commit**

```bash
git add apps/rpi-player scripts/rpi/install-video-premium.sh
git commit -m "feat: add rpi video premium installer"
```

---

### Task 6: Final Verification And Handoff Notes

**Files:**
- Modify: `docs/raspberry-pi-video-premium-handoff.md` if the install command or local test command changes.
- Modify: `README.md` only if a short pointer to the RPi package is useful.

- [ ] **Step 1: Run all available local checks**

Run:

```bash
npm run test:server
bash -n scripts/rpi/install-video-premium.sh
python3 -m py_compile $(find apps/rpi-player/src -name '*.py' -print)
PYTHONPATH=apps/rpi-player/src python3 -m unittest discover -s apps/rpi-player/tests -v
```

Expected: all checks pass locally.

- [ ] **Step 2: Record hardware verification gap**

Add a short note to the handoff that these still require physical Raspberry Pi 5 validation:

- DRM connector names
- `mpv --drm-connector` behavior
- hotspot activation on Raspberry Pi OS Lite
- sync delta measurement across two HDMI displays

- [ ] **Step 3: Commit final docs if changed**

```bash
git add docs README.md
git commit -m "docs: document rpi player verification"
```

