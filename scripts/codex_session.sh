#!/usr/bin/env bash
# Drive the office with the real Codex CLI and a scripted fake model.
#
# Runs your installed Codex CLI in a throwaway project with its own CODEX_HOME,
# so your ~/.codex config, login and hooks are neither used nor modified. The
# model API is pointed at scripts/fake_codex_api.py (a "fake" model provider),
# which answers with a fixed script: read the code, run the failing test, hand
# a search to a subagent and wait for it, patch the file, run the test again,
# then reply. Codex runs the real tools and fires the real hooks; this repo's
# codex-office-hook is registered in that CODEX_HOME only, with the same
# installer `make codex-hooks-install` uses. Hooks there are trusted for this
# one run with --dangerously-bypass-hook-trust.
#
# Usage: scripts/codex_session.sh [--keep]
#   Needs: a running backend (make dev), the hooks venv (make install) and the
#   Codex CLI on PATH. --keep leaves the throwaway folder in place.
#
# Environment:
#   CODEX_BIN          Codex CLI to run (default: codex on PATH)
#   FAKE_CODEX_THINK   seconds the fake model waits before each answer (default: 3)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_CMD="$REPO_ROOT/hooks/.venv/bin/codex-office-hook"
CODEX_BIN="${CODEX_BIN:-codex}"
THINK="${FAKE_CODEX_THINK:-3}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

if [[ ! -x "$HOOK_CMD" ]]; then
  echo "Hook command not found at $HOOK_CMD — run 'make install' first." >&2
  exit 1
fi
if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "Codex CLI ($CODEX_BIN) is not on PATH." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-office-codex.XXXXXX")"
FAKE_PID=""
cleanup() {
  [[ -n "$FAKE_PID" ]] && kill "$FAKE_PID" 2>/dev/null || true
  if [[ "$KEEP" == 1 ]]; then
    echo "Kept $WORK_DIR"
  else
    rm -rf -- "${WORK_DIR:?}"
  fi
}
trap cleanup EXIT

PROJ="$WORK_DIR/proj"
CODEX_DIR="$WORK_DIR/codex-home"
mkdir -p "$PROJ/src" "$PROJ/tests" "$CODEX_DIR"
cat >"$PROJ/src/auth.py" <<'PY'
SESSION_TIMEOUT = 30


def is_expired(age_seconds: int) -> bool:
    return age_seconds > SESSION_TIMEOUT
PY
cat >"$PROJ/tests/test_auth.py" <<'PY'
import sys

sys.path.insert(0, "src")
from auth import is_expired

assert is_expired(30), "a 30 second old session should be expired"
print("ok")
PY

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"

# The fake model as the only provider; no approvals or sandbox in the
# throwaway project.
cat >"$CODEX_DIR/config.toml" <<TOML
model = "gpt-5.1-codex-mini"
model_provider = "fake"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.fake]
name = "Fake"
base_url = "http://127.0.0.1:$PORT/v1"
env_key = "FAKE_OPENAI_KEY"
wire_api = "responses"
TOML
(cd "$REPO_ROOT/hooks" && uv run --frozen python manage_codex_hooks.py install \
  --hooks-file "$CODEX_DIR/hooks.json" --hook-cmd "$HOOK_CMD") >/dev/null

python3 "$REPO_ROOT/scripts/fake_codex_api.py" "$PORT" "$THINK" &
FAKE_PID=$!
disown "$FAKE_PID"  # no "Terminated" notice when cleanup stops it
sleep 1

cd "$PROJ"
CODEX_HOME="$CODEX_DIR" FAKE_OPENAI_KEY=fake-key \
  "$CODEX_BIN" exec --dangerously-bypass-hook-trust --skip-git-repo-check \
  "Why does the auth test fail?" </dev/null
