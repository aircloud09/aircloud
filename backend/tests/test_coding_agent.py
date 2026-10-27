"""The coding agent that runs a session reaches the session list and GameState."""

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.routes.sessions import list_sessions
from app.core.coding_agent import coding_agent_of
from app.core.event_processor import EventProcessor
from app.core.state_machine import StateMachine
from app.db import database
from app.db.migrate import migrate_schema
from app.models.events import AnyEvent, EventAdapter, EventType


def _event(event_type: EventType, session_id: str = "s", **data: Any) -> AnyEvent:
    return EventAdapter.validate_python(
        {"event_type": event_type, "session_id": session_id, "data": data}
    )


def test_explicit_coding_agent_wins() -> None:
    event = _event(EventType.SESSION_START, coding_agent="gemini-cli", source="opencode")
    assert coding_agent_of(event.data) == "gemini-cli"


def test_older_opencode_plugin_is_recognised_by_its_source_tag() -> None:
    assert coding_agent_of(_event(EventType.PRE_TOOL_USE, source="opencode").data) == "opencode"


def test_unknown_producer_names_no_agent() -> None:
    assert coding_agent_of(_event(EventType.SESSION_START, source="startup").data) is None


def test_game_state_keeps_the_first_named_agent() -> None:
    sm = StateMachine()
    sm.transition(_event(EventType.SESSION_START))
    assert sm.to_game_state("s").coding_agent is None

    sm.transition(_event(EventType.USER_PROMPT_SUBMIT, coding_agent="codex", prompt="go"))
    sm.transition(_event(EventType.STOP, coding_agent="claude-code"))
    state = sm.to_game_state("s").model_dump(mode="json", by_alias=True)
    assert state["codingAgent"] == "codex"


@pytest.mark.asyncio
async def test_session_list_names_the_coding_agent() -> None:
    ep = EventProcessor()
    await ep.process_event(_event(EventType.SESSION_START, "agent-a", coding_agent="opencode"))
    # A later event without the tag must not clear it.
    await ep.process_event(_event(EventType.USER_PROMPT_SUBMIT, "agent-a", prompt="go"))
    await ep.process_event(_event(EventType.SESSION_START, "agent-b"))

    async with database.AsyncSessionLocal() as db:
        sessions = {s["id"]: s for s in await list_sessions(db=db)}
    assert sessions["agent-a"]["codingAgent"] == "opencode"
    assert sessions["agent-b"]["codingAgent"] is None


@pytest.mark.asyncio
async def test_migration_adds_the_column_to_an_existing_database(tmp_path: Path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'old.db'}")
    async with engine.begin() as conn:
        await conn.execute(text("CREATE TABLE sessions (id TEXT PRIMARY KEY)"))
        await migrate_schema(conn)
        columns = {row[1] for row in (await conn.execute(text("PRAGMA table_info(sessions)")))}
    await engine.dispose()
    assert "coding_agent" in columns
