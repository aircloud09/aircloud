"""gemini-office-hook answers Gemini CLI with exactly ``{}`` and exit 0.

Gemini parses the hook's stdout as JSON, so anything else would surface as a
message to the user. The event goes to the backend over HTTP.
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

BEFORE_TOOL = {
    "session_id": "3f8b0a52-6c1e-4a9e-9a43-1f0f6c2b7d10",
    "transcript_path": "/tmp/session.json",
    "cwd": "/Users/me/work/shop",
    "hook_event_name": "BeforeTool",
    "timestamp": "2026-10-20T08:00:00.000Z",
    "tool_name": "read_file",
    "tool_input": {"file_path": "src/auth.py"},
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
        [sys.executable, "-m", "claude_office_hooks.gemini_main", *args],
        input=stdin,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def test_event_is_posted_and_gemini_gets_an_empty_decision(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    result = _run(json.dumps(BEFORE_TOOL), url, tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "{}", "")
    assert len(received) == 1
    assert received[0]["event_type"] == "pre_tool_use"
    assert received[0]["data"]["coding_agent"] == "gemini-cli"


def test_bad_stdin_still_answers_cleanly(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    result = _run("{oops", url, tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "{}", "")
    assert received == []


def test_unregistered_event_is_not_posted(
    backend: tuple[str, list[dict[str, Any]]], tmp_path: Path
) -> None:
    url, received = backend
    result = _run(json.dumps({**BEFORE_TOOL, "hook_event_name": "BeforeModel"}), url, tmp_path)

    assert (result.returncode, result.stdout) == (0, "{}")
    assert received == []


def test_backend_down_still_answers_cleanly(tmp_path: Path) -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        closed_port = sock.getsockname()[1]
    result = _run(json.dumps(BEFORE_TOOL), f"http://127.0.0.1:{closed_port}/x", tmp_path)

    assert (result.returncode, result.stdout, result.stderr) == (0, "{}", "")


def test_version(tmp_path: Path) -> None:
    result = _run("", "http://127.0.0.1:9/x", tmp_path, "--version")

    assert result.returncode == 0
    assert result.stdout.startswith("gemini-office-hook ")
