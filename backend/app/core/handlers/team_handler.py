"""Team event handlers for TASK_CREATED, TASK_COMPLETED, and TEAMMATE_IDLE.

These events are fired by Claude Code Agent Teams when
``CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`` is enabled.  The state machine
handles ``teammate_idle`` (boss idle) in ``state_machine.py``; the task events
only reach the event log. This module only logs them.
"""

import logging

from app.core.state_machine import StateMachine
from app.models.events import LifecycleEvent, TaskEvent

logger = logging.getLogger(__name__)


async def handle_task_created(sm: StateMachine, event: TaskEvent) -> None:
    """Handle a ``task_created`` team event.

    The event is recorded in the session history. This handler logs it.

    Args:
        sm: The session's state machine (already transitioned).
        event: The task_created event.
    """
    task_id = event.data.task_id
    task_subject = event.data.task_subject
    logger.info(f"Task created: id={task_id} subject={task_subject} session={event.session_id}")


async def handle_task_completed(sm: StateMachine, event: TaskEvent) -> None:
    """Handle a ``task_completed`` team event.

    The event is recorded in the session history. This handler logs it.

    Args:
        sm: The session's state machine (already transitioned).
        event: The task_completed event.
    """
    task_id = event.data.task_id
    task_subject = event.data.task_subject
    logger.info(f"Task completed: id={task_id} subject={task_subject} session={event.session_id}")


async def handle_teammate_idle(sm: StateMachine, event: LifecycleEvent) -> None:
    """Handle a ``teammate_idle`` team event.

    The state machine has already set boss to IDLE and cleared the bubble
    via ``StateMachine.transition()``.  This handler logs the idle state.

    Args:
        sm: The session's state machine (already transitioned).
        event: The teammate_idle event.
    """
    teammate_name = event.data.teammate_name
    logger.info(f"Teammate idle: name={teammate_name} session={event.session_id}")
