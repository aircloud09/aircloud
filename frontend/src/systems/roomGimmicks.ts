/**
 * Small touches in the rooms while people work (docs/plan/spec.md 「작업
 * 공간 기믹」): when they show is decided here, how they look in the
 * character and room code.
 */

/** A command running this long has the one waiting at the rack check its watch (ms). */
export const WATCH_AFTER_MS = 10_000;

/** Waiting at the rack for a long command: arms crossed, an eye on the watch. */
export function watchesTheClock(runningForMs: number): boolean {
  return runningForMs >= WATCH_AFTER_MS;
}

/** A sticky note on the whiteboard per to-do, coloured by how far it got. */
export type NoteStatus = "pending" | "in_progress" | "completed";

/** The whiteboard holds this many to-do notes. */
export const MAX_NOTES = 12;

/**
 * The notes for a to-do list tool's input: Claude Code's TodoWrite and
 * OpenCode's todowrite and Gemini's write_todos send ``todos``, Codex's
 * update_plan ``plan``; anything else is not a list (null).
 */
export function todoNotes(input: unknown): NoteStatus[] | null {
  if (typeof input !== "object" || input === null) return null;
  const { todos, plan } = input as { todos?: unknown; plan?: unknown };
  const list = Array.isArray(todos) ? todos : Array.isArray(plan) ? plan : null;
  if (!list) return null;
  return list.slice(0, MAX_NOTES).map((item: unknown) => {
    const status = (item as { status?: unknown } | null)?.status;
    return status === "completed" || status === "in_progress"
      ? status
      : "pending";
  });
}

/** The newest to-do list in the log (newest first), or null when there is none. */
export function latestTodoNotes(
  eventLog: readonly { detail?: { toolInput?: unknown } }[],
): NoteStatus[] | null {
  for (const entry of eventLog) {
    const notes = todoNotes(entry.detail?.toolInput);
    if (notes) return notes;
  }
  return null;
}

/** How fast the search room globe turns while someone searches (rad/s). */
export const GLOBE_SPIN_SPEED = 1.8;
/** How quickly it gets up to speed and winds down (rad/s per second). */
const GLOBE_EASE = 2.4;

/** The globe's turning speed after ``dt`` seconds, easing toward full or still. */
export function globeSpeed(
  current: number,
  searching: boolean,
  dt: number,
): number {
  const target = searching ? GLOBE_SPIN_SPEED : 0;
  const step = GLOBE_EASE * dt;
  return current + Math.max(-step, Math.min(step, target - current));
}

/** Books a reader piles up beside it in the library, at most. */
export const MAX_PILE = 6;

/** A reader's pile of books in the library, and the bubble that added the last one. */
export interface BookPile {
  count: number;
  /** When the tool bubble that added the newest book appeared. */
  lastBubbleAt: number | null;
}

export const NO_PILE: BookPile = { count: 0, lastBubbleAt: null };

/**
 * Each new reading tool (a new tool bubble) while it works in the library
 * adds a book to its pile, up to MAX_PILE; leaving the library clears it.
 */
export function bookPile(
  pile: BookPile,
  inLibrary: boolean,
  reading: boolean,
  bubbleAt: number | null,
): BookPile {
  if (!inLibrary) return pile.count === 0 ? pile : NO_PILE;
  if (!reading || bubbleAt === null || bubbleAt === pile.lastBubbleAt) {
    return pile;
  }
  return { count: Math.min(MAX_PILE, pile.count + 1), lastBubbleAt: bubbleAt };
}

/** Typing at its desk, it scratches its head this long every so often (ms). */
export const SCRATCH_EVERY_MS = 8_000;
export const SCRATCH_MS = 1_200;

/** Scratching its head ``typingForMs`` into typing: the last moments of each round. */
export function scratchesHead(typingForMs: number): boolean {
  return typingForMs % SCRATCH_EVERY_MS >= SCRATCH_EVERY_MS - SCRATCH_MS;
}

/** How long it cheers after its tests pass (ms). */
export const CHEER_MS = 2_500;

/** A shell command that runs tests: one with ``test`` (or a test runner) in it. */
export function isTestCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /\b(tests?|pytest|vitest|jest)\b/i.test(command)
  );
}

/**
 * The log id of ``agentId``'s latest test command when it passed, or null
 * when its latest one failed or it ran none. A failed tool carries an
 * errorType. The office cheers when a new id shows up, not by the event's
 * time: the backend dates a finished tool near its start.
 */
export function lastPassedTestId(
  eventLog: readonly {
    id: string;
    type: string;
    agentId: string;
    detail?: { toolInput?: unknown; errorType?: string };
  }[],
  agentId: string,
): string | null {
  for (const entry of eventLog) {
    if (entry.type !== "post_tool_use" || entry.agentId !== agentId) continue;
    const input = entry.detail?.toolInput as { command?: unknown } | undefined;
    if (!isTestCommand(input?.command)) continue;
    return entry.detail?.errorType ? null : entry.id;
  }
  return null;
}

/** The lamp over the elevator door stays lit this long after someone steps out (s). */
export const LAMP_HOLD_SECONDS = 1.5;

/** Lit while someone steps out of the elevator and a moment after (``seconds`` is the clock). */
export function lampLit(lastArrival: number | null, seconds: number): boolean {
  return lastArrival !== null && seconds - lastArrival < LAMP_HOLD_SECONDS;
}
