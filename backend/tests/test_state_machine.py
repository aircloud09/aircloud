"""Tests for state machine logic."""

from app.core.state_machine import StateMachine
from app.models.agents import AgentState, BossState


class TestStateMachineInit:
    """Tests for StateMachine initialization."""

    def test_initial_boss_state_is_idle(self) -> None:
        """Initial boss state should be IDLE."""
        sm = StateMachine()
        assert sm.boss_state == BossState.IDLE

    def test_initial_agents_empty(self) -> None:
        """Initial agents dict should be empty."""
        sm = StateMachine()
        assert len(sm.agents) == 0

    def test_initial_queues_empty(self) -> None:
        """Initial queues should be empty."""
        sm = StateMachine()
        assert len(sm.arrival_queue) == 0
        assert len(sm.handin_queue) == 0


class TestRemoveAgent:
    """Tests for remove_agent method."""

    def test_remove_existing_agent(self) -> None:
        """Should remove agent from agents dict."""
        sm = StateMachine()
        from app.models.agents import Agent

        sm.agents["agent1"] = Agent(
            id="agent1", name="Test", color="#ff0000", number=1, state=AgentState.WORKING
        )
        sm.remove_agent("agent1")
        assert "agent1" not in sm.agents

    def test_remove_agent_from_arrival_queue(self) -> None:
        """Should remove agent from arrival queue."""
        sm = StateMachine()
        from app.models.agents import Agent

        sm.agents["agent1"] = Agent(
            id="agent1", name="Test", color="#ff0000", number=1, state=AgentState.ARRIVING
        )
        sm.arrival_queue.append("agent1")
        sm.remove_agent("agent1")
        assert "agent1" not in sm.arrival_queue

    def test_remove_agent_from_handin_queue(self) -> None:
        """Should remove agent from handin queue."""
        sm = StateMachine()
        from app.models.agents import Agent

        sm.agents["agent1"] = Agent(
            id="agent1", name="Test", color="#ff0000", number=1, state=AgentState.COMPLETED
        )
        sm.handin_queue.append("agent1")
        sm.remove_agent("agent1")
        assert "agent1" not in sm.handin_queue

    def test_remove_nonexistent_agent_no_error(self) -> None:
        """Removing nonexistent agent should not raise error."""
        sm = StateMachine()
        sm.remove_agent("nonexistent")  # Should not raise


class TestToGameState:
    """Tests for to_game_state method."""

    def test_returns_game_state_object(self) -> None:
        """Should return a GameState object."""
        sm = StateMachine()
        state = sm.to_game_state("test_session")
        assert state.session_id == "test_session"

    def test_boss_state_copied(self) -> None:
        """Boss state should be included in game state."""
        sm = StateMachine()
        sm.boss_state = BossState.WORKING
        state = sm.to_game_state("test")
        assert state.boss.state == BossState.WORKING

    def test_queues_copied(self) -> None:
        """Queues should be copied to game state."""
        sm = StateMachine()
        sm.arrival_queue = ["a1", "a2"]
        sm.handin_queue = ["a3"]
        state = sm.to_game_state("test")
        assert state.arrival_queue == ["a1", "a2"]
        assert state.departure_queue == ["a3"]
