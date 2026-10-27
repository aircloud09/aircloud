"""The Codex installer adds and removes only its own hook groups, fail-safe."""

import json
from pathlib import Path

import pytest

import manage_codex_hooks as mch
from claude_office_hooks.codex_event_mapper import HOOK_EVENT_TYPES

# What other tools put in a user's ~/.codex/hooks.json.
FOREIGN_GROUP = {"hooks": [{"type": "command", "command": "/Users/me/.superset/hooks/codex.sh"}]}


def _read(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_install_creates_a_missing_hooks_file(tmp_path: Path) -> None:
    path = tmp_path / ".codex" / "hooks.json"
    assert mch.install(path, "codex-office-hook")
    hooks = _read(path)["hooks"]
    assert isinstance(hooks, dict)
    assert set(hooks) == set(HOOK_EVENT_TYPES)
    handler = hooks["PreToolUse"][0]["hooks"][0]
    assert handler == {"type": "command", "command": "codex-office-hook", "timeout": 5}
    # Codex allows SessionEnd hooks at most 3 seconds.
    assert hooks["SessionEnd"][0]["hooks"][0]["timeout"] == 3


def test_install_keeps_other_tools_hooks(tmp_path: Path) -> None:
    path = tmp_path / "hooks.json"
    path.write_text(json.dumps({"description": "mine", "hooks": {"Stop": [FOREIGN_GROUP]}}))
    mch.install(path, "codex-office-hook")
    settings = _read(path)
    assert settings["description"] == "mine"
    stop = settings["hooks"]["Stop"]  # type: ignore[index]
    assert stop[0] == FOREIGN_GROUP
    assert mch.is_ours(stop[1])
    assert (tmp_path / "hooks.json.bak").exists()


def test_install_again_replaces_its_own_groups(tmp_path: Path) -> None:
    path = tmp_path / "hooks.json"
    mch.install(path, "/old/codex-office-hook")
    assert mch.install(path, "/new/codex-office-hook")
    stop = _read(path)["hooks"]["Stop"]  # type: ignore[index]
    assert [g["hooks"][0]["command"] for g in stop] == ["/new/codex-office-hook"]
    assert not mch.install(path, "/new/codex-office-hook")


def test_uninstall_removes_only_its_own(tmp_path: Path) -> None:
    path = tmp_path / "hooks.json"
    path.write_text(json.dumps({"hooks": {"Stop": [FOREIGN_GROUP]}}))
    mch.install(path, "codex-office-hook")
    assert mch.uninstall(path)
    assert _read(path)["hooks"] == {"Stop": [FOREIGN_GROUP]}
    assert mch.installed_events(path) == []


def test_status_lists_installed_events(tmp_path: Path) -> None:
    path = tmp_path / "hooks.json"
    assert mch.installed_events(path) == []
    mch.install(path, "codex-office-hook")
    assert set(mch.installed_events(path)) == set(HOOK_EVENT_TYPES)


def test_a_broken_hooks_file_is_never_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "hooks.json"
    path.write_text("{not json")
    with pytest.raises(SystemExit):
        mch.install(path, "codex-office-hook")
    assert path.read_text() == "{not json"


def test_codex_home_moves_the_hooks_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex"))
    assert mch.get_hooks_path() == tmp_path / "codex" / "hooks.json"
    monkeypatch.delenv("CODEX_HOME")
    assert mch.get_hooks_path() == Path.home() / ".codex" / "hooks.json"
