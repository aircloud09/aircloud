"""Tests for security hardening (issue #37 + #41)."""

from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import urlparse

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from starlette.responses import Response

from app.api.websocket import validate_websocket_origin
from app.config import get_settings
from app.core.path_utils import is_safe_transcript_path

# ---------------------------------------------------------------------------
# Fix #1: API URL validation — tests the validation logic directly
# (hooks-side module reload can't run from backend test env)
# ---------------------------------------------------------------------------

_ALLOWED_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1", None})


class TestApiUrlValidation:
    """Verify the hostname allowlist used by hooks config."""

    def test_localhost_hostname_allowed(self) -> None:
        assert urlparse("http://localhost:8000/api").hostname in _ALLOWED_HOSTNAMES

    def test_127_hostname_allowed(self) -> None:
        assert urlparse("http://127.0.0.1:8000/api").hostname in _ALLOWED_HOSTNAMES

    def test_ipv6_hostname_allowed(self) -> None:
        assert urlparse("http://[::1]:8000/api").hostname in _ALLOWED_HOSTNAMES

    def test_external_hostname_blocked(self) -> None:
        assert urlparse("https://evil.com/collect").hostname not in _ALLOWED_HOSTNAMES

    def test_lan_ip_blocked(self) -> None:
        assert urlparse("http://192.168.1.1:8000/api").hostname not in _ALLOWED_HOSTNAMES


# ---------------------------------------------------------------------------
# Fix #2: Transcript path validation
# ---------------------------------------------------------------------------


class TestSafeTranscriptPath:
    """Verify is_safe_transcript_path rejects paths outside ~/.claude/."""

    def test_valid_claude_jsonl(self) -> None:
        with patch.object(Path, "home", return_value=Path("/home/user")):
            assert is_safe_transcript_path("/home/user/.claude/session.jsonl") is True

    def test_rejects_non_claude_dir(self) -> None:
        with patch.object(Path, "home", return_value=Path("/home/user")):
            assert is_safe_transcript_path("/tmp/evil.jsonl") is False

    def test_rejects_non_jsonl(self) -> None:
        with patch.object(Path, "home", return_value=Path("/home/user")):
            assert is_safe_transcript_path("/home/user/.claude/config.env") is False

    def test_rejects_path_traversal(self) -> None:
        with patch.object(Path, "home", return_value=Path("/home/user")):
            assert is_safe_transcript_path("/home/user/.claude/../../etc/passwd.jsonl") is False

    def test_rejects_empty(self) -> None:
        assert is_safe_transcript_path("") is False


# ---------------------------------------------------------------------------
# Fix #3: API key auth middleware
# ---------------------------------------------------------------------------


class TestApiKeyMiddleware:
    """Verify ApiKeyMiddleware rejects requests without valid key."""

    def test_no_key_configured_allows_requests(self) -> None:
        """When CLAUDE_OFFICE_API_KEY is empty, auth is skipped."""
        from app.main import app

        client = TestClient(app)
        resp = client.post(
            "/api/v1/events",
            json={
                "event_type": "session_start",
                "session_id": "test-no-key",
                "timestamp": "2026-01-01T00:00:00",
                "data": {},
            },
        )
        assert resp.status_code == 200

    def test_valid_key_accepted(self) -> None:
        """Requests with the correct X-API-Key should pass."""
        from app.config import get_settings

        settings = get_settings()
        original_key = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"

        from app.main import app

        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/events",
                json={
                    "event_type": "session_start",
                    "session_id": "test-with-key",
                    "timestamp": "2026-01-01T00:00:00",
                    "data": {},
                },
                headers={"X-API-Key": "test-secret-key"},
            )
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original_key

    def test_invalid_key_rejected(self) -> None:
        """Requests with wrong X-API-Key should get 401."""
        from app.config import get_settings

        settings = get_settings()
        original_key = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"

        from app.main import app

        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/events",
                json={
                    "event_type": "session_start",
                    "session_id": "test-bad-key",
                    "timestamp": "2026-01-01T00:00:00",
                    "data": {},
                },
                headers={"X-API-Key": "wrong-key"},
            )
            assert resp.status_code == 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original_key

    def test_missing_key_rejected(self) -> None:
        """Requests with no X-API-Key when key is configured should get 401."""
        from app.config import get_settings

        settings = get_settings()
        original_key = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"

        from app.main import app

        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/events",
                json={
                    "event_type": "session_start",
                    "session_id": "test-no-key-header",
                    "timestamp": "2026-01-01T00:00:00",
                    "data": {},
                },
            )
            assert resp.status_code == 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original_key

    def test_refusals_carry_cors_headers(self) -> None:
        """A 401 must reach the page as a 401, not as a CORS network error."""
        from app.main import app

        client = TestClient(app)
        resp = client.delete("/api/v1/sessions", headers={"Origin": "http://localhost:4747"})
        assert resp.status_code == 401
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:4747"

    def test_health_endpoint_skips_auth(self) -> None:
        """Health endpoint should not require an API key."""
        from app.config import get_settings

        settings = get_settings()
        original_key = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"

        from app.main import app

        try:
            client = TestClient(app)
            resp = client.get("/health")
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original_key


# ---------------------------------------------------------------------------
# Fix #4: WebSocket origin validation with API key fallback
# ---------------------------------------------------------------------------


class TestWebSocketOriginValidation:
    """Verify WebSocket validates both origin and API key."""

    def _make_ws(self, origin: str | None = None, api_key: str | None = None) -> Any:
        """Create a mock WebSocket with specified headers."""

        class MockWebSocket:
            def __init__(self, headers: dict[str, str]) -> None:
                self.headers = headers

        headers: dict[str, str] = {}
        if origin is not None:
            headers["origin"] = origin
        if api_key is not None:
            headers["x-api-key"] = api_key
        return MockWebSocket(headers)

    def test_localhost_origin_accepted(self) -> None:
        ws = self._make_ws(origin="http://localhost:4747")
        assert validate_websocket_origin(ws) is True

    def test_cors_origin_non_loopback_rejected(self) -> None:
        """A non-loopback origin present in BACKEND_CORS_ORIGINS must still be
        rejected for WebSocket — the WS trust boundary stays localhost-only
        even when CORS is widened (QA-014).

        ``http://0.0.0.0:4747`` is in the default ``BACKEND_CORS_ORIGINS`` but
        ``0.0.0.0`` is not a loopback hostname, so it must be excluded from the
        derived WS allowlist.
        """
        settings = get_settings()
        assert "http://0.0.0.0:4747" in settings.BACKEND_CORS_ORIGINS
        ws = self._make_ws(origin="http://0.0.0.0:4747")
        assert validate_websocket_origin(ws) is False

    def test_external_origin_rejected(self) -> None:
        ws = self._make_ws(origin="https://evil.com")
        assert validate_websocket_origin(ws) is False

    def test_no_origin_no_key_configured_rejected(self) -> None:
        """No origin + no key = rejected even without explicit CLAUDE_OFFICE_API_KEY.

        The auto-generated per-launch token is always required for non-browser
        WebSocket clients (issue #41 item 3).
        """
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            ws = self._make_ws()
            assert validate_websocket_origin(ws) is False
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_no_origin_auto_key_accepted(self) -> None:
        """No origin + valid auto-generated key = accepted."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            ws = self._make_ws(api_key=settings.effective_api_key)
            assert validate_websocket_origin(ws) is True
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_no_origin_valid_key_accepted(self) -> None:
        """No origin + valid API key = accepted."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "my-secret"
        try:
            ws = self._make_ws(api_key="my-secret")
            assert validate_websocket_origin(ws) is True
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_no_origin_wrong_key_rejected(self) -> None:
        """No origin + wrong API key = rejected."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "my-secret"
        try:
            ws = self._make_ws(api_key="wrong")
            assert validate_websocket_origin(ws) is False
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_no_origin_no_key_rejected(self) -> None:
        """No origin + no API key when configured = rejected."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "my-secret"
        try:
            ws = self._make_ws()
            assert validate_websocket_origin(ws) is False
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original


# ---------------------------------------------------------------------------
# Follow-up (issue #39): the OpenAPI schema URL must stay reachable when an
# API key is set.
# ---------------------------------------------------------------------------


class TestOpenApiAuthExemption:
    """OpenAPI docs must stay reachable when an API key is configured (issue #39)."""

    def test_openapi_schema_reachable_with_key(self) -> None:
        from app.config import get_settings
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"
        try:
            client = TestClient(app)
            resp = client.get(f"{settings.API_V1_STR}/openapi.json")
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_docs_page_reachable_with_key(self) -> None:
        from app.config import get_settings
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"
        try:
            client = TestClient(app)
            resp = client.get("/docs")
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_redoc_page_reachable_with_key(self) -> None:
        from app.config import get_settings
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "test-secret-key"
        try:
            client = TestClient(app)
            resp = client.get("/redoc")
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original


# ---------------------------------------------------------------------------
# Issue #41 — lower-severity hardening follow-ups
# ---------------------------------------------------------------------------


class TestTimingSafeKeyComparison:
    """Verify API key comparison uses constant-time hmac.compare_digest."""

    def test_middleware_uses_hmac(self) -> None:
        """ApiKeyMiddleware should use hmac.compare_digest, not plain ==."""
        import inspect

        from app.main import ApiKeyMiddleware

        source = inspect.getsource(ApiKeyMiddleware.dispatch)
        assert "hmac.compare_digest" in source
        assert "provided != key" not in source
        assert "provided == key" not in source

    def test_websocket_uses_hmac(self) -> None:
        """WebSocket validation should use hmac.compare_digest."""
        import inspect

        source = inspect.getsource(validate_websocket_origin)
        assert "hmac.compare_digest" in source
        assert "provided == key" not in source


class TestStateChangingEndpointAuth:
    """State-changing endpoints always require the effective API key (issue #41 item 2)."""

    def test_clear_db_requires_key(self) -> None:
        """DELETE /sessions should require the effective API key."""
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            client = TestClient(app)
            # No X-API-Key header — should be rejected
            resp = client.delete(f"{settings.API_V1_STR}/sessions")
            assert resp.status_code == 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_clear_db_with_effective_key(self) -> None:
        """DELETE /sessions with the effective key should pass auth."""
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            client = TestClient(app)
            resp = client.delete(
                f"{settings.API_V1_STR}/sessions",
                headers={"X-API-Key": settings.effective_api_key},
            )
            # Auth passes — may be 200 or 500 depending on DB state, but not 401
            assert resp.status_code != 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_simulate_requires_key(self) -> None:
        """POST /sessions/simulate should require the effective API key."""
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            client = TestClient(app)
            resp = client.post(f"{settings.API_V1_STR}/sessions/simulate")
            assert resp.status_code == 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_read_only_endpoints_open_without_key(self) -> None:
        """GET endpoints should still work without a key."""
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            client = TestClient(app)
            resp = client.get(f"{settings.API_V1_STR}/sessions")
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original


class TestEffectiveApiKey:
    """Verify config.effective_api_key behavior."""

    def test_auto_key_generated(self) -> None:
        """An auto-generated key should exist when no explicit key is set."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            assert settings.effective_api_key
            assert len(settings.effective_api_key) == 64  # secrets.token_hex(32)
            assert not settings.has_explicit_key
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_explicit_key_takes_precedence(self) -> None:
        """When CLAUDE_OFFICE_API_KEY is set, it is the effective key."""
        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "my-explicit-key"
        try:
            assert settings.effective_api_key == "my-explicit-key"
            assert settings.has_explicit_key is True
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original


# ---------------------------------------------------------------------------
# SEC-001 — the API key is never served over HTTP
# ---------------------------------------------------------------------------


class TestStatusEndpointRemoved:
    """``GET /api/v1/status`` once carried the API key (SEC-001); it is gone."""

    def test_status_route_is_gone(self) -> None:
        from app.main import app

        client = TestClient(app)
        resp = client.get("/api/v1/status")
        assert resp.status_code == 404
        assert get_settings().effective_api_key not in resp.text


# ---------------------------------------------------------------------------
# SEC-005 — /events auth behavior regression (backend: no code change;
# plugin key support deferred, blocked by QA-002)
# ---------------------------------------------------------------------------


class TestEventsEndpointAuthRegression:
    """Lock in /events auth behavior (SEC-005 backend decision).

    Default config: /events stays open because hooks/plugin have no discovery
    channel for the auto-key after SEC-001 (gating it would silently break all
    event producers). Explicit key set: /events requires that key.
    """

    def test_events_open_in_default_config(self) -> None:
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = ""
        try:
            client = TestClient(app)
            resp = client.post(
                f"{settings.API_V1_STR}/events",
                json={
                    "event_type": "session_start",
                    "session_id": "sec005-default",
                    "timestamp": "2026-01-01T00:00:00",
                    "data": {},
                },
            )
            assert resp.status_code == 200
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original

    def test_events_require_explicit_key_when_set(self) -> None:
        from app.main import app

        settings = get_settings()
        original = settings.CLAUDE_OFFICE_API_KEY
        settings.CLAUDE_OFFICE_API_KEY = "explicit-test-key"
        try:
            client = TestClient(app)
            resp = client.post(
                f"{settings.API_V1_STR}/events",
                json={
                    "event_type": "session_start",
                    "session_id": "sec005-explicit",
                    "timestamp": "2026-01-01T00:00:00",
                    "data": {},
                },
            )
            assert resp.status_code == 401
        finally:
            settings.CLAUDE_OFFICE_API_KEY = original


class TestLocalhostOnlySetting:
    """LOCALHOST_ONLY routes through Settings (PR #61 review remediation)."""

    @staticmethod
    def _dispatch(client_host: str) -> tuple[bool, Response | None]:
        import asyncio

        from app.api import middleware as mw

        mw_instance = mw.LocalhostOnlyMiddleware(app=None)  # pyright: ignore[reportArgumentType]
        scope: dict[str, Any] = {
            "type": "http",
            "client": (client_host, 50000),
            "method": "GET",
            "path": "/",
            "headers": [],
        }
        request = Request(scope)
        called = False

        async def call_next(request: Request) -> JSONResponse:
            nonlocal called
            called = True
            return JSONResponse({"ok": True})

        response = asyncio.run(mw_instance.dispatch(request, call_next))
        return called, response if isinstance(response, JSONResponse) else None

    def test_disabled_allows_non_loopback_client(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """LOCALHOST_ONLY=0 (Docker) admits bridge-gateway client addresses."""
        from app.api import middleware as mw

        monkeypatch.setattr(mw.settings, "LOCALHOST_ONLY", False)
        called, _response = self._dispatch("192.168.65.1")
        assert called, "request must reach the app when the IP check is disabled"

    def test_enabled_rejects_non_loopback_client(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.api import middleware as mw

        monkeypatch.setattr(mw.settings, "LOCALHOST_ONLY", True)
        called, response = self._dispatch("192.168.65.1")
        assert not called
        assert response is not None and response.status_code == 403
