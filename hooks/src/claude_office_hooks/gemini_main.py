#!/usr/bin/env python3
"""
Agent Office hook for Gemini CLI lifecycle events.

Gemini CLI runs this command for each registered hook with the event JSON on
stdin. On exit 0 it parses stdout as JSON, and text that is not JSON turns into
a message shown to the user. So this hook:
- writes exactly ``{}`` (no decision) to stdout and nothing else
- never writes to stderr
- always exits 0, so it can never block a tool or warn

Errors are logged to the debug file.
"""

import io
import sys

# Suppress ALL output immediately - before any imports that might fail
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()

from claude_office_hooks.debug_logger import log_error  # noqa: E402

# The hook's only stdout: an empty decision.
NO_DECISION = "{}"


def _reply() -> None:
    """Write the empty decision to the real stdout."""
    real_stdout = sys.__stdout__
    if real_stdout is not None:
        real_stdout.write(NO_DECISION)
        real_stdout.flush()


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
        real_stdout.write(f"gemini-office-hook {version('claude-office-hooks')}\n")
        real_stdout.flush()


def main() -> None:
    """Read the hook event, map it, POST it, and answer Gemini with ``{}``."""
    if "--version" in sys.argv or "-V" in sys.argv:
        _print_version()
        return
    try:
        import os

        from claude_office_hooks.config import load_config
        from claude_office_hooks.debug_logger import debug_log
        from claude_office_hooks.gemini_event_mapper import map_gemini_event
        from claude_office_hooks.main import send_event

        debug = load_config().get("CLAUDE_OFFICE_DEBUG", "0") == "1"
        raw_data = _read_stdin()
        # Gemini names the event on stdin; an argument overrides it, like the
        # Claude Code hook's ``claude-office-hook <event>``.
        hook_event = sys.argv[1] if len(sys.argv) > 1 else str(raw_data.get("hook_event_name", ""))
        payload = map_gemini_event(
            hook_event, dict(raw_data), os.environ.get("GEMINI_SESSION_ID", "")
        )
        debug_log(hook_event, dict(raw_data), payload or {"skipped": True}, enabled=debug)
        if payload is not None:
            send_event(payload)
    except Exception as exc:
        log_error(exc, "gemini-office-hook failed")
    finally:
        _reply()


if __name__ == "__main__":
    main()
    sys.exit(0)
