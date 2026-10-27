"""A session rebuilt from the database applies each event once, at the right time.

When an event arrives for a session that is not in memory (a new session,
or one evicted or lost to a backend restart), the processor rebuilds the
session from its stored events. The arriving event must be applied once,
and stored timestamps must come back as the same UTC instant.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select, update

from app.core.event_processor import EventProcessor
from app.db import database
from app.db.models import EventRecord, SessionRecord
from app.models.agents import Activity
from app.models.events import AnyEvent, EventAdapter, EventType


def _event(
    event_type: EventType, session_id: str, timestamp: str | None = None, **data: Any
) -> AnyEvent:
    payload: dict[str, Any] = {"event_type": event_type, "session_id": session_id, "data": data}
    if timestamp is not None:
        payload["timestamp"] = timestamp
    return EventAdapter.validate_python(payload)


def _types(ep: EventProcessor, session_id: str) -> list[str]:
    return [entry["type"] for entry in ep.sessions[session_id].history]


@pytest.mark.asyncio
async def test_first_event_of_a_new_session_is_applied_once() -> None:
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, "restore-new"))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, "restore-new", prompt="hi"))

    assert _types(ep, "restore-new") == ["session_start", "user_prompt_submit"]


@pytest.mark.asyncio
async def test_event_after_eviction_is_applied_once() -> None:
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, "restore-evicted"))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, "restore-evicted", prompt="one"))
    del ep.sessions["restore-evicted"]  # evicted from memory, events stay in the DB

    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, "restore-evicted", prompt="two"))

    assert _types(ep, "restore-evicted") == [
        "session_start",
        "user_prompt_submit",
        "user_prompt_submit",
    ]
    prompts = [
        e["summary"]
        for e in ep.sessions["restore-evicted"].history
        if e["type"] == "user_prompt_submit"
    ]
    assert prompts == ["User: one", "User: two"]


@pytest.mark.asyncio
async def test_restored_history_keeps_what_the_log_shows() -> None:
    sid = "restore-detail"
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, sid))
    await ep.process_event(
        _event(EventType.USER_PROMPT_SUBMIT, sid, prompt="Rename the config loader")
    )
    await ep.process_event(
        _event(
            EventType.PRE_TOOL_USE,
            sid,
            tool_name="Read",
            tool_use_id="t1",
            tool_input={"file_path": "src/config.ts"},
        )
    )
    live = [entry["detail"] for entry in ep.sessions[sid].history]

    # A backend restart: a new processor rebuilds the session from the DB.
    state = await EventProcessor().get_current_state(sid)
    assert state is not None
    assert [entry["detail"] for entry in state.history] == live
    assert live[1]["prompt"] == "Rename the config loader"
    assert live[2]["toolInput"] == {"file_path": "src/config.ts"}


@pytest.mark.asyncio
async def test_lead_time_follows_the_lead_and_survives_a_restart() -> None:
    # A colleague's thinking counts from its lead's latest event, as the session
    # itself counts it when shown; an employee's work does not move it.
    ep = EventProcessor()
    sid = "restore-lead-time"
    prompted = "2026-10-23T05:00:01Z"
    await ep.process_event(_event(EventType.SESSION_START, sid, "2026-10-23T05:00:00Z"))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, sid, prompted, prompt="go"))
    await ep.process_event(
        _event(
            EventType.SUBAGENT_START,
            sid,
            "2026-10-23T05:00:09Z",
            agent_id="subagent_x",
            agent_name="Explore",
            task_description="Map the auth flow",
        )
    )
    assert ep.sessions[sid].lead_event_at == datetime(2026, 10, 23, 5, 0, 1, tzinfo=UTC)

    del ep.sessions[sid]  # lost to a restart, events stay in the DB
    await ep.process_event(
        _event(
            EventType.SUBAGENT_STOP,
            sid,
            "2026-10-23T05:00:20Z",
            agent_id="subagent_x",
            success=True,
        )
    )

    assert ep.sessions[sid].lead_event_at == datetime(2026, 10, 23, 5, 0, 1, tzinfo=UTC)


@pytest.mark.asyncio
async def test_restored_history_keeps_utc_times_and_ids() -> None:
    sid = "restore-utc"
    first = await _live_entry(sid)
    # A backend restart: a new processor rebuilds the session from the DB.
    state = await EventProcessor().get_current_state(sid)
    assert state is not None
    restored = state.history[0]

    assert restored["timestamp"] == "2026-10-19T23:00:00+00:00"
    # Same event, same id: the frontend's event log matches them up.
    assert restored["id"] == first["id"]
    assert datetime.fromisoformat(restored["timestamp"]) == datetime.fromisoformat(
        first["timestamp"]
    )


async def _live_entry(session_id: str) -> dict[str, str]:
    ep = EventProcessor()
    # 08:00 in Seoul is 23:00 UTC the day before.
    await ep.process_event(
        _event(EventType.SESSION_START, session_id, timestamp="2026-10-20T08:00:00+09:00")
    )
    entry = ep.sessions[session_id].history[0]
    return {"id": entry["id"], "timestamp": entry["timestamp"]}


@pytest.mark.asyncio
async def test_new_conversation_after_restart_starts_fresh() -> None:
    sid = "restore-startup"
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, sid))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, sid, prompt="old"))

    restarted = EventProcessor()
    await restarted.process_event(_event(EventType.SESSION_START, sid, source="startup"))

    assert _types(restarted, sid) == ["session_start"]
    async with database.AsyncSessionLocal() as db:
        stored = (
            await db.execute(select(EventRecord.event_type).where(EventRecord.session_id == sid))
        ).scalars()
        assert list(stored) == ["session_start"]


@pytest.mark.asyncio
async def test_resumed_session_after_restart_is_rebuilt_from_its_events() -> None:
    sid = "restore-resume"
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, sid))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, sid, prompt="old"))

    restarted = EventProcessor()
    await restarted.process_event(_event(EventType.SESSION_START, sid, source="resume"))

    assert _types(restarted, sid) == ["session_start", "user_prompt_submit", "session_start"]


@pytest.mark.asyncio
async def test_stored_timestamps_read_back_as_the_same_utc_instant() -> None:
    seoul = datetime.fromisoformat("2026-10-20T08:00:00+09:00")
    async with database.AsyncSessionLocal() as db:
        db.add(EventRecord(session_id="restore-db", timestamp=seoul, event_type="stop", data={}))
        await db.commit()
    async with database.AsyncSessionLocal() as db:
        stored = (
            await db.execute(
                select(EventRecord.timestamp).where(EventRecord.session_id == "restore-db")
            )
        ).scalar_one()

    assert stored == seoul
    assert stored.tzinfo == UTC


async def _reading(session_id: str) -> None:
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, session_id))
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, session_id, prompt="go"))
    await ep.process_event(
        _event(
            EventType.PRE_TOOL_USE,
            session_id,
            tool_name="Read",
            tool_use_id="t1",
            tool_input={"file_path": "src/auth.py"},
        )
    )


@pytest.mark.asyncio
async def test_overview_after_restart_knows_what_open_sessions_are_doing() -> None:
    # A colleague reading in the library goes on reading when the backend
    # comes back, instead of walking to its desk until its next event.
    sid = "restore-overview-open"
    await _reading(sid)

    overview = await EventProcessor().build_overview_snapshot()

    entry = next(e for e in overview.entries if e.session_id == sid)
    assert entry.activity == Activity.READING
    assert entry.bubble is not None and "auth.py" in entry.bubble.text


@pytest.mark.asyncio
async def test_overview_after_restart_leaves_out_ended_and_long_idle_sessions() -> None:
    ended, idle = "restore-overview-ended", "restore-overview-idle"
    await _reading(ended)
    await EventProcessor().process_event(_event(EventType.SESSION_END, ended))
    await _reading(idle)
    async with database.AsyncSessionLocal() as db:
        await db.execute(
            update(SessionRecord)
            .where(SessionRecord.id == idle)
            .values(updated_at=datetime.now(UTC) - timedelta(days=1))
        )
        await db.commit()

    restarted = EventProcessor()
    overview = await restarted.build_overview_snapshot()

    shown = {e.session_id for e in overview.entries}
    assert ended not in shown and idle not in shown
    assert ended not in restarted.sessions and idle not in restarted.sessions
