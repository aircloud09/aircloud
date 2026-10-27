"""A scripted fake of the OpenAI Responses API, for driving the real Codex CLI without an account.

Codex asks for one step at a time; each answer depends on how many tool results
the request already carries. The lead agent reads the code, runs the failing
test, hands a search to a subagent and waits for it, patches the file, runs the
test again and replies. A request that carries the subagent's task follows the
subagent's own script instead: search, then report.

usage: python3 fake_codex_api.py <port> [think-seconds]
"""

import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PORT = int(sys.argv[1])
# Seconds the fake model "thinks" before each answer, so the office has time to move.
THINK_SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0

SUBAGENT_TASK = "Find every place that uses SESSION_TIMEOUT."
PATCH = (
    "apply_patch <<'PATCH'\n"
    "*** Begin Patch\n"
    "*** Update File: src/auth.py\n"
    "@@\n"
    "-    return age_seconds > SESSION_TIMEOUT\n"
    "+    return age_seconds >= SESSION_TIMEOUT\n"
    "*** End Patch\n"
    "PATCH"
)
SUBAGENTS = "multi_agent_v1"

LEAD: list[dict[str, Any]] = [
    {"call": "exec_command", "args": {"cmd": "sed -n '1,20p' src/auth.py"}},
    {"call": "exec_command", "args": {"cmd": "sleep 4; python3 tests/test_auth.py"}},
    {"call": "spawn_agent", "namespace": SUBAGENTS, "args": {"message": SUBAGENT_TASK}},
    {
        "call": "wait_agent",
        "namespace": SUBAGENTS,
        "args": {"targets": ["$SPAWNED"], "timeout_ms": 60000},
    },
    {"call": "exec_command", "args": {"cmd": PATCH}},
    {"call": "exec_command", "args": {"cmd": "python3 tests/test_auth.py"}},
    {
        "text": "Fixed: is_expired now uses >= so a 30 second session counts as expired. "
        "The test passes."
    },
]
SUBAGENT: list[dict[str, Any]] = [
    {"call": "exec_command", "args": {"cmd": "grep -rn SESSION_TIMEOUT src tests"}},
    {
        "text": "SESSION_TIMEOUT is used only in src/auth.py, where is_expired compares "
        "with > instead of >=."
    },
]


def _texts(items: list[Any]) -> str:
    """The text a request carries: messages and tool outputs."""
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, list):
            out += [c.get("text", "") for c in content if isinstance(c, dict)]
        elif isinstance(content, str):
            out.append(content)
        if isinstance(item.get("output"), str):
            out.append(item["output"])
    return "\n".join(out)


def _spawned(items: list[Any]) -> str:
    """The id the subagent got when it was spawned."""
    for item in reversed(items):
        output = item.get("output") if isinstance(item, dict) else None
        if isinstance(output, str):
            match = re.search(r'"agent_id":"([^"]+)"', output)
            if match:
                return match.group(1)
    return ""


def _item(step: dict[str, Any], n: int, items: list[Any], thread: str) -> dict[str, Any]:
    if "text" in step:
        return {
            "type": "message",
            "id": f"msg_{n}",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": step["text"], "annotations": []}],
        }
    args = json.dumps(step["args"]).replace("$SPAWNED", _spawned(items))
    item = {
        "type": "function_call",
        "id": f"fc_{thread}_{n}",
        "call_id": f"call_{thread}_{n}",
        "name": step["call"],
        "arguments": args,
        "status": "completed",
    }
    if "namespace" in step:
        item["namespace"] = step["namespace"]
    return item


def _sse(event: dict[str, Any]) -> bytes:
    return f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 (http.server naming)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if not self.path.endswith("/responses"):
            self.send_response(404)
            self.end_headers()
            return
        items: list[Any] = body.get("input", [])
        outputs = sum(
            1 for i in items if isinstance(i, dict) and str(i.get("type", "")).endswith("_output")
        )
        thread = "sub" if SUBAGENT_TASK in _texts(items) else "lead"
        script = SUBAGENT if thread == "sub" else LEAD
        item = _item(script[min(outputs, len(script) - 1)], outputs, items, thread)
        time.sleep(THINK_SECONDS)
        rid = f"resp_{outputs}"
        usage = {
            "input_tokens": 200,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 20,
            "output_tokens_details": {"reasoning_tokens": 0},
            "total_tokens": 220,
        }
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(_sse({"type": "response.created", "response": {"id": rid}}))
        done = {"type": "response.output_item.done", "output_index": 0, "item": item}
        self.wfile.write(_sse(done))
        completed = {"id": rid, "status": "completed", "output": [item], "usage": usage}
        self.wfile.write(_sse({"type": "response.completed", "response": completed}))
        self.wfile.flush()

    def do_GET(self) -> None:  # noqa: N802
        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
