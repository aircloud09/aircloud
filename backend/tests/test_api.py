import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.event_processor import event_processor
from app.main import app
from app.models.events import EventAdapter, EventType

client = TestClient(app)


def _auth_headers() -> dict[str, str]:
    """Per-launch API key header required for state-changing endpoints.

    Session DELETE/PATCH are guarded by ``_is_state_changing`` even when no
    explicit key is configured, so these tests must present the auto-generated
    ``effective_api_key``.
    """
    return {"X-API-Key": get_settings().effective_api_key}


def _seed_session(session_id: str | None = None, **data: str) -> str:
    """Create a session via the event pipeline and return its ID."""
    sid = session_id or f"test-{uuid4()}"
    event = EventAdapter.validate_python(
        {
            "event_type": EventType.SESSION_START,
            "session_id": sid,
            "timestamp": datetime.now(UTC),
            "data": data,
        }
    )
    asyncio.run(event_processor.process_event(event))
    return sid


def test_receive_event():
    response = client.post(
        "/api/v1/events",
        json={
            "event_type": "session_start",
            "session_id": "test_session",
            "timestamp": "2026-01-15T10:00:00",
            "data": {},
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"


def test_event_rate_limiter_is_per_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """ARC-016: ingestion rate limit keys by session_id, not globally.

    One busy session hitting its limit must not throttle a different,
    concurrent session. The previous single global deque throttled the
    wrong dimension and silently dropped events from unrelated sessions
    (hooks do not retry on 429).
    """
    from app.api.routes import events
    from app.config import Settings

    limit = 3
    test_settings = Settings(EVENT_RATE_LIMIT=limit)
    monkeypatch.setattr(events, "get_settings", lambda: test_settings)
    events.reset_rate_limiter()

    def post(session_id: str) -> int:
        return client.post(
            "/api/v1/events",
            json={
                "event_type": "session_start",
                "session_id": session_id,
                "data": {},
            },
        ).status_code

    # Session A fills its own bucket up to the limit.
    for _ in range(limit):
        assert post("sess-a") == 200
    # Session A is now throttled at its own bucket.
    assert post("sess-a") == 429
    # Session B has a separate bucket and is unaffected — the core
    # per-session property the fix restores.
    assert post("sess-b") == 200


def test_delete_single_session():
    session_id = _seed_session()

    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    assert any(session["id"] == session_id for session in list_response.json())

    delete_response = client.delete(f"/api/v1/sessions/{session_id}", headers=_auth_headers())
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "success"

    list_after_delete = client.get("/api/v1/sessions")
    assert list_after_delete.status_code == 200
    assert session_id not in [session["id"] for session in list_after_delete.json()]


def test_update_session_label():
    """PATCH /sessions/{id}/label should persist and return the label."""
    session_id = _seed_session()

    # Update label
    response = client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": "My Test Session"},
        headers=_auth_headers(),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify label appears in session list
    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert session["label"] == "My Test Session"


def test_update_session_label_clear():
    """PATCH /sessions/{id}/label with null should clear the label."""
    session_id = _seed_session()

    # Set a label first
    client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": "temporary"},
        headers=_auth_headers(),
    )

    # Clear it
    response = client.patch(
        f"/api/v1/sessions/{session_id}/label",
        json={"label": None},
        headers=_auth_headers(),
    )
    assert response.status_code == 200

    list_response = client.get("/api/v1/sessions")
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert session["label"] is None


def test_update_session_label_not_found():
    """PATCH /sessions/{id}/label should return 404 for unknown session."""
    response = client.patch(
        "/api/v1/sessions/nonexistent-session/label",
        json={"label": "test"},
        headers=_auth_headers(),
    )
    assert response.status_code == 404


def test_session_list_includes_label_field():
    """All sessions in the list response should include a label field."""
    session_id = _seed_session()

    list_response = client.get("/api/v1/sessions")
    assert list_response.status_code == 200
    session = next(s for s in list_response.json() if s["id"] == session_id)
    assert "label" in session


def _end_session(session_id: str, reason: str) -> None:
    event = EventAdapter.validate_python(
        {
            "event_type": EventType.SESSION_END,
            "session_id": session_id,
            "timestamp": datetime.now(UTC),
            "data": {"reason": reason},
        }
    )
    asyncio.run(event_processor.process_event(event))


def test_session_list_leaves_out_sessions_ended_by_clear():
    """/clear goes on as a new session, so the session it ended leaves the list."""
    cleared, exited = _seed_session(), _seed_session()
    _seed_prompts(cleared, "Fix the login timeout")
    _seed_prompts(exited, "Fix the login timeout")
    _end_session(cleared, "clear")
    _end_session(exited, "prompt_input_exit")

    listed = {s["id"] for s in client.get("/api/v1/sessions").json()}
    assert cleared not in listed
    assert exited in listed


def test_resumed_cleared_session_is_listed_again():
    cleared = _seed_session()
    _seed_prompts(cleared, "Fix the login timeout")
    _end_session(cleared, "clear")
    _seed_session(cleared, source="resume")  # `claude --resume` starts it again

    listed = {s["id"]: s for s in client.get("/api/v1/sessions").json()}
    assert cleared in listed
    assert listed[cleared]["title"] == "Fix the login timeout"

    _end_session(cleared, "prompt_input_exit")
    assert cleared in {s["id"] for s in client.get("/api/v1/sessions").json()}

    _seed_session(cleared, source="resume")
    _end_session(cleared, "clear")
    assert cleared not in {s["id"] for s in client.get("/api/v1/sessions").json()}


def test_session_that_carried_on_a_conversation_is_listed_once_ended():
    """A compacted session whose events an earlier backend wiped still had a talk."""
    compacted = _seed_session(summary="Session started (compact)")
    _end_session(compacted, "other")

    assert compacted in {s["id"] for s in client.get("/api/v1/sessions").json()}


def test_session_list_leaves_out_ended_sessions_nothing_happened_in():
    """Opened, waited on and closed without a name: nothing to show."""
    silent, talked, worked, labelled, open_ = (_seed_session() for _ in range(5))
    _seed_prompts(talked, "Fix the login timeout")
    client.patch(
        f"/api/v1/sessions/{labelled}/label", json={"label": "Spare"}, headers=_auth_headers()
    )
    for session_id, event_type in (
        (silent, EventType.NOTIFICATION),
        (worked, EventType.PRE_TOOL_USE),
    ):
        event = EventAdapter.validate_python(
            {
                "event_type": event_type,
                "session_id": session_id,
                "timestamp": datetime.now(UTC),
                "data": {"tool_name": "Read"},
            }
        )
        asyncio.run(event_processor.process_event(event))
    for session_id in (silent, talked, worked, labelled):
        _end_session(session_id, "other")

    listed = {s["id"] for s in client.get("/api/v1/sessions").json()}
    assert silent not in listed
    assert {talked, worked, labelled, open_} <= listed


def _send(session_id: str, event_type: EventType, **data: object) -> None:
    event = EventAdapter.validate_python(
        {
            "event_type": event_type,
            "session_id": session_id,
            "timestamp": datetime.now(UTC),
            "data": data,
        }
    )
    asyncio.run(event_processor.process_event(event))


def test_session_list_says_which_sessions_wait_for_the_next_prompt():
    """A turn that ended waits, even after Claude Code says it waits for input."""
    working, stopped, fresh, finishing, delegating = (_seed_session() for _ in range(5))
    for session_id in (working, stopped, finishing, delegating):
        _seed_prompts(session_id, "Fix the login timeout")
    _send(working, EventType.PRE_TOOL_USE, tool_name="Read", tool_use_id="t1")
    _send(stopped, EventType.STOP)
    _send(stopped, EventType.NOTIFICATION, message="Claude is waiting for your input")
    # A background agent still at work after the lead's turn ended.
    _send(finishing, EventType.STOP)
    _send(finishing, EventType.PRE_TOOL_USE, tool_name="Read", tool_use_id="t2", agent_id="bg1")
    # The lead stops again while an agent it sent is still in the office.
    _send(delegating, EventType.SUBAGENT_START, agent_id="bg2", task_description="Map the docs")
    _send(delegating, EventType.STOP)

    idle = {s["id"]: s["idle"] for s in client.get("/api/v1/sessions").json()}
    assert idle[working] is False
    assert idle[stopped] is True
    assert idle[fresh] is True
    assert idle[finishing] is False
    assert idle[delegating] is False


def _seed_prompts(session_id: str, *prompts: str) -> None:
    for prompt in prompts:
        event = EventAdapter.validate_python(
            {
                "event_type": EventType.USER_PROMPT_SUBMIT,
                "session_id": session_id,
                "timestamp": datetime.now(UTC),
                "data": {"prompt": prompt},
            }
        )
        asyncio.run(event_processor.process_event(event))


def test_session_list_titles_sessions_by_their_first_prompt():
    """A session's title is the first line of its first prompt; no prompt, no title."""
    titled = _seed_session()
    untitled = _seed_session()
    _seed_prompts(titled, "  Fix the login timeout\nand add a test", "Second prompt")

    listed = {s["id"]: s for s in client.get("/api/v1/sessions").json()}
    assert listed[titled]["title"] == "Fix the login timeout"
    assert listed[untitled]["title"] is None


def test_session_title_is_one_short_line():
    spaced, long, blank = _seed_session(), _seed_session(), _seed_session()
    _seed_prompts(spaced, "\n\n  a   b  \nc")
    _seed_prompts(long, "x" * 200)
    _seed_prompts(blank, "   ")

    listed = {s["id"]: s for s in client.get("/api/v1/sessions").json()}
    assert listed[spaced]["title"] == "a b"
    assert listed[long]["title"] == "x" * 79 + "…"
    assert listed[blank]["title"] is None


def test_session_title_is_the_name_claude_code_gave_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Claude Code names sessions in their transcript; that beats the first prompt."""
    monkeypatch.setenv("HOME", str(tmp_path))
    folder = tmp_path / ".claude" / "projects" / "-tmp-demo"
    folder.mkdir(parents=True)
    named = folder / "named.jsonl"
    named.write_text(json.dumps({"type": "ai-title", "aiTitle": "Login timeout fix"}) + "\n")
    unnamed = folder / "unnamed.jsonl"
    unnamed.write_text(json.dumps({"type": "user", "message": {"content": "/clear"}}) + "\n")

    by_name, by_prompt = _seed_session(), _seed_session()
    for session_id, prompt, transcript in (
        (by_name, "/clear", named),
        (by_prompt, "Fix the login timeout", unnamed),
    ):
        event = EventAdapter.validate_python(
            {
                "event_type": EventType.USER_PROMPT_SUBMIT,
                "session_id": session_id,
                "timestamp": datetime.now(UTC),
                "data": {"prompt": prompt, "transcript_path": str(transcript)},
            }
        )
        asyncio.run(event_processor.process_event(event))

    listed = {s["id"]: s for s in client.get("/api/v1/sessions").json()}
    assert listed[by_name]["title"] == "Login timeout fix"
    assert listed[by_prompt]["title"] == "Fix the login timeout"


def test_clear_database_deletes_every_preference():
    """Clearing the database drops every preference; none is kept back."""
    for key in ("language", "building_config"):
        response = client.put(f"/api/v1/preferences/{key}", json={"value": "x"})
        assert response.status_code == 200

    response = client.delete("/api/v1/sessions", headers=_auth_headers())
    assert response.status_code == 200
    assert client.get("/api/v1/preferences").json() == {}
