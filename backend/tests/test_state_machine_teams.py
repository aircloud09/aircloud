"""Tests for the Agent Teams events in the StateMachine."""

from typing import Any

from app.core.state_machine import StateMachine
from app.models.agents import BossState
from app.models.common import BubbleContent, BubbleType
from app.models.events import AnyEvent, EventAdapter, EventType


def _make_event(event_type: EventType, **kwargs: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": "s1", "data": kwargs}
    )


class TestTaskEvents:
    def test_task_events_leave_the_boss_alone(self) -> None:
        """task_created / task_completed only reach the event log."""
        sm = StateMachine()
        sm.boss_state = BossState.WORKING
        sm.transition(_make_event(EventType.TASK_CREATED, task_id="t1", task_subject="Work"))
        sm.transition(_make_event(EventType.TASK_COMPLETED, task_id="t1"))
        assert sm.boss_state == BossState.WORKING
        assert sm.agents == {}


class TestTeammateIdleTransition:
    def test_teammate_idle_sets_boss_state_idle(self) -> None:
        sm = StateMachine()
        sm.boss_state = BossState.WORKING
        sm.transition(_make_event(EventType.TEAMMATE_IDLE))
        assert sm.boss_state == BossState.IDLE

    def test_teammate_idle_clears_boss_bubble(self) -> None:
        sm = StateMachine()
        sm.boss_bubble = BubbleContent(type=BubbleType.THOUGHT, text="Thinking...")
        sm.transition(_make_event(EventType.TEAMMATE_IDLE))
        assert sm.boss_bubble is None
