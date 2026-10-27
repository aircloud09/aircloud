/**
 * The right-hand panels of the isometric office (docs/plan/spec.md
 * 「화면 재설계」, wording after the video): 「사무실」 rows and the
 * 「활동 로그」 lines, built from the people on the floor and the event log.
 */

import type { ErrandRoomId } from "@/constants/isoFloorPlan";
import type { EventLogEntry } from "@/stores/slices/types";
import { ROOM_FOR_ACTIVITY } from "./isoErrands";
import type { IsoPerson } from "./officePeople";

/** Words the panels need, already translated. */
export interface RosterWords {
  thinking: string;
  looking: string;
  /** Room names, by the room an activity sends a person to (and their own desk). */
  rooms: Record<ErrandRoomId | "seat", string>;
}

export type RosterStatus = "thinking" | "working" | null;

/** One person in 「사무실」. */
export interface RosterRow {
  id: string;
  kind: IsoPerson["kind"];
  outfit: IsoPerson["outfit"];
  title: string;
  typeLabel: string;
  status: RosterStatus;
  /** What it is doing now, e.g. 「📖 자료실 · src/auth.py」. */
  doing: string;
  /** ``doing`` with the tool's whole target, for hovering (bubbles cut it short). */
  doingInFull: string;
  /** Tools it has used this session. */
  tools: number;
  /** When its latest event came (ms); null when the page cannot tell. */
  since: number | null;
}

/** Whole seconds from ``at`` to ``now`` (ms), as the thinking bubble counts them. */
export const secondsSince = (at: number, now: number): number =>
  Math.max(0, Math.floor((now - at) / 1000));

/** How long (ms) until the count from any of ``starts`` goes up, at most a second. */
export function untilNextSecond(starts: number[], now: number): number {
  let wait = 1000;
  for (const at of starts) {
    const elapsed = now - at;
    wait = Math.min(wait, elapsed < 0 ? -elapsed : 1000 - (elapsed % 1000));
  }
  return wait;
}

/** Tool uses per character in the event log ("main" is the lead agent). */
export function toolCounts(entries: EventLogEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== "pre_tool_use") continue;
    counts.set(entry.agentId, (counts.get(entry.agentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The task each subagent was last started with, from the event log (newest
 * first): a subagent that has gone home is still named by it in the log.
 */
export function startedTasks(entries: EventLogEntry[]): Map<string, string> {
  const tasks = new Map<string, string>();
  for (const entry of entries) {
    const task = entry.detail?.taskDescription;
    if (entry.type === "subagent_start" && task && !tasks.has(entry.agentId)) {
      tasks.set(entry.agentId, task);
    }
  }
  return tasks;
}

/**
 * The whole target of each character's latest tool, from the event log
 * (newest first): its bubble carries the target cut short.
 */
export function toolTargets(entries: EventLogEntry[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "pre_tool_use" || targets.has(entry.agentId)) continue;
    targets.set(entry.agentId, toolTarget(entry.detail?.toolInput));
  }
  return targets;
}

/** Whether ``text`` is ``whole`` with parts cut out and marked "...". */
const isCutFrom = (text: string, whole: string): boolean =>
  text.split("...").every((piece) => whole.includes(piece.trim()));

/** The event-log id of a person: the lead agent logs as "main". */
const logId = (person: IsoPerson): string =>
  person.kind === "claude" ? "main" : person.id;

/** Everyone at work (I am not listed), Claude first. */
export function rosterRows(
  people: IsoPerson[],
  counts: Map<string, number>,
  words: RosterWords,
  targets: Map<string, string> = new Map(),
): RosterRow[] {
  return people
    .filter((person) => person.kind !== "me")
    .map((person): RosterRow => {
      let status: RosterStatus = null;
      let doing = "";
      let doingInFull: string | null = null;
      if (person.stuck) {
        status = "thinking";
        doing = `❗ ${person.bubble?.text ?? ""}`.trim();
      } else if (person.activity) {
        status = "working";
        const room = words.rooms[ROOM_FOR_ACTIVITY[person.activity]];
        const tool = person.bubble?.type === "thought" ? person.bubble : null;
        doing = tool ? `${tool.icon ?? "⚙️"} ${room} · ${tool.text}` : room;
        // Only when the bubble is that target cut short, not an older tool's.
        const target = targets.get(logId(person));
        if (tool && target && isCutFrom(tool.text, target)) {
          doingInFull = `${tool.icon ?? "⚙️"} ${room} · ${target}`;
        }
      } else if (person.thinking) {
        status = "thinking";
        doing = `💭 ${words.thinking}...`;
      }
      return {
        id: person.id,
        kind: person.kind,
        outfit: person.outfit,
        title: person.title,
        typeLabel: person.typeLabel,
        status,
        doing,
        doingInFull: doingInFull ?? doing,
        tools: counts.get(logId(person)) ?? 0,
        since: person.since,
      };
    });
}

/** One line of 「활동 로그」. */
export interface LogLine {
  id: string;
  time: Date;
  who: string;
  what: string;
}

/** Icons of common tools, as the tool bubbles show them (every agent's names). */
const TOOL_ICONS: Record<string, string> = {
  read: "📖",
  write: "✍️",
  edit: "📝",
  multiedit: "📝",
  bash: "💻",
  glob: "🔍",
  grep: "🔎",
  websearch: "🌐",
  webfetch: "📥",
  task: "🎯",
  agent: "🎯",
  todowrite: "📋",
  askuserquestion: "❓",
  // Gemini CLI
  read_file: "📖",
  write_file: "✍️",
  replace: "📝",
  run_shell_command: "💻",
  google_web_search: "🌐",
  web_fetch: "📥",
  write_todos: "📋",
  ask_user: "❓",
  // Codex CLI
  apply_patch: "📝",
  spawn_agent: "🎯",
  update_plan: "📋",
  request_user_input: "❓",
  view_image: "📖",
};

/** Tool input keys that name what a call works on, most specific first. */
const TARGET_KEYS = [
  "file_path",
  "notebook_path",
  "filePath",
  "absolute_path",
  "dir_path",
  "path",
  "pattern",
  "url",
  "query",
  "command",
  "description",
];

function toolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.startsWith("mcp__")) return "🌐";
  return TOOL_ICONS[name] ?? "⚙️";
}

function toolTarget(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of TARGET_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value) && value.length) return value.join(" ");
  }
  return "";
}

/**
 * What the log says for an event, or null for the ones it leaves out (tools
 * that finished fine, session bookkeeping).
 */
function lineText(entry: EventLogEntry, words: RosterWords): string | null {
  const detail = entry.detail ?? {};
  switch (entry.type) {
    case "pre_tool_use": {
      const tool = detail.toolName ?? "";
      const target = toolTarget(detail.toolInput) || tool;
      return `${toolIcon(tool)} ${target} ${words.looking}`;
    }
    case "post_tool_use":
      return detail.errorType
        ? `❗ ${[detail.toolName, detail.resultSummary].filter(Boolean).join(": ")}`
        : null;
    case "user_prompt_submit":
      return detail.prompt ? `📞 ${detail.prompt}` : null;
    case "permission_request":
      return `❓ ${detail.toolName ?? ""}`.trim();
    case "stop":
      return detail.message ? `💬 ${detail.message}` : null;
    case "agent_update":
      if (detail.thinking) return `💭 ${detail.thinking}`;
      return detail.message ? `💬 ${detail.message}` : null;
    default:
      return null;
  }
}

/**
 * At most ``limit`` lines, newest first. ``entries`` come newest first, as
 * the store keeps the event log.
 */
export function logLines(
  entries: EventLogEntry[],
  whoOf: (agentId: string, type: EventLogEntry["type"]) => string,
  words: RosterWords,
  limit = 40,
): LogLine[] {
  const lines: LogLine[] = [];
  for (const entry of entries) {
    if (lines.length >= limit) break;
    const what = lineText(entry, words);
    if (what === null) continue;
    lines.push({
      id: entry.id,
      time: entry.timestamp,
      who: whoOf(entry.agentId, entry.type),
      what,
    });
  }
  return lines;
}
