#!/usr/bin/env bash
# Drive the office with the real Gemini CLI and a scripted fake model.
#
# Runs Gemini CLI (pinned, via npx) in a throwaway project with its own HOME,
# so your ~/.gemini settings and login are neither used nor modified. The
# model API is pointed at scripts/fake_gemini_api.py (GOOGLE_GEMINI_BASE_URL),
# which answers with a fixed script: read a file, read a missing file, run a
# failing test for six seconds, then reply. Gemini runs the real tools and
# fires the real hooks; this repo's gemini-office-hook is registered in that
# HOME only, with the same installer `make gemini-hooks-install` uses.
#
# Usage: scripts/gemini_session.sh [--keep]
#   Needs: a running backend (make dev), the hooks venv (make install) and
#   Node 20+. --keep leaves the throwaway folder in place.
#
# Environment:
#   GEMINI_CLI_VERSION  Gemini CLI version (default: 0.64.0)
#   FAKE_GEMINI_THINK   seconds the fake model waits before each answer (default: 3)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_CMD="$REPO_ROOT/hooks/.venv/bin/gemini-office-hook"
VERSION="${GEMINI_CLI_VERSION:-0.64.0}"
THINK="${FAKE_GEMINI_THINK:-3}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

if [[ ! -x "$HOOK_CMD" ]]; then
  echo "Hook command not found at $HOOK_CMD — run 'make install' first." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "npx (Node 20+) is not on PATH." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-office-gemini.XXXXXX")"
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
GEMINI_HOME="$WORK_DIR/home"
mkdir -p "$PROJ/src" "$PROJ/tests" "$GEMINI_HOME/.gemini"
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

# API key auth (the base URL alone would select an auth type -p rejects), no
# folder trust prompt, no telemetry or update checks.
cat >"$GEMINI_HOME/.gemini/settings.json" <<'JSON'
{
  "privacy": {"usageStatisticsEnabled": false},
  "general": {"disableAutoUpdate": true, "disableUpdateNag": true},
  "security": {"auth": {"selectedType": "gemini-api-key"}, "folderTrust": {"enabled": false}}
}
JSON
(cd "$REPO_ROOT/hooks" && uv run --frozen python manage_gemini_hooks.py install \
  --settings "$GEMINI_HOME/.gemini/settings.json" --hook-cmd "$HOOK_CMD") >/dev/null

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 "$REPO_ROOT/scripts/fake_gemini_api.py" "$PORT" "$PROJ" "$THINK" &
FAKE_PID=$!
disown "$FAKE_PID"  # no "Terminated" notice when cleanup stops it
sleep 1

# Keep npm's download cache in the real HOME so the CLI is fetched only once.
NPM_CACHE="${npm_config_cache:-$HOME/.npm}"
cd "$PROJ"
HOME="$GEMINI_HOME" npm_config_cache="$NPM_CACHE" GEMINI_API_KEY=fake-key \
  GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:$PORT" \
  npx --yes "@google/gemini-cli@$VERSION" -p "Why does the auth test fail?" --yolo -m gemini-2.5-flash
