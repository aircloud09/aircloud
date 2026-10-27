"""WebSocket routes for the Claude Office backend.

Moved out of ``app.main`` in ARC-023. The two endpoints register on a
dedicated ``APIRouter`` that ``app.main`` includes without a prefix.

Declaration order is load-bearing: ``/ws/overview`` MUST be registered before
``/ws/{session_id}`` so the single-segment path ``/ws/overview`` isn't
captured by the session-id route (which would treat "overview" as a session
id, accept, find no state, and silently idle).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.websocket import get_manager
from app.core.event_processor import get_event_processor

logger = logging.getLogger(__name__)

# Upper bound on concurrent /ws/overview watchers. Each one
# amplifies the per-event overview rebuild cost, so refuse new ones past this.
_MAX_OVERVIEW_CONNECTIONS = 16

router = APIRouter()


@router.websocket("/ws/overview")
async def websocket_overview(websocket: WebSocket) -> None:
    """Overview WebSocket: boss status of every live session.

    Declared BEFORE ``/ws/{session_id}`` so the single-segment path ``/ws/overview``
    isn't captured by the session route (which would treat "overview" as a session
    id, accept, find no state, and silently idle).
    """
    from app.api.websocket import validate_websocket_origin

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    # Cap concurrent overview watchers: each connection amplifies the per-event
    # overview rebuild cost, so refuse beyond the limit instead of letting it
    # grow unbounded. The check is enforced atomically with the registration
    # inside connect_overview (under the manager lock) so a burst of concurrent
    # handshakes can't each pass the limit before any registers.
    accepted = await get_manager().connect_overview(
        websocket, max_connections=_MAX_OVERVIEW_CONNECTIONS
    )
    if not accepted:
        await websocket.close(code=4013, reason="Too many overview connections")
        return
    try:
        # Send the current overview snapshot on connect. Built under the same
        # ``_sessions_lock`` used by the per-event broadcast so it reads a
        # consistent registry snapshot and can't race a concurrent event handler
        # resizing ``sessions`` mid-iteration.
        overview = await get_event_processor().build_overview_snapshot()
        await websocket.send_json(
            {
                "type": "state_update",
                "timestamp": overview.last_updated.isoformat(),
                "state": overview.model_dump(mode="json", by_alias=True),
            }
        )
        # Keep alive -- discard incoming messages
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("Overview WebSocket error", exc_info=True)
    finally:
        await get_manager().disconnect_overview(websocket)


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    from app.api.websocket import validate_session_id, validate_websocket_origin

    if not validate_session_id(session_id):
        await websocket.close(code=4000, reason="Invalid session ID format")
        return

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    await get_manager().connect(websocket, session_id)

    current_state = await get_event_processor().get_current_state(session_id)
    if current_state:
        await get_manager().send_personal_message(
            {
                "type": "state_update",
                "timestamp": current_state.last_updated.isoformat(),
                "state": current_state.model_dump(mode="json", by_alias=True),
            },
            websocket,
        )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await get_manager().disconnect(websocket, session_id)
