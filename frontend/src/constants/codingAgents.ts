/**
 * Display names for the coding agents that producers report as
 * `coding_agent` (backend `app/core/coding_agent.py`).
 */
const CODING_AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude",
  opencode: "OpenCode",
  "gemini-cli": "Gemini",
  codex: "Codex",
};

/** Longest unknown tag shown as-is before it is cut. */
const MAX_UNKNOWN_NAME_LENGTH = 16;

/**
 * Name for a session's coding agent: a known agent's display name, an
 * unknown producer's own tag, or null when the session does not say.
 */
export function codingAgentName(
  codingAgent: string | null | undefined,
): string | null {
  if (!codingAgent) return null;
  return (
    CODING_AGENT_NAMES[codingAgent] ??
    codingAgent.slice(0, MAX_UNKNOWN_NAME_LENGTH)
  );
}
