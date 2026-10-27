#!/usr/bin/env python3
"""Install the Agent Office hook into Codex CLI's hooks.json.

Every hook event the Codex mapper understands gets one entry that runs
``codex-office-hook``. Installing again replaces those entries, and
uninstalling removes only them, so hooks from other tools stay as they are.
The file is read and written with ``manage_hooks``' fail-safe helpers: a file
that is not valid JSON is never overwritten, the first change is backed up to
``hooks.json.bak``, and writes are atomic.

Codex runs a new or changed hook only once it is trusted: open Codex and
review the Agent Office hooks with ``/hooks``.
"""

import argparse
import os
from pathlib import Path
from typing import Any

from claude_office_hooks.codex_event_mapper import HOOK_EVENT_TYPES
from manage_hooks import load_settings, save_settings

HOOK_COMMAND = "codex-office-hook"
# Codex hook timeouts are in seconds; the hook itself gives up on the backend
# well before this. SessionEnd allows at most 3.
HOOK_TIMEOUT_SECONDS = 5
SESSION_END_TIMEOUT_SECONDS = 3

TRUST_NOTE = (
    "Codex runs new hooks only once they are trusted: open Codex and review them with /hooks."
)


def get_hooks_path() -> Path:
    """Codex CLI's user hooks file (``$CODEX_HOME``, else ``~/.codex``)."""
    codex_home = os.environ.get("CODEX_HOME")
    return (Path(codex_home) if codex_home else Path.home() / ".codex") / "hooks.json"


def create_hook_entry(hook_cmd: str, event: str) -> dict[str, Any]:
    """One hooks.json group that runs *hook_cmd* for every call of *event*."""
    timeout = SESSION_END_TIMEOUT_SECONDS if event == "SessionEnd" else HOOK_TIMEOUT_SECONDS
    return {"hooks": [{"type": "command", "command": hook_cmd, "timeout": timeout}]}


def is_ours(entry: Any) -> bool:
    """Whether a hooks.json group is one this installer wrote."""
    if not isinstance(entry, dict):
        return False
    return any(
        isinstance(hook, dict) and HOOK_COMMAND in str(hook.get("command", ""))
        for hook in entry.get("hooks", [])
    )


def install(hooks_path: Path, hook_cmd: str, dry_run: bool = False) -> bool:
    """Register *hook_cmd* for every mapped event. Returns whether anything changed."""
    settings = load_settings(hooks_path)
    hooks: dict[str, Any] = settings.get("hooks", {})
    changed = False
    for event in HOOK_EVENT_TYPES:
        current: list[Any] = hooks.get(event, [])
        updated = [entry for entry in current if not is_ours(entry)]
        updated.append(create_hook_entry(hook_cmd, event))
        if updated != current:
            hooks[event] = updated
            changed = True
            print(f"  [Set]  {event}: {hook_cmd}")
    if changed and not dry_run:
        settings["hooks"] = hooks
        save_settings(hooks_path, settings)
    return changed


def uninstall(hooks_path: Path, dry_run: bool = False) -> bool:
    """Remove this installer's groups. Returns whether anything changed."""
    if not hooks_path.exists():
        return False
    settings = load_settings(hooks_path)
    hooks: dict[str, Any] = settings.get("hooks", {})
    changed = False
    for event in list(hooks):
        kept = [entry for entry in hooks[event] if not is_ours(entry)]
        if len(kept) != len(hooks[event]):
            changed = True
            print(f"  [Remove] {event}")
            if kept:
                hooks[event] = kept
            else:
                del hooks[event]
    if changed and not dry_run:
        settings["hooks"] = hooks
        save_settings(hooks_path, settings)
    return changed


def installed_events(hooks_path: Path) -> list[str]:
    """Events whose hooks include this installer's group."""
    if not hooks_path.exists():
        return []
    hooks: dict[str, Any] = load_settings(hooks_path).get("hooks", {})
    return [event for event, entries in hooks.items() if any(is_ours(e) for e in entries)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the Agent Office hook for Codex CLI.")
    parser.add_argument("action", choices=["install", "uninstall", "status"])
    parser.add_argument("--hook-cmd", default=HOOK_COMMAND, help="Command Codex CLI runs")
    parser.add_argument(
        "--hooks-file",
        type=Path,
        default=None,
        help="Hooks file (default: $CODEX_HOME/hooks.json, else ~/.codex/hooks.json)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    args = parser.parse_args()
    hooks_path: Path = args.hooks_file or get_hooks_path()

    if args.action == "install":
        print(f"Installing the Agent Office hook into {hooks_path}...")
        changed = install(hooks_path, args.hook_cmd, args.dry_run)
        print("Hooks saved." if changed and not args.dry_run else "No changes saved.")
        print(TRUST_NOTE)
    elif args.action == "uninstall":
        print(f"Removing the Agent Office hook from {hooks_path}...")
        changed = uninstall(hooks_path, args.dry_run)
        print("Hooks saved." if changed and not args.dry_run else "No changes saved.")
    else:
        events = installed_events(hooks_path)
        print(f"{hooks_path}: " + (", ".join(events) if events else "not installed"))


if __name__ == "__main__":
    main()
