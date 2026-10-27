"""Gemini CLI producer -> backend event contract test.

Every payload ``hooks/src/claude_office_hooks/gemini_event_mapper.py`` can
emit must validate against the backend's ``AnyEvent`` union, and the cases
below must cover every event type the mapper emits. Mapping behaviour is
tested in ``hooks/tests/test_gemini_event_mapper.py``; this file only guards
the contract between the two packages.
"""

# Pyright can't resolve ``claude_office_hooks`` (loaded via runtime
# ``sys.path.insert`` below — the hooks package lives outside ``backend/``).
# pyright: reportMissingImports=false, reportUnknownVariableType=false
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest

_HOOKS_SRC = Path(__file__).resolve().parents[2] / "hooks" / "src"
if str(_HOOKS_SRC) not in sys.path:
    sys.path.insert(0, str(_HOOKS_SRC))

from claude_office_hooks.gemini_event_mapper import (  # noqa: E402
    map_gemini_event as _untyped_map_gemini_event,
)

from app.models.events import EventAdapter  # noqa: E402

map_gemini_event: Callable[..., dict[str, Any] | None] = cast(
    Callable[..., dict[str, Any] | None], _untyped_map_gemini_event
)

_BASE: dict[str, Any] = {
    "session_id": "3f8b0a52-6c1e-4a9e-9a43-1f0f6c2b7d10",
    "transcript_path": "/tmp/session.json",
    "cwd": "/Users/me/work/shop",
    "timestamp": "2026-10-20T08:00:00.000Z",
}

# (hook event, extra stdin fields, case id)
_CASES: list[tuple[str, dict[str, Any], str]] = [
    ("SessionStart", {"source": "startup"}, "session-start"),
    ("SessionEnd", {"reason": "exit"}, "session-end"),
    ("BeforeAgent", {"prompt": "Fix the auth test"}, "prompt"),
    ("AfterAgent", {"prompt": "x", "prompt_response": "Fixed."}, "reply"),
    ("BeforeTool", {"tool_name": "read_file", "tool_input": {"file_path": "a.py"}}, "tool-start"),
    (
        "AfterTool",
        {
            "tool_name": "run_shell_command",
            "tool_input": {"command": "pytest"},
            "tool_response": {"llmContent": "", "returnDisplay": "", "error": "exit 1"},
        },
        "tool-failed",
    ),
    ("PreCompress", {"trigger": "manual"}, "compaction"),
    (
        "Notification",
        {
            "notification_type": "ToolPermission",
            "message": "Tool Shell requires execution",
            "details": {"type": "exec", "title": "Shell", "command": "rm -rf build"},
        },
        "permission",
    ),
    ("Notification", {"notification_type": "Other", "message": "hi"}, "notification"),
]

_EXPECTED_OUTPUT_TYPES = {
    "session_start",
    "session_end",
    "user_prompt_submit",
    "stop",
    "pre_tool_use",
    "post_tool_use",
    "context_compaction",
    "permission_request",
    "notification",
}


@pytest.mark.parametrize(
    ("hook_event", "fields"), [(c[0], c[1]) for c in _CASES], ids=[c[2] for c in _CASES]
)
def test_gemini_output_validates_against_union(hook_event: str, fields: dict[str, Any]) -> None:
    payload = map_gemini_event(hook_event, {**_BASE, "hook_event_name": hook_event, **fields})
    assert payload is not None
    EventAdapter.validate_python(payload)


def test_gemini_output_surface_is_covered() -> None:
    observed: set[str] = set()
    for hook_event, fields, _case_id in _CASES:
        payload = map_gemini_event(hook_event, {**_BASE, **fields})
        assert payload is not None
        observed.add(payload["event_type"])
    assert observed == _EXPECTED_OUTPUT_TYPES
