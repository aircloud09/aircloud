/**
 * Office slice (ARC-005).
 *
 * Session/scalar office state: session id, event log, coding agent.
 * Self-contained apart from the @/types shapes it carries.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type {
  EventDetail,
  EventType,
  HistoryEntry,
  WebSocketMessage,
} from "@/types";
import type { EventLogEntry } from "./types";

const MAX_EVENT_LOG = 500;

/**
 * Identity of an event log entry. The backend sends each event twice, inside
 * the state snapshot's `history` and as its own `event` message, with the
 * same id (its timestamp), type, agent and summary.
 */
function eventLogKey(event: {
  id: string;
  type: string;
  agentId: string;
  summary: string;
}): string {
  return `${event.id}|${event.type}|${event.agentId}|${event.summary}`;
}

export type OfficeSlice = {
  sessionId: string;
  /** The session whose state snapshot has been applied, once it has. */
  snapshotSessionId: string | null;
  eventLog: EventLogEntry[];
  codingAgent: string | null;

  setSessionId: (id: string) => void;
  markSnapshot: (sessionId: string) => void;
  addEventLog: (event: NonNullable<WebSocketMessage["event"]>) => void;
  mergeEventHistory: (history: HistoryEntry[]) => void;
  setCodingAgent: (codingAgent: string | null) => void;
};

export const initialOfficeState = {
  sessionId: "None",
  snapshotSessionId: null as string | null,
  eventLog: [] as EventLogEntry[],
  codingAgent: null as string | null,
};

export const createOfficeSlice: StateCreator<GameStore, [], [], OfficeSlice> = (
  set,
) => ({
  ...initialOfficeState,

  setSessionId: (id) => set({ sessionId: id }),

  markSnapshot: (sessionId) =>
    set((state) =>
      state.snapshotSessionId === sessionId
        ? state
        : { snapshotSessionId: sessionId },
    ),

  addEventLog: (event) =>
    set((state) => {
      const key = eventLogKey(event);
      if (state.eventLog.some((logged) => eventLogKey(logged) === key)) {
        return state;
      }
      const timestamp = event.timestamp
        ? new Date(event.timestamp)
        : new Date();
      const entry: EventLogEntry = { ...event, timestamp };
      return {
        eventLog: [entry, ...state.eventLog.slice(0, MAX_EVENT_LOG - 1)],
      };
    }),

  // Adds history entries the log does not have yet (a reopened or finished
  // session has no live events), keeping the log newest-first.
  mergeEventHistory: (history) =>
    set((state) => {
      const logged = new Set(state.eventLog.map(eventLogKey));
      const missing: EventLogEntry[] = history
        .filter((entry) => !logged.has(eventLogKey(entry)))
        .map((entry) => ({
          id: entry.id,
          type: entry.type as EventType,
          agentId: entry.agentId,
          summary: entry.summary,
          timestamp: new Date(entry.timestamp),
          detail: entry.detail as EventDetail,
        }));
      if (missing.length === 0) return state;
      return {
        eventLog: [...state.eventLog, ...missing]
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, MAX_EVENT_LOG),
      };
    }),

  setCodingAgent: (codingAgent) => set({ codingAgent }),
});
