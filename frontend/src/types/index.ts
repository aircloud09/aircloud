/**
 * Types barrel — re-exports backend-derived types from generated.ts and
 * defines purely-frontend types inline.
 *
 * Consumers can continue to import from "@/types" without changes.
 *
 * DO NOT hand-edit types that originate from backend Pydantic models.
 * Run `make gen-types` to regenerate generated.ts from the backend models.
 */

// ============================================================================
// GENERATED TYPES — re-exported from ./generated (do not edit)
// ============================================================================

export type {
  // Agents
  Activity,
  StuckReason,
  Agent,
  AgentState,
  Boss,
  BossState,
  // Common
  BubbleContent,
  BubbleType,
  SpeechContent,
  TodoStatus,
  TodoItem,
  // Sessions
  GameState,
  HistoryEntry,
  // Events (backend models)
  EventType,
  EventData,
  Event,
  // Overview (/ws/overview)
  OverviewEntry,
  OverviewState,
} from "./generated";

// Re-export the overview status bucket under a descriptive name
export type { Bucket as OverviewBucket } from "./generated";

// ============================================================================
// FRONTEND-ONLY TYPES — not derived from backend models
// ============================================================================

/**
 * 2D position with typed x/y coordinates.
 * The backend uses dict[str, int] (no named model), so this stays frontend-only.
 * The index signature makes this compatible with the generated Position type
 * (which is { [k: string]: number } from dict[str, int]).
 */
export interface Position {
  x: number;
  y: number;
  [k: string]: number;
}

/**
 * Shape of the optional event detail payload carried in WebSocket events.
 * Derived from the frontend event-log rendering requirements.
 */
export interface EventDetail {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  resultSummary?: string;
  message?: string;
  thinking?: string;
  errorType?: string;
  taskDescription?: string;
  agentName?: string;
  prompt?: string;
}

/**
 * WebSocket message types sent from the backend over the /ws endpoint.
 */
export interface WebSocketMessage {
  type: "state_update" | "event" | "reload" | "session_deleted" | "error";
  timestamp: string;
  state?: import("./generated").GameState;
  event?: {
    id: string;
    type: import("./generated").EventType;
    agentId: string;
    summary: string;
    timestamp: string;
    detail?: EventDetail;
  };
  session_id?: string;
  message?: string;
}
