"""Map Codex CLI hook payloads to the agent-office event contract.

Pure module: no I/O (the transport is ``codex_main.py``).

Codex CLI sends each hook event as JSON on stdin (https://learn.chatgpt.com/docs/hooks,
and payloads recorded from codex-cli 0.160.1 driven by a scripted model,
2026-10-21). Every event carries ``session_id``, ``transcript_path``, ``cwd``,
``hook_event_name`` and ``model``; turn events add ``turn_id``:

- ``SessionStart``: ``source`` · ``SessionEnd``: ``reason``
- ``UserPromptSubmit``: ``prompt``. A subagent's first prompt, its task, also
  carries its ``agent_id`` and ``agent_type``: that is when it arrives.
  (``SubagentStart`` comes just before it, without the task.)
- ``PreToolUse`` · ``PostToolUse``: ``tool_name``, ``tool_use_id``,
  ``tool_input``; Post adds ``tool_response``, the tool's output text. A
  subagent's tools carry its ``agent_id``; its call ids are scoped by that id,
  as a provider may number calls per thread. Shell commands come as ``Bash``
  with ``{"command": ...}``, and their response holds no exit code, so a
  failed command cannot be told apart. The subagent tools may come with
  their namespace glued on (``multi_agent_v1wait_agent``).
- ``apply_patch`` run through the shell gets a PreToolUse but no
  PostToolUse, so it is sent as an edit that starts and ends at once.
- ``PermissionRequest``: ``tool_name``, ``tool_input``
- ``PreCompact``: ``trigger`` (``manual`` · ``auto``)
- ``SubagentStop``: ``agent_id``, ``agent_type``, ``last_assistant_message``
- ``Stop``: ``last_assistant_message``

Tool names stay Codex's own; the backend maps every agent's tools. Codex's
transcript is not in Claude Code's format, so it is not forwarded; replies
come from ``last_assistant_message``. ``SubagentStart``, ``PostCompact`` and
``Interrupt`` are not mapped.
"""

import re
from pathlib import Path
from typing import Any, cast

from claude_office_hooks.debug_logger import get_iso_timestamp

CODING_AGENT = "codex"

# Codex hook event -> office event type, for every hook the installer registers.
HOOK_EVENT_TYPES: dict[str, str] = {
    "SessionStart": "session_start",
    "SessionEnd": "session_end",
    "UserPromptSubmit": "user_prompt_submit",
    "PreToolUse": "pre_tool_use",
    "PostToolUse": "post_tool_use",
    "PermissionRequest": "permission_request",
    "PreCompact": "context_compaction",
    "SubagentStop": "subagent_stop",
    "Stop": "stop",
}

# Namespaces Codex groups its own tools under.
TOOL_NAMESPACES = ("multi_agent_v1",)

# Codex's name for a subagent of no special kind; the office calls it general.
_AGENT_TYPES = {"default": "general-purpose"}

# The files a patch touches, in apply_patch's own format.
_PATCH_FILE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", re.MULTILINE)


def _tool_name(raw: Any) -> str:
    """Codex's tool name without its namespace."""
    name = str(raw or "")
    for namespace in TOOL_NAMESPACES:
        if name.startswith(namespace) and len(name) > len(namespace):
            return name[len(namespace) :].lstrip("._")
    return name


def _agent_type(raw: Any) -> str | None:
    """A subagent's type, with Codex's ``default`` as the office's general one."""
    if not isinstance(raw, str) or not raw:
        return None
    return _AGENT_TYPES.get(raw, raw)


def _patch_text(tool_input: Any) -> str:
    """The patch an apply_patch call carries, whatever its input looks like."""
    if isinstance(tool_input, str):
        return tool_input
    if isinstance(tool_input, dict):
        values = cast(dict[str, Any], tool_input).values()
        return "\n".join(v for v in values if isinstance(v, str))
    return ""


def _patch_target(patch: str) -> dict[str, Any] | None:
    """The first file a patch touches, as the edit's target."""
    match = _PATCH_FILE.search(patch)
    return {"file_path": match.group(1).strip()} if match else None


def _shell_patch(tool_input: Any) -> str | None:
    """The command of an apply_patch run through the shell, if this is one."""
    if not isinstance(tool_input, dict):
        return None
    command = cast(dict[str, Any], tool_input).get("command")
    if isinstance(command, str) and command.lstrip().startswith("apply_patch"):
        return command
    return None


def _reply(raw: Any) -> str | None:
    """A non-empty last assistant message."""
    return raw if isinstance(raw, str) and raw.strip() else None


def _payload(event_type: str, raw_data: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "session_id": raw_data.get("session_id") or "unknown_session",
        "timestamp": get_iso_timestamp(),
        "data": data,
    }


def _apply_tool(hook_event: str, raw_data: dict[str, Any], data: dict[str, Any]) -> bool:
    """Fill a tool event's fields. Returns whether it is a shell patch's start."""
    tool_input = raw_data.get("tool_input")
    tool_use_id = raw_data.get("tool_use_id")
    agent_id = raw_data.get("agent_id")
    data["tool_name"] = _tool_name(raw_data.get("tool_name"))
    data["tool_input"] = tool_input
    # Call ids are unique within one thread only; the backend drops a second
    # tool event with the same id, so a subagent's are scoped by its id.
    data["tool_use_id"] = f"{agent_id}:{tool_use_id}" if agent_id and tool_use_id else tool_use_id
    data["agent_id"] = agent_id or "main"
    shell_patch = _shell_patch(tool_input)
    if shell_patch is not None:
        data["tool_name"] = "apply_patch"
        data["tool_input"] = _patch_target(shell_patch) or {}
        return hook_event == "PreToolUse"
    if data["tool_name"] == "apply_patch":
        data["tool_input"] = _patch_target(_patch_text(tool_input)) or tool_input
    return False


def map_codex_event(hook_event: str, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the backend payloads for one Codex hook call (none to skip it).

    Args:
        hook_event: The Codex hook event name (``hook_event_name``).
        raw_data: The JSON Codex CLI wrote to the hook's stdin.
    """
    event_type = HOOK_EVENT_TYPES.get(hook_event)
    if event_type is None:
        return []

    working_dir = str(raw_data.get("cwd") or "")
    data: dict[str, Any] = {
        "coding_agent": CODING_AGENT,
        "project_name": Path(working_dir).name or "unknown",
        "working_dir": working_dir,
    }
    agent_id = raw_data.get("agent_id")

    match hook_event:
        case "SessionStart":
            data["source"] = raw_data.get("source")
        case "SessionEnd":
            data["reason"] = raw_data.get("reason")
        case "UserPromptSubmit":
            if agent_id:
                # A subagent's first prompt is its task: it arrives now.
                event_type = "subagent_start"
                data["agent_id"] = agent_id
                data["agent_type"] = _agent_type(raw_data.get("agent_type"))
                data["task_description"] = raw_data.get("prompt", "")
            else:
                data["prompt"] = raw_data.get("prompt", "")
        case "PreToolUse" | "PostToolUse":
            if _apply_tool(hook_event, raw_data, data):
                # Codex sends no PostToolUse for a patch run through the shell.
                return [
                    _payload("pre_tool_use", raw_data, data),
                    _payload("post_tool_use", raw_data, {**data, "success": True}),
                ]
        case "PermissionRequest":
            data["tool_name"] = _tool_name(raw_data.get("tool_name"))
            data["tool_input"] = raw_data.get("tool_input")
            data["agent_id"] = agent_id or "main"
        case "PreCompact":
            data["reason"] = raw_data.get("trigger")
        case "SubagentStop":
            if not agent_id:
                return []
            data["agent_id"] = agent_id
            data["agent_type"] = _agent_type(raw_data.get("agent_type"))
            reply = _reply(raw_data.get("last_assistant_message"))
            if reply:
                data["speech_content"] = {"agent": reply}
        case "Stop":
            reply = _reply(raw_data.get("last_assistant_message"))
            if reply:
                data["speech_content"] = {"boss": reply}
        case _:
            pass

    return [_payload(event_type, raw_data, data)]
