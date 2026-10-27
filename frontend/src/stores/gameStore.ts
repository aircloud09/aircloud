"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Activity,
  StuckReason,
  Position,
  BubbleContent,
  BossState,
  AgentState as BackendAgentState,
  HistoryEntry,
  WebSocketMessage,
  Agent as BackendAgent,
} from "@/types";

// ============================================================================
// SHARED STORE TYPES (ARC-005)
// ============================================================================
// Slice-shared types live in ./slices/types and are re-exported here so every
// existing `import { ... } from "@/stores/gameStore"` consumer is unchanged.
export type {
  AgentPhase,
  PathState,
  BubbleState,
  AgentAnimationState,
  BossAnimationState,
  BossErrandPhase,
  BossErrandState,
  AgentErrandState,
  ErrandRoom,
  EventLogEntry,
  AgentMovement,
} from "./slices/types";
import type {
  AgentPhase,
  PathState,
  AgentAnimationState,
  BossAnimationState,
  BossErrandState,
  AgentErrandState,
  EventLogEntry,
  AgentMovement,
} from "./slices/types";

// Slices (ARC-005): each concern owns its state + actions in its own file and
// is composed below. Cross-slice access (bubbles read boss/agent state; queues
// re-index agents) goes through the shared `set`/`get`, typed for GameStore.
import { createAgentSlice, initialAgentState } from "./slices/agentSlice";
import { createQueueSlice, initialQueueState } from "./slices/queueSlice";
import {
  createReservationSlice,
  initialReservationState,
} from "./slices/reservationSlice";
import { createBossSlice, initialBossSliceState } from "./slices/bossSlice";
import { createBubbleSlice } from "./slices/bubbleSlice";
import { createOfficeSlice, initialOfficeState } from "./slices/officeSlice";
import { createReplaySlice, initialReplayState } from "./slices/replaySlice";
import {
  createEmptyBubbleState,
  initialBossErrandState,
  initialBossState,
} from "./slices/shared";

// ============================================================================
// STORE INTERFACE (the single public contract; impls come from the slices)
// ============================================================================

export interface GameStore {
  // ========== Agent State ==========
  agents: Map<string, AgentAnimationState>;

  // Agent actions
  addAgent: (backendAgent: BackendAgent, initialPosition: Position) => void;
  removeAgent: (agentId: string) => void;
  updateAgentPhase: (agentId: string, phase: AgentPhase) => void;
  updateAgentPosition: (agentId: string, position: Position) => void;
  updateAgentTarget: (agentId: string, target: Position) => void;
  updateAgentPath: (agentId: string, path: PathState | null) => void;
  updateAgentBackendState: (agentId: string, state: BackendAgentState) => void;
  updateAgentMeta: (
    agentId: string,
    meta: {
      backendState: BackendAgentState;
      name: string | null;
      currentTask: string | null;
      activity?: Activity | null;
      stuck?: StuckReason | null;
    },
  ) => void;
  updateAgentQueueInfo: (
    agentId: string,
    queueType: "arrival" | "departure" | null,
    queueIndex: number,
  ) => void;
  setAgentTyping: (agentId: string, typing: boolean) => void;
  applyAgentMovements: (movements: AgentMovement[]) => void;
  agentErrands: Map<string, AgentErrandState>;
  setAgentErrands: (errands: Map<string, AgentErrandState>) => void;

  // ========== Queue State ==========
  arrivalQueue: string[]; // Agent IDs in order
  departureQueue: string[]; // Agent IDs in order

  // Queue actions
  enqueueArrival: (agentId: string) => void;
  enqueueDeparture: (agentId: string) => void;
  dequeueArrival: () => string | undefined;
  dequeueDeparture: () => string | undefined;
  advanceQueue: (queueType: "arrival" | "departure") => void;
  syncQueues: (arrivalQueue: string[], departureQueue: string[]) => void;

  // ========== Queue Reservations (ARC-004: single writer) ==========
  // Slots agents are walking toward but haven't formally joined yet, so two
  // agents never claim the same physical slot. Key: slot index -> agentId.
  queueReservations: {
    arrival: Map<number, string>;
    departure: Map<number, string>;
  };
  // Which agent occupies (or is walking to) the ready position A0/D0.
  readyOccupants: { arrival: string | null; departure: string | null };

  // Reservation mutators. QueueManager is the sole caller (stateless façade);
  // these are the only writes to the above state.
  setQueueReservation: (
    queueType: "arrival" | "departure",
    slotIndex: number,
    agentId: string,
  ) => void;
  clearQueueReservation: (
    queueType: "arrival" | "departure",
    agentId: string,
  ) => void;
  clearAgentReservations: (agentId: string) => void;
  resetQueueReservations: () => void;
  setReadyOccupant: (
    queueType: "arrival" | "departure",
    agentId: string | null,
  ) => void;

  // ========== Boss State ==========
  boss: BossAnimationState;

  // Boss actions
  updateBossBackendState: (state: BossState) => void;
  updateBossTask: (task: string | null) => void;
  updateBossActivity: (activity: Activity | null) => void;
  updateBossTurn: (turn: {
    stuck: StuckReason | null;
    turnActive: boolean;
    quietSince: number | null;
  }) => void;
  bossErrand: BossErrandState;
  setBossErrand: (errand: BossErrandState) => void;
  setBossInUse: (by: "arrival" | "departure" | null) => void;
  setBossTyping: (typing: boolean) => void;

  // ========== Bubble Actions (unified for boss and agents) ==========
  enqueueBubble: (entityId: string, content: BubbleContent) => void;
  advanceBubble: (entityId: string) => void;
  clearBubbles: (entityId: string) => void;
  getCurrentBubble: (entityId: string) => BubbleContent | null;
  isBubbleQueueEmpty: (entityId: string) => boolean;
  hasBubbleText: (entityId: string, text: string) => boolean;

  // ========== Office State ==========
  sessionId: string;
  snapshotSessionId: string | null; // Session whose state snapshot is applied
  eventLog: EventLogEntry[];
  codingAgent: string | null; // Coding agent running the session (name tag)

  // Office actions
  setSessionId: (id: string) => void;
  markSnapshot: (sessionId: string) => void;
  addEventLog: (event: NonNullable<WebSocketMessage["event"]>) => void;
  mergeEventHistory: (history: HistoryEntry[]) => void;
  setCodingAgent: (codingAgent: string | null) => void;

  // ========== UI State ==========
  isConnected: boolean;
  isReplaying: boolean;

  // UI actions
  setConnected: (connected: boolean) => void;
  setReplaying: (replaying: boolean) => void;

  // ========== Top-level Actions ==========
  reset: () => void;
  resetForSessionSwitch: () => void;
}

// ============================================================================
// INITIAL STATE (composed from each slice's initial fragment)
// ============================================================================

const initialState = {
  ...initialAgentState,
  ...initialQueueState,
  ...initialReservationState,
  ...initialBossSliceState,
  ...initialOfficeState,
  ...initialReplayState,
};

// ============================================================================
// STORE IMPLEMENTATION (composition root)
// ============================================================================

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get, api) => ({
    ...initialState,

    // --- Slices (ARC-005): each provides its own state + actions ---
    ...createAgentSlice(set, get, api),
    ...createQueueSlice(set, get, api),
    ...createReservationSlice(set, get, api),
    ...createBossSlice(set, get, api),
    ...createBubbleSlice(set, get, api),
    ...createOfficeSlice(set, get, api),
    ...createReplaySlice(set, get, api),

    // ========================================================================
    // TOP-LEVEL ACTIONS (cross-cutting: reset variants reconcile every slice)
    // ========================================================================

    reset: () =>
      set({
        ...initialState,
        agents: new Map(),
        boss: { ...initialBossState, bubble: createEmptyBubbleState() },
      }),

    resetForSessionSwitch: () =>
      set({
        // Reset all agent/game state but preserve UI settings
        agents: new Map(),
        arrivalQueue: [],
        departureQueue: [],
        queueReservations: {
          arrival: new Map(),
          departure: new Map(),
        },
        readyOccupants: { arrival: null, departure: null },
        boss: { ...initialBossState, bubble: createEmptyBubbleState() },
        bossErrand: initialBossErrandState,
        agentErrands: new Map(),
        sessionId: "None",
        snapshotSessionId: null,
        eventLog: [], // Clear event log for new session
        codingAgent: null,
        // Keep connection-related state
        isConnected: false,
        isReplaying: false, // Important: allow WebSocket to reconnect
      }),
  })),
);

// ============================================================================
// SELECTORS (for efficient subscriptions)
// ============================================================================

export const selectBoss = (state: GameStore) => state.boss;
/**
 * The session whose snapshot the page shows, or null while it waits for one
 * (before the first one, and just after a switch or reconnect clears the
 * store): until then the office and its panel show nobody, not the reset
 * store's lone, idle lead.
 */
export const selectShownSessionId = (state: GameStore): string | null =>
  state.snapshotSessionId !== null &&
  state.snapshotSessionId === state.sessionId
    ? state.snapshotSessionId
    : null;
export const selectIsConnected = (state: GameStore) => state.isConnected;
export const selectCodingAgent = (state: GameStore) => state.codingAgent;
