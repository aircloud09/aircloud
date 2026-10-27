"""The title Claude Code gives a session, read from its transcript.

Claude Code writes ``{"type": "ai-title", "aiTitle": ...}`` lines into a
session's transcript and keeps writing them as the conversation goes on, so the
newest one sits near the end of the file. Transcripts run to many megabytes:
only the tail is read, and a title is reused until the file grows.
"""

from __future__ import annotations

import json
import os
from typing import Any, cast

from app.core.path_utils import is_safe_transcript_path

# On live transcripts the newest ai-title line sat within the last 30KB; a
# quarter megabyte leaves room for a long tool result written after it.
TAIL_BYTES = 256 * 1024

# Transcript path -> (its size when read, the title found).
_titles: dict[str, tuple[int, str | None]] = {}


def transcript_title(path: str) -> str | None:
    """Claude Code's newest ``ai-title`` in the transcript at *path*, or None."""
    if not is_safe_transcript_path(path):
        return None
    try:
        size = os.path.getsize(path)
    except OSError:
        return None
    cached = _titles.get(path)
    if cached is not None and cached[0] == size:
        return cached[1]
    title = _tail_title(path, size)
    _titles[path] = (size, title)
    return title


def transcript_titles(paths: dict[str, str]) -> dict[str, str]:
    """Titles for ``{session_id: transcript_path}``, leaving out the untitled."""
    titles: dict[str, str] = {}
    for session_id, path in paths.items():
        title = transcript_title(path)
        if title:
            titles[session_id] = title
    return titles


def _tail_title(path: str, size: int) -> str | None:
    try:
        with open(path, "rb") as f:
            f.seek(max(0, size - TAIL_BYTES))
            tail = f.read(TAIL_BYTES)
    except OSError:
        return None
    for line in reversed(tail.splitlines()):
        if b"ai-title" not in line:
            continue
        try:
            entry: Any = json.loads(line)
        except ValueError:
            continue  # the tail's first line may start mid-entry
        if not isinstance(entry, dict):
            continue
        fields = cast(dict[str, Any], entry)
        title = fields.get("aiTitle")
        if fields.get("type") == "ai-title" and isinstance(title, str) and title.strip():
            return title
    return None
