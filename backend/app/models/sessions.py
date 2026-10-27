from datetime import datetime
from typing import TypedDict, cast

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.agents import Agent, Boss
from app.models.common import TodoItem

__all__ = [
    "HistoryEntry",
    "GameState",
]


class HistoryEntry(TypedDict):
    """A single entry in the event history log."""

    id: str
    type: str
    agentId: str
    summary: str
    timestamp: str
    detail: dict[str, object]


class GameState(BaseModel):
    """Complete state of the office visualization for frontend rendering."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    session_id: str
    boss: Boss
    agents: list[Agent]
    last_updated: datetime
    history: list[HistoryEntry] = Field(default_factory=lambda: cast(list[HistoryEntry], []))
    todos: list[TodoItem] = Field(default_factory=lambda: cast(list[TodoItem], []))
    arrival_queue: list[str] = Field(default_factory=lambda: cast(list[str], []))
    departure_queue: list[str] = Field(default_factory=lambda: cast(list[str], []))
    coding_agent: str | None = None
