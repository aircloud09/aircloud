"""Errands scenario: characters walk to the archive and the server room.

Exercises the office rooms (docs/plan/spec.md R1, R2) with a fixed, repeatable
timeline (~70 s):

1. The boss reads three files back to back (one archive trip, no round trips
   between the reads), then greps.
2. The boss runs a slow test command (server room), edits at the desk, runs a
   command that fails, edits again and reruns it.
3. A subagent arrives, reads in the archive, runs a command in the server
   room and reports back.
4. The turn ends.

Every tool event carries a ``tool_use_id`` like the real hooks do.
"""

from __future__ import annotations

import time
from typing import Any

from scripts.scenarios._base import SimulationContext

SUBAGENT_ID = "subagent_errands_1"
# Time the frontend needs to walk a new subagent from the elevator to its desk
SUBAGENT_ARRIVAL_WAIT = 20.0


def _tool(
    ctx: SimulationContext,
    agent_id: str,
    tool_use_id: str,
    tool_name: str,
    tool_input: dict[str, Any],
    duration: float,
    *,
    success: bool = True,
    gap: float = 0.6,
) -> None:
    """Send a pre/post tool pair ``duration`` seconds apart, then pause ``gap``."""
    ctx.send_event(
        "pre_tool_use",
        {
            "tool_name": tool_name,
            "tool_use_id": tool_use_id,
            "tool_input": tool_input,
            "agent_id": agent_id,
        },
    )
    time.sleep(duration)
    post: dict[str, Any] = {
        "tool_name": tool_name,
        "tool_use_id": tool_use_id,
        "tool_input": tool_input,
        "agent_id": agent_id,
        "success": success,
    }
    if not success:
        post["error_type"] = "tool_error"
        post["result_summary"] = "Exit code 1"
    ctx.send_event("post_tool_use", post)
    time.sleep(gap)


def run(ctx: SimulationContext) -> None:
    """Execute the errands scenario against *ctx*.

    Args:
        ctx: Shared simulation context (session_id, token state, etc.).
    """
    ctx.reset(initial_fraction=0.1)
    ctx.log("[errands] Starting errands scenario")

    ctx.send_event("session_start", {"project_name": "Errands"})
    time.sleep(0.5)
    ctx.send_event("user_prompt_submit", {"prompt": "Find why login times out and fix it."})
    time.sleep(1.5)

    # 1. Archive: three reads back to back, then a grep
    ctx.log("[errands] Boss reads in the archive")
    for i, path in enumerate(("src/auth/login.py", "src/auth/session.py", "tests/test_login.py")):
        _tool(ctx, "main", f"tu_read_{i}", "Read", {"file_path": path}, 1.2, gap=0.5)
    _tool(ctx, "main", "tu_grep_0", "Grep", {"pattern": "SESSION_TIMEOUT"}, 1.5, gap=1.0)

    # 2. Server room: slow test run, desk edit, failing run, fix, rerun
    ctx.log("[errands] Boss runs tests in the server room")
    _tool(ctx, "main", "tu_bash_0", "Bash", {"command": "npm test -- login"}, 5.0, gap=1.2)
    _tool(ctx, "main", "tu_edit_0", "Edit", {"file_path": "src/auth/login.py"}, 2.0, gap=1.0)
    _tool(
        ctx,
        "main",
        "tu_bash_1",
        "Bash",
        {"command": "npm test -- login"},
        3.0,
        success=False,
        gap=2.0,
    )
    _tool(ctx, "main", "tu_edit_1", "Edit", {"file_path": "src/auth/session.py"}, 1.5, gap=1.0)
    _tool(ctx, "main", "tu_bash_2", "Bash", {"command": "npm test -- login"}, 3.0, gap=1.5)

    # 3. A subagent runs the same errands
    ctx.log("[errands] Subagent arrives")
    ctx.send_event(
        "subagent_start",
        {
            "agent_id": SUBAGENT_ID,
            "agent_name": "Archivist",
            "task_description": "Check other callers of the session timeout",
        },
    )
    time.sleep(SUBAGENT_ARRIVAL_WAIT)
    ctx.log("[errands] Subagent reads and runs a command")
    _tool(ctx, SUBAGENT_ID, "tu_sub_read_0", "Read", {"file_path": "src/api/auth.py"}, 2.5)
    _tool(ctx, SUBAGENT_ID, "tu_sub_grep_0", "Grep", {"pattern": "timeout"}, 2.0)
    _tool(ctx, SUBAGENT_ID, "tu_sub_bash_0", "Bash", {"command": "rg -n timeout src"}, 3.0)
    ctx.send_event("subagent_stop", {"agent_id": SUBAGENT_ID, "success": True})
    time.sleep(8.0)

    # 4. Turn ends
    ctx.send_event("stop", {})
    ctx.log("[errands] Done.")
