from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.common import BubbleContent

__all__ = [
    "Activity",
    "StuckReason",
    "AgentState",
    "BossState",
    "Agent",
    "Boss",
]


class AgentState(StrEnum):
    """Visual states for agent characters."""

    ARRIVING = "arriving"
    REPORTING = "reporting"
    WALKING_TO_DESK = "walking_to_desk"
    WORKING = "working"
    THINKING = "thinking"
    WAITING_PERMISSION = "waiting_permission"
    COMPLETED = "completed"
    WAITING = "waiting"
    REPORTING_DONE = "reporting_done"
    LEAVING = "leaving"
    IN_ELEVATOR = "in_elevator"
    IDLE = "idle"


class Activity(StrEnum):
    """What a character is doing with its current tool, in office terms.

    Drives where the character walks: reading tools send it to the archive,
    command tools to the server room (docs/plan/spec.md R1, R2), and in the
    isometric office editing keeps it at its desk, browsing sends it to the
    search room, planning to the meeting room and asking to my desk
    (spec 「방 ↔ 도구」). ``None`` on a character means no mapped tool is
    running.
    """

    READING = "reading"
    RUNNING = "running"
    EDITING = "editing"
    BROWSING = "browsing"
    PLANNING = "planning"
    ASKING = "asking"


class StuckReason(StrEnum):
    """Why a character is stuck and ponders on the spot (docs/plan/spec.md R3)."""

    TOOL_FAILED = "tool_failed"
    WAITING_PERMISSION = "waiting_permission"


class BossState(StrEnum):
    """Visual states for the boss character."""

    IDLE = "idle"
    PHONE_RINGING = "phone_ringing"
    ON_PHONE = "on_phone"
    RECEIVING = "receiving"
    WORKING = "working"
    DELEGATING = "delegating"
    WAITING_PERMISSION = "waiting_permission"
    REVIEWING = "reviewing"
    COMPLETING = "completing"


class Agent(BaseModel):
    """Represents a subagent in the office visualization."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    native_id: str | None = None  # Native Claude agent ID (e.g., "a5a60c7")
    name: str | None = None
    color: str
    number: int
    state: AgentState
    desk: int | None = None
    bubble: BubbleContent | None = None
    current_task: str | None = None
    position: dict[str, int] = {"x": 0, "y": 0}
    # Agent Teams character hierarchy (Phase 4)
    activity: Activity | None = None  # set from in-flight tools, see core/activity.py
    stuck: StuckReason | None = None  # failed tool / permission wait until it moves on
    character_type: str | None = None  # "lead" | "teammate" | "subagent"
    agent_type: str | None = None  # subagent type it was started as, e.g. "general-purpose"
    parent_session_id: str | None = None  # session that owns this character
    parent_id: str | None = None  # for subagents: parent lead/teammate id


class Boss(BaseModel):
    """Represents the main Claude agent (boss) in the office visualization."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    state: BossState
    current_task: str | None = None
    bubble: BubbleContent | None = None
    activity: Activity | None = None  # set from in-flight tools, see core/activity.py
    stuck: StuckReason | None = None  # failed tool / permission wait until it moves on
    # True from a user prompt until the turn ends; lets the frontend tell a
    # long think mid-turn (ponder) from an idle session.
    turn_active: bool = False
    position: dict[str, int] = {"x": 640, "y": 830}
