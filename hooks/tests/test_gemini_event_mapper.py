"""Gemini CLI hook payloads map onto the office events.

Payload shapes follow Gemini CLI's hooks reference and its 0.64.0 bundle
(see the gemini_event_mapper module docstring).
"""

from typing import Any

import pytest

from claude_office_hooks.gemini_event_mapper import map_gemini_event

SESSION_ID = "3f8b0a52-6c1e-4a9e-9a43-1f0f6c2b7d10"
BASE: dict[str, Any] = {
    "session_id": SESSION_ID,
    "transcript_path": "/Users/me/.gemini/tmp/abc/chats/session.json",
    "cwd": "/Users/me/work/shop",
    "timestamp": "2026-10-20T08:00:00.000Z",
}


def _map(hook_event: str, **fields: Any) -> dict[str, Any]:
    payload = map_gemini_event(hook_event, {**BASE, "hook_event_name": hook_event, **fields})
    assert payload is not None
    return payload


@pytest.fixture(autouse=True)
def _no_gemini_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GEMINI_PROJECT_DIR", "GEMINI_CWD", "GEMINI_SESSION_ID"):
        monkeypatch.delenv(name, raising=False)


class TestLifecycle:
    def test_session_start(self) -> None:
        payload = _map("SessionStart", source="startup")
        assert payload["event_type"] == "session_start"
        assert payload["session_id"] == SESSION_ID
        assert payload["data"]["source"] == "startup"

    def test_session_end(self) -> None:
        payload = _map("SessionEnd", reason="exit")
        assert (payload["event_type"], payload["data"]["reason"]) == ("session_end", "exit")

    def test_prompt(self) -> None:
        payload = _map("BeforeAgent", prompt="Fix the failing auth test")
        assert payload["event_type"] == "user_prompt_submit"
        assert payload["data"]["prompt"] == "Fix the failing auth test"

    def test_reply_becomes_the_boss_speech(self) -> None:
        payload = _map("AfterAgent", prompt="Fix it", prompt_response="Fixed the boundary.")
        assert payload["event_type"] == "stop"
        assert payload["data"]["speech_content"] == {"boss": "Fixed the boundary."}

    def test_empty_reply_sends_no_speech(self) -> None:
        payload = _map("AfterAgent", prompt="Fix it", prompt_response="   ")
        assert "speech_content" not in payload["data"]

    def test_manual_compression_is_a_compaction(self) -> None:
        payload = _map("PreCompress", trigger="manual")
        assert (payload["event_type"], payload["data"]["reason"]) == (
            "context_compaction",
            "manual",
        )

    def test_automatic_compression_check_is_skipped(self) -> None:
        # Gemini fires it before every turn's check, not only when it compresses.
        assert map_gemini_event("PreCompress", {**BASE, "trigger": "auto"}) is None


class TestTools:
    def test_before_tool_keeps_gemini_names(self) -> None:
        payload = _map("BeforeTool", tool_name="read_file", tool_input={"file_path": "src/auth.py"})
        assert payload["event_type"] == "pre_tool_use"
        assert payload["data"]["tool_name"] == "read_file"
        assert payload["data"]["tool_input"] == {"file_path": "src/auth.py"}
        assert payload["data"]["agent_id"] == "main"
        assert "tool_use_id" not in payload["data"]

    def test_after_tool_success(self) -> None:
        payload = _map(
            "AfterTool",
            tool_name="run_shell_command",
            tool_input={"command": "pytest -q"},
            tool_response={"llmContent": "1 passed", "returnDisplay": "1 passed"},
        )
        assert payload["event_type"] == "post_tool_use"
        assert payload["data"]["success"] is True
        assert "error_type" not in payload["data"]

    @pytest.mark.parametrize(
        "error",
        [
            "Command exited with code 1\nTraceback ...",
            {"message": "Command exited with code 1\nTraceback ...", "type": "shell"},
        ],
    )
    def test_after_tool_error_is_a_failed_tool(self, error: Any) -> None:
        payload = _map(
            "AfterTool",
            tool_name="run_shell_command",
            tool_input={"command": "pytest -q"},
            tool_response={"llmContent": "", "returnDisplay": "", "error": error},
        )
        assert payload["data"]["success"] is False
        assert payload["data"]["error_type"] == "tool_error"
        assert payload["data"]["result_summary"] == "Command exited with code 1"

    def test_non_zero_exit_code_is_a_failed_tool(self) -> None:
        # Captured from Gemini CLI 0.64.0: a failing command has no "error".
        content = (
            "<untrusted_context>\nOutput: Traceback (most recent call last):\n"
            "AssertionError: a 30 second old session should be expired\n"
            "Exit Code: 1\nProcess Group PGID: 4766\n</untrusted_context>"
        )
        payload = _map(
            "AfterTool",
            tool_name="run_shell_command",
            tool_input={"command": "python3 tests/test_auth.py"},
            tool_response={"llmContent": content, "returnDisplay": "Traceback ..."},
        )
        assert payload["data"]["success"] is False
        assert payload["data"]["result_summary"] == "Exit code 1"

    def test_zero_exit_code_is_a_success(self) -> None:
        payload = _map(
            "AfterTool",
            tool_name="run_shell_command",
            tool_input={"command": "true"},
            tool_response={"llmContent": "Output: (empty)\nExit Code: 0\n", "returnDisplay": ""},
        )
        assert payload["data"]["success"] is True


class TestNotification:
    def test_exec_permission_names_the_command(self) -> None:
        payload = _map(
            "Notification",
            notification_type="ToolPermission",
            message="Tool Shell requires execution",
            details={
                "type": "exec",
                "title": "Shell",
                "command": "rm -rf build",
                "rootCommand": "rm",
            },
        )
        assert payload["event_type"] == "permission_request"
        assert payload["data"]["tool_name"] == "Shell"
        assert payload["data"]["tool_input"] == {"command": "rm -rf build"}
        assert payload["data"]["agent_id"] == "main"

    def test_edit_permission_names_the_file(self) -> None:
        payload = _map(
            "Notification",
            notification_type="ToolPermission",
            message="Tool Edit requires editing",
            details={
                "type": "edit",
                "title": "Edit",
                "fileName": "auth.py",
                "filePath": "/w/auth.py",
            },
        )
        assert payload["data"]["tool_input"] == {"file_path": "/w/auth.py"}

    def test_mcp_permission_names_the_tool(self) -> None:
        payload = _map(
            "Notification",
            notification_type="ToolPermission",
            message="Tool needs approval",
            details={"type": "mcp", "title": "search", "serverName": "docs", "toolName": "search"},
        )
        assert payload["data"]["tool_name"] == "search"

    def test_other_notifications_stay_notifications(self) -> None:
        payload = _map("Notification", notification_type="Other", message="hello")
        assert payload["event_type"] == "notification"
        assert payload["data"]["message"] == "hello"


class TestCommon:
    @pytest.mark.parametrize(
        "hook_event", ["SessionStart", "BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool"]
    )
    def test_every_event_names_gemini(self, hook_event: str) -> None:
        assert _map(hook_event)["data"]["coding_agent"] == "gemini-cli"

    @pytest.mark.parametrize("hook_event", ["BeforeModel", "AfterModel", "BeforeToolSelection", ""])
    def test_unregistered_events_are_skipped(self, hook_event: str) -> None:
        assert map_gemini_event(hook_event, BASE) is None

    def test_project_comes_from_gemini_project_dir(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GEMINI_PROJECT_DIR", "/Users/me/work/api")
        data = _map("SessionStart")["data"]
        assert (data["project_name"], data["project_dir"]) == ("api", "/Users/me/work/api")
        assert data["working_dir"] == "/Users/me/work/shop"

    def test_project_falls_back_to_cwd(self) -> None:
        assert _map("SessionStart")["data"]["project_name"] == "shop"

    def test_session_id_falls_back(self) -> None:
        payload = map_gemini_event("SessionStart", {"cwd": "/w"}, "env-session")
        assert payload is not None
        assert payload["session_id"] == "env-session"

    def test_transcript_is_not_forwarded(self) -> None:
        assert "transcript_path" not in _map("SessionStart")["data"]
