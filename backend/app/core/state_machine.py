import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

from app.core.activity import (
    SUBAGENT_TOOLS,
    TODO_TOOLS,
    ToolActivityTracker,
    activity_for_call,
    activity_for_tool,
    tool_subject,
)
from app.core.coding_agent import coding_agent_of
from app.core.path_utils import compress_path, compress_paths_in_text, truncate_long_words
from app.core.quotes import get_random_job_completion_quote
from app.core.summary_service import get_summary_service
from app.models.agents import (
    Activity,
    Agent,
    AgentState,
    Boss,
    BossState,
    StuckReason,
)
from app.models.common import BubbleContent, BubbleType, TodoItem, TodoStatus
from app.models.events import (
    AgentEvent,
    AgentEventData,
    AnyEvent,
    EventType,
    LifecycleEvent,
    PromptEvent,
    ToolEvent,
)
from app.models.sessions import GameState, HistoryEntry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _empty_agents() -> dict[str, Agent]:
    return cast(dict[str, Agent], {})


def _empty_str_list() -> list[str]:
    return cast(list[str], [])


def _empty_history_list() -> list[HistoryEntry]:
    return cast(list[HistoryEntry], [])


def _empty_todo_list() -> list[TodoItem]:
    return cast(list[TodoItem], [])


# ---------------------------------------------------------------------------
# Agent resolution (shared by transition and handler modules)
# ---------------------------------------------------------------------------


@dataclass
class ResolvedAgent:
    """Result of agent resolution by ID or native ID."""

    agent_id: str
    agent: Agent
    was_late_linked: bool = False


def resolve_agent_for_stop(
    agents: dict[str, Agent],
    arrival_queue: list[str],
    agent_id: str | None,
    native_agent_id: str | None,
) -> ResolvedAgent | None:
    """Resolve an agent for SUBAGENT_STOP by ID, native ID, or fallback linking.

    Resolution order:
    1. Direct agent_id match (synchronous agents)
    2. Native ID match (agents that received SubagentInfo)
    3. Fallback: link oldest unlinked agent from arrival_queue (missed SubagentInfo)

    The fallback prefers the oldest unlinked agent (FIFO) to handle cases where
    multiple background agents started but SubagentInfo was missed for some.

    Args:
        agents: Dict of agent_id -> Agent
        arrival_queue: List of agent_ids in arrival order
        agent_id: Optional agent_id from event
        native_agent_id: Optional native_agent_id from event

    Returns:
        ResolvedAgent if found, None otherwise
    """
    # 1. Try direct agent_id match
    if agent_id and agent_id in agents:
        return ResolvedAgent(agent_id=agent_id, agent=agents[agent_id])

    if not native_agent_id:
        return None

    # 2. Try native_id match
    for aid, agent in agents.items():
        if agent.native_id == native_agent_id:
            return ResolvedAgent(agent_id=aid, agent=agent)

    # 3. Fallback: link oldest unlinked agent (FIFO from arrival_queue)
    for aid in arrival_queue:
        agent = agents.get(aid)
        if agent and agent.native_id is None:
            agent.native_id = native_agent_id
            logger.info(
                f"Late-linked agent {aid} to native ID {native_agent_id} (SubagentInfo was missed)"
            )
            return ResolvedAgent(agent_id=aid, agent=agent, was_late_linked=True)

    # 4. Last resort: any unlinked agent not in arrival_queue
    for aid, agent in agents.items():
        if agent.native_id is None:
            agent.native_id = native_agent_id
            logger.warning(
                f"Late-linked orphan agent {aid} to native ID {native_agent_id} "
                f"(not in arrival_queue)"
            )
            return ResolvedAgent(agent_id=aid, agent=agent, was_late_linked=True)

    return None


# ---------------------------------------------------------------------------
# Todo parsing -- extracted from StateMachine for single-responsibility.
# ---------------------------------------------------------------------------


def parse_todos_from_event(event: AnyEvent) -> list[TodoItem]:
    """Parse TodoWrite tool input from an event and return a new todo list.

    Args:
        event: A PRE_TOOL_USE event whose ``tool_name`` is ``"TodoWrite"``.

    Returns:
        A list of parsed :class:`TodoItem` objects, or an empty list if the
        event data is missing or malformed.
    """
    if not event.data or not getattr(event.data, "tool_input", None):
        return []

    assert isinstance(event, ToolEvent)
    tool_input = event.data.tool_input
    if not tool_input:
        return []
    todos_data = tool_input.get("todos", [])

    if not isinstance(todos_data, list):
        return []

    new_todos: list[TodoItem] = []
    typed_todos_data: list[Any] = cast(list[Any], todos_data)
    for item in typed_todos_data:
        if not isinstance(item, dict):
            continue

        item_dict: dict[str, Any] = cast(dict[str, Any], item)
        # Gemini CLI's write_todos names the text "description".
        content: str = str(item_dict.get("content") or item_dict.get("description") or "")
        status_str: str = str(item_dict.get("status", "pending"))
        active_form_raw: Any = item_dict.get("activeForm")
        active_form: str | None = str(active_form_raw) if active_form_raw else None

        try:
            status = TodoStatus(status_str)
        except ValueError:
            status = TodoStatus.PENDING

        if content:
            new_todos.append(TodoItem(content=content, status=status, active_form=active_form))

    return new_todos


# ---------------------------------------------------------------------------
# Dispatch table handlers.
# Each handler receives the StateMachine instance and the Event,
# and mutates state in place.  These are plain functions, not methods,
# so the dispatch table can reference them without circular definition issues.
# ---------------------------------------------------------------------------


def _handle_session_start(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle SESSION_START: initialize office state for a new session."""
    sm.boss_state = BossState.IDLE
    sm.turn_active = False


def _handle_pre_tool_use(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle PRE_TOOL_USE: update boss/agent state and process TodoWrite events."""
    assert isinstance(event, ToolEvent)
    tool_name = event.data.tool_name
    name = (tool_name or "").lower()

    if name in TODO_TOOLS:
        parsed = parse_todos_from_event(event)
        if parsed:
            sm.todos = parsed

    if name in SUBAGENT_TOOLS:
        sm.boss_state = BossState.DELEGATING
        sm.set_stuck("main", None)
    else:
        agent_id = sm.tool_character_id(event)

        bubble = sm.tool_to_thought(event)
        if agent_id == "main":
            sm.boss_bubble = bubble
            sm.boss_state = BossState.WORKING
        else:
            if agent_id not in sm.agents and len(sm.agents) < sm.MAX_AGENTS:
                new_agent = sm.create_agent(
                    AgentEventData(
                        agent_id=agent_id,
                        agent_name=f"Ghost {agent_id[-4:]}",
                        task_description="Resumed mid-session",
                    )
                )
                new_agent.state = AgentState.WORKING
                new_agent.native_id = event.data.native_agent_id
                sm.agents[agent_id] = new_agent

            if agent_id in sm.agents:
                sm.agents[agent_id].bubble = bubble
                sm.agents[agent_id].state = AgentState.WORKING
                if agent_id in sm.arrival_queue:
                    sm.arrival_queue.remove(agent_id)

        sm.tool_activity.start(agent_id, tool_name, event.data.tool_use_id, event.data.tool_input)
        sm.sync_activity(agent_id)
        sm.set_stuck(agent_id, None)


def _handle_user_prompt_submit(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle USER_PROMPT_SUBMIT: boss receives a new user prompt."""
    assert isinstance(event, PromptEvent)
    sm.boss_state = BossState.RECEIVING
    sm.tool_activity.clear("main")
    sm.sync_activity("main")
    sm.set_stuck("main", None)
    prompt_text = event.data.prompt
    sm.turn_active = True
    if prompt_text:
        sm.boss_bubble = BubbleContent(
            type=BubbleType.SPEECH,
            text=prompt_text,
            icon="📞",
        )
        sm.boss_current_task = prompt_text


def _handle_permission_request(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle PERMISSION_REQUEST: set boss or agent to waiting state."""
    assert isinstance(event, ToolEvent)
    agent_id = sm.tool_character_id(event)
    tool_name = event.data.tool_name or "permission"

    waiting_bubble = BubbleContent(
        type=BubbleType.THOUGHT,
        text=f"Waiting: {tool_name}",
        icon="❓",
    )

    if agent_id == "main":
        sm.boss_state = BossState.WAITING_PERMISSION
        sm.boss_bubble = waiting_bubble
    else:
        if agent_id in sm.agents:
            sm.agents[agent_id].state = AgentState.WAITING_PERMISSION
            sm.agents[agent_id].bubble = waiting_bubble
    sm.set_stuck(agent_id, StuckReason.WAITING_PERMISSION)


def _handle_post_tool_use(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle POST_TOOL_USE: finish the tool and reset agent state."""
    assert isinstance(event, ToolEvent)
    agent_id = sm.tool_character_id(event)
    sm.tool_activity.finish(agent_id, event.data.tool_name, event.data.tool_use_id)
    sm.sync_activity(agent_id)
    if event.data.success is False:
        # Stuck until the character starts another tool or its turn ends.
        sm.set_stuck(agent_id, StuckReason.TOOL_FAILED)
        failed_bubble = sm.failure_to_thought(event)
        if agent_id == "main":
            sm.boss_bubble = failed_bubble
        elif agent_id in sm.agents:
            sm.agents[agent_id].bubble = failed_bubble
    elif sm.stuck_reason(agent_id) == StuckReason.WAITING_PERMISSION:
        sm.set_stuck(agent_id, None)
    if agent_id == "main":
        sm.boss_state = BossState.IDLE
    elif agent_id in sm.agents and sm.agents[agent_id].state == AgentState.WAITING_PERMISSION:
        sm.agents[agent_id].state = AgentState.WORKING


def _handle_subagent_start(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle SUBAGENT_START: create a new agent and add to arrival queue."""
    assert isinstance(event, AgentEvent)
    if not event.data.agent_id:
        logger.warning(
            f"SUBAGENT_START guard failed: missing agent_id (agent_id={event.data.agent_id})"
        )
        return
    if len(sm.agents) >= sm.MAX_AGENTS:
        logger.warning(
            f"SUBAGENT_START guard failed: MAX_AGENTS reached "
            f"({len(sm.agents)}/{sm.MAX_AGENTS}), agent_id={event.data.agent_id}"
        )
        return
    agent = sm.create_agent(event.data)
    sm.boss_state = BossState.DELEGATING

    if agent.id not in sm.arrival_queue:
        sm.arrival_queue.append(agent.id)

    sm.agents[agent.id] = agent


def _handle_subagent_stop(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle SUBAGENT_STOP: resolve agent and add it to the departure queue."""
    assert isinstance(event, AgentEvent)
    resolved = resolve_agent_for_stop(
        agents=sm.agents,
        arrival_queue=sm.arrival_queue,
        agent_id=event.data.agent_id,
        native_agent_id=event.data.native_agent_id,
    )

    if resolved:
        agent_id = resolved.agent_id
        stopping_agent = resolved.agent
        stopping_agent.state = AgentState.WAITING
        sm.tool_activity.clear(agent_id)
        sm.sync_activity(agent_id)
        sm.set_stuck(agent_id, None)
        if agent_id not in sm.handin_queue:
            sm.handin_queue.append(agent_id)

        sm.boss_state = BossState.IDLE


def _handle_cleanup(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle CLEANUP: remove a departed agent from all state."""
    assert isinstance(event, AgentEvent)
    if event.data.agent_id:
        sm.remove_agent(event.data.agent_id)


def _handle_stop(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle STOP: main agent completes work, show completion message."""
    assert isinstance(event, LifecycleEvent)
    sm.boss_state = BossState.COMPLETING
    sm.turn_active = False
    sm.tool_activity.clear("main")
    sm.sync_activity("main")
    sm.set_stuck("main", None)

    speech_text = (
        event.data.speech_content.boss_phone
        if event.data.speech_content and event.data.speech_content.boss_phone
        else get_random_job_completion_quote()
    )
    sm.boss_bubble = BubbleContent(
        type=BubbleType.SPEECH,
        text=speech_text,
        icon="📞",
        persistent=True,
    )


def _handle_session_end(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle SESSION_END: mark session as ended."""
    sm.boss_state = BossState.IDLE
    sm.boss_current_task = None
    sm.turn_active = False
    sm.tool_activity.clear_all()
    sm.boss_activity = None
    sm.boss_stuck = None
    for agent in sm.agents.values():
        agent.activity = None
        agent.stuck = None


def _handle_teammate_idle(sm: "StateMachine", event: AnyEvent) -> None:
    """Handle TEAMMATE_IDLE: set teammate boss state to idle."""
    sm.boss_state = BossState.IDLE
    sm.boss_bubble = None
    sm.turn_active = False


# ---------------------------------------------------------------------------
# Dispatch table: EventType -> handler callable.
# ---------------------------------------------------------------------------

_DISPATCH_TABLE: dict[EventType, Callable[["StateMachine", AnyEvent], None]] = {
    EventType.SESSION_START: _handle_session_start,
    EventType.PRE_TOOL_USE: _handle_pre_tool_use,
    EventType.USER_PROMPT_SUBMIT: _handle_user_prompt_submit,
    EventType.PERMISSION_REQUEST: _handle_permission_request,
    EventType.POST_TOOL_USE: _handle_post_tool_use,
    EventType.SUBAGENT_START: _handle_subagent_start,
    EventType.SUBAGENT_STOP: _handle_subagent_stop,
    EventType.CLEANUP: _handle_cleanup,
    EventType.STOP: _handle_stop,
    EventType.SESSION_END: _handle_session_end,
    EventType.TEAMMATE_IDLE: _handle_teammate_idle,
}


# ---------------------------------------------------------------------------
# StateMachine
# ---------------------------------------------------------------------------

# Tool-name → thought-bubble icon mapping. Hoisted to module level so the dict
# is built once at import rather than rebuilt on every PRE/POST_TOOL_USE event.
_TOOL_ICONS: dict[str, str] = {
    "Read": "📖",
    "Write": "✍️",
    "Edit": "📝",
    "Bash": "💻",
    "Glob": "🔍",
    "Grep": "🔎",
    "WebSearch": "🌐",
    "WebFetch": "📥",
    "Task": "🎯",
}
# Lookup for any agent's casing (OpenCode sends "read", "bash", ...).
_TOOL_ICONS_LOWER: dict[str, str] = {name.lower(): icon for name, icon in _TOOL_ICONS.items()}
_ACTIVITY_ICONS: dict[Activity, str] = {
    Activity.READING: "📖",
    Activity.RUNNING: "💻",
    Activity.EDITING: "📝",
    Activity.BROWSING: "🌐",
    Activity.PLANNING: "📋",
    Activity.ASKING: "❓",
}


def _tool_icon(tool_name: str, tool_input: dict[str, Any] | None) -> str:
    """Icon for a tool call: by name in any casing, else by the office activity it drives.

    A command that only reads (``cat``, ``sed -n``) shows the reading icon.
    """
    name = tool_name.lower()
    if name in SUBAGENT_TOOLS:
        return "🎯"
    activity = activity_for_call(tool_name, tool_input)
    if activity is Activity.READING and activity_for_tool(tool_name) is Activity.RUNNING:
        return _ACTIVITY_ICONS[Activity.READING]
    icon = _TOOL_ICONS_LOWER.get(name)
    if icon is not None:
        return icon
    return _ACTIVITY_ICONS[activity] if activity is not None else "⚙️"


@dataclass
class StateMachine:
    """Manages office state and processes events to track agents, boss, and office elements.

    State mutation happens exclusively through :meth:`transition`, which
    delegates to a dispatch table of handler functions.  External handler
    modules (in ``app.core.handlers``) perform enrichment, polling, and
    broadcasting but should not set core state fields directly.
    """

    MAX_AGENTS = 8
    # Desk grid row width — keep in sync with frontend/src/constants/positions.ts
    # (DESKS_PER_ROW), where the agent machine lays out desks and queues. Agents
    # get desk numbers 1..N (Agent.desk); the backend itself does not read this.
    DESKS_PER_ROW: int = 4

    boss_state: BossState = BossState.IDLE
    boss_bubble: BubbleContent | None = None
    boss_current_task: str | None = None  # Summarized user prompt
    boss_activity: Activity | None = None  # Mirrors tool_activity for "main"
    boss_stuck: StuckReason | None = None  # Failed tool / permission wait
    agents: dict[str, Agent] = field(default_factory=_empty_agents)
    arrival_queue: list[str] = field(default_factory=_empty_str_list)
    handin_queue: list[str] = field(default_factory=_empty_str_list)
    history: list[HistoryEntry] = field(default_factory=_empty_history_list)
    todos: list[TodoItem] = field(default_factory=_empty_todo_list)
    # True from the moment a user prompt arrives until the turn completes
    # (STOP) or the session ends. Lets the overview treat the brief idle
    # *between* tool calls as "still working" instead of flickering the
    # session into the "done" bucket and back every tool cycle.
    turn_active: bool = False

    # Coding agent running the session (first event that names one wins)
    coding_agent: str | None = None

    # Mapped tools in flight per character ("main" or agent id), which decide
    # where each character walks (archive / server room).
    tool_activity: ToolActivityTracker = field(default_factory=ToolActivityTracker)

    # Wall-clock timestamp of the most recent event routed through ``transition``
    # for this session (ARC-015). Used by ``EventProcessor.evict_idle_sessions``
    # to drop in-memory state that has not seen activity for a while; the DB
    # remains the source of truth, so an evicted session replays on next access.
    # Not part of ``to_game_state`` output — internal eviction metadata only.
    last_event_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    # When the lead agent's latest event happened (the hook's time, as the
    # history line shows it). The overview carries it so the office counts
    # another session's lead from the same moment as when that session is shown.
    lead_event_at: datetime | None = None

    # ---------------------------------------------------------------------------
    # Core methods
    # ---------------------------------------------------------------------------

    def to_game_state(self, session_id: str) -> GameState:
        """Convert current state to a GameState for frontend consumption.

        Builds a complete snapshot including boss, agents, history, todos
        and queues.

        Args:
            session_id: The session identifier to include in the GameState.

        Returns:
            A GameState instance representing the current office state.
        """
        boss = Boss(
            state=self.boss_state,
            current_task=self.boss_current_task,
            bubble=self.boss_bubble,
            activity=self.boss_activity,
            stuck=self.boss_stuck,
            turn_active=self.turn_active,
        )

        agents_list: list[Agent] = list(self.agents.values())

        return GameState(
            session_id=session_id,
            boss=boss,
            agents=agents_list,
            last_updated=datetime.now(UTC),
            history=self.history,
            todos=self.todos,
            arrival_queue=self.arrival_queue.copy(),
            departure_queue=self.handin_queue.copy(),
            coding_agent=self.coding_agent,
        )

    def remove_agent(self, agent_id: str) -> None:
        """Remove an agent from the office and all queues.

        Deletes the agent from the agents dict, arrival queue, and
        handin (departure) queue.

        Args:
            agent_id: The identifier of the agent to remove.
        """
        if agent_id in self.agents:
            del self.agents[agent_id]
        if agent_id in self.arrival_queue:
            self.arrival_queue.remove(agent_id)
        if agent_id in self.handin_queue:
            self.handin_queue.remove(agent_id)
        self.tool_activity.clear(agent_id)

    def transition(self, event: AnyEvent) -> None:
        """Process an event and update state accordingly.

        Uses a dispatch table mapping :class:`EventType` to a handler
        callable instead of an if/elif chain.

        If the handler raises an exception, a warning is logged but the
        event is not silently swallowed.  State may be partially updated;
        callers that need full rollback should wrap this in a higher-level
        transaction.
        """
        if self.coding_agent is None:
            self.coding_agent = coding_agent_of(event.data)

        handler = _DISPATCH_TABLE.get(event.event_type)
        if handler is not None:
            try:
                handler(self, event)
            except Exception:
                logger.warning(
                    "Handler for %s raised an exception; state may be partially updated",
                    event.event_type,
                    exc_info=True,
                )
                raise

    def tool_character_id(self, event: ToolEvent) -> str:
        """Which character a tool event belongs to: ``"main"`` or an agent id.

        Producers that know the office agent id send it as ``agent_id``. Claude
        Code tool calls made inside a subagent only carry the subagent's
        native id (forwarded by the hook as ``native_agent_id``). It resolves
        like a SUBAGENT_STOP: the agent linked to that native id, else the
        oldest agent still waiting for its SUBAGENT_INFO link (late-linked
        here), else ``subagent_<native id>`` — the PRE_TOOL_USE handler then
        creates that one as a ghost agent.
        """
        if event.data.agent_id:
            return event.data.agent_id
        native_id = event.data.native_agent_id
        if not native_id:
            return "main"
        resolved = resolve_agent_for_stop(
            agents=self.agents,
            arrival_queue=self.arrival_queue,
            agent_id=None,
            native_agent_id=native_id,
        )
        return resolved.agent_id if resolved else f"subagent_{native_id}"

    def sync_activity(self, character_id: str) -> None:
        """Copy a character's current activity onto the boss or its agent."""
        activity = self.tool_activity.current(character_id)
        if character_id == "main":
            self.boss_activity = activity
        elif character_id in self.agents:
            self.agents[character_id].activity = activity

    def stuck_reason(self, character_id: str) -> StuckReason | None:
        """Why the boss or an agent is stuck, if it is."""
        if character_id == "main":
            return self.boss_stuck
        agent = self.agents.get(character_id)
        return agent.stuck if agent else None

    def set_stuck(self, character_id: str, reason: StuckReason | None) -> None:
        """Mark the boss or an agent stuck (or clear it with ``None``)."""
        if character_id == "main":
            self.boss_stuck = reason
        elif character_id in self.agents:
            self.agents[character_id].stuck = reason

    def failure_to_thought(self, event: ToolEvent) -> BubbleContent:
        """Thought bubble for a failed tool: the tool name and first error line."""
        tool_name = event.data.tool_name or "Tool"
        summary = event.data.result_summary
        text = f"{tool_name} failed: {summary}" if summary else f"{tool_name} failed"
        text = truncate_long_words(compress_paths_in_text(text), max_len=35)
        return BubbleContent(type=BubbleType.THOUGHT, text=text, icon="❗")

    def tool_to_thought(self, event: ToolEvent) -> BubbleContent:
        """Convert a tool use event to thought bubble content.

        Maps tool names to icons and extracts relevant context (file paths,
        command snippets) for display in character thought bubbles.

        Args:
            event: A PRE_TOOL_USE or POST_TOOL_USE event.

        Returns:
            A BubbleContent with type THOUGHT, a short description, and an icon.
        """
        tool_name = event.data.tool_name or ""
        icon = _tool_icon(tool_name, event.data.tool_input)
        subject = tool_subject(tool_name, event.data.tool_input)

        text: str = tool_name

        if tool_name.lower() in SUBAGENT_TOOLS:
            text = "Delegating..."

        elif subject is not None and subject.kind == "command":
            cmd_clean = subject.value.strip().split("\n")[0]
            cmd_clean = compress_paths_in_text(cmd_clean)
            if len(cmd_clean) > 45:
                cmd_clean = cmd_clean[:42] + "..."
            text = cmd_clean

        elif subject is not None and subject.kind == "path":
            text = compress_path(subject.value, max_len=35)

        elif subject is not None:
            text = subject.value if len(subject.value) <= 35 else subject.value[:32] + "..."

        text = compress_paths_in_text(text)
        text = truncate_long_words(text, max_len=35)

        return BubbleContent(type=BubbleType.THOUGHT, text=text, icon=icon)

    def create_agent(self, data: AgentEventData) -> Agent:
        """Create a new agent from event data.

        Assigns a color from the palette, generates a short name via the
        summary service, and sets initial state to ARRIVING.

        Args:
            data: AgentEventData containing agent_id, agent_name, and
                task_description fields.

        Returns:
            A new Agent instance ready to be added to the office.
        """
        agent_id = data.agent_id or "unknown"
        count = len(self.agents) + 1
        colors = [
            "#3B82F6",
            "#22C55E",
            "#A855F7",
            "#F97316",
            "#EC4899",
            "#06B6D4",
            "#EAB308",
            "#EF4444",
        ]
        color = colors[(count - 1) % len(colors)]

        # Generate short name from description using fallback
        name_source = data.agent_name or data.task_description or ""
        summary_service = get_summary_service()
        existing_names = {a.name for a in self.agents.values() if a.name}
        short_name = summary_service.generate_agent_name_fallback(
            name_source, existing_names, agent_type=data.agent_type
        )

        task = data.task_description or data.agent_name or None

        return Agent(
            id=agent_id,
            name=short_name,
            color=color,
            number=count,
            state=AgentState.ARRIVING,
            desk=count,
            bubble=None,
            current_task=task,
            agent_type=data.agent_type,
        )
