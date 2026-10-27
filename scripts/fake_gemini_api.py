"""A scripted fake of the Gemini API, for driving the real Gemini CLI without an account.

Each streamGenerateContent answer depends on how many tool results the request
carries: read a file, read a missing file, run a failing test that takes six
seconds, then reply. JSON side requests get a generic answer.

usage: python3 fake_gemini_api.py <port> <project-dir> [think-seconds]
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PORT = int(sys.argv[1])
PROJECT = sys.argv[2]
# Seconds the fake model "thinks" before each answer, so the office has time to move.
THINK_SECONDS = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

SCRIPT: list[dict[str, Any]] = [
    {"functionCall": {"name": "read_file", "args": {"file_path": f"{PROJECT}/src/auth.py"}}},
    {"functionCall": {"name": "read_file", "args": {"file_path": f"{PROJECT}/src/session.py"}}},
    {
        "functionCall": {
            "name": "run_shell_command",
            "args": {
                "command": "sleep 6; python3 tests/test_auth.py",
                "description": "Run the auth test",
            },
        }
    },
    {
        "text": "The auth test fails because is_expired uses > instead of >=. "
        "Changing it to >= fixes the boundary."
    },
]


def chunk(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """One GenerateContentResponse holding *parts*."""
    return {
        "candidates": [
            {"content": {"role": "model", "parts": parts}, "finishReason": "STOP", "index": 0}
        ],
        "usageMetadata": {
            "promptTokenCount": 120,
            "candidatesTokenCount": 12,
            "totalTokenCount": 132,
        },
        "modelVersion": "gemini-2.5-flash",
    }


def next_parts(body: dict[str, Any]) -> list[dict[str, Any]]:
    """The scripted answer after as many tool results as the request carries."""
    done = sum(
        1
        for content in body.get("contents", [])
        for part in content.get("parts", [])
        if "functionResponse" in part
    )
    return [SCRIPT[min(done, len(SCRIPT) - 1)]]


class Handler(BaseHTTPRequestHandler):
    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802 (http.server naming)
        body = self._body()
        if ":streamGenerateContent" in self.path:
            time.sleep(THINK_SECONDS)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(f"data: {json.dumps(chunk(next_parts(body)))}\n\n".encode())
            self.wfile.flush()
        elif ":generateContent" in self.path:
            config = body.get("generationConfig", {})
            if config.get("responseMimeType") == "application/json":
                text = json.dumps({"next_speaker": "user", "reasoning": "The task is done."})
            else:
                text = "ok"
            self._json(chunk([{"text": text}]))
        elif ":countTokens" in self.path:
            self._json({"totalTokens": 120})
        else:
            self._json({"error": {"code": 404, "message": "not faked"}}, 404)

    def do_GET(self) -> None:  # noqa: N802
        self._json({"error": {"code": 404, "message": "not faked"}}, 404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
