/**
 * Shared store-level types (ARC-005).
 *
 * Extracted from gameStore.ts so each slice can import the types it needs
 * without a runtime dependency back to the store composition root. All types
 * are re-exported from gameStore.ts so existing `import { ... } from
 * "@/stores/gameStore"` consumers are unchanged.
 */
import type {
  Activity,
  StuckReason,
  Position,
  BubbleContent,
  BossState,
  AgentState as BackendAgentState,
  WebSocketMessage,
  EventDetail,
} from "@/types";

/**
 * Frontend-controlled agent phases for queue choreography.
 * These are distinct from backend AgentState which tracks work status.
 */
export type AgentPhase =
  | "idle" // At desk, working
  | "arriving" // Just spawned, walking to queue
  | "in_arrival_queue" // Waiting in arrival queue
  | "walking_to_ready" // Moving to position 0 (ready to talk spot)
  | "conversing" // At position 0, talking to boss
  | "walking_to_boss" // Moving to boss desk slot
  | "at_boss" // Brief pause at boss desk
  | "walking_to_desk" // Moving from boss to assigned desk
  | "departing" // Removed from backend, walking to queue
  | "in_departure_queue" // Waiting in departure queue
  | "walking_to_elevator" // Moving from boss to elevator
  | "in_elevator"; // In elevator, about to be removed

/**
 * Path state for an agent following waypoints.
 */
export interface PathState {
  waypoints: Position[];
  currentIndex: number;
  progress: number; // 0-1 along current segment
  speed?: number; // px/s; defaults to the regular agent walking speed
}

/**
 * Bubble state with queue for ensuring minimum display time.
 */
export interface BubbleState {
  content: BubbleContent | null;
  displayStartTime: number | null;
  queue: BubbleContent[];
}

/**
 * Complete animation state for an agent (frontend-owned).
 */
export interface AgentAnimationState {
  // Identity (from backend)
  id: string;
  name: string | null;
  color: string;
  number: number;
  desk: number | null;
  backendState: BackendAgentState;
  currentTask: string | null;
  activity: Activity | null; // Backend tool activity (archive / server room)
  stuck: StuckReason | null; // Failed tool / permission wait: ponder at the desk
  characterType: string | null;
  agentType: string | null; // Subagent type it was started as, e.g. "general-purpose"
  parentSessionId: string | null;
  parentId: string | null;

  // Phase tracking (frontend owned)
  phase: AgentPhase;

  // Position state (frontend owned)
  currentPosition: Position;
  targetPosition: Position;
  path: PathState | null;

  // Bubble state (frontend owned)
  bubble: BubbleState;

  // Queue metadata
  queueType: "arrival" | "departure" | null;
  queueIndex: number; // Position in queue (-1 = not in queue)

  // Animation state
  isTyping: boolean; // True when agent is actively using tools
}

/**
 * Boss animation state.
 */
export interface BossAnimationState {
  backendState: BossState;
  position: Position;
  bubble: BubbleState;
  inUseBy: "arrival" | "departure" | null;
  currentTask: string | null;
  activity: Activity | null; // Backend tool activity (archive / server room)
  stuck: StuckReason | null; // Failed tool / permission wait: ponder on the spot
  turnActive: boolean; // A user prompt is being worked on
  // When the boss went quiet mid-turn (no tool, not stuck), from
  // performance.now(); a long quiet spell means it is thinking hard.
  quietSince: number | null;
  isTyping: boolean; // True when boss is actively using tools (typing animation)
}

/** Room the boss walks to for an errand (docs/plan/spec.md R1, R2). */
export type ErrandRoom = "archive" | "server";

/**
 * Boss errand phases:
 * - seated: at the desk (the regular BossSprite)
 * - walking: heading to a room spot
 * - working: at the spot (reading a book / at the rack)
 * - returning: heading back to the desk
 */
export type BossErrandPhase = "seated" | "walking" | "working" | "returning";

/**
 * Frontend-owned errand choreography for the boss (systems/bossErrands.ts).
 * `position` is the walking boss's body center; `lingerUntil` (ms, from
 * performance.now) keeps the boss in a room briefly after its tool ends so
 * back-to-back reads do not cause round trips.
 */
export interface BossErrandState {
  phase: BossErrandPhase;
  /** Pondering on the spot (stuck or thinking long): the boss does not move */
  pondering: boolean;
  room: ErrandRoom | null;
  position: Position;
  path: PathState | null;
  lingerUntil: number | null;
}

/**
 * Errand of an agent seated at its desk (systems/agentErrands.ts). The agent
 * walks with its regular path movement; this tracks where it is going and
 * which room spot it holds. Phases mirror BossErrandPhase.
 */
export interface AgentErrandState {
  phase: BossErrandPhase;
  room: ErrandRoom | null;
  /** Reserved standing spot (agent position convention), null when seated */
  spot: Position | null;
  lingerUntil: number | null;
  /** Stuck at the spot: chin in hand, not leaving */
  pondering: boolean;
}

/**
 * Event log entry for display.
 */
export type EventLogEntry = Omit<
  NonNullable<WebSocketMessage["event"]>,
  "timestamp"
> & { timestamp: Date; detail?: EventDetail };

/**
 * One agent's position/path delta for a single animation tick (ARC-006).
 * `path` is optional: omit to leave the path unchanged, pass null to clear it.
 */
export interface AgentMovement {
  agentId: string;
  position: Position;
  path?: PathState | null;
}
