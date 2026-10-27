"""Handler for USER_PROMPT_SUBMIT and STOP events.

Responsibilities:
- Summarising user prompts and storing them on the StateMachine.
- Extracting boss speech from transcripts on STOP.
"""

import asyncio
import logging

from app.core.broadcast_service import broadcast_state
from app.core.jsonl_parser import get_last_assistant_response
from app.core.path_utils import is_safe_transcript_path
from app.core.state_machine import StateMachine
from app.core.summary_service import get_summary_service
from app.models.common import BubbleContent, BubbleType
from app.models.events import LifecycleEvent, PromptEvent

__all__ = [
    "handle_user_prompt_submit",
    "handle_stop",
    "extract_and_set_boss_speech",
    "set_boss_speech",
]

logger = logging.getLogger(__name__)


async def handle_user_prompt_submit(sm: StateMachine, event: PromptEvent) -> None:
    """Handle a USER_PROMPT_SUBMIT event.

    Summarises the user prompt and stores it as the boss's current task.

    Args:
        sm: The StateMachine for this session.
        event: The USER_PROMPT_SUBMIT event.
    """
    if not event.data.prompt:
        return

    summary_service = get_summary_service()
    sm.boss_current_task = await summary_service.summarize_user_prompt(event.data.prompt)
    logger.debug(f"Boss current task set to: {sm.boss_current_task}")

    await broadcast_state(event.session_id, sm)


async def handle_stop(sm: StateMachine, event: LifecycleEvent) -> None:
    """Handle a STOP event.

    Extracts the assistant's last response from the transcript and shows its
    summary as the boss speech bubble.

    Args:
        sm: The StateMachine for this session.
        event: The STOP event.
    """
    logger.info(
        f"STOP event: boss_bubble before extract = "
        f"{sm.boss_bubble.text[:50] if sm.boss_bubble else 'None'}..."
    )

    full_response = await extract_and_set_boss_speech(sm, event.data.transcript_path)
    # Producers whose transcript the backend cannot read (Gemini CLI) send the
    # reply itself as the boss's speech.
    reply = event.data.speech_content.boss if event.data.speech_content else None
    if full_response is None and reply:
        await set_boss_speech(sm, reply)

    logger.info(
        f"STOP event: boss_bubble after extract = "
        f"{sm.boss_bubble.text[:50] if sm.boss_bubble else 'None'}..."
    )

    await broadcast_state(event.session_id, sm)


async def extract_and_set_boss_speech(
    sm: StateMachine,
    transcript_path: str | None,
) -> str | None:
    """Extract Claude's response from a transcript and set the boss speech bubble.

    Args:
        sm: The StateMachine whose boss_bubble should be updated.
        transcript_path: Path to the JSONL transcript file, or None.

    Returns:
        The full response text, or None if unavailable.
    """
    if not transcript_path:
        return None

    from app.config import get_settings  # local import to avoid cycles

    settings = get_settings()
    translated_path = settings.translate_path(transcript_path)

    if not is_safe_transcript_path(translated_path):
        logger.warning(f"Rejected transcript path outside ~/.claude/: {translated_path}")
        return None

    response = await asyncio.to_thread(get_last_assistant_response, translated_path)
    if not response:
        return None

    return await set_boss_speech(sm, response)


async def set_boss_speech(sm: StateMachine, response: str) -> str:
    """Show a summary of the assistant's *response* as the boss speech bubble.

    Returns:
        The full response text.
    """
    summary_service = get_summary_service()
    summary = await summary_service.summarize_response(response)

    if summary:
        sm.boss_bubble = BubbleContent(
            type=BubbleType.SPEECH,
            text=summary,
            icon="💬",
            persistent=True,
        )
        logger.debug(f"Set boss speech: {summary[:50]}...")

    return response
