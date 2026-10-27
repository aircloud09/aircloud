"""Session titles read from Claude Code transcripts (``ai-title`` lines)."""

import json
from pathlib import Path

import pytest

from app.core import transcript_title as module
from app.core.transcript_title import transcript_title


@pytest.fixture
def projects(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A home folder whose ``~/.claude/projects`` holds the test transcripts."""
    monkeypatch.setenv("HOME", str(tmp_path))
    folder = tmp_path / ".claude" / "projects" / "-tmp-demo"
    folder.mkdir(parents=True)
    return folder


def _write(path: Path, *entries: dict[str, object]) -> str:
    path.write_text("".join(json.dumps(e) + "\n" for e in entries), encoding="utf-8")
    return str(path)


def _named(title: str) -> dict[str, object]:
    return {"type": "ai-title", "aiTitle": title, "sessionId": "s"}


def _said(text: str) -> dict[str, object]:
    return {"type": "user", "message": {"role": "user", "content": text}}


def test_the_newest_name_wins(projects: Path) -> None:
    path = _write(
        projects / "a.jsonl",
        _said("/clear"),
        _named("Old name"),
        _said("more work"),
        _named("New name"),
        _said("still going"),
    )
    assert transcript_title(path) == "New name"


def test_no_name_yet(projects: Path) -> None:
    assert transcript_title(_write(projects / "b.jsonl", _said("/clear"))) is None


def test_reads_only_the_tail(projects: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "TAIL_BYTES", 200)
    path = _write(projects / "c.jsonl", _named("Far back"), _said("x" * 400))
    assert transcript_title(path) is None


def test_a_line_cut_by_the_tail_is_not_misread(
    projects: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    last = json.dumps(_said("tail")) + "\n"
    # The tail starts inside the name line, at '"type": "ai-title"}'.
    monkeypatch.setattr(module, "TAIL_BYTES", len(last) + 20)
    path = _write(projects / "d.jsonl", {"aiTitle": "Cut", "type": "ai-title"}, _said("tail"))
    assert transcript_title(path) is None


def test_a_renamed_session_is_read_again(projects: Path) -> None:
    path = projects / "e.jsonl"
    _write(path, _named("First"))
    assert transcript_title(str(path)) == "First"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(_named("Second")) + "\n")
    assert transcript_title(str(path)) == "Second"


def test_only_claude_transcripts_are_read(tmp_path: Path, projects: Path) -> None:
    outside = _write(tmp_path / "elsewhere.jsonl", _named("Not ours"))
    assert transcript_title(outside) is None
    assert transcript_title(str(projects / "missing.jsonl")) is None
