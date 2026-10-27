"""The Gemini installer adds and removes only its own entries, fail-safe."""

import json
from pathlib import Path

import pytest

import manage_gemini_hooks as mgh
from claude_office_hooks.gemini_event_mapper import HOOK_EVENT_TYPES

FOREIGN_ENTRY = {
    "hooks": [{"type": "command", "command": "/Users/me/.superset/hooks/gemini-hook.sh"}]
}


def _read(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_install_creates_a_missing_settings_file(tmp_path: Path) -> None:
    path = tmp_path / ".gemini" / "settings.json"
    assert mgh.install(path, "gemini-office-hook")
    hooks = _read(path)["hooks"]
    assert isinstance(hooks, dict)
    assert set(hooks) == set(HOOK_EVENT_TYPES)
    entry = hooks["BeforeTool"][0]["hooks"][0]
    assert entry["name"] == "agent-office"
    assert entry["command"] == "gemini-office-hook"
    assert entry["timeout"] == mgh.HOOK_TIMEOUT_MS


def test_install_keeps_other_tools_hooks_and_settings(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"theme": "dark", "hooks": {"AfterTool": [FOREIGN_ENTRY]}}))
    mgh.install(path, "gemini-office-hook")
    settings = _read(path)
    assert settings["theme"] == "dark"
    after_tool = settings["hooks"]["AfterTool"]  # type: ignore[index]
    assert after_tool[0] == FOREIGN_ENTRY
    assert mgh.is_ours(after_tool[1])


def test_install_twice_does_not_duplicate(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    mgh.install(path, "gemini-office-hook")
    assert not mgh.install(path, "gemini-office-hook")
    assert len(_read(path)["hooks"]["SessionStart"]) == 1  # type: ignore[index]


def test_install_backs_up_the_original_once(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"hooks": {"AfterTool": [FOREIGN_ENTRY]}}))
    mgh.install(path, "gemini-office-hook")
    backup = tmp_path / "settings.json.bak"
    assert _read(backup) == {"hooks": {"AfterTool": [FOREIGN_ENTRY]}}


def test_invalid_json_is_never_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text("{ not json")
    with pytest.raises(SystemExit):
        mgh.install(path, "gemini-office-hook")
    assert path.read_text() == "{ not json"


def test_uninstall_removes_only_ours(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"hooks": {"AfterTool": [FOREIGN_ENTRY]}}))
    mgh.install(path, "gemini-office-hook")
    assert mgh.uninstall(path)
    assert _read(path)["hooks"] == {"AfterTool": [FOREIGN_ENTRY]}
    assert mgh.installed_events(path) == []


def test_status_lists_installed_events(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    assert mgh.installed_events(path) == []
    mgh.install(path, "gemini-office-hook")
    assert set(mgh.installed_events(path)) == set(HOOK_EVENT_TYPES)
