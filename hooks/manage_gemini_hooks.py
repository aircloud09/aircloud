#!/usr/bin/env python3
"""Install the Agent Office hook into Gemini CLI's settings.

Every hook event the Gemini mapper understands gets one entry named
``agent-office`` that runs ``gemini-office-hook``. Installing again replaces
those entries, and uninstalling removes only them, so hooks from other tools
stay as they are. Settings are read and written with ``manage_hooks``'
fail-safe helpers: a file that is not valid JSON is never overwritten, the
first change is backed up to ``settings.json.bak``, and writes are atomic.
"""

import argparse
from pathlib import Path
from typing import Any

from claude_office_hooks.gemini_event_mapper import HOOK_EVENT_TYPES
from manage_hooks import load_settings, save_settings

HOOK_NAME = "agent-office"
HOOK_COMMAND = "gemini-office-hook"
# Gemini CLI hook timeouts are in milliseconds; the hook itself gives up on the
# backend well before this.
HOOK_TIMEOUT_MS = 5000


def get_settings_path() -> Path:
    """Gemini CLI's user settings file."""
    return Path.home() / ".gemini" / "settings.json"


def create_hook_entry(hook_cmd: str) -> dict[str, Any]:
    """One settings entry that runs *hook_cmd* for every call of an event."""
    return {
        "hooks": [
            {
                "name": HOOK_NAME,
                "type": "command",
                "command": hook_cmd,
                "timeout": HOOK_TIMEOUT_MS,
                "description": "Agent Office visualizer event",
            }
        ]
    }


def is_ours(entry: Any) -> bool:
    """Whether a settings entry is one this installer wrote."""
    if not isinstance(entry, dict):
        return False
    for hook in entry.get("hooks", []):
        if isinstance(hook, dict) and (
            hook.get("name") == HOOK_NAME or HOOK_COMMAND in str(hook.get("command", ""))
        ):
            return True
    return False


def install(settings_path: Path, hook_cmd: str, dry_run: bool = False) -> bool:
    """Register *hook_cmd* for every mapped event. Returns whether anything changed."""
    settings = load_settings(settings_path)
    hooks: dict[str, Any] = settings.get("hooks", {})
    changed = False
    for event in HOOK_EVENT_TYPES:
        current: list[Any] = hooks.get(event, [])
        updated = [entry for entry in current if not is_ours(entry)]
        updated.append(create_hook_entry(hook_cmd))
        if updated != current:
            hooks[event] = updated
            changed = True
            print(f"  [Set]  {event}: {hook_cmd}")
    if changed and not dry_run:
        settings["hooks"] = hooks
        save_settings(settings_path, settings)
    return changed


def uninstall(settings_path: Path, dry_run: bool = False) -> bool:
    """Remove this installer's entries. Returns whether anything changed."""
    if not settings_path.exists():
        return False
    settings = load_settings(settings_path)
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
        save_settings(settings_path, settings)
    return changed


def installed_events(settings_path: Path) -> list[str]:
    """Events whose hooks include this installer's entry."""
    if not settings_path.exists():
        return []
    hooks: dict[str, Any] = load_settings(settings_path).get("hooks", {})
    return [event for event, entries in hooks.items() if any(is_ours(e) for e in entries)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the Agent Office hook for Gemini CLI.")
    parser.add_argument("action", choices=["install", "uninstall", "status"])
    parser.add_argument("--hook-cmd", default=HOOK_COMMAND, help="Command Gemini CLI runs")
    parser.add_argument(
        "--settings",
        type=Path,
        default=None,
        help="Settings file (default: ~/.gemini/settings.json; a project's also works)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    args = parser.parse_args()
    settings_path: Path = args.settings or get_settings_path()

    if args.action == "install":
        print(f"Installing the Agent Office hook into {settings_path}...")
        changed = install(settings_path, args.hook_cmd, args.dry_run)
        print("Settings saved." if changed and not args.dry_run else "No changes saved.")
    elif args.action == "uninstall":
        print(f"Removing the Agent Office hook from {settings_path}...")
        changed = uninstall(settings_path, args.dry_run)
        print("Settings saved." if changed and not args.dry_run else "No changes saved.")
    else:
        events = installed_events(settings_path)
        print(f"{settings_path}: " + (", ".join(events) if events else "not installed"))


if __name__ == "__main__":
    main()
