"""codex-office-hook prints nothing and exits 0.

Codex adds a SessionStart or UserPromptSubmit hook's plain stdout to the
model's context and rejects plain text from Stop, so the hook must stay
silent. Events go to the backend over HTTP.
"""

import json
import os
import socket
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest

PRE_TOOL = {
    "session_id": "01a15c90-b93c-71d3-9aae-2b35e749b77d",
    "turn_id": "01a15c90-b980-7860-b101-29557920ffd8",
    "transcript_path": "/tmp/rollout.jsonl",
    "cwd": "/Users/me/work/shop",
    "hook_event_name": "PreToolUse",
    "model": "gpt-5.1-codex-mini",
    "tool_name": "Bash",
    "tool_input": {"command": "sed -n '1,20p' src/auth.py"},
    "tool_use_id": "call_0",
}


@pytest.fixture
def backend() -> Iterator[tuple[str, list[dict[str, Any]]]]:
    """A local stand-in for POST /api/v1/events that records what it receives."""
    received: list[dict[str, Any]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 (http.server naming)
            body = self.rfile.read(int(self.headers["Content-Length"]))
            received.append(json.loads(body))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/api/v1/events", received
    server.shutdown()


def _run(stdin: str, api_url: str, home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "CLAUDE_OFFICE_API_URL": api_url, "HOME": str(home)}
    return subprocess.run(
        [sys.executable, "-m", "claude_office_hooks.codex_main", *args],
        input=stdin,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def test_event_is_posted_and_codex_gets_no_output(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    result = _run(json.dumps(PRE_TOOL), url, tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
    assert [r["event_type"] for r in received] == ["pre_tool_use"]
    assert received[0]["data"]["coding_agent"] == "codex"


def test_a_shell_patch_posts_its_start_and_end(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    patch = "apply_patch <<'P'\n*** Begin Patch\n*** Update File: src/auth.py\n*** End Patch\nP"
    result = _run(json.dumps({**PRE_TOOL, "tool_input": {"command": patch}}), url, tmp_path)

    assert (result.returncode, result.stdout) == (0, "")
    assert [r["event_type"] for r in received] == ["pre_tool_use", "post_tool_use"]


def test_bad_stdin_stays_silent(backend: tuple[str, list[dict[str, Any]]], tmp_path: Path) -> None:
    url, received = backend
    result = _run("{oops", url, tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
    assert received == []


def test_unmapped_event_is_not_posted(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    result = _run(json.dumps({**PRE_TOOL, "hook_event_name": "Interrupt"}), url, tmp_path)

    assert (result.returncode, result.stdout) == (0, "")
    assert received == []


def test_backend_down_stays_silent(tmp_path: Path) -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        closed_port = sock.getsockname()[1]
    result = _run(json.dumps(PRE_TOOL), f"http://127.0.0.1:{closed_port}/x", tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")


def test_version(tmp_path: Path) -> None:
    result = _run("", "http://127.0.0.1:9/x", tmp_path, "--version")

    assert result.returncode == 0
    assert result.stdout.startswith("codex-office-hook ")
