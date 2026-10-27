"""Connecting coding agents to the office from the browser (``/api/v1/hooks``)."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.agent_hooks import (
    AGENT_HOOKS,
    AgentHook,
    HookRunBusyError,
    connected_events,
    run_hook_action,
)
from app.main import app

client = TestClient(app)


def _auth_headers() -> dict[str, str]:
    return {"X-API-Key": get_settings().effective_api_key}


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty home folder, so no test reads or writes the real agent settings."""
    monkeypatch.setenv("HOME", str(tmp_path))
    for name in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "UV_TOOL_BIN_DIR", "XDG_BIN_HOME"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


def _write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _group(command: str) -> dict[str, object]:
    return {"hooks": [{"type": "command", "command": command}]}


class TestConnectedEvents:
    def test_reads_only_the_office_hook(self, home: Path) -> None:
        _write(
            home / ".claude" / "settings.json",
            {
                "hooks": {
                    "PreToolUse": [{"matcher": ".*", **_group("claude-office-hook pre_tool_use")}],
                    "Stop": [_group("some-other-tool stop")],
                }
            },
        )
        assert connected_events(AGENT_HOOKS["claude-code"]) == ["PreToolUse"]

    def test_missing_or_broken_settings_read_as_not_connected(self, home: Path) -> None:
        (home / ".gemini").mkdir()
        (home / ".gemini" / "settings.json").write_text("{not json", encoding="utf-8")
        assert connected_events(AGENT_HOOKS["codex"]) == []
        assert connected_events(AGENT_HOOKS["gemini-cli"]) == []

    def test_follows_codex_home(self, home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CODEX_HOME", str(home / "codex-home"))
        _write(
            home / "codex-home" / "hooks.json", {"hooks": {"Stop": [_group("codex-office-hook")]}}
        )
        assert connected_events(AGENT_HOOKS["codex"]) == ["Stop"]


class TestHooksApi:
    def test_lists_every_agent(self, home: Path) -> None:
        res = client.get("/api/v1/hooks")
        assert res.status_code == 200
        agents = res.json()["agents"]
        assert [a["agent"] for a in agents] == ["claude-code", "codex", "gemini-cli"]
        assert agents[0]["settings_path"] == "~/.claude/settings.json"
        assert not any(a["connected"] for a in agents)

    @pytest.mark.parametrize(
        "origin",
        [
            None,  # curl and other clients that send no Origin
            "https://evil.example",  # another site in the same browser
            "http://attacker.test:8000",  # DNS rebinding: Origin names the attacker's host
            "http://0.0.0.0:4747",  # in the CORS list, but not a loopback host
            "null",
        ],
    )
    def test_anyone_but_the_office_page_needs_the_launch_token(
        self, home: Path, monkeypatch: pytest.MonkeyPatch, origin: str | None
    ) -> None:
        async def must_not_run(hook: AgentHook, action: str) -> tuple[bool, str, str]:
            raise AssertionError("ran without the launch token")

        monkeypatch.setattr("app.api.routes.agent_hooks.run_hook_action", must_not_run)
        headers = {"Origin": origin} if origin else {}
        res = client.post("/api/v1/hooks/claude-code/install", headers=headers)
        assert res.status_code == 401

    def test_the_office_page_connects_without_the_token(
        self, home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_run(hook: AgentHook, action: str) -> tuple[bool, str, str]:
            return True, " ".join(hook.install), "Done!"

        monkeypatch.setattr("app.api.routes.agent_hooks.run_hook_action", fake_run)
        monkeypatch.setattr("app.api.routes.agent_hooks.unavailable_reason", lambda: None)
        res = client.post(
            "/api/v1/hooks/claude-code/install", headers={"Origin": "http://localhost:4747"}
        )
        assert res.status_code == 200
        assert res.json()["ok"]

    def test_an_explicit_key_gates_the_office_page_too(
        self, home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "CLAUDE_OFFICE_API_KEY", "explicit-key")
        res = client.post(
            "/api/v1/hooks/claude-code/install", headers={"Origin": "http://localhost:4747"}
        )
        assert res.status_code == 401

    def test_unknown_agent_or_action(self, home: Path) -> None:
        assert (
            client.post("/api/v1/hooks/cursor/install", headers=_auth_headers()).status_code == 404
        )
        assert client.post("/api/v1/hooks/codex/delete", headers=_auth_headers()).status_code == 422

    def test_backend_reachable_from_outside_refuses(
        self, home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "LOCALHOST_ONLY", False)
        assert client.get("/api/v1/hooks").json()["reason"] == "not_local"
        res = client.post("/api/v1/hooks/claude-code/install", headers=_auth_headers())
        assert res.status_code == 409
        assert res.json()["detail"] == "not_local"

    def test_install_runs_the_command_and_rereads_the_settings(
        self, home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ran: list[tuple[str, str]] = []

        async def fake_run(hook: AgentHook, action: str) -> tuple[bool, str, str]:
            ran.append((hook.agent, action))
            _write(
                home / ".claude" / "settings.json",
                {"hooks": {"Stop": [_group("claude-office-hook stop")]}},
            )
            return True, " ".join(hook.install), "Done!"

        monkeypatch.setattr("app.api.routes.agent_hooks.run_hook_action", fake_run)
        monkeypatch.setattr("app.api.routes.agent_hooks.unavailable_reason", lambda: None)
        res = client.post("/api/v1/hooks/claude-code/install", headers=_auth_headers())
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] and body["command"] == "make hooks-install"
        assert body["status"]["connected"] and body["status"]["events"] == ["Stop"]
        assert ran == [("claude-code", "install")]


def _shell_hook(script: str) -> AgentHook:
    return AgentHook(
        agent="test",
        cli="true",
        hook_command="test-office-hook",
        settings_path=lambda: Path("/nonexistent/settings.json"),
        install=("sh", "-c", script),
        remove=("true",),
    )


class TestRunHookAction:
    def test_reports_failure_with_the_last_lines(self) -> None:
        hook = _shell_hook("for i in $(seq 1 50); do echo line $i; done; exit 3")
        ok, command, output = asyncio.run(run_hook_action(hook, "install"))
        assert not ok
        assert command.startswith("sh -c")
        assert output.splitlines() == [f"line {i}" for i in range(11, 51)]

    def test_one_command_at_a_time(self) -> None:
        hook = _shell_hook("sleep 0.5")

        async def overlap() -> bool:
            first = asyncio.create_task(run_hook_action(hook, "install"))
            await asyncio.sleep(0.1)
            with pytest.raises(HookRunBusyError):
                await run_hook_action(hook, "install")
            ok, _, _ = await first
            return ok

        assert asyncio.run(overlap())
