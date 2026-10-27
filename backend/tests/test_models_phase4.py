"""Tests for Phase 4 model additions: team fields and character types."""

from app.db.models import SessionRecord
from app.models.agents import Agent, AgentState
from app.models.events import EventData, EventType


class TestNewEventTypes:
    def test_task_created_event_type_exists(self) -> None:
        assert EventType.TASK_CREATED == "task_created"

    def test_task_completed_event_type_exists(self) -> None:
        assert EventType.TASK_COMPLETED == "task_completed"

    def test_teammate_idle_event_type_exists(self) -> None:
        assert EventType.TEAMMATE_IDLE == "teammate_idle"


class TestEventDataTeamFields:
    def test_team_name_field(self) -> None:
        d = EventData(team_name="my-team")
        assert d.team_name == "my-team"

    def test_teammate_name_field(self) -> None:
        d = EventData(teammate_name="implementer")
        assert d.teammate_name == "implementer"

    def test_task_id_field(self) -> None:
        d = EventData(task_id="abc-123")
        assert d.task_id == "abc-123"

    def test_task_subject_field(self) -> None:
        d = EventData(task_subject="Implement login [REC-42]")
        assert d.task_subject == "Implement login [REC-42]"

    def test_team_fields_default_none(self) -> None:
        d = EventData()
        assert d.team_name is None
        assert d.teammate_name is None
        assert d.task_id is None
        assert d.task_subject is None


class TestAgentStateIdle:
    def test_idle_state_exists(self) -> None:
        assert AgentState.IDLE == "idle"


class TestAgentCharacterTypeFields:
    def test_character_type_field(self) -> None:
        a = Agent(
            id="x", color="#fff", number=0, state=AgentState.WORKING, character_type="teammate"
        )
        assert a.character_type == "teammate"

    def test_parent_session_id_field(self) -> None:
        a = Agent(
            id="x", color="#fff", number=0, state=AgentState.WORKING, parent_session_id="sess-abc"
        )
        assert a.parent_session_id == "sess-abc"

    def test_parent_id_field(self) -> None:
        a = Agent(id="x", color="#fff", number=0, state=AgentState.WORKING, parent_id="tm-abc123")
        assert a.parent_id == "tm-abc123"

    def test_character_fields_default_none(self) -> None:
        a = Agent(id="x", color="#fff", number=0, state=AgentState.WORKING)
        assert a.character_type is None
        assert a.parent_session_id is None
        assert a.parent_id is None


class TestSessionRecordTeamColumns:
    def test_session_record_has_team_name_column(self) -> None:
        col = SessionRecord.__table__.columns["team_name"]
        assert col.nullable is True

    def test_session_record_has_teammate_name_column(self) -> None:
        col = SessionRecord.__table__.columns["teammate_name"]
        assert col.nullable is True

    def test_session_record_has_is_lead_column(self) -> None:
        col = SessionRecord.__table__.columns["is_lead"]
        assert col.default.arg is False
