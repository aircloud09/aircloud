#!/usr/bin/env bash
# Drive the office with a real, short Claude Code session.
#
# Creates a throwaway project, writes hook settings that point at this
# repo's hook command, and runs a scripted `claude -p` session in it. The
# hooks are passed with --settings and only project settings are loaded
# (--setting-sources project), so your ~/.claude/settings.json and its hooks
# are neither used nor modified.
#
# The session reads two files (archive), runs a failing command (server
# room, then pondering), and delegates a Grep to a subagent (elevator,
# subagent errand). It uses the haiku model with a spend cap.
#
# Usage: scripts/live_session.sh [--keep]
#   Needs: a running backend (make dev), the hooks venv (make install), and
#   a logged-in `claude` CLI. --keep leaves the throwaway project in place.
#
# Environment:
#   LIVE_SESSION_MODEL   model alias (default: haiku)
#   LIVE_SESSION_BUDGET  max spend in USD (default: 0.5)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_CMD="$REPO_ROOT/hooks/.venv/bin/claude-office-hook"
MODEL="${LIVE_SESSION_MODEL:-haiku}"
BUDGET="${LIVE_SESSION_BUDGET:-0.5}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

if [[ ! -x "$HOOK_CMD" ]]; then
  echo "Hook command not found at $HOOK_CMD — run 'make install' first." >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "The claude CLI is not on PATH." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-office-live.XXXXXX")"
cleanup() {
  if [[ "$KEEP" == 1 ]]; then
    echo "Kept $WORK_DIR"
  else
    rm -rf -- "${WORK_DIR:?}"
  fi
}
trap cleanup EXIT

mkdir -p "$WORK_DIR/proj/src" "$WORK_DIR/proj/tests"
cat >"$WORK_DIR/proj/src/auth.py" <<'PY'
"""Tiny auth module for the agent-office live session."""

SESSION_TIMEOUT = 30  # TODO: read from config


def is_expired(age_seconds: int) -> bool:
    # TODO: the boundary is off by one
    return age_seconds > SESSION_TIMEOUT
PY
cat >"$WORK_DIR/proj/tests/test_auth.py" <<'PY'
import sys

sys.path.insert(0, "src")
from auth import is_expired

assert is_expired(30), "a 30 second old session should be expired"
print("ok")
PY

# Hook settings built by the installer's own config function
(cd "$REPO_ROOT/hooks" && uv run --frozen python - "$HOOK_CMD" "$WORK_DIR/hooks.json") <<'PY'
import json
import sys

import manage_hooks

hook_cmd, out = sys.argv[1], sys.argv[2]
hooks = {t: [manage_hooks.create_hook_config(hook_cmd, t)] for t in manage_hooks.HOOK_TYPES}
with open(out, "w", encoding="utf-8") as f:
    json.dump({"hooks": hooks}, f, indent=2)
PY

PROMPT='This is a scripted test of an office visualizer. Do exactly these steps, one tool call per step, and do not edit any file:
1. Read src/auth.py.
2. Read tests/test_auth.py.
3. Run `python3 tests/test_auth.py` with Bash. It is expected to fail; do not fix it.
4. Launch one subagent with the Agent tool (subagent_type "general-purpose") with these exact instructions: "First run `sleep 10` with Bash. Then Read src/auth.py. Then use Grep to count lines containing TODO under src. Report the count." Wait for it.
5. Reply with one short line summarizing what failed and the TODO count.'

cd "$WORK_DIR/proj"
claude -p "$PROMPT" \
  --model "$MODEL" \
  --setting-sources project \
  --settings "$WORK_DIR/hooks.json" \
  --allowedTools "Read" "Grep" "Glob" "Agent" "Task" \
    "Bash(python3 tests/test_auth.py)" "Bash(sleep 10)" \
  --max-budget-usd "$BUDGET" \
  --output-format json
