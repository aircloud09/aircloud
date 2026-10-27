"""Map Gemini CLI hook payloads to the agent-office event contract.

Pure module: no I/O (the transport is ``gemini_main.py``).

Gemini CLI sends each hook event as JSON on stdin (its ``docs/hooks/reference.md``
and the 0.64.0 bundle, checked 2026-10-20). Every event carries
``session_id``, ``transcript_path``, ``cwd``, ``hook_event_name`` and
``timestamp``; the rest depends on the event:

- ``SessionStart``: ``source`` · ``SessionEnd``: ``reason``
- ``BeforeAgent``: ``prompt`` · ``AfterAgent``: ``prompt``, ``prompt_response``
- ``BeforeTool``: ``tool_name``, ``tool_input`` · ``AfterTool`` adds
  ``tool_response`` (``llmContent``, ``returnDisplay``, optional ``error``).
  A shell command that exits non-zero is not an ``error``: its exit code is a
  line of ``llmContent`` (``Exit Code: 1``), so that line marks it failed too.
- ``PreCompress``: ``trigger`` (``auto`` · ``manual``). Gemini fires it with
  ``auto`` before every turn's compression check, whether or not it then
  compresses, so only ``manual`` (``/compress``) becomes a compaction.
- ``Notification``: ``notification_type`` (``ToolPermission``), ``message`` and
  ``details`` (``type`` ``exec`` with ``command``, ``edit`` with ``filePath``,
  ``mcp`` with ``toolName``, ``info``; always ``title``)

Tool names stay Gemini's own (``read_file``, ``run_shell_command``, ...); the
backend maps every agent's tools. Tool events carry no call id, so none is
sent and the backend pairs a tool's end with its start by name. Gemini's
transcript is not in Claude Code's format, so it is not forwarded; the reply
comes from ``AfterAgent.prompt_response`` instead.
"""

import os
import re
from pathlib import Path
from typing import Any, cast

from claude_office_hooks.debug_logger import get_iso_timestamp

CODING_AGENT = "gemini-cli"

# Gemini hook event -> office event type, for every hook the installer registers.
HOOK_EVENT_TYPES: dict[str, str] = {
    "SessionStart": "session_start",
    "SessionEnd": "session_end",
    "BeforeAgent": "user_prompt_submit",
    "AfterAgent": "stop",
    "BeforeTool": "pre_tool_use",
    "AfterTool": "post_tool_use",
    "PreCompress": "context_compaction",
    "Notification": "notification",
}

# Longest error line forwarded for a failed tool (same as the Claude Code mapper).
MAX_ERROR_SUMMARY = 120

# The exit code line run_shell_command writes into its llmContent.
_EXIT_CODE_LINE = re.compile(r"^Exit Code: (\d+)$", re.MULTILINE)


def _error_line(error: Any) -> str | None:
    """First line of a tool error, which Gemini sends as text or as ``{message}``."""
    if isinstance(error, dict):
        error = cast(dict[str, Any], error).get("message")
    if isinstance(error, str) and error.strip():
        return error.strip().splitlines()[0][:MAX_ERROR_SUMMARY]
    return None


def _apply_tool_response(tool_response: Any, data: dict[str, Any]) -> None:
    """Mark the tool failed on ``tool_response.error`` or a non-zero exit code."""
    response = cast(dict[str, Any], tool_response) if isinstance(tool_response, dict) else {}
    summary: str | None = None
    if response.get("error"):
        summary = _error_line(response["error"])
    else:
        content = response.get("llmContent")
        exit_code = _EXIT_CODE_LINE.search(content) if isinstance(content, str) else None
        if exit_code is None or exit_code.group(1) == "0":
            data["success"] = True
            return
        summary = f"Exit code {exit_code.group(1)}"
    data["success"] = False
    data["error_type"] = "tool_error"
    if summary:
        data["result_summary"] = summary


def _apply_permission(details: Any, data: dict[str, Any]) -> None:
    """Name the tool and its target that wait for the user's approval."""
    if not isinstance(details, dict):
        return
    details = cast(dict[str, Any], details)
    data["tool_name"] = details.get("toolName") or details.get("title")
    if details.get("type") == "exec" and details.get("command"):
        data["tool_input"] = {"command": details["command"]}
    elif details.get("type") == "edit" and details.get("filePath"):
        data["tool_input"] = {"file_path": details["filePath"]}


def map_gemini_event(
    hook_event: str,
    raw_data: dict[str, Any],
    session_id_fallback: str = "",
) -> dict[str, Any] | None:
    """Return the backend payload for one Gemini hook call, or None to skip it.

    Args:
        hook_event: The Gemini hook event name (``hook_event_name``).
        raw_data: The JSON Gemini CLI wrote to the hook's stdin.
        session_id_fallback: Used when stdin has no ``session_id``
            (``GEMINI_SESSION_ID``).
    """
    event_type = HOOK_EVENT_TYPES.get(hook_event)
    if event_type is None:
        return None

    project_dir = os.environ.get("GEMINI_PROJECT_DIR", "")
    working_dir = raw_data.get("cwd") or os.environ.get("GEMINI_CWD", "")
    data: dict[str, Any] = {
        "coding_agent": CODING_AGENT,
        "project_name": Path(project_dir or working_dir).name or "unknown",
        "project_dir": project_dir,
        "working_dir": working_dir,
    }

    match hook_event:
        case "SessionStart":
            data["source"] = raw_data.get("source")
        case "SessionEnd":
            data["reason"] = raw_data.get("reason")
        case "BeforeAgent":
            data["prompt"] = raw_data.get("prompt", "")
        case "AfterAgent":
            reply = raw_data.get("prompt_response")
            if isinstance(reply, str) and reply.strip():
                data["speech_content"] = {"boss": reply}
        case "BeforeTool" | "AfterTool":
            data["tool_name"] = raw_data.get("tool_name")
            data["tool_input"] = raw_data.get("tool_input")
            data["agent_id"] = "main"
            if hook_event == "AfterTool":
                _apply_tool_response(raw_data.get("tool_response"), data)
        case "PreCompress":
            if raw_data.get("trigger") != "manual":
                return None
            data["reason"] = "manual"
        case "Notification":
            data["notification_type"] = raw_data.get("notification_type")
            data["message"] = raw_data.get("message")
            if raw_data.get("notification_type") == "ToolPermission":
                event_type = "permission_request"
                data["agent_id"] = "main"
                _apply_permission(raw_data.get("details"), data)
        case _:
            pass

    session_id = raw_data.get("session_id") or session_id_fallback or "unknown_session"
    return {
        "event_type": event_type,
        "session_id": session_id,
        "timestamp": get_iso_timestamp(),
        "data": data,
    }
