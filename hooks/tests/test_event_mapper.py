"""Tests for event_mapper subagent event handling."""

from claude_office_hooks.event_mapper import map_event

SESSION_ID = "test-session-001"
TRANSCRIPT = "/home/user/.claude/projects/myproject/session.jsonl"


def _pre_tool_use_agent(tool_use_id: str = "tu_123") -> dict:
    return {
        "tool_name": "Agent",
        "tool_use_id": tool_use_id,
        "tool_input": {"prompt": "do something", "description": "Test Agent"},
        "session_id": SESSION_ID,
        "transcript_path": TRANSCRIPT,
    }


def _pre_tool_use_task(tool_use_id: str = "tu_456") -> dict:
    return {
        "tool_name": "Task",
        "tool_use_id": tool_use_id,
        "tool_input": {"prompt": "do something", "description": "Test Task"},
        "session_id": SESSION_ID,
        "transcript_path": TRANSCRIPT,
    }


def _post_tool_use_agent(
    tool_use_id: str = "tu_123",
    agent_id: str | None = "a5a60c7",
    run_in_background: bool = False,
) -> dict:
    tool_input: dict = {"prompt": "do something"}
    if run_in_background:
        tool_input["run_in_background"] = True
    resp = {}
    if agent_id is not None:
        resp["agentId"] = agent_id
    return {
        "tool_name": "Agent",
        "tool_use_id": tool_use_id,
        "tool_input": tool_input,
        "tool_response": resp,
        "session_id": SESSION_ID,
        "transcript_path": TRANSCRIPT,
    }


def _post_tool_use_task(tool_use_id: str = "tu_456") -> dict:
    return {
        "tool_name": "Task",
        "tool_use_id": tool_use_id,
        "tool_input": {"prompt": "do something"},
        "tool_response": {"content": "done"},
        "session_id": SESSION_ID,
        "transcript_path": TRANSCRIPT,
    }


class TestPreToolUseSubagentStart:
    """PreToolUse for Agent/Task tools should remap to subagent_start."""

    def test_agent_tool_creates_subagent_start(self) -> None:
        result = map_event("pre_tool_use", _pre_tool_use_agent(), SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_start"
        assert result["data"]["agent_id"] == "subagent_tu_123"

    def test_task_tool_creates_subagent_start(self) -> None:
        result = map_event("pre_tool_use", _pre_tool_use_task(), SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_start"
        assert result["data"]["agent_id"] == "subagent_tu_456"

    def test_extracts_description_and_prompt(self) -> None:
        result = map_event("pre_tool_use", _pre_tool_use_agent(), SESSION_ID)
        assert result is not None
        assert result["data"]["agent_name"] == "Test Agent"
        assert result["data"]["task_description"] == "do something"


class TestPostToolUseAgentAsync:
    """PostToolUse for Agent tool with agentId in response (async, v2.1+)."""

    def test_agent_with_agent_id_does_not_send_subagent_stop(self) -> None:
        """Agent tool with agentId in response means agent is still running async."""
        result = map_event("post_tool_use", _post_tool_use_agent(), SESSION_ID)
        assert result is not None
        assert result["event_type"] == "post_tool_use"
        assert result["data"]["agent_id"] == "main"

    def test_agent_with_agent_id_preserves_native_id(self) -> None:
        result = map_event("post_tool_use", _post_tool_use_agent(), SESSION_ID)
        assert result is not None
        assert result["data"]["native_agent_id"] == "a5a60c7"

    def test_agent_with_agent_id_preserves_transcript_path(self) -> None:
        result = map_event("post_tool_use", _post_tool_use_agent(), SESSION_ID)
        assert result is not None
        assert result["data"]["agent_transcript_path"] is not None
        assert "subagents/agent-a5a60c7" in result["data"]["agent_transcript_path"]

    def test_agent_without_agent_id_sends_subagent_stop(self) -> None:
        """Agent tool without agentId in response means sync completion (legacy)."""
        result = map_event("post_tool_use", _post_tool_use_agent(agent_id=None), SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_stop"
        assert result["data"]["agent_id"] == "subagent_tu_123"


class TestPostToolUseTaskSync:
    """PostToolUse for Task tool (always sync, no agentId)."""

    def test_task_sends_subagent_stop(self) -> None:
        result = map_event("post_tool_use", _post_tool_use_task(), SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_stop"
        assert result["data"]["agent_id"] == "subagent_tu_456"


class TestPostToolUseBackground:
    """PostToolUse with run_in_background should not send subagent_stop."""

    def test_background_agent_sends_main_id(self) -> None:
        result = map_event(
            "post_tool_use",
            _post_tool_use_agent(run_in_background=True),
            SESSION_ID,
        )
        assert result is not None
        assert result["event_type"] == "post_tool_use"
        assert result["data"]["agent_id"] == "main"


class TestNativeSubagentStart:
    """Native SubagentStart hook should remap to subagent_info."""

    def test_native_subagent_start_maps_to_info(self) -> None:
        raw = {
            "agent_id": "a5a60c7",
            "agent_type": "general-purpose",
            "session_id": SESSION_ID,
            "transcript_path": TRANSCRIPT,
        }
        result = map_event("subagent_start", raw, SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_info"
        assert result["data"]["native_agent_id"] == "a5a60c7"

    def test_native_subagent_start_without_agent_id_returns_none(self) -> None:
        raw = {
            "session_id": SESSION_ID,
            "transcript_path": TRANSCRIPT,
        }
        result = map_event("subagent_start", raw, SESSION_ID)
        assert result is None


class TestNativeSubagentStop:
    """Native SubagentStop hook should pass through with native_agent_id."""

    def test_native_subagent_stop_includes_native_id(self) -> None:
        raw = {
            "agent_id": "a5a60c7",
            "session_id": SESSION_ID,
            "transcript_path": TRANSCRIPT,
        }
        result = map_event("subagent_stop", raw, SESSION_ID)
        assert result is not None
        assert result["event_type"] == "subagent_stop"
        assert result["data"]["native_agent_id"] == "a5a60c7"

    def test_native_subagent_stop_without_agent_id_returns_none(self) -> None:
        raw = {
            "session_id": SESSION_ID,
            "transcript_path": TRANSCRIPT,
        }
        result = map_event("subagent_stop", raw, SESSION_ID)
        assert result is None


def _tool_call(tool_name: str = "Read", subagent_id: str | None = None) -> dict:
    raw: dict = {
        "tool_name": tool_name,
        "tool_use_id": "tu_read_1",
        "tool_input": {"file_path": "/repo/app.py"},
        "session_id": SESSION_ID,
        "transcript_path": TRANSCRIPT,
    }
    if subagent_id is not None:
        raw["agent_id"] = subagent_id
        raw["agent_type"] = "Explore"
    return raw


class TestToolEventAttribution:
    """Tool hooks fired inside a subagent carry the subagent's native agent_id."""

    def test_main_thread_tool_goes_to_boss(self) -> None:
        result = map_event("pre_tool_use", _tool_call(), SESSION_ID)
        assert result is not None
        assert result["data"]["agent_id"] == "main"
        assert "native_agent_id" not in result["data"]

    def test_subagent_tool_forwards_native_id(self) -> None:
        for event_type in ("pre_tool_use", "post_tool_use", "permission_request"):
            result = map_event(event_type, _tool_call(subagent_id="a5a60c7"), SESSION_ID)
            assert result is not None
            assert result["data"]["native_agent_id"] == "a5a60c7"
            assert "agent_id" not in result["data"]


class TestPostToolUseFailure:
    """PostToolUseFailure is sent as a failed post_tool_use."""

    def test_failure_maps_to_failed_post_tool_use(self) -> None:
        raw = {
            **_tool_call("Bash"),
            "tool_input": {"command": "npm test"},
            "error": "Exit code 1\nError: Cannot find module 'express'",
            "is_interrupt": False,
        }
        result = map_event("post_tool_use_failure", raw, SESSION_ID)
        assert result is not None
        assert result["event_type"] == "post_tool_use"
        assert result["data"]["success"] is False
        assert result["data"]["error_type"] == "tool_error"
        assert result["data"]["result_summary"] == "Exit code 1"
        assert result["data"]["tool_use_id"] == "tu_read_1"
        assert result["data"]["agent_id"] == "main"

    def test_interrupt_and_subagent_failure(self) -> None:
        raw = {**_tool_call("Bash", subagent_id="a5a60c7"), "is_interrupt": True}
        result = map_event("post_tool_use_failure", raw, SESSION_ID)
        assert result is not None
        assert result["data"]["error_type"] == "interrupt"
        assert result["data"]["native_agent_id"] == "a5a60c7"
        assert "result_summary" not in result["data"]


class TestCodingAgent:
    """Every hook event names Claude Code as the session's coding agent."""

    def test_tool_event_is_tagged_claude_code(self) -> None:
        result = map_event("pre_tool_use", _pre_tool_use_task(), SESSION_ID)
        assert result is not None
        assert result["data"]["coding_agent"] == "claude-code"

    def test_session_start_is_tagged_claude_code(self) -> None:
        raw = {"session_id": SESSION_ID, "source": "startup", "cwd": "/tmp/p"}
        result = map_event("session_start", raw, SESSION_ID)
        assert result is not None
        assert result["data"]["coding_agent"] == "claude-code"


class TestSessionStart:
    """A session start says why it started."""

    def test_source_is_sent(self) -> None:
        raw = {"session_id": SESSION_ID, "source": "compact", "cwd": "/tmp/p"}
        result = map_event("session_start", raw, SESSION_ID)
        assert result is not None
        assert result["data"]["source"] == "compact"
        assert result["data"]["summary"] == "Session started (compact)"
