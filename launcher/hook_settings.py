#!/usr/bin/env python3
"""Merge the Agent Office hooks into Claude Code's settings.json.

Uses the fork's own hooks/manage_hooks.py (unmodified) for the hook list, the
entry format and the safe load/save (backup + atomic write), and adds what it
cannot do on its own:

- absolute hook paths, quoted when they contain spaces (the desktop app runs
  hooks with a limited PATH, so the bare ``claude-office-hook`` would fail);
- the SessionStart entry that starts the office (launcher/agent_office.py);
- dropping our stale copies (e.g. a bare-name entry from ``make hooks-install``)
  so events are not sent twice.

Every other hook and setting in the file is kept as is.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))
import manage_hooks  # noqa: E402  (the fork's module, imported unmodified)

OUR_MARKERS = ("claude-office-hook", "claude-office/hooks/", "agent_office.py")


def _command(entry: Any) -> str:
    try:
        return entry.get("hooks", [])[0].get("command", "") or ""
    except (IndexError, AttributeError):
        return ""


def _strip_ours(hooks_config: dict[str, Any]) -> list[str]:
    """Remove every entry of ours; return the commands removed."""
    removed: list[str] = []
    for hook_type in list(hooks_config):
        kept = []
        for entry in hooks_config[hook_type]:
            cmd = _command(entry)
            if any(m in cmd for m in OUR_MARKERS):
                removed.append(f"{hook_type}: {cmd}")
            else:
                kept.append(entry)
        if kept:
            hooks_config[hook_type] = kept
        else:
            del hooks_config[hook_type]
    return removed


def install(hook_exe: str, launcher_cmd: str) -> None:
    path = manage_hooks.get_settings_path()
    settings = manage_hooks.load_settings(path)
    hooks_config: dict[str, Any] = settings.get("hooks", {})
    before = repr(hooks_config)

    _strip_ours(hooks_config)
    hook_cmd = f'"{hook_exe}"' if any(c.isspace() for c in hook_exe) else hook_exe
    for hook_type in manage_hooks.HOOK_TYPES:
        hooks_config.setdefault(hook_type, []).append(
            manage_hooks.create_hook_config(hook_cmd, hook_type)
        )
    hooks_config.setdefault("SessionStart", []).append(
        {"hooks": [{"type": "command", "command": launcher_cmd, "timeout": 5}]}
    )

    if repr(hooks_config) == before:
        print(f"  {path}: already up to date")
        return
    settings["hooks"] = hooks_config
    manage_hooks.save_settings(path, settings)
    print(f"  {path}: {len(manage_hooks.HOOK_TYPES) + 1} hooks registered (others kept)")


def uninstall() -> None:
    path = manage_hooks.get_settings_path()
    settings = manage_hooks.load_settings(path)
    hooks_config: dict[str, Any] = settings.get("hooks", {})
    removed = _strip_ours(hooks_config)
    for line in removed:
        print(f"  [Remove] {line}")
    if removed:
        settings["hooks"] = hooks_config
        manage_hooks.save_settings(path, settings)
    else:
        print("  nothing to remove")
