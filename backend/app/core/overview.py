"""Cross-session overview: every live session's boss in one compact payload.

``build_overview`` feeds ``/ws/overview``. The isometric office reads it to
show the other sessions on the same floor as colleagues
(``frontend/src/hooks/useFloorColleagues.ts``). Every session is an equal
peer: no lead, no desks, no merged state.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from app.models.agents import BossState
from app.models.common import TodoStatus
from app.models.overview import OverviewBucket, OverviewEntry, OverviewState

if TYPE_CHECKING:
    from app.core.state_machine import StateMachine

logger = logging.getLogger(__name__)

# Maps BossState to an overview status bucket. "needs_you" surfaces the
# terminals that are blocked on the user; "done" covers idle/finished turns.
_BOSS_TO_BUCKET: dict[BossState, OverviewBucket] = {
    BossState.WAITING_PERMISSION: "needs_you",
    BossState.PHONE_RINGING: "needs_you",
    BossState.WORKING: "working",
    BossState.DELEGATING: "working",
    BossState.REVIEWING: "working",
    BossState.RECEIVING: "working",
    BossState.ON_PHONE: "working",
    BossState.IDLE: "done",
    BossState.COMPLETING: "done",
}


def _overview_bucket(sm: StateMachine) -> OverviewBucket:
    """Pick the overview bucket for a session, smoothing out flicker.

    The boss drops to ``IDLE`` in the brief gap *between* tool calls and right
    after a subagent stops, even though the turn is still running. Mapping that
    transient idle straight to "done" makes the session jump out of "working"
    and back every tool cycle. So a session counts as still working when its
    turn is in progress (``turn_active``) or it has live subagents — only a
    genuinely finished/waiting turn lands in "done".
    """
    bucket = _BOSS_TO_BUCKET.get(sm.boss_state)
    if bucket is None:
        # An unknown BossState should fail safe to "done" rather than silently
        # masking the session as "working"; flag it so the map can be updated.
        logger.warning("No overview bucket for BossState %s; defaulting to 'done'", sm.boss_state)
        bucket = "done"
    if bucket == "done" and (sm.turn_active or sm.agents):
        return "working"
    return bucket


def build_overview(sessions: dict[str, StateMachine]) -> OverviewState:
    """Build a compact cross-session overview.

    Every session is an equal peer: one boss snapshot each, mapped to a status
    bucket. The frontend joins ``session_id`` to a project label and applies the
    "ended" bucket from its session list, so neither is included here.
    """
    entries: list[OverviewEntry] = []
    # Snapshot the registry up front: the caller holds ``_sessions_lock`` so the
    # dict can't be resized mid-iteration here, but copy defensively in case a
    # caller passes an unlocked registry.
    for session_id, sm in list(sessions.items()):
        # Snapshot each StateMachine's mutable collections so an in-place
        # mutation by that session's handlers (e.g. ``del sm.agents[id]``)
        # can't raise "dict changed size during iteration" / torn counts.
        todos = list(sm.todos)
        todo_total = len(todos)
        todo_done = sum(1 for t in todos if t.status == TodoStatus.COMPLETED)
        entries.append(
            OverviewEntry(
                session_id=session_id,
                bucket=_overview_bucket(sm),
                state=sm.boss_state,
                current_task=sm.boss_current_task,
                todo_done=todo_done,
                todo_total=todo_total,
                subagent_count=len(list(sm.agents)),
                activity=sm.boss_activity,
                stuck=sm.boss_stuck,
                bubble=sm.boss_bubble,
                turn_active=sm.turn_active,
                last_event_at=sm.lead_event_at,
            )
        )
    return OverviewState(entries=entries, last_updated=datetime.now(UTC))
