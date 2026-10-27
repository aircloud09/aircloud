#!/usr/bin/env python3
import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any

# Constants
HOOK_TYPES = [
    "SessionStart",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "PermissionRequest",
    "Notification",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
]


# Substrings that mark a settings entry as ours: the event hook (bare name or
# absolute path, with or without .exe), the old .sh wrappers, and the
# launcher that starts the office on SessionStart.
OUR_MARKERS = ("claude-office-hook", "claude-office/hooks/", "agent_office.py")


def quote_cmd(path: str) -> str:
    """Quote an executable path that contains whitespace.

    Hook commands run through a shell (Git Bash on Windows), so an absolute
    path such as ``C:/Users/Jane Doe/.local/bin/claude-office-hook.exe`` must
    be quoted to stay one word.
    """
    return f'"{path}"' if any(c.isspace() for c in path) else path


def entry_command(entry: dict[str, Any]) -> str:
    """Return the first hook command of a settings entry, or ``""``."""
    try:
        return entry.get("hooks", [])[0].get("command", "") or ""
    except (IndexError, AttributeError):
        return ""


def is_ours(entry: dict[str, Any]) -> bool:
    return any(marker in entry_command(entry) for marker in OUR_MARKERS)


def get_settings_path() -> Path:
    """Get the path to the Claude settings file."""
    # Priority: Env var -> ~/.claude/settings.json
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        return Path(os.environ["CLAUDE_CONFIG_DIR"]) / "settings.json"
    return Path.home() / ".claude" / "settings.json"


def load_settings(path: Path) -> dict[str, Any]:
    """Load settings from JSON file.

    A missing file returns ``{}`` (fresh install). A file that exists but
    fails to parse is a hard stop: returning ``{}`` here would cause the
    caller to write a near-empty dict back over the user's real config and
    silently wipe unrelated settings (permissions, env, model, statusline).
    """
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise SystemExit(
            f"ERROR: {path} exists but is not valid JSON ({e}).\n"
            "Refusing to continue: proceeding would overwrite your settings.\n"
            "Fix or move the file, then re-run install."
        ) from e


def save_settings(path: Path, settings: dict[str, Any]) -> None:
    """Save settings atomically, backing up the original once per run.

    Writes a temp file in the same directory then ``os.replace``s it into
    place, so a crash mid-write cannot leave a truncated ``settings.json``.
    The first mutation of an existing file is snapshotted to
    ``settings.json.bak``; the ``if not backup.exists()`` guard preserves
    the oldest known-good copy across repeated runs.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_suffix(".json.bak")
        if not backup.exists():
            shutil.copy2(path, backup)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def create_hook_config(hook_cmd: str, hook_type: str) -> dict[str, Any]:
    """Create the hook configuration dictionary.

    Args:
        hook_cmd: Path to the claude-office-hook command
        hook_type: The hook type in PascalCase (e.g., "PreToolUse")
    """
    # Convert PascalCase to snake_case for the event type argument
    event_type = convert_camel_to_snake(hook_type)

    config = {
        "type": "command",
        "command": f"{quote_cmd(hook_cmd)} {event_type}",
        "timeout": 2,  # Seconds
    }

    # Wrap in the structure expected by Claude Code
    # Structure:
    # "HookName": [
    #   {
    #     "matcher": ".*" (optional),
    #     "hooks": [ { "type": "command", ... } ]
    #   }
    # ]

    hook_entry: dict[str, Any] = {"hooks": [config]}

    # Hooks that support matchers (match all with ".*")
    if hook_type in [
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
        "Notification",
        "SubagentStart",
        "SubagentStop",
    ]:
        hook_entry["matcher"] = ".*"

    return hook_entry


def is_same_hook(entry1: dict[str, Any], entry2: dict[str, Any]) -> bool:
    """Check if two hook entries are effectively the same."""
    # Simple comparison of command path
    try:
        cmd1 = entry1.get("hooks", [])[0].get("command")
        cmd2 = entry2.get("hooks", [])[0].get("command")
        return cmd1 == cmd2
    except (IndexError, AttributeError):
        return False


def create_launcher_config(launcher_cmd: str) -> dict[str, Any]:
    """SessionStart entry that starts the office server if it is down.

    The command hands the work to a detached process and returns at once, so
    the short timeout only guards against a broken interpreter path.
    """
    return {"hooks": [{"type": "command", "command": launcher_cmd, "timeout": 5}]}


def _merge_entry(
    hooks_config: dict[str, Any], hook_type: str, new_entry: dict[str, Any], marker: str
) -> bool:
    """Add *new_entry* under *hook_type*, replacing our stale copies of it.

    Entries whose command contains *marker* but differ from *new_entry* (for
    example the bare ``claude-office-hook`` an older install wrote) are
    dropped; everything else the user has is kept as is. Returns True when
    the list changed.
    """
    current_list = hooks_config.get(hook_type, [])
    if any(is_same_hook(existing, new_entry) for existing in current_list):
        print(f"  [Skip] {hook_type}: Hook already exists.")
        return False

    kept: list[Any] = []
    for existing in current_list:
        cmd = entry_command(existing)
        if marker in cmd:
            print(f"  [Replace] {hook_type}: {cmd}")
            continue
        kept.append(existing)
    print(f"  [Add]  {hook_type}: {entry_command(new_entry)}")
    kept.append(new_entry)
    hooks_config[hook_type] = kept
    return True


def install_hooks(hook_cmd: str, dry_run: bool = False, launcher_cmd: str | None = None):
    """Install hooks into settings.

    Args:
        hook_cmd: Path to the claude-office-hook command
        dry_run: If True, don't actually save changes
        launcher_cmd: Full SessionStart command that starts the office (optional)
    """
    settings_path = get_settings_path()
    print(f"Installing hooks to {settings_path}...")

    settings = load_settings(settings_path)
    hooks_config = settings.get("hooks", {})

    changes_made = False

    for hook_type in HOOK_TYPES:
        new_entry = create_hook_config(hook_cmd, hook_type)
        if _merge_entry(hooks_config, hook_type, new_entry, "claude-office-hook"):
            changes_made = True

    if launcher_cmd and _merge_entry(
        hooks_config, "SessionStart", create_launcher_config(launcher_cmd), "agent_office.py"
    ):
        changes_made = True

    if changes_made:
        settings["hooks"] = hooks_config
        if not dry_run:
            save_settings(settings_path, settings)
            print("Settings saved.")
        else:
            print("Dry run: No changes saved.")
    else:
        print("No changes needed.")


def uninstall_hooks(_hook_cmd: str, dry_run: bool = False) -> None:
    """Remove hooks from settings.

    Args:
        _hook_cmd: Path to the claude-office-hook command (unused, hooks identified by pattern)
        dry_run: If True, don't actually save changes
    """
    del _hook_cmd  # Unused - hooks identified by pattern match
    settings_path = get_settings_path()
    print(f"Uninstalling hooks from {settings_path}...")

    settings = load_settings(settings_path)
    hooks_config = settings.get("hooks", {})

    changes_made = False

    for hook_type in list(hooks_config.keys()):
        current_list = hooks_config[hook_type]
        original_len = len(current_list)

        # Filter out hooks that use our command (event hook, old .sh wrappers,
        # and the office launcher)
        new_list: list[Any] = []
        for entry in current_list:
            if is_ours(entry):
                print(f"  [Remove] {hook_type}: {entry_command(entry)}")
                continue
            new_list.append(entry)

        if len(new_list) < original_len:
            hooks_config[hook_type] = new_list
            changes_made = True

        # Clean up empty lists
        if not hooks_config[hook_type]:
            del hooks_config[hook_type]

    if changes_made:
        settings["hooks"] = hooks_config
        if not dry_run:
            save_settings(settings_path, settings)
            print("Settings saved.")
        else:
            print("Dry run: No changes saved.")
    else:
        print("No hooks found to remove.")


def convert_camel_to_snake(name: str) -> str:
    import re

    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def main():
    parser = argparse.ArgumentParser(description="Manage Claude Office hooks.")
    parser.add_argument("action", choices=["install", "uninstall"], help="Action to perform")
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    parser.add_argument("--hook-cmd", help="Path to claude-office-hook command", required=True)
    parser.add_argument(
        "--launcher-cmd",
        help="Full SessionStart command that starts the office server when it is down",
    )

    args = parser.parse_args()

    if args.action == "install":
        install_hooks(args.hook_cmd, args.dry_run, args.launcher_cmd)
    elif args.action == "uninstall":
        uninstall_hooks(args.hook_cmd, args.dry_run)


if __name__ == "__main__":
    main()
