"""Codex CLI hook payloads become the office's events.

The payloads are trimmed from ones codex-cli 0.160.1 wrote to a hook while a
scripted model drove it (2026-10-21): read a file, run a failing test, hand a
search to a subagent, wait for it, patch the file.
"""

from typing import Any

import pytest

from claude_office_hooks.codex_event_mapper import HOOK_EVENT_TYPES, map_codex_event

BASE = {
    "session_id": "01a15c90-b93c-71d3-9aae-2b35e749b77d",
    "transcript_path": "/Users/me/.codex/sessions/2026/10/21/rollout-x.jsonl",
    "cwd": "/Users/me/work/shop",
    "model": "gpt-5.1-codex-mini",
    "permission_mode": "bypassPermissions",
}
TURN = {**BASE, "turn_id": "01a15c90-b980-7860-b101-29557920ffd8"}
SUBAGENT = "01a15c93-6a73-7e13-acd8-b377db3ba9c6"


def _one(hook_event: str, **fields: Any) -> dict[str, Any]:
    payloads = map_codex_event(hook_event, {**TURN, "hook_event_name": hook_event, **fields})
    assert len(payloads) == 1
    return payloads[0]


def test_every_event_tags_codex_and_the_project() -> None:
    payload = _one("SessionStart", source="startup")
    assert payload["event_type"] == "session_start"
    assert payload["session_id"] == BASE["session_id"]
    assert payload["data"]["coding_agent"] == "codex"
    assert payload["data"]["project_name"] == "shop"
    assert payload["data"]["working_dir"] == "/Users/me/work/shop"
    assert payload["data"]["source"] == "startup"
    # Codex's transcript is not Claude Code's, so it is not forwarded.
    assert "transcript_path" not in payload["data"]


def test_my_prompt_starts_a_turn() -> None:
    payload = _one("UserPromptSubmit", prompt="Why does the auth test fail?")
    assert payload["event_type"] == "user_prompt_submit"
    assert payload["data"]["prompt"] == "Why does the auth test fail?"


def test_a_subagents_first_prompt_brings_it_in_with_its_task() -> None:
    payload = _one(
        "UserPromptSubmit",
        agent_id=SUBAGENT,
        agent_type="default",
        prompt="Find where SESSION_TIMEOUT is used",
    )
    assert payload["event_type"] == "subagent_start"
    assert payload["data"]["agent_id"] == SUBAGENT
    assert payload["data"]["agent_type"] == "general-purpose"
    assert payload["data"]["task_description"] == "Find where SESSION_TIMEOUT is used"


def test_shell_commands_are_bash_tools_of_the_boss() -> None:
    start = _one(
        "PreToolUse",
        tool_name="Bash",
        tool_input={"command": "sed -n '1,20p' src/auth.py"},
        tool_use_id="call_0",
    )
    assert start["event_type"] == "pre_tool_use"
    assert start["data"]["tool_name"] == "Bash"
    assert start["data"]["tool_input"] == {"command": "sed -n '1,20p' src/auth.py"}
    assert start["data"]["tool_use_id"] == "call_0"
    assert start["data"]["agent_id"] == "main"


def test_a_tools_end_does_not_claim_success_or_failure() -> None:
    end = _one(
        "PostToolUse",
        tool_name="Bash",
        tool_input={"command": "python3 tests/test_auth.py"},
        tool_use_id="call_1",
        tool_response="Traceback (most recent call last):\nAssertionError\n",
    )
    assert end["event_type"] == "post_tool_use"
    # Codex gives no exit code, so a failed command cannot be told apart.
    assert "success" not in end["data"]
    assert "error_type" not in end["data"]


def test_a_subagents_tools_are_its_own() -> None:
    payload = _one(
        "PreToolUse",
        agent_id=SUBAGENT,
        agent_type="default",
        tool_name="Bash",
        tool_input={"command": "grep -n SESSION_TIMEOUT src/auth.py"},
        tool_use_id="call_0",
    )
    assert payload["data"]["agent_id"] == SUBAGENT
    # The lead's first call is call_0 too; the subagent's must not collide with it.
    assert payload["data"]["tool_use_id"] == f"{SUBAGENT}:call_0"


@pytest.mark.parametrize(
    ("raw", "name"),
    [
        ("spawn_agent", "spawn_agent"),
        ("multi_agent_v1wait_agent", "wait_agent"),
        ("multi_agent_v1.close_agent", "close_agent"),
        ("update_plan", "update_plan"),
        ("mcp__github__get_issue", "mcp__github__get_issue"),
    ],
)
def test_tool_names_lose_their_namespace(raw: str, name: str) -> None:
    assert (
        _one("PreToolUse", tool_name=raw, tool_input={}, tool_use_id="c")["data"]["tool_name"]
        == name
    )


PATCH = (
    "*** Begin Patch\n*** Update File: src/auth.py\n@@\n"
    "-    return age_seconds > SESSION_TIMEOUT\n+    return age_seconds >= SESSION_TIMEOUT\n"
    "*** End Patch\n"
)


def test_a_patch_through_the_shell_is_an_edit_that_ends_at_once() -> None:
    payloads = map_codex_event(
        "PreToolUse",
        {
            **TURN,
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": f"apply_patch <<'PATCH'\n{PATCH}PATCH"},
            "tool_use_id": "call_4",
        },
    )
    assert [p["event_type"] for p in payloads] == ["pre_tool_use", "post_tool_use"]
    for payload in payloads:
        assert payload["data"]["tool_name"] == "apply_patch"
        assert payload["data"]["tool_input"] == {"file_path": "src/auth.py"}
        assert payload["data"]["tool_use_id"] == "call_4"
    assert payloads[1]["data"]["success"] is True


@pytest.mark.parametrize("tool_input", [PATCH, {"input": PATCH}, {"patch": PATCH}])
def test_the_patch_tool_edits_the_first_file_it_touches(tool_input: Any) -> None:
    payload = _one("PreToolUse", tool_name="apply_patch", tool_input=tool_input, tool_use_id="c")
    assert payload["data"]["tool_name"] == "apply_patch"
    assert payload["data"]["tool_input"] == {"file_path": "src/auth.py"}


def test_a_permission_wait_names_the_tool() -> None:
    payload = _one(
        "PermissionRequest",
        tool_name="Bash",
        tool_input={"command": "git push", "description": "Push the branch"},
    )
    assert payload["event_type"] == "permission_request"
    assert payload["data"]["tool_name"] == "Bash"
    assert payload["data"]["tool_input"]["command"] == "git push"
    assert payload["data"]["agent_id"] == "main"


@pytest.mark.parametrize("trigger", ["manual", "auto"])
def test_compaction(trigger: str) -> None:
    payload = _one("PreCompact", trigger=trigger)
    assert payload["event_type"] == "context_compaction"
    assert payload["data"]["reason"] == trigger


def test_a_finished_subagent_reports_its_last_reply() -> None:
    payload = _one(
        "SubagentStop",
        agent_id=SUBAGENT,
        agent_type="default",
        stop_hook_active=False,
        agent_transcript_path=None,
        last_assistant_message="SESSION_TIMEOUT is set to 30 in src/auth.py line 1.",
    )
    assert payload["event_type"] == "subagent_stop"
    assert payload["data"]["agent_id"] == SUBAGENT
    assert payload["data"]["speech_content"] == {
        "agent": "SESSION_TIMEOUT is set to 30 in src/auth.py line 1."
    }


def test_a_subagent_stop_without_an_agent_is_skipped() -> None:
    assert map_codex_event("SubagentStop", {**TURN, "last_assistant_message": "x"}) == []


def test_the_turns_reply_rides_with_stop() -> None:
    payload = _one("Stop", stop_hook_active=False, last_assistant_message="Fixed: use >=.")
    assert payload["event_type"] == "stop"
    assert payload["data"]["speech_content"] == {"boss": "Fixed: use >=."}
    assert "speech_content" not in _one("Stop", last_assistant_message=None)["data"]


def test_session_end() -> None:
    payload = _one("SessionEnd", reason="other")
    assert payload["event_type"] == "session_end"
    assert payload["data"]["reason"] == "other"


@pytest.mark.parametrize("hook_event", ["SubagentStart", "PostCompact", "Interrupt", "Nope"])
def test_unmapped_events_are_skipped(hook_event: str) -> None:
    assert map_codex_event(hook_event, {**TURN, "agent_id": SUBAGENT}) == []
    assert hook_event not in HOOK_EVENT_TYPES


def test_a_payload_without_a_session_still_has_one() -> None:
    payload = map_codex_event("SessionEnd", {"hook_event_name": "SessionEnd"})[0]
    assert payload["session_id"] == "unknown_session"
    assert payload["data"]["project_name"] == "unknown"
