# backend/tests/test_team_detection.py
"""Tests for team detection in EventProcessor."""

import asyncio
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.event_processor import EventProcessor
from app.db.database import AsyncSessionLocal, Base, override_engine
from app.db.models import SessionRecord
from app.models.events import AnyEvent, EventAdapter, EventType


@pytest.fixture(autouse=True, scope="module")
def ensure_test_db() -> None:
    """Ensure a fresh in-memory DB is available for this module.

    test_task_persistence.py overrides the global engine and then disposes
    it.  This fixture re-initialises a clean engine so our tests are not
    affected by execution order.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    async def _setup() -> None:
        import app.db.models  # noqa: F401  # pyright: ignore[reportUnusedImport]

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())
    override_engine(engine)


def _make_event(event_type: EventType, session_id: str = "s1", **kwargs: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": session_id, "data": kwargs}
    )


async def _session_record(session_id: str) -> SessionRecord:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(SessionRecord).where(SessionRecord.id == session_id))
        return result.scalar_one()


class TestTeamDetection:
    @pytest.mark.asyncio
    async def test_lead_session_detected_when_no_teammate_name(self) -> None:
        ep = EventProcessor()
        event = _make_event(
            EventType.SESSION_START,
            session_id="lead-sess",
            team_name="squad",
            project_name="myapp",
        )
        await ep.process_event(event)
        record = await _session_record("lead-sess")
        assert record.team_name == "squad"
        assert record.is_lead is True

    @pytest.mark.asyncio
    async def test_teammate_session_detected_when_teammate_name_present(self) -> None:
        ep = EventProcessor()
        event = _make_event(
            EventType.SESSION_START,
            session_id="tm-sess",
            team_name="squad",
            teammate_name="implementer",
            project_name="myapp",
        )
        await ep.process_event(event)
        record = await _session_record("tm-sess")
        assert record.team_name == "squad"
        assert record.teammate_name == "implementer"
        assert record.is_lead is False
