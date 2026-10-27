"""API routes that connect coding agents to the office from the browser.

``POST`` runs a command on this computer and rewrites an agent's settings file,
so ``ApiKeyMiddleware`` lets it through only from the office page itself (by its
Origin) or with the launch token.
"""

import shutil

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.agent_hooks import (
    AGENT_HOOKS,
    AgentHook,
    HookAction,
    HookRunBusyError,
    connected_events,
    display_path,
    hook_tool_found,
    run_hook_action,
    unavailable_reason,
)

router = APIRouter(prefix="/hooks", tags=["hooks"])


class AgentHookStatus(BaseModel):
    """Whether one coding agent sends its events to the office."""

    agent: str
    connected: bool
    # Events whose hooks run the office hook.
    events: list[str]
    # The hook tool the settings run is installed.
    tool_found: bool
    # The agent's own command, and whether it is on this computer.
    cli: str
    cli_found: bool
    settings_path: str


class AgentHooksOverview(BaseModel):
    """Every agent the office can connect, and whether this backend can do it."""

    available: bool
    # not_local | no_repo | no_make | no_uv, when not available.
    reason: str | None = None
    agents: list[AgentHookStatus]


class AgentHookRun(BaseModel):
    """What connecting or disconnecting an agent did."""

    ok: bool
    command: str
    output: str
    status: AgentHookStatus


def _status(hook: AgentHook) -> AgentHookStatus:
    events = connected_events(hook)
    return AgentHookStatus(
        agent=hook.agent,
        connected=bool(events),
        events=events,
        tool_found=hook_tool_found(hook.hook_command),
        cli=hook.cli,
        cli_found=shutil.which(hook.cli) is not None,
        settings_path=display_path(hook.settings_path()),
    )


@router.get("")
async def list_agent_hooks() -> AgentHooksOverview:
    """Which coding agents are connected to the office."""
    reason = unavailable_reason()
    return AgentHooksOverview(
        available=reason is None,
        reason=reason,
        agents=[_status(hook) for hook in AGENT_HOOKS.values()],
    )


@router.post("/{agent}/{action}")
async def run_agent_hook(agent: str, action: HookAction) -> AgentHookRun:
    """Connect (``install``) or disconnect (``remove``) one coding agent."""
    hook = AGENT_HOOKS.get(agent)
    if hook is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent}")
    reason = unavailable_reason()
    if reason is not None:
        raise HTTPException(status_code=409, detail=reason)
    try:
        ok, command, output = await run_hook_action(hook, action)
    except HookRunBusyError as e:
        raise HTTPException(status_code=409, detail="busy") from e
    return AgentHookRun(ok=ok, command=command, output=output, status=_status(hook))
