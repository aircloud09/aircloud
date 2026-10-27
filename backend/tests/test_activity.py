"""Tool -> office activity contract (docs/plan/spec.md R1, R2).

Reading tools send a character to the archive, command tools to the server
room. The backend owns the mapping and exposes it as ``activity`` on the boss
and on each agent; these tests pin the mapping, the in-flight bookkeeping
(parallel and failed tools), and the attribution of subagent tool calls.
"""

from typing import Any

import pytest

from app.core.activity import (
    ToolActivityTracker,
    ToolSubject,
    activity_for_call,
    activity_for_tool,
    tool_subject,
)
from app.core.event_processor import EventProcessor
from app.core.state_machine import StateMachine
from app.models.agents import Activity, Agent, AgentState
from app.models.events import AnyEvent, EventAdapter, EventType, ToolEvent


def _event(event_type: EventType, **data: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": "s1", "data": data}
    )


def _tool(event_type: EventType, tool_name: str, tool_use_id: str | None, **data: Any) -> AnyEvent:
    payload: dict[str, Any] = {"tool_name": tool_name, **data}
    if tool_use_id is not None:
        payload["tool_use_id"] = tool_use_id
    if "agent_id" not in data and "native_agent_id" not in data:
        payload["agent_id"] = "main"
    return _event(event_type, **payload)


class TestActivityForTool:
    @pytest.mark.parametrize(
        "tool_name",
        [
            "Read",
            "Grep",
            "Glob",
            "LS",
            "NotebookRead",
            "read",
            "read_file",
            "grep_search",
            "view_image",
        ],
    )
    def test_reading_tools(self, tool_name: str) -> None:
        assert activity_for_tool(tool_name) == Activity.READING

    @pytest.mark.parametrize(
        "tool_name", ["Bash", "PowerShell", "BashOutput", "bash", "run_shell_command", "shell"]
    )
    def test_command_tools(self, tool_name: str) -> None:
        assert activity_for_tool(tool_name) == Activity.RUNNING

    @pytest.mark.parametrize(
        ("tool_name", "activity"),
        [
            ("Edit", Activity.EDITING),
            ("MultiEdit", Activity.EDITING),
            ("NotebookEdit", Activity.EDITING),
            ("write", Activity.EDITING),
            ("replace", Activity.EDITING),
            ("apply_patch", Activity.EDITING),
            ("WebFetch", Activity.BROWSING),
            ("WebSearch", Activity.BROWSING),
            ("google_web_search", Activity.BROWSING),
            ("mcp__github__get_issue", Activity.BROWSING),
            ("TodoWrite", Activity.PLANNING),
            ("EnterPlanMode", Activity.PLANNING),
            ("ExitPlanMode", Activity.PLANNING),
            ("Skill", Activity.PLANNING),
            ("write_todos", Activity.PLANNING),
            ("update_plan", Activity.PLANNING),
            ("AskUserQuestion", Activity.ASKING),
            ("request_user_input", Activity.ASKING),
            ("ask_user", Activity.ASKING),
        ],
    )
    def test_room_tools(self, tool_name: str, activity: Activity) -> None:
        assert activity_for_tool(tool_name) == activity

    @pytest.mark.parametrize(
        "tool_name", ["Task", "spawn_agent", "wait_agent", "SlashCommand", "mcp_x", "", None]
    )
    def test_other_tools_have_no_activity(self, tool_name: str | None) -> None:
        assert activity_for_tool(tool_name) is None

    @pytest.mark.parametrize("tool_name", ["Task", "Agent", "spawn_agent"])
    def test_handing_out_work_puts_the_boss_on_delegating(self, tool_name: str) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, tool_name, "d1"))
        assert sm.boss_state.value == "delegating"
        assert sm.boss_bubble is None


class TestToolActivityTracker:
    def test_most_recent_unfinished_tool_wins(self) -> None:
        tracker = ToolActivityTracker()
        tracker.start("main", "Read", "t1")
        tracker.start("main", "Bash", "t2")
        assert tracker.current("main") == Activity.RUNNING
        tracker.finish("main", "Bash", "t2")
        assert tracker.current("main") == Activity.READING
        tracker.finish("main", "Read", "t1")
        assert tracker.current("main") is None

    def test_finish_without_id_matches_oldest_same_name(self) -> None:
        tracker = ToolActivityTracker()
        tracker.start("main", "Read", None)
        tracker.start("main", "Bash", None)
        tracker.finish("main", "read", None)
        assert tracker.current("main") == Activity.RUNNING

    def test_characters_are_independent(self) -> None:
        tracker = ToolActivityTracker()
        tracker.start("main", "Read", "t1")
        tracker.start("agent-1", "Bash", "t2")
        tracker.clear("agent-1")
        assert tracker.current("main") == Activity.READING
        assert tracker.current("agent-1") is None


class TestBossActivity:
    def test_parallel_reads_and_command(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Read", "r1"))
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Read", "r2"))
        assert sm.to_game_state("s1").boss.activity == Activity.READING
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Bash", "b1"))
        assert sm.to_game_state("s1").boss.activity == Activity.RUNNING
        sm.transition(_tool(EventType.POST_TOOL_USE, "Bash", "b1", success=True))
        sm.transition(_tool(EventType.POST_TOOL_USE, "Read", "r1", success=True))
        assert sm.boss_activity == Activity.READING
        sm.transition(_tool(EventType.POST_TOOL_USE, "Read", "r2", success=True))
        assert sm.boss_activity is None

    def test_failed_tool_ends_its_activity(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Bash", "b1"))
        sm.transition(
            _tool(EventType.POST_TOOL_USE, "Bash", "b1", success=False, error_type="tool_error")
        )
        assert sm.boss_activity is None

    def test_unmapped_tool_keeps_boss_at_desk(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "SlashCommand", "s1"))
        assert sm.boss_activity is None

    def test_turn_boundaries_clear_leftovers(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Bash", "b1"))  # never finished
        sm.transition(_event(EventType.STOP))
        assert sm.boss_activity is None
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Read", "r1"))  # never finished
        sm.transition(_event(EventType.USER_PROMPT_SUBMIT, prompt="next"))
        assert sm.boss_activity is None

    def test_game_state_serializes_activity(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Grep", "g1"))
        payload = sm.to_game_state("s1").model_dump(mode="json", by_alias=True)
        assert payload["boss"]["activity"] == "reading"


class TestSubagentType:
    def test_subagent_keeps_the_type_it_was_started_as(self) -> None:
        sm = StateMachine()
        sm.transition(
            _event(
                EventType.SUBAGENT_START,
                agent_id="subagent_tu1",
                agent_type="general-purpose",
                task_description="Write the T-013 parts",
            )
        )
        assert sm.agents["subagent_tu1"].agent_type == "general-purpose"
        payload = sm.to_game_state("s1").model_dump(mode="json", by_alias=True)
        assert payload["agents"][0]["agentType"] == "general-purpose"

    def test_type_is_empty_when_the_producer_does_not_say(self) -> None:
        sm = StateMachine()
        sm.transition(_event(EventType.SUBAGENT_START, agent_id="subagent_tu2"))
        assert sm.agents["subagent_tu2"].agent_type is None


class TestSubagentAttribution:
    def _sm_with_linked_agent(self) -> StateMachine:
        sm = StateMachine()
        sm.agents["subagent_tu1"] = Agent(
            id="subagent_tu1",
            native_id="a5a60c7",
            color="#3b82f6",
            number=1,
            state=AgentState.WORKING,
            desk=1,
        )
        return sm

    def test_subagent_read_moves_the_agent_not_the_boss(self) -> None:
        sm = self._sm_with_linked_agent()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Read", "r1", native_agent_id="a5a60c7"))
        assert sm.agents["subagent_tu1"].activity == Activity.READING
        assert sm.agents["subagent_tu1"].bubble is not None
        assert sm.boss_activity is None
        assert sm.boss_bubble is None

    def test_subagent_tools_end_with_the_subagent(self) -> None:
        sm = self._sm_with_linked_agent()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Bash", "b1", native_agent_id="a5a60c7"))
        sm.transition(_event(EventType.SUBAGENT_STOP, agent_id="subagent_tu1"))
        assert sm.agents["subagent_tu1"].activity is None

    def test_unlinked_subagent_is_late_linked_by_its_first_tool(self) -> None:
        sm = StateMachine()
        sm.transition(_event(EventType.SUBAGENT_START, agent_id="subagent_tu9"))
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Read", "r1", native_agent_id="c42"))
        assert set(sm.agents) == {"subagent_tu9"}
        assert sm.agents["subagent_tu9"].native_id == "c42"
        assert sm.agents["subagent_tu9"].activity == Activity.READING

    def test_unknown_subagent_becomes_a_linked_ghost(self) -> None:
        sm = StateMachine()
        sm.transition(_tool(EventType.PRE_TOOL_USE, "Grep", "g1", native_agent_id="b77"))
        ghost = sm.agents["subagent_b77"]
        assert ghost.native_id == "b77"
        assert ghost.activity == Activity.READING
        sm.transition(
            _tool(EventType.POST_TOOL_USE, "Grep", "g1", native_agent_id="b77", success=True)
        )
        assert ghost.activity is None


class TestToolSubject:
    """What a tool call works on, whichever agent sent it."""

    @pytest.mark.parametrize(
        ("tool_name", "tool_input", "expected"),
        [
            ("Read", {"file_path": "/repo/src/auth.py"}, ToolSubject("path", "/repo/src/auth.py")),
            ("read", {"filePath": "src/auth.ts"}, ToolSubject("path", "src/auth.ts")),
            ("read_file", {"absolute_path": "/repo/a.py"}, ToolSubject("path", "/repo/a.py")),
            ("Grep", {"pattern": "TODO", "path": "src"}, ToolSubject("path", "TODO")),
            ("Bash", {"command": "npm test"}, ToolSubject("command", "npm test")),
            (
                "bash",
                {"command": "npm test", "description": "run"},
                ToolSubject("command", "npm test"),
            ),
            (
                "shell",
                {"command": ["bash", "-lc", "npm test"]},
                ToolSubject("command", "bash -lc npm test"),
            ),
            (
                "read_many_files",
                {"include": ["src/a.py", "src/b.py"]},
                ToolSubject("path", "src/a.py src/b.py"),
            ),
            (
                "WebFetch",
                {"url": "https://example.com", "prompt": "x"},
                ToolSubject("text", "https://example.com"),
            ),
        ],
    )
    def test_reads_each_agents_input_keys(
        self, tool_name: str, tool_input: dict[str, Any], expected: ToolSubject
    ) -> None:
        assert tool_subject(tool_name, tool_input) == expected

    def test_no_input_has_no_subject(self) -> None:
        assert tool_subject("Read", None) is None
        assert tool_subject("Read", {}) is None

    def test_command_tool_without_a_command_has_no_subject(self) -> None:
        assert tool_subject("bash", {"file_path": "a.py"}) is None


class TestToolBubble:
    """Thought bubble text and icon for each agent's tool names."""

    @pytest.mark.parametrize(
        ("tool_name", "tool_input", "text", "icon"),
        [
            ("Read", {"file_path": "src/auth.py"}, "src/auth.py", "📖"),
            ("read", {"filePath": "src/auth.ts"}, "src/auth.ts", "📖"),
            ("grep", {"pattern": "TODO"}, "TODO", "🔎"),
            ("read_file", {"absolute_path": "src/a.py"}, "src/a.py", "📖"),
            ("Bash", {"command": "npm test"}, "npm test", "💻"),
            ("bash", {"command": "npm test"}, "npm test", "💻"),
            ("run_shell_command", {"command": "pytest -q"}, "pytest -q", "💻"),
            ("task", {"prompt": "look around"}, "Delegating...", "🎯"),
            ("Agent", {"prompt": "look around"}, "Delegating...", "🎯"),
            ("TodoWrite", {"todos": []}, "TodoWrite", "📋"),
            ("replace", {"file_path": "src/a.py"}, "src/a.py", "📝"),
        ],
    )
    def test_text_and_icon(
        self, tool_name: str, tool_input: dict[str, Any], text: str, icon: str
    ) -> None:
        event = _tool(EventType.PRE_TOOL_USE, tool_name, "t1", tool_input=tool_input)
        assert isinstance(event, ToolEvent)
        bubble = StateMachine().tool_to_thought(event)
        assert (bubble.text, bubble.icon) == (text, icon)


@pytest.mark.asyncio
async def test_event_log_summary_names_an_opencode_tools_target() -> None:
    def event(event_type: EventType, **data: Any) -> AnyEvent:
        return EventAdapter.validate_python(
            {"event_type": event_type, "session_id": "summary-oc", "data": data}
        )

    ep = EventProcessor()
    await ep.process_event(event(EventType.SESSION_START, coding_agent="opencode"))
    await ep.process_event(
        event(
            EventType.PRE_TOOL_USE,
            tool_name="read",
            tool_use_id="c1",
            agent_id="main",
            tool_input={"filePath": "src/auth.ts"},
        )
    )
    history = ep.sessions["summary-oc"].history
    assert history[0]["summary"] == "Session started"
    assert history[-1]["summary"] == "Using read src/auth.ts"


class TestReadOnlyCommands:
    """A command tool that only reads counts as reading (Codex reads with the shell)."""

    @pytest.mark.parametrize(
        "command",
        [
            "cat src/auth.py",
            "sed -n 1,80p src/auth.py",
            "rg TODO src | head -20",
            "cd src && ls -la",
            "bash -lc 'sed -n 1,80p src/auth.py'",
            "nl -ba src/auth.py | sed -n '1,40p'",
            "find . -name '*.py'",
        ],
    )
    def test_reading_commands(self, command: str) -> None:
        assert activity_for_call("Bash", {"command": command}) is Activity.READING

    @pytest.mark.parametrize(
        "command",
        [
            "pytest -q",
            "cat a.py > b.py",
            "sed -i 's/>/>=/' src/auth.py",
            "sed 's/a/b/' src/auth.py",
            "find . -name '*.pyc' -delete",
            "cat $(git ls-files)",
            "cat a.py && rm a.py",
            "bash -lc 'npm test'",
        ],
    )
    def test_other_commands_run(self, command: str) -> None:
        assert activity_for_call("Bash", {"command": command}) is Activity.RUNNING

    def test_argv_lists_are_read_too(self) -> None:
        call = {"command": ["bash", "-lc", "cat src/auth.py"]}
        assert activity_for_call("shell", call) is Activity.READING

    def test_reading_command_sends_the_boss_to_the_archive(self) -> None:
        sm = StateMachine()
        sm.transition(
            _tool(EventType.PRE_TOOL_USE, "Bash", "t1", tool_input={"command": "cat a.py"})
        )
        assert sm.boss_activity is Activity.READING

    def test_reading_command_bubble_uses_the_reading_icon(self) -> None:
        event = _tool(EventType.PRE_TOOL_USE, "Bash", "t1", tool_input={"command": "cat a.py"})
        assert isinstance(event, ToolEvent)
        bubble = StateMachine().tool_to_thought(event)
        assert (bubble.text, bubble.icon) == ("cat a.py", "📖")
