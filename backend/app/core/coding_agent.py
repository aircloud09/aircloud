"""Which coding agent (Claude Code, OpenCode, Gemini CLI, Codex CLI) runs a session.

Producers tag every event with ``coding_agent``. The frontend shows it as the
boss's name tag and in the session list.
"""

from app.models.events import EventDataBase

CLAUDE_CODE = "claude-code"
OPENCODE = "opencode"
GEMINI_CLI = "gemini-cli"
CODEX = "codex"


def coding_agent_of(data: EventDataBase) -> str | None:
    """Return the coding agent an event came from, or None when it does not say.

    OpenCode plugin builds from before ``coding_agent`` existed still tag their
    events with ``source="opencode"``.
    """
    if data.coding_agent:
        return data.coding_agent
    if data.source == OPENCODE:
        return OPENCODE
    return None
