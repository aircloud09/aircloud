#!/usr/bin/env python3
"""
Agent Office hook for Codex CLI lifecycle events.

Codex CLI runs this command for each registered hook with the event JSON on
stdin. Plain text on stdout becomes extra developer context for
SessionStart, UserPromptSubmit and SubagentStart and is invalid for Stop and
SubagentStop, while exit 0 with no output lets Codex continue
(https://learn.chatgpt.com/docs/hooks). So this hook:
- writes nothing to stdout or stderr
- always exits 0, so it can never block a tool or a turn

Errors are logged to the debug file.
"""

import io
import sys

# Suppress ALL output immediately - before any imports that might fail
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()

from claude_office_hooks.debug_logger import log_error  # noqa: E402


def _read_stdin() -> dict[str, object]:
    """The hook event JSON from the real stdin, or an empty dict."""
    import json
    from typing import cast

    real_stdin = sys.__stdin__
    if real_stdin is None or real_stdin.closed or real_stdin.isatty():
        return {}
    raw_input = real_stdin.read()
    if not raw_input.strip():
        return {}
    return cast(dict[str, object], json.loads(raw_input))


def _print_version() -> None:
    """Write the package version to the real stdout."""
    from importlib.metadata import version

    real_stdout = sys.__stdout__
    if real_stdout is not None:
        real_stdout.write(f"codex-office-hook {version('claude-office-hooks')}\n")
        real_stdout.flush()


def main() -> None:
    """Read the hook event, map it and POST what it becomes, silently."""
    if "--version" in sys.argv or "-V" in sys.argv:
        _print_version()
        return
    try:
        from claude_office_hooks.codex_event_mapper import map_codex_event
        from claude_office_hooks.config import load_config
        from claude_office_hooks.debug_logger import debug_log
        from claude_office_hooks.main import send_event

        debug = load_config().get("CLAUDE_OFFICE_DEBUG", "0") == "1"
        raw_data = _read_stdin()
        # Codex names the event on stdin; an argument overrides it, like the
        # Claude Code hook's ``claude-office-hook <event>``.
        hook_event = sys.argv[1] if len(sys.argv) > 1 else str(raw_data.get("hook_event_name", ""))
        payloads = map_codex_event(hook_event, dict(raw_data))
        debug_log(
            hook_event,
            dict(raw_data),
            {"events": payloads} if payloads else {"skipped": True},
            enabled=debug,
        )
        for payload in payloads:
            send_event(payload)
    except Exception as exc:
        log_error(exc, "codex-office-hook failed")


if __name__ == "__main__":
    main()
    sys.exit(0)
