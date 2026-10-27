# Quick Start Guide

Get Claude Office Visualizer running in under 5 minutes. This guide covers the fastest path from clone to visualization.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Starting the Visualizer](#starting-the-visualizer)
- [Verifying Installation](#verifying-installation)
- [Next Steps](#next-steps)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Overview

Claude Office Visualizer transforms Claude Code operations into a real-time office. Once installed, it automatically captures Claude Code events and displays them as animated office activities. In this fork the office is a bright isometric one; the original pixel art office has been removed.

```mermaid
graph LR
    CC[Claude Code]
    Hooks[Hooks]
    Backend[Backend :8000]
    Frontend[Frontend :4747]

    CC -->|Events| Hooks
    Hooks -->|HTTP POST| Backend
    Backend -->|WebSocket| Frontend

    style CC fill:#4a148c,stroke:#9c27b0,stroke-width:2px,color:#ffffff
    style Hooks fill:#37474f,stroke:#78909c,stroke-width:2px,color:#ffffff
    style Backend fill:#e65100,stroke:#ff9800,stroke-width:3px,color:#ffffff
    style Frontend fill:#0d47a1,stroke:#2196f3,stroke-width:2px,color:#ffffff
```

## Prerequisites

Before starting, ensure you have:

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Python | 3.13+ | `python --version` |
| Node.js | 20+ | `node --version` |
| uv | Latest | `uv --version` |
| Claude Code | Latest | `claude --version` |
| tmux | Any | `tmux -V` |

> **Note:** tmux is optional but recommended for the best development experience. Bun can be used as an alternative to Node.js/npm.

### Installing uv (if needed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/paulrobello/claude-office.git
cd claude-office
```

### Step 2: Install All Dependencies

```bash
make install-all
```

This single command:
- Installs backend Python dependencies via uv
- Installs frontend dependencies (auto-detects bun or npm)
- Registers Claude Code hooks and the OpenCode plugin

### Step 3: (Optional) Enable AI Enhancements

For AI-powered features like agent name generation and task summaries, create a `.env` file in the `backend/` folder with your Claude Code OAuth token:

```bash
# Set up a long-lived authentication token (requires Claude subscription)
# This will prompt you to authenticate and display your token
claude setup-token

# Create the .env file with the token
echo "CLAUDE_CODE_OAUTH_TOKEN=your-token-here" > backend/.env
```

> **Note:** Without this token, the visualizer works fully but displays raw agent IDs instead of generated names, and tool names instead of task summaries. The frontend displays AI status in the top right corner so you can verify if it's properly configured.

### Step 4: Verify Hooks Installation

```bash
make hooks-status
```

Expected output shows installed hooks and configuration:
```
=== Installed Claude Code Hooks ===
  PreToolUse: 1 hook(s)
  PostToolUse: 1 hook(s)
  ...

=== Hook Config ===
CLAUDE_OFFICE_STRIP_PREFIXES="..."
CLAUDE_OFFICE_DEBUG=1
```

## Starting the Visualizer

### Recommended: Using tmux

```bash
make dev-tmux
```

This creates a tmux session with separate windows for backend and frontend:

| Window | Service | URL |
|--------|---------|-----|
| 0: backend | FastAPI server | http://localhost:8000 |
| 1: frontend | Next.js dev server | http://localhost:4747 |

**Navigation:**
- `Ctrl-b n` - Next window
- `Ctrl-b p` - Previous window
- `Ctrl-b d` - Detach (services keep running)

### Alternative: Without tmux

```bash
make dev
```

This runs both services in the same terminal (less convenient for viewing logs).

## Verifying Installation

### 1. Check Backend Health

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status": "ok"}
```

### 2. Open the Frontend

Navigate to [http://localhost:4747](http://localhost:4747) in your browser.

You should see the isometric office with:
- The floor guide on the left: one floor per project, its sessions listed under it
- One floor with its rooms (library, dev room, server room, search room, meeting room, lounge, cafe), my desk and an elevator
- The people in the office, an activity log and a room legend on the right

### 3. Test with Claude Code

In a separate terminal, run any Claude Code command:

```bash
claude "What is 2 + 2?"
```

Watch the visualizer:
1. Claude thinks at its desk (a 「💭 고민 중」 bubble)
2. Claude walks to the room of each tool it runs: the library to read, the server room to run commands, its desk to edit
3. Its reply appears as a speech bubble

### 4. Test Subagent Visualization

Run a command that spawns subagents:

```bash
claude "Search this codebase for all Python files and summarize what each does"
```

Watch the visualizer:
1. Claude picks up the phone at its desk
2. Employee agents step out of the elevator
3. Agents walk to their desks, or to the room of their tool, and work
4. When done they report beside Claude, wave 「👋 퇴근합니다!」 and ride the elevator away

## Next Steps

Now that the visualizer is running:

| Task | Command/Action |
|------|----------------|
| Run simulation | `uv run --frozen python scripts/simulate_events.py errands` |
| View hook logs | `make hooks-logs` |
| Stop services | `make dev-tmux-kill` |

## Troubleshooting

### Hooks Not Triggering

```bash
# Enable debug logging
make hooks-debug-on

# Watch logs in real-time
make hooks-logs-follow

# Then run a Claude command and check for output
```

### Port Already in Use

```bash
# Kill existing services
make dev-tmux-kill

# Or manually kill processes on ports
lsof -ti:8000 | xargs kill -9
lsof -ti:4747 | xargs kill -9
```

### Frontend Not Connecting

1. Check backend is running: `curl http://localhost:8000/health`
2. Check browser console for WebSocket errors
3. Try hard refresh: `Ctrl+Shift+R`

### No Agents Appearing

1. Verify hooks are installed: `make hooks-status`
2. Restart Claude Code after hook installation
3. Check hook logs: `make hooks-logs`

> **Warning:** After installing hooks, you must restart Claude Code for them to take effect.

### Backend Crashes or Won't Start

If the backend crashes on startup or the frontend can't maintain a connection, the SQLite database may be corrupted or have an incompatible schema (e.g., after a code update that adds new columns).

**Solution: Delete the database and let it recreate:**

```bash
rm backend/visualizer.db
# Restart the backend - database will be recreated with current schema
```

> **Note:** This will clear all stored session history. The database is automatically recreated on startup with the correct schema.

## Related Documentation

- [Project README](../../README.md) - Project overview and full feature list
- [Architecture](../architecture/ARCHITECTURE.md) - System design and component details
- [Deployment Guide](deployment.md) - Docker and container deployment instructions
- [AI Summary](../reference/ai-summary.md) - AI-powered summary service documentation
