# Claude Office Visualizer

![CI](https://github.com/paulrobello/claude-office/actions/workflows/ci.yml/badge.svg)
![GitHub Release](https://img.shields.io/github/v/release/paulrobello/claude-office)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![GitHub](https://img.shields.io/badge/github-paulrobello%2Fclaude--office-blue?logo=github)
![Runs on Linux | MacOS | Windows](https://img.shields.io/badge/runs%20on-Linux%20%7C%20MacOS%20%7C%20Windows-blue)

[![Watch the demo](https://img.shields.io/badge/YouTube-Demo-red?logo=youtube)](https://youtu.be/AM2UjKYB8Ew)

> **포크 안내 (heejunKIM01/agent-office)** — [paulrobello/claude-office](https://github.com/paulrobello/claude-office) 의 포크다. 코딩 에이전트의 일을 밝은 등각 사무실로 보여 준다. 파일을 읽으면 자료실로, 명령을 돌리면 서버실로, 계획을 세우면 회의실 화이트보드로 가고, 물어볼 게 생기면 내 자리까지 찾아온다. 서브에이전트는 엘리베이터로 출퇴근한다. Claude Code 에만 묶이지 않게 OpenCode · Gemini CLI · Codex CLI 도 같은 사무실에 띄우는 것이 목표다. 무엇을 왜 만드는지는 [근거 문서](docs/plan/spec.md), 진행 상황은 [작업 분할](docs/plan/work-breakdown.md)에 있다.

## 이 포크 실행하기

![등각 사무실 — 층별 안내 · 방 일곱 곳 · 사무실 사람들 · 활동 로그](docs/reports/img/20-iso-default.png)

| 에이전트가 하는 일 | 사무실에서 보이는 것 |
|---|---|
| 파일 읽기 · 검색 (`Read` · `Grep` · `Glob` …) | 📚 자료실 책장 앞에서 책을 편다 |
| 코드 작성 · 수정 (`Edit` · `Write` …) | 💻 개발실 자기 자리 아이맥에 코드가 흐른다 |
| 명령 실행 · git (`Bash` …) | 🗄️ 서버실 랙 앞에 선다. 랙 불빛이 빨라진다 |
| 웹 · 외부 도구 (`WebFetch` · `WebSearch` · MCP) | 🌐 정보검색실 키오스크 앞에 선다 |
| 계획 · 할 일 · 스킬 (`TodoWrite` · 플랜 모드 · `Skill`) | 🗒️ 회의실 화이트보드에 적는다 |
| 질문 · 권한 대기 (`AskUserQuestion`) | 🧑‍💻 내 자리(안내 데스크)까지 찾아온다 |
| 서브에이전트 (`Task`) | Claude 가 전화를 걸면 🛗 엘리베이터로 출근한다. 끝나면 Claude 옆에서 보고하고 「👋 퇴근합니다!」 하고 돌아간다. Explore 는 초록 옷에 모자, Plan 은 보라 옷에 안경 |
| 생각 · 실패 | 「💭 고민 중」 구름 말풍선. 도구가 실패하면 그 자리에서 식은땀을 흘리며 빨간 말풍선을 띄운다 |

왼쪽 「층별 안내」는 프로젝트를 층으로, 세션을 매장으로 보여 준다. 다른 층을 누르면 「▲ 3F」 표시등이 뜨고 그 층 사무실로 간다. 오른쪽에는 「사무실」(지금 일하는 사람들) · 활동 로그 · 「사무실 안내도」(방마다 하는 일)가 있다. 원본의 2D 픽셀 사무실(화이트보드 · 지휘 센터 · 빌딩 뷰)은 이 포크에서 지웠다.

```bash
git clone https://github.com/heejunKIM01/agent-office.git
cd agent-office
make install     # uv · bun(또는 npm) 필요. Python 3.13 은 uv 가 받는다
make dev         # 백엔드 :8000 + 프런트 :4747
```

브라우저로 <http://localhost:4747> 을 연다. 이벤트를 넣는 방법은 넷이다.

1. **실제 Claude Code 에 연결** — 브라우저에서 한다: ⚙ 설정 → 「연결」 탭에서 「연결」을 누른다(빈 사무실의 「에이전트 연결」 버튼도 그 탭을 연다). 버튼은 아래 명령을 대신 실행한다. 백엔드는 이 화면(4747)에서 온 요청만 실행 토큰 없이 받는다. 터미널에서는 `make hooks-install` 이 `~/.claude/settings.json` 에 훅을 등록한다. 원본에서 이미 설치했다면 `make hooks-reinstall` 로 다시 설치해야 실패 훅(`PostToolUseFailure`)이 들어간다.
2. **Gemini CLI · Codex CLI · OpenCode 에 연결** — Gemini CLI · Codex CLI 도 같은 「연결」 탭에서 연결한다. 터미널에서는 `make gemini-hooks-install` 이 `~/.gemini/settings.json` 에, `make codex-hooks-install` 이 `~/.codex/hooks.json` 에 훅을 넣는다(다른 도구의 훅은 그대로 둔다). Codex 는 새 훅을 `/hooks` 에서 신뢰해야 돌린다([훅 README](hooks/README.md#codex-cli)). OpenCode 는 원본의 `make opencode-install`.
3. **전역 설정을 건드리지 않고 한 번 돌려 보기** — `scripts/live_session.sh` 가 임시 프로젝트에서 짧은 Claude Code 세션(haiku, 지출 상한 $0.5)을 돌린다. 훅은 그 세션에만 걸린다. Gemini CLI 는 `scripts/gemini_session.sh`, Codex CLI 는 `scripts/codex_session.sh` 가 계정 없이 가짜 모델로 진짜 CLI 를 돌린다.
4. **시뮬레이터** — `uv run python scripts/simulate_events.py errands` 가 같은 장면을 가짜 이벤트로 재생한다.

백엔드는 기본으로 이벤트마다 요약을 만들려고 `claude -p` 를 부른다. 사용량을 아끼려면 `SUMMARY_BACKEND=disabled make dev` 로 띄운다.

## Table of Contents

* [About](#about)
* [What's New](#whats-new)
* [Features](#features)
* [Quick Start](#quick-start)
* [Prerequisites](#prerequisites)
* [Installation](#installation)
* [Development](#development)
* [Project Structure](#project-structure)
* [Troubleshooting](#troubleshooting)
* [Contributing](#contributing)
* [Related Documentation](#related-documentation)

## About

Claude Office Visualizer is a real-time office simulation that visualizes Claude Code operations. Watch as a "boss" character (main Claude agent) manages work, spawns "employee" agents (subagents), and orchestrates tasks in an animated office environment.

The application was built with [Next.js](https://nextjs.org/), [three.js](https://threejs.org/), [FastAPI](https://fastapi.tiangolo.com/), and [Zustand](https://github.com/pmndrs/zustand).

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/probello3)

## What's New

### v0.25.0 (October 2026)

- **Docker deployment works end to end** — the compose stack now serves the UI at [http://localhost:8050](http://localhost:8050) with no port configuration: the frontend derives its API/WebSocket origin from the page itself, transcript path translation defaults on, and `make docker-config` points the hooks and the OpenCode plugin at :8050. Thanks [@tcsenpai](https://github.com/tcsenpai) ([PR #61](https://github.com/paulrobello/claude-office/pull/61)).
- **Session recovery**: sessions opened before the backend (or after a database wipe) now appear automatically on their next event, without resetting a live session's office state. Child OpenCode @agent sessions stay excluded.
- **New `LOCALHOST_ONLY` setting** (default on; compose disables it in Docker where the loopback boundary is the host port binding) and a full dependency refresh across all five projects. TypeScript stays held at ^6.0.3 and frontend ESLint at 9.x.

### v0.24.1 (July 2026)

- **Bug fix — API URL env vars now respected everywhere.** The floor-config hook (`useFloorConfig.ts`) and the simulation scripts (`scripts/scenarios/_base.py`) hardcoded `http://localhost:8000`, so they silently broke when the backend ran on another port (e.g. 8000 was already in use). They now read `NEXT_PUBLIC_API_URL` and `CLAUDE_OFFICE_API_URL` like the rest of the stack; standard-port defaults are unchanged. Thanks [@rasulboliev](https://github.com/rasulboliev) ([PR #55](https://github.com/paulrobello/claude-office/pull/55)).

### v0.24.0 (July 2026)

- **⚠ Breaking — OpenCode plugin remote backend is now opt-in**: a non-localhost `CLAUDE_OFFICE_API_URL` is clamped to the local default unless `CLAUDE_OFFICE_ALLOW_REMOTE=1` is set (matching the Claude Code hooks; event payloads carry tool I/O and file paths). **If you point the plugin at a remote server, set `CLAUDE_OFFICE_ALLOW_REMOTE=1` or events silently post to localhost.**
- **Pluggable summary backend**: summaries now come from `SUMMARY_BACKEND` = `claude-cli` (default), any `openai`-compatible endpoint, or `disabled` — `CLAUDE_CODE_OAUTH_TOKEN` no longer required.
- **Performance & architecture**: per-frame agent writes batched into one store update per tick (header/sidebar/modals stop re-rendering at 60fps during movement); `gameStore` split into 9 Zustand slices; single-writer agent-state ownership retires the 3-second "stuck boss" watchdog. 67 of 69 audit findings resolved.

### v0.23.0 (July 2026)

- **Audit remediation (60 findings)**: Full security hardening (API key no longer disclosed over HTTP — delivered via `?token=` launch URL, `focus`/clipboard gated behind the key, git invocation hardening against hostile repos, Docker bound to loopback), a real CI workflow running `make checkall` across all four components, and the entire backend structural chain consolidated (single event-dispatch table, `ConnectionManager` moved to the domain layer with functional DI seams, `EventData` discriminated union, `BasePoller` framework, `main.py` split into middleware/migrate/websockets, bounded growth with idle eviction + replay pagination). +489 tests. See `CHANGELOG.md` and `AUDIT-REMEDIATION.md`
- **Code quality & docs**: 76 frontend characterization tests, `useWebSocketEvents` decomposed into pure transport + domain modules, the OpenCode plugin's session-tracking extracted into a tested `SessionTracker` with real ESLint, atomic `gameStore` dequeue, named constants, a fail-safe hooks installer that preserves user edits, `VERSION`/`__version__` derived via `importlib.metadata`, and `make bump-version` automation. API authentication, the `SERVE_STATIC` gate, Command Center architecture, and complete env-var tables documented

### v0.22.0 (June 2026)

- **Schedule editor cron helpers**: New pure `src/utils/cron.ts` utilities that round-trip between a friendly schedule editor and 5-field cron expressions (`timesToCron`, `intervalToCron`, `cronToEditor`)
- **Bug fixes**: Attention toast dismiss glyph rendered as raw source text instead of ✕ (#54), a Windows hook crash caused by a conflicting system OpenSSL, and dropped proxy/redirect support for remote `http://` backends (#53)

### v0.21.0 (June 2026)

- **Dependency refresh**: All packages across backend, frontend, hooks, and the OpenCode plugin bumped to latest (FastAPI 0.137, Starlette 1.3, Next 16.2.9, React 19.2.7, pixi.js 8.19, and tooling) — supersedes dependabot PRs #47/#50
- **Bug fixes**: Command Center exit-loop (#49), a Starlette 1.3 type-check regression (added `httpx2`), and a latent hooks logging bug

### v0.20.0 (June 2026)

- **Command Center**: New cross-terminal overview that gathers the boss (main agent) of every live session into a single pixel office — see at a glance what's finished, still running, or needs your attention. Reachable from the header (when ≥2 sessions are active) or the Building view's penthouse tile
- **Scrollable Building View**: The building cross-section now scrolls when the floor list is taller than the viewport
- **Full-system QA + security hardening**: 41 bug fixes (including a polling deadlock, a Docker blank-page fix, and a CORS preflight fix) plus per-session authorization guards and event-payload validation

### v0.15.0 (May 2026)

- **Multi-Floor Building Navigation**: Browse a multi-story building with floor-level views, each with its own office layout and agents
- **Settings Overhaul**: New building configuration and consolidated general settings tabs
- **Kanban Whiteboard Mode**: 12th whiteboard mode showing task workflow in columns

Special thanks to [@mjcadile](https://github.com/mjcadile) ([PR #20](https://github.com/paulrobello/claude-office/pull/20)) for the multi-floor building navigation, floor/room routing, and live session counts that power this release.

### v0.14.0 (April 2026)

- **Pluralization Support (i18n)**: Count-based translations now correctly display singular/plural forms (e.g., "1 event" vs "5 events") in all supported languages
- **Star History Chart**: Repository growth visualization added to README

For the full release history, see [CHANGELOG.md](CHANGELOG.md).

## Features

### Core Capabilities
- **Real-time Visualization**: Watch Claude Code operations as they happen in an animated office
- **Boss & Employee Agents**: Main Claude agent as boss, subagents as employees
- **Visual State Indicators**: Working, delegating, waiting states clearly displayed
- **Thought/Speech Bubbles**: See agent activities and communications

### Advanced Features
- **User Preferences**: Settings persist across sessions via backend database
- **Random Quotes**: Agents display random acceptance/completion quotes when receiving or turning in work

### Technical Excellence
- **WebSocket Architecture**: Real-time state updates from backend to frontend
- **Extensible Design**: Easy to add new visualizations and features
- **Cross-Platform**: Runs on Windows, macOS, and Linux


## Quick Start

For the fastest setup, see the [Quick Start Guide](docs/guides/quickstart.md).

```bash
git clone https://github.com/paulrobello/claude-office.git
cd claude-office
make install-all
make dev-tmux
```

Then open [http://localhost:4747](http://localhost:4747) and run any Claude Code command to see it visualized.

## Prerequisites

- Python 3.13+
- Node.js 20+ (Bun auto-detected if available)
- uv (Python package manager)
- Claude Code CLI installed and configured, **or** [OpenCode](https://opencode.ai) with Bun

## Installation

### Quick Start

```bash
# Clone the repository
git clone https://github.com/paulrobello/claude-office.git
cd claude-office

# Install all components (backend, frontend, hooks)
make install-all
```

### Manual Installation

```bash
# Install backend dependencies
cd backend && uv sync && cd ..

# Install frontend dependencies
cd frontend && bun install && cd ..

# Install hooks into Claude Code
make hooks-install
```

### Enable AI Enhancements (Optional)

For AI-powered features like agent name generation and task summaries, create a `.env` file in the `backend/` folder with your Claude Code OAuth token:

```bash
# Set up a long-lived authentication token (requires Claude subscription)
# This will prompt you to authenticate and display your token
claude setup-token

# Create the .env file with the token
echo "CLAUDE_CODE_OAUTH_TOKEN=your-token-here" > backend/.env
```

Without this token, the visualizer works fully but displays raw agent IDs instead of friendly generated names, and tool names instead of summarized tasks. The frontend displays AI status in the top right corner so you can verify if it's properly configured.

## Development

### Starting the Development Servers

**Recommended: Using tmux**

```bash
make dev-tmux
```

Navigate between windows with `Ctrl-b n` (next) and `Ctrl-b p` (previous).

**Alternative: Basic parallel mode**

```bash
make dev
```

### Available Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start backend and frontend in parallel |
| `make dev-tmux` | Start in tmux with separate windows (recommended) |
| `make dev-tmux-kill` | Kill the tmux session |
| `make checkall` | Run format, lint, typecheck, and tests |
| `make test` | Run all test suites without the other checks |
| `make simulate` | Run event simulation script |
| `make build-static` | Build frontend and copy to backend for standalone deployment |
| `make clean-all` | Remove all build artifacts and data |

### Hook Management

| Command | Description |
|---------|-------------|
| `make hooks-install` | Install hooks into Claude Code |
| `make hooks-uninstall` | Remove hooks from Claude Code |
| `make hooks-status` | Show installed hooks and config |
| `make hooks-logs` | View recent hook logs |
| `make hooks-debug-on` | Enable debug logging |
| `make hooks-debug-off` | Disable debug logging |

### OpenCode Integration

This fork adds support for [OpenCode](https://opencode.ai) as an alternative to Claude Code CLI. The `opencode-plugin/` directory contains a plugin that sends OpenCode lifecycle events to the same backend API.

> **⚠ Breaking in v0.24.0:** a non-localhost `CLAUDE_OFFICE_API_URL` is now clamped to the local default unless `CLAUDE_OFFICE_ALLOW_REMOTE=1` is set (the Claude Code hooks always did this). If your backend runs on another host, set `CLAUDE_OFFICE_ALLOW_REMOTE=1` or events will silently post to localhost.

#### Install

```bash
make opencode-install
```

This builds the plugin, links it globally, and registers it in your `~/.config/opencode/opencode.json`.

#### Uninstall

```bash
make opencode-uninstall
```

#### OpenCode Plugin Commands

| Command | Description |
|---------|-------------|
| `make opencode-install` | Build and register plugin with OpenCode |
| `make opencode-uninstall` | Remove plugin from OpenCode |
| `make opencode-reinstall` | Uninstall and reinstall plugin |
| `make opencode-build` | Build plugin without registering |

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OFFICE_API_URL` | `http://localhost:8000/api/v1/events` | Backend API endpoint. Non-localhost values are reset to the default unless `CLAUDE_OFFICE_ALLOW_REMOTE=1` |
| `CLAUDE_OFFICE_ALLOW_REMOTE` | `0` | Set to `1` to permit a non-localhost backend (hooks + OpenCode plugin; opt-in since payloads carry tool I/O and file paths) |
| `CLAUDE_OFFICE_TIMEOUT_MS` | `1500` | HTTP request timeout |
| `CLAUDE_OFFICE_DEBUG` | `0` | Set to `1` to log events to stderr |

#### Event Mapping

The plugin maps OpenCode events to claude-office backend events:

| OpenCode Event | Backend Event |
|----------------|---------------|
| `session.created` | `session_start` |
| `session.deleted` | `session_end` |
| `session.idle` | `stop` |
| `session.compacted` | `context_compaction` |
| `chat.message` hook | `user_prompt_submit` |
| `tool.execute.before` | `pre_tool_use` / `subagent_start` |
| `tool.execute.after` | `post_tool_use` / `subagent_stop` |
| `permission.ask` | `permission_request` |
| `step-finish` part | `reporting` (token usage) |
| `message.updated` (assistant) | `reporting` (token usage) |

### Docker Deployment

| Command | Description |
|---------|-------------|
| `make docker-build` | Build Docker image |
| `make docker-up` | Start container in background (UI at [http://localhost:8050](http://localhost:8050)) |
| `make docker-config` | Point the hooks/plugin at the Docker-published port |
| `make docker-down` | Stop container |
| `make docker-logs` | View container logs |

See [Docker Guide](docs/guides/deployment.md) for detailed configuration.

### Accessing the Visualizer

Once running, open [http://localhost:4747](http://localhost:4747) in your browser.

## Project Structure

```
claude-office/
├── backend/               # FastAPI backend
│   ├── app/
│   │   ├── api/          # REST and WebSocket endpoints
│   │   ├── core/         # State machine, event processor
│   │   └── models/       # Pydantic models
│   └── pyproject.toml
├── frontend/             # Next.js + three.js frontend
│   ├── src/
│   │   ├── components/   # React components (iso/ = three.js office)
│   │   ├── hooks/        # Custom React hooks
│   │   ├── stores/       # Zustand state stores
│   │   └── systems/      # Animation, pathfinding
│   └── package.json
├── hooks/                # Claude Code integration
│   ├── src/              # Hook implementation
│   ├── install.sh        # Hook installer
│   └── uninstall.sh      # Hook uninstaller
├── opencode-plugin/      # OpenCode integration
│   ├── src/              # Plugin TypeScript source
│   ├── install.sh        # Plugin installer
│   └── uninstall.sh      # Plugin uninstaller
├── scripts/              # Utility scripts
├── docs/                 # Documentation
└── Makefile              # Project orchestration
```

## Troubleshooting

### Hooks Not Firing

1. Check hooks are installed: `make hooks-status`
2. Enable debug logging: `make hooks-debug-on`
3. Watch logs: `make hooks-logs-follow`

### Frontend Not Updating

1. Check WebSocket connection in browser dev tools (Network > WS)
2. Verify backend is running: [http://localhost:8000/health](http://localhost:8000/health)
3. Check browser console for errors

### Backend Errors

1. Check backend logs in tmux window or terminal
2. Clear database and restart: `make clean-db && make dev`

### Common Issues

| Issue | Solution |
|-------|----------|
| "Session already exists" | Run `make dev-tmux-kill` first |
| Port 8000 in use | Stop other services on that port |
| Port 4747 in use | Stop other services on that port |
| Hooks not detected | Restart Claude Code after installing hooks |

## Contributing

Contributions are welcome! Please ensure that all pull requests:

1. Pass all checks: `make checkall`
2. Follow the existing code style
3. Include appropriate tests for new features
4. Update documentation as needed

## Related Documentation

- [Quick Start Guide](docs/guides/quickstart.md) - Get running in under 5 minutes
- [Architecture](docs/architecture/ARCHITECTURE.md) - System design, data flow, component details
- [Docker Guide](docs/guides/deployment.md) - Docker deployment and configuration
- [AI Summary](docs/reference/ai-summary.md) - AI-powered summary service documentation
- [Backend README](backend/README.md) - Backend-specific setup
- [Frontend README](frontend/README.md) - Frontend-specific setup
- [Hooks README](hooks/README.md) - Hook installation details
- [OpenCode Plugin](opencode-plugin/) - OpenCode integration plugin
- [Scripts README](scripts/README.md) - Testing and simulation scripts
- [CLAUDE.md](CLAUDE.md) - AI assistant instructions for this project

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=paulrobello/claude-office&type=Date)](https://star-history.dera.page/#paulrobello/claude-office&Date)
