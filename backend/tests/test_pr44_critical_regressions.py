"""Regression tests for the critical fixes shipped in PR #44.

Each test pins down a specific bug that was fixed during the full-system QA
sweep so it cannot silently regress:

* ``TranscriptPoller.stop_polling`` deadlock (lock held while awaiting the
  cancelled poll task).
* ``EventProcessor`` session-creation race (concurrent events for a brand-new
  session must not clobber each other's StateMachine).
* Session restore crashing on an unknown persisted ``event_type``.
"""

# pyright: reportPrivateUsage=false

import asyncio
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.event_processor import EventProcessor
from app.core.transcript_poller import TranscriptPoller
from app.db.database import AsyncSessionLocal, Base, override_engine
from app.db.models import EventRecord, SessionRecord
from app.models.events import EventAdapter, EventType


@pytest.fixture(autouse=True, scope="module")
def ensure_test_db() -> None:
    """Provide a fresh in-memory DB for this module (order-independent).

    Other modules override and dispose the global engine, so we re-initialise a
    clean one here just like ``test_team_detection.py`` does.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    async def _setup() -> None:
        import app.db.models  # noqa: F401  # pyright: ignore[reportUnusedImport]

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())
    override_engine(engine)


# ---------------------------------------------------------------------------
# TranscriptPoller.stop_polling deadlock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_polling_does_not_deadlock() -> None:
    """stop_polling must not hold the lock while awaiting the cancelled task."""
    callback = AsyncMock()
    poller = TranscriptPoller(callback)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write("")
        temp_path = f.name

    try:
        with patch("app.core.transcript_poller.POLL_INTERVAL_SECONDS", 0.01):
            await poller.start_polling("agent1", "session1", temp_path)
            # Let the poll loop run a few iterations so it is actively contending
            # for the lock when stop_polling cancels it.
            await asyncio.sleep(0.05)
            # Regression: stop_polling used to ``await agent.poll_task`` while
            # still holding ``self._lock``, deadlocking against the poll loop.
            # Bound with a timeout so a regression fails fast instead of hanging.
            await asyncio.wait_for(poller.stop_polling("agent1"), timeout=2.0)

        assert "agent1" not in poller._sessions
    finally:
        Path(temp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# EventProcessor concurrent session-creation race
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_events_share_one_state_machine() -> None:
    """Concurrent events for a new session must not lose updates.

    Before the ``_sessions_lock`` guard, two events racing on a brand-new
    session could each create a fresh StateMachine, the second clobbering the
    first and discarding the first event's history entry.

    Persistence is stubbed so the restore path stays empty — this isolates the
    in-memory create-under-lock logic from DB replay, which is what the lock
    actually protects.
    """
    ep = EventProcessor()
    session_id = "race-session"
    count = 20

    events = [
        EventAdapter.validate_python(
            {
                "event_type": EventType.USER_PROMPT_SUBMIT,
                "session_id": session_id,
                "data": {"prompt": f"prompt number {i}", "project_name": "app"},
            }
        )
        for i in range(count)
    ]

    with patch.object(ep, "_persist_event", new=AsyncMock()):
        await asyncio.gather(*(ep.process_event(evt) for evt in events))

    sm = ep.sessions.get(session_id)
    assert sm is not None
    # Every prompt must be recorded on the single shared StateMachine — none
    # lost to a clobbered/recreated instance.
    prompts = [e for e in sm.history if e["type"] == "user_prompt_submit"]
    assert len(prompts) == count


# ---------------------------------------------------------------------------
# Session restore crash on unknown event_type
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_restore_session_skips_unknown_event_type() -> None:
    """An unknown persisted event_type is skipped, not fatal to restoration."""
    session_id = "replay-unknown-type"
    now = datetime.now(UTC)

    async with AsyncSessionLocal() as db:
        db.add(SessionRecord(id=session_id, project_name="app"))
        db.add(
            EventRecord(
                session_id=session_id,
                timestamp=now,
                event_type=EventType.SESSION_START.value,
                data={"project_name": "app"},
            )
        )
        # A bogus event_type that EventType(...) cannot parse.
        db.add(
            EventRecord(
                session_id=session_id,
                timestamp=now,
                event_type="totally_bogus_event_type",
                data={},
            )
        )
        await db.commit()

    ep = EventProcessor()
    # Regression: EventType("totally_bogus_event_type") raised ValueError and
    # aborted the whole restore. It must now be skipped instead.
    await ep._restore_session(session_id)

    assert session_id in ep.sessions
