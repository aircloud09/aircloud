"""Stuck characters ponder on the spot (docs/plan/spec.md R3).

A failed tool or a permission prompt marks the boss or an agent stuck until
it starts another tool or its turn ends; the frontend shows the chin-in-hand
pose for it. ``turn_active`` lets the frontend tell a long think mid-turn
from an idle session.
"""

from typing import Any

from app.core.state_machine import StateMachine
from app.models.agents import Agent, AgentState, StuckReason
from app.models.events import AnyEvent, EventAdapter, EventType


def _event(event_type: EventType, **data: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": "s1", "data": data}
    )


def _bash(event_type: EventType, tool_use_id: str = "b1", **data: Any) -> AnyEvent:
    data.setdefault("agent_id", "main")
    return _event(
        event_type,
        tool_name="Bash",
        tool_use_id=tool_use_id,
        tool_input={"command": "npm test"},
        **data,
    )


class TestToolFailure:
    def test_failed_tool_sticks_until_the_next_tool(self) -> None:
        sm = StateMachine()
        sm.transition(_bash(EventType.PRE_TOOL_USE))
        sm.transition(
            _bash(
                EventType.POST_TOOL_USE,
                success=False,
                error_type="tool_error",
                result_summary="Exit code 1",
            )
        )
        state = sm.to_game_state("s1")
        assert state.boss.stuck == StuckReason.TOOL_FAILED
        assert state.boss.bubble is not None
        assert state.boss.bubble.text == "Bash failed: Exit code 1"
        assert state.boss.bubble.icon == "❗"

        sm.transition(_bash(EventType.PRE_TOOL_USE, tool_use_id="b2"))
        assert sm.boss_stuck is None

    def test_successful_tool_does_not_stick(self) -> None:
        sm = StateMachine()
        sm.transition(_bash(EventType.PRE_TOOL_USE))
        sm.transition(_bash(EventType.POST_TOOL_USE, success=True))
        assert sm.boss_stuck is None

    def test_turn_end_and_new_prompt_clear_it(self) -> None:
        sm = StateMachine()
        sm.transition(_bash(EventType.POST_TOOL_USE, success=False))
        sm.transition(_event(EventType.STOP))
        assert sm.boss_stuck is None
        sm.transition(_bash(EventType.POST_TOOL_USE, success=False))
        sm.transition(_event(EventType.USER_PROMPT_SUBMIT, prompt="try again"))
        assert sm.boss_stuck is None


class TestPermissionWait:
    def test_permission_prompt_sticks_until_the_tool_finishes(self) -> None:
        sm = StateMachine()
        sm.transition(_bash(EventType.PRE_TOOL_USE))
        sm.transition(_bash(EventType.PERMISSION_REQUEST))
        assert sm.boss_stuck == StuckReason.WAITING_PERMISSION
        sm.transition(_bash(EventType.POST_TOOL_USE, success=True))
        assert sm.boss_stuck is None

    def test_denied_permission_clears_on_the_next_tool(self) -> None:
        sm = StateMachine()
        sm.transition(_bash(EventType.PRE_TOOL_USE))
        sm.transition(_bash(EventType.PERMISSION_REQUEST))
        # Denied: no PostToolUse ever arrives for b1
        sm.transition(
            _event(EventType.PRE_TOOL_USE, tool_name="Read", tool_use_id="r1", agent_id="main")
        )
        assert sm.boss_stuck is None


class TestSubagentStuck:
    def test_agent_failure_is_its_own(self) -> None:
        sm = StateMachine()
        sm.agents["subagent_a"] = Agent(
            id="subagent_a", color="#fff", number=1, state=AgentState.WORKING, desk=1
        )
        sm.transition(_bash(EventType.POST_TOOL_USE, agent_id="subagent_a", success=False))
        assert sm.agents["subagent_a"].stuck == StuckReason.TOOL_FAILED
        assert sm.boss_stuck is None
        sm.transition(_event(EventType.SUBAGENT_STOP, agent_id="subagent_a"))
        assert sm.agents["subagent_a"].stuck is None


class TestTurnActive:
    def test_turn_active_spans_prompt_to_stop(self) -> None:
        sm = StateMachine()
        assert sm.to_game_state("s1").boss.turn_active is False
        sm.transition(_event(EventType.USER_PROMPT_SUBMIT, prompt="go"))
        assert sm.to_game_state("s1").boss.turn_active is True
        sm.transition(_event(EventType.STOP))
        payload = sm.to_game_state("s1").model_dump(mode="json", by_alias=True)
        assert payload["boss"]["turnActive"] is False
