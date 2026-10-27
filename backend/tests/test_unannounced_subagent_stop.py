"""SubagentStop of agents the office never had.

Claude Code reports SubagentStop for helper agents it runs on its own, with no
PreToolUse or SubagentStart before it and no transcript on disk. Such a stop
is dropped, so it neither fills the record nor sends home a real employee
that is still waiting to be linked.
"""

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select

from app.core.event_processor import EventProcessor
from app.db.database import AsyncSessionLocal
from app.db.models import EventRecord, SessionRecord
from app.models.events import AnyEvent, EventAdapter, EventType

SESSION_ID = "unannounced-stop"


def _event(event_type: EventType, **data: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": SESSION_ID, "data": data}
    )


async def _stored_types() -> list[str]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(EventRecord.event_type).where(EventRecord.session_id == SESSION_ID)
        )
        return list(result.scalars())


@pytest.fixture
async def transcripts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A session transcript under a ~/.claude of its own; returns its path."""
    monkeypatch.setenv("HOME", str(tmp_path))
    session_file = tmp_path / ".claude" / "projects" / "p" / f"{SESSION_ID}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text("{}\n")
    async with AsyncSessionLocal() as db:
        await db.execute(delete(EventRecord).where(EventRecord.session_id == SESSION_ID))
        await db.execute(delete(SessionRecord).where(SessionRecord.id == SESSION_ID))
        await db.commit()
    return session_file


def _agent_file(session_file: Path, native_id: str) -> Path:
    return session_file.with_suffix("") / "subagents" / f"agent-{native_id}.jsonl"


async def _office_with_unlinked_employee(session_file: Path) -> EventProcessor:
    """A session whose employee started but has not been linked to a native id."""
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, transcript_path=str(session_file)))
    await ep.process_event(
        _event(
            EventType.SUBAGENT_START,
            agent_id="subagent_real",
            agent_name="Explore",
            task_description="Map the auth flow",
        )
    )
    return ep


@pytest.mark.asyncio
async def test_stop_of_an_agent_without_a_transcript_is_dropped(transcripts: Path) -> None:
    ep = await _office_with_unlinked_employee(transcripts)

    await ep.process_event(
        _event(
            EventType.SUBAGENT_STOP,
            native_agent_id="helper1",
            transcript_path=str(transcripts),
            agent_transcript_path=str(_agent_file(transcripts, "helper1")),
        )
    )

    sm = ep.sessions[SESSION_ID]
    assert "subagent_real" in sm.agents
    assert sm.agents["subagent_real"].native_id is None
    assert "subagent_real" not in sm.handin_queue
    assert "subagent_stop" not in await _stored_types()


@pytest.mark.asyncio
async def test_stop_of_an_employee_whose_start_was_missed_still_sends_it_home(
    transcripts: Path,
) -> None:
    ep = await _office_with_unlinked_employee(transcripts)
    agent_file = _agent_file(transcripts, "real1")
    agent_file.parent.mkdir(parents=True)
    agent_file.write_text("{}\n")

    await ep.process_event(
        _event(
            EventType.SUBAGENT_STOP,
            native_agent_id="real1",
            transcript_path=str(transcripts),
            agent_transcript_path=str(agent_file),
        )
    )

    assert "subagent_stop" in await _stored_types()
    assert "subagent_real" not in ep.sessions[SESSION_ID].agents


@pytest.mark.asyncio
async def test_a_backend_that_cannot_see_transcripts_drops_nothing(transcripts: Path) -> None:
    ep = await _office_with_unlinked_employee(transcripts)
    unseen_session = transcripts.with_name("elsewhere.jsonl")

    await ep.process_event(
        _event(
            EventType.SUBAGENT_STOP,
            native_agent_id="helper2",
            transcript_path=str(unseen_session),
            agent_transcript_path=str(_agent_file(unseen_session, "helper2")),
        )
    )

    assert "subagent_stop" in await _stored_types()
