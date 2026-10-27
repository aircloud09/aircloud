"""HTTP middleware for the Claude Office backend.

Moved out of ``app.main`` in ARC-023. The trust boundary and auth behavior
live here: ``LocalhostOnlyMiddleware`` restricts access to the loopback
interface, and ``ApiKeyMiddleware`` gates state-changing endpoints behind
either an explicit user-configured key or the per-launch auto-generated
token (SEC-001 / SEC-002 / SEC-006). The one exception is connecting a coding
agent from the office page itself, recognised by its Origin
(``office_page_origins``, which also gates browser WebSocket handshakes).
"""

import hmac
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings

# Resolved once at import time, mirroring the previous ``main.py`` pattern.
# ``Settings`` is a pydantic-settings singleton; subsequent ``get_settings()``
# calls return the same instance, so call-time attribute access is identical.
settings = get_settings()

_LOCALHOST_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})

# Loopback hosts the office page may be served from. Its origins are
# ``settings.BACKEND_CORS_ORIGINS`` filtered to these hosts, so a CORS-config
# change can never widen the trust boundary beyond the local machine (QA-014).
_LOOPBACK_ORIGIN_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def office_page_origins() -> frozenset[str]:
    """Origins the office page itself is served from.

    A browser WebSocket handshake must come from one of these, and so must an
    agent connect sent without the launch token.
    """
    return frozenset(
        origin.rstrip("/")
        for origin in settings.BACKEND_CORS_ORIGINS
        if urlparse(origin).hostname in _LOOPBACK_ORIGIN_HOSTS
    )


class LocalhostOnlyMiddleware(BaseHTTPMiddleware):
    """Reject HTTP requests from non-localhost origins.

    This is a local-only development tool, not deployed to the public internet.
    All API endpoints (including the ones that run subprocesses) are
    protected by restricting access to the loopback interface.

    ``"testclient"`` is the sentinel host used by Starlette's test transport
    and cannot appear on a real TCP connection, so it is safe to allow.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        client_host = request.client.host if request.client else None
        if settings.LOCALHOST_ONLY and client_host not in _LOCALHOST_HOSTS:
            return JSONResponse(
                status_code=403,
                content={"detail": "Access denied: localhost only"},
            )
        return await call_next(request)


# Paths that do NOT require an API key (health checks, interactive docs).
# The OpenAPI schema URL is checked separately in the middleware because it is
# served under settings.API_V1_STR (e.g. /api/v1/openapi.json), not /openapi.json.
_NO_AUTH_PATHS = frozenset({"/health", "/docs", "/redoc"})


def _is_agent_connect(path: str, method: str) -> bool:
    """Connecting or disconnecting a coding agent (``POST /hooks/...``)."""
    return path.startswith(f"{settings.API_V1_STR}/hooks/") and method == "POST"


def _is_state_changing(path: str, method: str) -> bool:
    """Return True if the request targets a destructive or side-effecting endpoint.

    Covers global destructive operations (clearing all sessions, running a
    simulation) and connecting a coding agent (``/hooks/...``, which runs an
    install command and rewrites the agent's settings file). Per-session
    mutations remain open in the default configuration and are fully gated
    when an explicit key is set (handled by ``settings.has_explicit_key`` in
    the middleware).
    """
    prefix = settings.API_V1_STR + "/sessions"
    return (
        (path == prefix and method == "DELETE")
        or (path == f"{prefix}/simulate" and method == "POST")
        or _is_agent_connect(path, method)
    )


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Validate X-API-Key header for protected endpoints.

    * When ``CLAUDE_OFFICE_API_KEY`` is explicitly set, ALL non-public paths
      require the key (existing behaviour).
    * When the key is empty (default), state-changing endpoints still require
      the per-launch auto-generated token (``settings.effective_api_key``),
      except an agent connect sent by the office page (see below).
      Read-only paths remain open for backwards compatibility.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if request.method == "OPTIONS":
            return await call_next(request)

        # Skip auth for public paths and WebSocket handshakes
        if (
            request.url.path in _NO_AUTH_PATHS
            or request.url.path == f"{settings.API_V1_STR}/openapi.json"
            or request.url.path.startswith("/ws/")
        ):
            return await call_next(request)

        # Determine whether auth is required for this request
        requires_auth = settings.has_explicit_key or _is_state_changing(
            request.url.path, request.method
        )

        if not requires_auth:
            return await call_next(request)

        # The settings page connects agents without the launch token, which it
        # has no way to get. A browser always sends Origin on a POST and a page
        # cannot fake it, so another site (or DNS rebinding, whose Origin names
        # the attacker's host) still needs the token, and so does a client that
        # sends no Origin. An explicit key keeps gating everything.
        origin = request.headers.get("origin", "").rstrip("/")
        if (
            not settings.has_explicit_key
            and _is_agent_connect(request.url.path, request.method)
            and origin in office_page_origins()
        ):
            return await call_next(request)

        provided = request.headers.get("X-API-Key", "")
        if not hmac.compare_digest(provided, settings.effective_api_key):
            return JSONResponse(status_code=401, content={"detail": "Invalid API key"})

        return await call_next(request)
