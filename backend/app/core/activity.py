"""Tool → office activity mapping and per-character in-flight tracking.

A character reading files walks to the archive; a character running a shell
command stands in the server room (docs/plan/spec.md R1, R2). The isometric
office adds editing, browsing (web and MCP tools), planning and asking (spec
「방 ↔ 도구」). The mapping is agent-agnostic: tool names from Claude Code,
OpenCode, Gemini CLI and Codex CLI are matched case-insensitively against one
table.

Characters are keyed by the same id the state machine uses for bubbles:
``"main"`` for the boss, the agent id for a subagent.
"""

import re
import shlex
from collections.abc import Mapping
from pathlib import PurePath
from typing import Any, Literal, NamedTuple, cast

from app.models.agents import Activity

__all__ = [
    "ASKING_TOOLS",
    "BROWSING_TOOLS",
    "EDITING_TOOLS",
    "PLANNING_TOOLS",
    "READING_TOOLS",
    "RUNNING_TOOLS",
    "SUBAGENT_TOOLS",
    "TODO_TOOLS",
    "ToolActivityTracker",
    "ToolSubject",
    "activity_for_call",
    "activity_for_tool",
    "tool_subject",
]

# Lowercase tool names per agent (see docs/plan/spec.md "에이전트 범위").
READING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code
        "read",
        "grep",
        "glob",
        "ls",
        "notebookread",
        # OpenCode (read/grep/glob shared above)
        "list",
        # Gemini CLI
        "read_file",
        "read_many_files",
        "grep_search",
        "search_file_content",
        "list_directory",
        # Codex CLI (it reads files with the shell; see READ_ONLY_PROGRAMS)
        "view_image",
    }
)

EDITING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code (OpenCode shares edit/write)
        "edit",
        "write",
        "multiedit",
        "notebookedit",
        # OpenCode
        "patch",
        # Gemini CLI
        "replace",
        "write_file",
        # Codex CLI
        "apply_patch",
    }
)

RUNNING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code
        "bash",
        "powershell",
        "bashoutput",
        "killshell",
        "killbash",
        # Gemini CLI
        "run_shell_command",
        # Codex CLI
        "shell",
        "local_shell",
        "exec_command",
    }
)

# Web tools; MCP tools (``mcp__<server>__<tool>``) browse too.
BROWSING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code (OpenCode shares webfetch/websearch)
        "webfetch",
        "websearch",
        # Gemini CLI
        "web_fetch",
        "google_web_search",
    }
)
MCP_TOOL_PREFIX = "mcp__"

PLANNING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code (OpenCode shares todowrite)
        "todowrite",
        "enterplanmode",
        "exitplanmode",
        "skill",
        # Gemini CLI
        "write_todos",
        # Codex CLI
        "update_plan",
    }
)

ASKING_TOOLS: frozenset[str] = frozenset(
    {
        # Claude Code
        "askuserquestion",
        # Codex CLI
        "request_user_input",
        # Gemini CLI
        "ask_user",
    }
)


# Tools that hand work to a subagent (Claude Code, OpenCode; Codex CLI's spawn_agent).
SUBAGENT_TOOLS: frozenset[str] = frozenset({"task", "agent", "spawn_agent"})

# Tools that rewrite the todo list from a `todos` input (Claude Code and
# OpenCode `TodoWrite`/`todowrite`, Gemini CLI `write_todos`).
TODO_TOOLS: frozenset[str] = frozenset({"todowrite", "write_todos"})

# Tool input keys that name what a call works on, most specific first:
# Claude Code (file_path, notebook_path, pattern, path, url, query), OpenCode
# (filePath), Gemini CLI (absolute_path, dir_path, read_many_files' include
# list) and Codex CLI (command as an argv list).
_COMMAND_KEYS = ("command", "cmd")
_PATH_KEYS = (
    "file_path",
    "filePath",
    "absolute_path",
    "notebook_path",
    "pattern",
    "path",
    "dir_path",
    "include",
)
_TEXT_KEYS = ("url", "query")


class ToolSubject(NamedTuple):
    """What a tool call works on: a path or pattern, a shell command, or other text."""

    kind: Literal["path", "command", "text"]
    value: str


def _input_text(tool_input: Mapping[str, Any], keys: tuple[str, ...]) -> str | None:
    """First non-empty string under *keys*; an argv list is joined with spaces."""
    for key in keys:
        value: object = tool_input.get(key)
        if isinstance(value, list):
            value = " ".join(part for part in cast(list[object], value) if isinstance(part, str))
        if isinstance(value, str) and value.strip():
            return value
    return None


def tool_subject(tool_name: str | None, tool_input: Mapping[str, Any] | None) -> ToolSubject | None:
    """What a tool call works on, read from the input keys every agent uses."""
    if not tool_input:
        return None
    if activity_for_tool(tool_name) is Activity.RUNNING:
        command = _input_text(tool_input, _COMMAND_KEYS)
        return ToolSubject("command", command) if command else None
    path = _input_text(tool_input, _PATH_KEYS)
    if path:
        return ToolSubject("path", path)
    text = _input_text(tool_input, _TEXT_KEYS)
    if text:
        return ToolSubject("text", text)
    command = _input_text(tool_input, _COMMAND_KEYS)
    return ToolSubject("command", command) if command else None


# Programs that only read or list files. A shell command made of these alone
# (pipes and && chains included, no redirection or substitution) counts as
# reading: Codex CLI reads files with the shell (sed -n, cat, rg) rather than
# a read tool. sed counts only with -n and without -i; find not with actions.
READ_ONLY_PROGRAMS: frozenset[str] = frozenset(
    {
        "cat",
        "cd",
        "echo",
        "egrep",
        "fgrep",
        "file",
        "find",
        "grep",
        "head",
        "less",
        "ls",
        "more",
        "nl",
        "printf",
        "pwd",
        "rg",
        "sed",
        "stat",
        "tail",
        "tree",
        "wc",
    }
)
_SHELLS = frozenset({"bash", "sh", "zsh"})
_FIND_ACTIONS = frozenset({"-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint"})
_COMMAND_SEPARATORS = re.compile(r"\|\||&&|[|;\n]")


def _is_read_only_command(command: str) -> bool:
    """Whether a shell command only reads or lists files."""
    if not command.strip() or any(mark in command for mark in (">", "`", "$(")):
        return False
    for segment in _COMMAND_SEPARATORS.split(command):
        try:
            words = shlex.split(segment)
        except ValueError:
            return False
        if not words:
            continue
        program = PurePath(words[0]).name
        if program in _SHELLS and len(words) >= 3 and words[1] in ("-c", "-lc"):
            if not _is_read_only_command(" ".join(words[2:])):
                return False
        elif (
            program not in READ_ONLY_PROGRAMS
            or program == "sed"
            and ("-n" not in words or any(w.startswith("-i") for w in words))
            or program == "find"
            and _FIND_ACTIONS.intersection(words)
        ):
            return False
    return True


def activity_for_call(
    tool_name: str | None, tool_input: Mapping[str, Any] | None
) -> Activity | None:
    """The office activity of one tool call: a command tool that only reads is reading."""
    activity = activity_for_tool(tool_name)
    if activity is Activity.RUNNING:
        subject = tool_subject(tool_name, tool_input)
        if subject is not None and _is_read_only_command(subject.value):
            return Activity.READING
    return activity


def activity_for_tool(tool_name: str | None) -> Activity | None:
    """Map a tool name to the office activity it drives, if any."""
    if not tool_name:
        return None
    name = tool_name.lower()
    if name in READING_TOOLS:
        return Activity.READING
    if name in RUNNING_TOOLS:
        return Activity.RUNNING
    if name in EDITING_TOOLS:
        return Activity.EDITING
    if name in BROWSING_TOOLS or name.startswith(MCP_TOOL_PREFIX):
        return Activity.BROWSING
    if name in PLANNING_TOOLS:
        return Activity.PLANNING
    if name in ASKING_TOOLS:
        return Activity.ASKING
    return None


class ToolActivityTracker:
    """Mapped tools currently running, per character.

    Tools can overlap (parallel ``Read`` calls, a background ``Bash``), so a
    character's activity is the one of its most recently started tool that
    has not finished yet.
    """

    def __init__(self) -> None:
        # character id -> {tool key -> (lowercase tool name, activity)},
        # insertion-ordered so the last entry is the most recent start.
        self._in_flight: dict[str, dict[str, tuple[str, Activity]]] = {}
        self._next_key = 0

    def start(
        self,
        character_id: str,
        tool_name: str | None,
        tool_use_id: str | None,
        tool_input: Mapping[str, Any] | None = None,
    ) -> None:
        """Record a tool start; tools that map to no activity are ignored."""
        activity = activity_for_call(tool_name, tool_input)
        if activity is None or tool_name is None:
            return
        key = tool_use_id or self._synthetic_key()
        self._in_flight.setdefault(character_id, {})[key] = (tool_name.lower(), activity)

    def finish(self, character_id: str, tool_name: str | None, tool_use_id: str | None) -> None:
        """Record a tool end (success or failure).

        Matches by ``tool_use_id`` first; producers that omit it fall back to
        the oldest in-flight tool with the same name.
        """
        tools = self._in_flight.get(character_id)
        if not tools:
            return
        if tool_use_id and tool_use_id in tools:
            del tools[tool_use_id]
        else:
            name = (tool_name or "").lower()
            for key, (in_flight_name, _) in tools.items():
                if in_flight_name == name:
                    del tools[key]
                    break
        if not tools:
            del self._in_flight[character_id]

    def clear(self, character_id: str) -> None:
        """Forget every in-flight tool of one character (turn or agent ended)."""
        self._in_flight.pop(character_id, None)

    def clear_all(self) -> None:
        """Forget every in-flight tool (session ended)."""
        self._in_flight.clear()

    def current(self, character_id: str) -> Activity | None:
        """The activity of the character's most recently started tool."""
        tools = self._in_flight.get(character_id)
        if not tools:
            return None
        return next(reversed(tools.values()))[1]

    def _synthetic_key(self) -> str:
        self._next_key += 1
        return f"untracked-{self._next_key}"
