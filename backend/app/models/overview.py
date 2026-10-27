"""Cross-session overview models for ``/ws/overview``.

The overview gathers the boss (main agent) of every live session into a single
compact payload: which sessions are working, which need attention, and which
are done. The isometric office shows the other sessions on the same floor from
it. There is no lead/teammate hierarchy and no desk layout — every session is
an equal "peer".
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.agents import Activity, BossState, StuckReason
from app.models.common import BubbleContent

__all__ = [
    "OverviewBucket",
    "OverviewEntry",
    "OverviewState",
]

# Status buckets a peer is sorted into on the overview.
# The "ended" bucket is applied frontend-side from the session list, so it is
# not part of the live backend payload.
OverviewBucket = Literal["needs_you", "working", "done"]


class OverviewEntry(BaseModel):
    """A single session's boss snapshot for the overview."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    session_id: str
    bucket: OverviewBucket
    state: BossState  # raw boss state, for the peer tooltip
    current_task: str | None = None
    todo_done: int = 0
    todo_total: int = 0
    subagent_count: int = 0
    # What the boss is doing right now, so the office can walk another live
    # session's boss to the same rooms as the session it shows.
    activity: Activity | None = None
    stuck: StuckReason | None = None
    bubble: BubbleContent | None = None
    turn_active: bool = False
    # When the lead's latest event happened: the office counts how long it has
    # been at what it does from here, not from when a page saw it.
    last_event_at: datetime | None = None


class OverviewState(BaseModel):
    """The full cross-session overview broadcast over ``/ws/overview``."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    entries: list[OverviewEntry] = Field(default_factory=lambda: cast(list[OverviewEntry], []))
    last_updated: datetime
