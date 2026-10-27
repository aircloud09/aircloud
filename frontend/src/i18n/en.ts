const en = {
  // Header Controls
  "header.settings": "SETTINGS",

  // Modals
  "modal.close": "Close",

  // Settings
  "settings.title": "Settings",
  "settings.sessionBehavior": "Session Behavior",
  "settings.autoFollow": "Auto-follow new sessions",
  "settings.autoFollowDesc":
    "Automatically switch to new sessions in the current project",
  "settings.floorTogether": "Show the floor's other sessions",
  "settings.floorTogetherDesc":
    "Claude from other sessions working on the same floor joins the office. Off shows only the chosen session.",
  "settings.language": "Language",
  "settings.theme": "Theme",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.tabs.general": "General",
  "settings.tabs.connect": "Connect",
  "settings.connect.intro":
    "Each button runs the connect command on this computer for you. Your other settings stay as they are; only the Agent Office hook is added.",
  "settings.connect.connected": "Connected",
  "settings.connect.notConnected": "Not connected",
  "settings.connect.connect": "Connect",
  "settings.connect.reconnect": "Reconnect",
  "settings.connect.disconnect": "Disconnect",
  "settings.connect.running": "Running…",
  "settings.connect.done": "Done.",
  "settings.connect.failed": "It didn't work. Check the output below.",
  "settings.connect.output": "Output · {command}",
  "settings.connect.cliMissing":
    "The {cli} command isn't on this computer yet.",
  "settings.connect.toolMissing":
    "The hook tool is missing. Reconnect to install it again.",
  "settings.connect.afterClaude":
    "Claude Code sessions you open from now on show up in the office.",
  "settings.connect.afterCodex":
    "In Codex, open /hooks and trust the Agent Office hook, or it won't run.",
  "settings.connect.afterGemini":
    "Gemini CLI sessions you open from now on show up in the office.",
  "settings.connect.needToken":
    "To connect, open this page from the 「Agent Office: http://localhost:4747/?token=…」 line in the backend's terminal.",
  "settings.connect.notLocal":
    "This backend is reachable from other machines (Docker, for example), so it can't connect agents. Run make hooks-install in a terminal instead.",
  "settings.connect.cannotRun":
    "This backend can't run the connect command ({reason}). Run make hooks-install from the repository in a terminal.",
  "settings.connect.busy": "Another connect is still running.",
  "settings.connect.loadFailed":
    "Couldn't read the connections. Is the backend running?",

  // Agent Status
  "agentStatus.inQueue": "In {queueType} queue (position {position})",

  // Office rooms
  "office.unknownAgent": "Agent",

  // Isometric office
  "iso.live": "LIVE",
  "iso.offline": "OFFLINE",
  "iso.controlsHint": "Drag to move · Scroll to zoom · Double-click to reset",
  "iso.me": "Me",
  "iso.agentType.general": "General",
  "iso.bubble.thinking": "Thinking",
  "iso.bubble.thinkingFor": "Thinking for {seconds}s",
  "iso.bubble.looking": "Looking into it",
  "iso.bubble.bye": "👋 Heading home!",
  "iso.bubble.compacting": "☕ Compacting the conversation",
  "iso.panel.project": "Project",
  "iso.panel.session": "Session",
  "iso.panel.people": "Office",
  "iso.panel.atWork": "{count} at work",
  "iso.panel.working": "Working",
  "iso.panel.tools": "{count} tools · {seconds}s",
  "iso.panel.tools_one": "{count} tool · {seconds}s",
  "iso.panel.colleague": "Another session on this floor · {seconds}s",
  "iso.panel.tools_other": "{count} tools · {seconds}s",
  "iso.panel.log": "Activity log",
  "iso.panel.logTime": "{h}:{m}:{s}",
  "iso.panel.rooms": "Office map",
  "iso.room.library": "Library",
  "iso.room.dev": "Dev room",
  "iso.room.server": "Server room",
  "iso.room.search": "Search room",
  "iso.room.meeting": "Meeting room",
  "iso.room.mydesk": "My desk",
  "iso.room.lounge": "Lounge",
  "iso.room.cafe": "Cafe",
  "iso.room.elevator": "Elevator",
  "iso.roomDoes.library": "Read · search files",
  "iso.roomDoes.dev": "Write · edit code",
  "iso.roomDoes.server": "Run commands · git",
  "iso.roomDoes.search": "Web · outside tools",
  "iso.roomDoes.meeting": "Plans · todos · skills",
  "iso.roomDoes.mydesk": "Questions · calls for me",
  "iso.roomDoes.lounge": "Rest · wait for the next prompt",
  "iso.roomDoes.cafe": "Coffee before home · while compacting",
  "iso.roomDoes.elevator": "Subagents come and go",
  "iso.floor.title": "Floor guide",
  "iso.connect.empty": "No one has come to work yet.",
  "iso.connect.cta": "Connect an agent",
  "iso.floor.caption": "DIRECTORY",
  "iso.floor.sessions": "{count} sessions",
  "iso.floor.sessions_one": "{count} session",
  "iso.floor.sessions_other": "{count} sessions",
  "iso.floor.activeNow": "Active now",
  "iso.floor.follow": "Follow the latest session",
  "iso.floor.together": "Show the floor's other sessions",
  "iso.floor.untitled": "Untitled session · {id}",
  "iso.floor.moreIdle": "{count} more quiet floors",
  "iso.floor.moreIdle_one": "{count} more quiet floor",
  "iso.floor.moreIdle_other": "{count} more quiet floors",
  "iso.floor.lessIdle": "Collapse",

  // Zoom Controls
  "zoom.in": "Zoom in",
  "zoom.out": "Zoom out",
  "zoom.reset": "Reset zoom",

  // Status Messages
  "status.switchedToSession": "Switched to session {sessionId}...",
  "status.deletingSession": "Deleting session {sessionId}...",
  "status.sessionDeleted": "Session deleted.",
  "status.failedDeleteSession": "Failed to delete session.",
  "status.errorConnecting": "Error connecting to backend.",
  "status.sessionRenamed": "Session renamed.",
  "status.failedRenameSession": "Failed to rename session.",
  "status.clearingDatabase": "Clearing database...",
  "status.databaseCleared": "Database cleared.",
  "status.failedClearDatabase": "Failed to clear database.",
  "status.triggeringSimulation": "Triggering simulation...",
  "status.simulationStarted": "Simulation started!",
  "status.failedSimulation": "Failed to trigger simulation.",
  "status.storeReset": "Store reset.",
  "status.sessionDeletedSwitched": "Session deleted. Switched to {sessionName}",
  "status.sessionDeletedNoOthers":
    "Session deleted. No other sessions available.",
  "status.connectedTo": "Connected to {sessionName}",
  "status.autoFollowed": "Auto-followed new session: {sessionName}",
} as const;

export type TranslationKey = keyof typeof en;
export default en;
