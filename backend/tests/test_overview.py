"""Tests for build_overview: one boss snapshot per live session for /ws/overview."""

from datetime import UTC, datetime

from app.core.overview import build_overview
from app.core.state_machine import StateMachine
from app.models.agents import Activity, Agent, AgentState, BossState, StuckReason
from app.models.common import BubbleContent, BubbleType, TodoItem, TodoStatus


class TestBuildOverview:
    def test_empty(self) -> None:
        ov = build_overview({})
        assert ov.entries == []

    def test_one_peer_per_session(self) -> None:
        a, b = StateMachine(), StateMachine()
        a.boss_state = BossState.WORKING
        b.boss_state = BossState.IDLE
        ov = build_overview({"s-a": a, "s-b": b})
        by_id = {e.session_id: e for e in ov.entries}
        assert set(by_id) == {"s-a", "s-b"}

    def test_carries_what_the_boss_is_doing(self) -> None:
        # The office walks another live session's boss to the room it works in.
        sm = StateMachine()
        sm.boss_state = BossState.WORKING
        sm.boss_activity = Activity.READING
        sm.boss_stuck = StuckReason.TOOL_FAILED
        sm.boss_bubble = BubbleContent(type=BubbleType.THOUGHT, text="src/auth.py", icon="📖")
        sm.turn_active = True
        entry = build_overview({"s": sm}).entries[0]
        assert entry.activity == Activity.READING
        assert entry.stuck == StuckReason.TOOL_FAILED
        assert entry.bubble is not None and entry.bubble.text == "src/auth.py"
        assert entry.turn_active
        dumped = entry.model_dump(mode="json", by_alias=True)
        assert dumped["activity"] == "reading" and dumped["turnActive"] is True

    def test_says_when_the_lead_last_did_something(self) -> None:
        # The office counts a colleague's thinking from here, not from when it saw it.
        sm = StateMachine()
        sm.lead_event_at = datetime(2026, 10, 23, 5, 0, tzinfo=UTC)
        dumped = build_overview({"s": sm}).entries[0].model_dump(mode="json", by_alias=True)
        assert dumped["lastEventAt"] == "2026-10-23T05:00:00Z"

    def test_bucket_mapping(self) -> None:
        cases = {
            BossState.WAITING_PERMISSION: "needs_you",
            BossState.PHONE_RINGING: "needs_you",
            BossState.WORKING: "working",
            BossState.DELEGATING: "working",
            BossState.REVIEWING: "working",
            BossState.IDLE: "done",
            BossState.COMPLETING: "done",
        }
        for state, expected in cases.items():
            sm = StateMachine()
            sm.boss_state = state
            ov = build_overview({"s": sm})
            assert ov.entries[0].bucket == expected
            assert ov.entries[0].state == state

    def test_idle_mid_turn_stays_working(self) -> None:
        # The boss drops to IDLE between tool calls; while the turn is still
        # running the terminal must not flicker into the "done" zone.
        sm = StateMachine()
        sm.boss_state = BossState.IDLE
        sm.turn_active = True
        assert build_overview({"s": sm}).entries[0].bucket == "working"

    def test_idle_with_live_subagents_stays_working(self) -> None:
        # A subagent stop flips the boss to IDLE, but if children are still
        # present the parent counts as working.
        sm = StateMachine()
        sm.boss_state = BossState.IDLE
        sm.turn_active = False
        sm.agents = {"x": Agent(id="x", color="#fff", number=0, state=AgentState.WORKING)}
        assert build_overview({"s": sm}).entries[0].bucket == "working"

    def test_idle_after_turn_is_done(self) -> None:
        # No active turn and no subagents -> genuinely idle/waiting.
        sm = StateMachine()
        sm.boss_state = BossState.IDLE
        sm.turn_active = False
        assert build_overview({"s": sm}).entries[0].bucket == "done"

    def test_needs_you_wins_over_turn_active(self) -> None:
        # Blocked-on-user states must surface even mid-turn.
        sm = StateMachine()
        sm.boss_state = BossState.WAITING_PERMISSION
        sm.turn_active = True
        assert build_overview({"s": sm}).entries[0].bucket == "needs_you"

    def test_todo_counts_and_subagents(self) -> None:
        sm = StateMachine()
        sm.boss_state = BossState.WORKING
        sm.boss_current_task = "refactor auth"
        sm.todos = [
            TodoItem(content="a", status=TodoStatus.COMPLETED),
            TodoItem(content="b", status=TodoStatus.IN_PROGRESS),
            TodoItem(content="c", status=TodoStatus.PENDING),
        ]
        sm.agents = {
            "x": Agent(id="x", color="#fff", number=0, state=AgentState.WORKING),
            "y": Agent(id="y", color="#fff", number=1, state=AgentState.WORKING),
        }
        entry = build_overview({"s": sm}).entries[0]
        assert entry.current_task == "refactor auth"
        assert (entry.todo_done, entry.todo_total) == (1, 3)
        assert entry.subagent_count == 2
