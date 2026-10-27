"""Concurrent hook events must not lose sessions or event rows.

The events endpoint processes each hook event as a background task, so events
from different terminals (or a burst from one) are persisted concurrently.
When every DB session shared one connection, one task's commit or rollback
landed on another task's half-written rows: sessions vanished from the
session list and handlers raised ``StaleDataError`` ("expected to update 1
row(s); 0 were matched") or ``NoResultFound``.

These tests run against a file database built by the production engine
factory, because an in-memory database hides the problem.
"""

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import func, select

from app.core.event_processor import EventProcessor
from app.db import database
from app.db.database import Base, create_engine_for, override_engine
from app.db.models import EventRecord, SessionRecord
from app.models.events import AnyEvent, EventAdapter, EventType

SESSIONS = 6


def _make_event(event_type: EventType, session_id: str, **kwargs: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": session_id, "data": kwargs}
    )


@pytest.fixture
def file_db(tmp_path: Path) -> Iterator[None]:
    """Point the app at a fresh file database built like production."""
    previous = database.get_engine()
    engine = create_engine_for(f"sqlite+aiosqlite:///{tmp_path / 'events.db'}")

    async def _setup() -> None:
        import app.db.models  # noqa: F401  # pyright: ignore[reportUnusedImport]

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_setup())
    override_engine(engine)
    yield
    asyncio.run(engine.dispose())
    override_engine(previous)


async def _counts() -> tuple[set[str], int]:
    async with database.AsyncSessionLocal() as db:
        ids = set((await db.execute(select(SessionRecord.id))).scalars())
        events = (await db.execute(select(func.count()).select_from(EventRecord))).scalar_one()
    return ids, events


@pytest.mark.asyncio
@pytest.mark.usefixtures("file_db")
async def test_sessions_started_together_all_persist() -> None:
    ep = EventProcessor()
    session_ids = [f"term-{i}" for i in range(SESSIONS)]

    await asyncio.gather(
        *(
            ep.process_event(_make_event(EventType.SESSION_START, sid, project_name=sid))
            for sid in session_ids
        )
    )
    await asyncio.gather(
        *(
            ep.process_event(_make_event(EventType.USER_PROMPT_SUBMIT, sid, prompt="go"))
            for sid in session_ids
        )
    )

    ids, events = await _counts()
    assert ids == set(session_ids)
    assert events == SESSIONS * 2


@pytest.mark.asyncio
@pytest.mark.usefixtures("file_db")
async def test_session_events_apply_in_arrival_order() -> None:
    """A prompt racing its own session_start must not spawn a second start."""
    ep = EventProcessor()
    sid = "0f6c2d1e-race"  # a real-looking id: "sim_" ids skip recovery

    await asyncio.gather(
        ep.process_event(_make_event(EventType.SESSION_START, sid, project_name="race")),
        ep.process_event(_make_event(EventType.USER_PROMPT_SUBMIT, sid, prompt="go")),
    )

    async with database.AsyncSessionLocal() as db:
        types = list(
            (
                await db.execute(
                    select(EventRecord.event_type)
                    .where(EventRecord.session_id == sid)
                    .order_by(EventRecord.id)
                )
            ).scalars()
        )
    assert types == ["session_start", "user_prompt_submit"]
    assert ep.sessions[sid].boss_state == "receiving"


@pytest.mark.asyncio
@pytest.mark.usefixtures("file_db")
async def test_tool_burst_in_one_session_persists_every_event() -> None:
    ep = EventProcessor()
    await ep.process_event(_make_event(EventType.SESSION_START, "burst", project_name="burst"))

    reads = [
        _make_event(
            EventType.PRE_TOOL_USE,
            "burst",
            tool_name="Read",
            tool_input={"file_path": f"/tmp/f{i}.py"},
            agent_id="main",
        )
        for i in range(8)
    ]
    await asyncio.gather(*(ep.process_event(e) for e in reads))

    ids, events = await _counts()
    assert ids == {"burst"}
    assert events == 1 + len(reads)


@pytest.mark.asyncio
@pytest.mark.usefixtures("file_db")
async def test_subagent_tool_from_hook_and_transcript_is_applied_once() -> None:
    """A subagent's tool arrives from the hook (native id) and from the
    transcript poller (office agent id) with the same tool_use_id."""
    ep = EventProcessor()
    sid = "dup-session"
    await ep.process_event(_make_event(EventType.SESSION_START, sid, project_name="dup"))
    await ep.process_event(_make_event(EventType.SUBAGENT_START, sid, agent_id="subagent_tu_task"))
    sm = ep.sessions[sid]
    sm.agents["subagent_tu_task"].native_id = "nat-1"

    hook_pre = _make_event(
        EventType.PRE_TOOL_USE, sid, tool_name="Grep", tool_use_id="tu_g", native_agent_id="nat-1"
    )
    hook_post = _make_event(
        EventType.POST_TOOL_USE,
        sid,
        tool_name="Grep",
        tool_use_id="tu_g",
        native_agent_id="nat-1",
        success=True,
    )
    polled_pre = _make_event(
        EventType.PRE_TOOL_USE,
        sid,
        tool_name="Grep",
        tool_use_id="tu_g",
        agent_id="subagent_tu_task",
    )
    polled_post = _make_event(
        EventType.POST_TOOL_USE,
        sid,
        tool_use_id="tu_g",
        agent_id="subagent_tu_task",
        success=True,
    )
    await ep.process_event(hook_pre)
    await ep.process_event(hook_post)
    await ep._handle_polled_event(polled_pre)  # pyright: ignore[reportPrivateUsage]
    await ep._handle_polled_event(polled_post)  # pyright: ignore[reportPrivateUsage]

    tool_history = [e["type"] for e in sm.history if e["type"].endswith("_tool_use")]
    assert tool_history == ["pre_tool_use", "post_tool_use"]
    async with database.AsyncSessionLocal() as db:
        tool_events = (
            await db.execute(
                select(func.count())
                .select_from(EventRecord)
                .where(EventRecord.session_id == sid)
                .where(EventRecord.event_type.in_(["pre_tool_use", "post_tool_use"]))
            )
        ).scalar_one()
    assert tool_events == 2
