"""Connect coding agents to the office from the browser.

The settings page connects an agent with the same command a user would type
(``make hooks-install`` and its Codex and Gemini twins), so the browser and the
terminal stay one path. Whether an agent is connected is read straight from its
own settings file, the way ``hooks/manage_*hooks.py status`` reads it.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

from app.config import get_settings
from app.core.coding_agent import CLAUDE_CODE, CODEX, GEMINI_CLI

REPO_ROOT = Path(__file__).resolve().parents[3]
HOOKS_DIR = REPO_ROOT / "hooks"

# Installing builds the hook tool and fetches Python 3.14 the first time.
RUN_TIMEOUT_SECONDS = 300
# How much of a command's output the settings page shows.
OUTPUT_TAIL_LINES = 40

HookAction = Literal["install", "remove"]

# Set for the backend itself (its uv environment, and make's job server under
# ``make dev``); the install command needs none of them.
_PARENT_ONLY_ENV = frozenset({"VIRTUAL_ENV", "MAKEFLAGS", "MFLAGS", "MAKELEVEL"})


def _claude_settings() -> Path:
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    return (Path(config_dir) if config_dir else Path.home() / ".claude") / "settings.json"


def _codex_hooks() -> Path:
    codex_home = os.environ.get("CODEX_HOME")
    return (Path(codex_home) if codex_home else Path.home() / ".codex") / "hooks.json"


def _gemini_settings() -> Path:
    return Path.home() / ".gemini" / "settings.json"


@dataclass(frozen=True)
class AgentHook:
    """How one coding agent runs the office hook, and how to add or drop it."""

    agent: str
    cli: str
    hook_command: str
    settings_path: Callable[[], Path]
    # Run from the repository root, as the README tells users to.
    install: tuple[str, ...]
    # Run from ``hooks/``. Drops only this agent's entries: the hook tool stays
    # because the other agents run the same tool.
    remove: tuple[str, ...]


AGENT_HOOKS: dict[str, AgentHook] = {
    hook.agent: hook
    for hook in (
        AgentHook(
            agent=CLAUDE_CODE,
            cli="claude",
            hook_command="claude-office-hook",
            settings_path=_claude_settings,
            install=("make", "hooks-install"),
            # Not ``make hooks-uninstall``: that also uninstalls the hook tool.
            remove=(
                "uv",
                "run",
                "-p",
                "3.14",
                "manage_hooks.py",
                "uninstall",
                "--hook-cmd",
                "claude-office-hook",
            ),
        ),
        AgentHook(
            agent=CODEX,
            cli="codex",
            hook_command="codex-office-hook",
            settings_path=_codex_hooks,
            install=("make", "codex-hooks-install"),
            remove=("uv", "run", "-p", "3.14", "manage_codex_hooks.py", "uninstall"),
        ),
        AgentHook(
            agent=GEMINI_CLI,
            cli="gemini",
            hook_command="gemini-office-hook",
            settings_path=_gemini_settings,
            install=("make", "gemini-hooks-install"),
            remove=("uv", "run", "-p", "3.14", "manage_gemini_hooks.py", "uninstall"),
        ),
    )
}


def _runs_hook(group: Any, command: str) -> bool:
    """Whether a settings hook group runs *command*."""
    if not isinstance(group, dict):
        return False
    entries: Any = cast(dict[str, Any], group).get("hooks")
    if not isinstance(entries, list):
        return False
    return any(
        isinstance(entry, dict) and command in str(cast(dict[str, Any], entry).get("command", ""))
        for entry in cast(list[Any], entries)
    )


def connected_events(hook: AgentHook) -> list[str]:
    """Events whose hooks in the agent's settings run the office hook."""
    try:
        data: Any = json.loads(hook.settings_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    hooks: Any = cast(dict[str, Any], data).get("hooks")
    if not isinstance(hooks, dict):
        return []
    return [
        event
        for event, groups in cast(dict[str, Any], hooks).items()
        if isinstance(groups, list)
        and any(_runs_hook(group, hook.hook_command) for group in cast(list[Any], groups))
    ]


def hook_tool_found(command: str) -> bool:
    """Whether the hook tool is on PATH or where ``uv tool install`` puts it."""
    if shutil.which(command):
        return True
    bin_dirs = (
        os.environ.get("UV_TOOL_BIN_DIR"),
        os.environ.get("XDG_BIN_HOME"),
        str(Path.home() / ".local" / "bin"),
    )
    return any(d and (Path(d) / command).is_file() for d in bin_dirs)


def display_path(path: Path) -> str:
    """*path* with the home folder written as ``~``."""
    home = Path.home()
    return f"~/{path.relative_to(home)}" if path.is_relative_to(home) else str(path)


def unavailable_reason() -> str | None:
    """Why this backend cannot connect agents, or None when it can."""
    if not get_settings().LOCALHOST_ONLY:
        # Docker: the hooks would land inside the container, not on the host.
        return "not_local"
    if not (HOOKS_DIR / "install.sh").is_file():
        return "no_repo"
    for tool in ("make", "uv"):
        if shutil.which(tool) is None:
            return f"no_{tool}"
    return None


class HookRunBusyError(Exception):
    """Another connect or disconnect is still running."""


_run_lock = asyncio.Lock()


async def run_hook_action(hook: AgentHook, action: HookAction) -> tuple[bool, str, str]:
    """Run the agent's install or remove command.

    Returns whether it succeeded, the command as typed, and the last lines of
    its output. One command runs at a time: two installs at once would build the
    same hook tool twice.
    """
    argv = hook.install if action == "install" else hook.remove
    cwd = REPO_ROOT if action == "install" else HOOKS_DIR
    command = " ".join(argv)
    if _run_lock.locked():
        raise HookRunBusyError
    async with _run_lock:
        env = {key: value for key, value in os.environ.items() if key not in _PARENT_ONLY_ENV}
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            output, _ = await asyncio.wait_for(proc.communicate(), RUN_TIMEOUT_SECONDS)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            return False, command, f"Timed out after {RUN_TIMEOUT_SECONDS}s"
    lines = output.decode("utf-8", errors="replace").splitlines()
    return proc.returncode == 0, command, "\n".join(lines[-OUTPUT_TAIL_LINES:])
