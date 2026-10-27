/**
 * Agent Errands
 *
 * Agents seated at their desks walk to the archive while a reading tool runs
 * and to the server room while a shell command runs, like the boss
 * (bossErrands.ts, docs/plan/spec.md R1, R2). Agents keep moving with their
 * regular path movement (animationSystem); this module only decides where
 * each one goes.
 *
 * Differences from the boss:
 * - Each agent reserves a standing spot in the room (AGENT_*_SPOTS). With no
 *   free spot it keeps working at its desk.
 * - No desk duty. Once an agent leaves its desk phase
 *   (departure), its state machine owns it again and the errand is dropped
 *   where it stands, so it walks out from the room instead of teleporting.
 * - Only stuck pondering (failed tool, permission prompt): agents have no
 *   turn to think long in.
 */

import type { Activity, Position } from "@/types";
import type { AgentErrandState, ErrandRoom } from "@/stores/slices/types";
import { AGENT_ARCHIVE_SPOTS, AGENT_SERVER_SPOTS } from "@/constants/rooms";
import { ERRAND_LINGER_MS, errandRoomFor } from "./bossErrands";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Standing spots per room, front row first */
export const AGENT_ERRAND_SPOTS: Record<ErrandRoom, Position[]> = {
  archive: AGENT_ARCHIVE_SPOTS,
  server: AGENT_SERVER_SPOTS,
};

/**
 * Walking speed on errands (px/s). Faster than the regular 200 px/s so a
 * trip from the far desk row keeps up with a short tool call.
 */
export const AGENT_ERRAND_SPEED = 280;

/** How close counts as arrived (px) */
const ARRIVAL_TOLERANCE = 4;

export const SEATED_AGENT_ERRAND: AgentErrandState = {
  phase: "seated",
  room: null,
  spot: null,
  lingerUntil: null,
  pondering: false,
};

// ============================================================================
// TYPES
// ============================================================================

export interface AgentErrandInput {
  /** Backend activity of the agent's current tool */
  activity: Activity | null;
  /** Backend marks the agent stuck (failed tool, permission prompt) */
  isStuck: boolean;
  /** Agent's current position */
  position: Position;
  /** The agent is following a path */
  isMoving: boolean;
  /** The agent's seat at its desk */
  desk: Position;
  /** First spot per room not reserved by another agent */
  freeSpots: Record<ErrandRoom, Position | null>;
  /** Current time (ms, same clock as lingerUntil) */
  now: number;
}

export interface AgentErrandStep {
  state: AgentErrandState;
  /** Where to start walking now, if anywhere */
  walkTo: Position | null;
}

// ============================================================================
// LOGIC
// ============================================================================

function isNear(a: Position, b: Position | null): boolean {
  return b !== null && Math.hypot(a.x - b.x, a.y - b.y) <= ARRIVAL_TOLERANCE;
}

function isOnErrand(state: AgentErrandState): boolean {
  return state.phase === "walking" || state.phase === "working";
}

/**
 * First spot of each room that no other agent holds.
 *
 * @param errands - Current errands of all agents
 * @param agentId - The agent asking (its own reservation counts as free)
 */
export function freeSpotsFor(
  errands: Map<string, AgentErrandState>,
  agentId: string,
): Record<ErrandRoom, Position | null> {
  const taken = new Set<string>();
  for (const [id, errand] of errands) {
    if (id !== agentId && errand.spot) {
      taken.add(`${errand.spot.x},${errand.spot.y}`);
    }
  }
  const firstFree = (spots: Position[]): Position | null =>
    spots.find((s) => !taken.has(`${s.x},${s.y}`)) ?? null;
  return {
    archive: firstFree(AGENT_ERRAND_SPOTS.archive),
    server: firstFree(AGENT_ERRAND_SPOTS.server),
  };
}

/**
 * Decide one agent's errand for this tick.
 */
export function stepAgentErrand(
  state: AgentErrandState,
  input: AgentErrandInput,
): AgentErrandStep {
  let next = state;

  // Arrivals: the walk itself is done by the regular path movement.
  if (
    next.phase === "walking" &&
    !input.isMoving &&
    isNear(input.position, next.spot)
  ) {
    next = { ...next, phase: "working" };
  }
  if (
    next.phase === "returning" &&
    !input.isMoving &&
    isNear(input.position, input.desk)
  ) {
    next = SEATED_AGENT_ERRAND;
  }

  if (next.pondering !== input.isStuck) {
    next = { ...next, pondering: input.isStuck };
  }

  // Linger clock: starts at the spot once the tool is over (not while
  // pondering), cleared whenever a tool runs.
  const toolRoom = errandRoomFor(input.activity);
  let lingerUntil = next.lingerUntil;
  if (toolRoom) {
    lingerUntil = null;
  } else if (
    lingerUntil === null &&
    next.phase === "working" &&
    !input.isStuck
  ) {
    lingerUntil = input.now + ERRAND_LINGER_MS;
  }
  if (lingerUntil !== next.lingerUntil) next = { ...next, lingerUntil };

  // Where to: the tool's room; otherwise finish the walk, linger, or sit.
  let destination: ErrandRoom | "desk" | "stay";
  if (toolRoom) {
    destination = toolRoom;
  } else if (input.isStuck || next.phase === "seated") {
    destination = "stay";
  } else if (next.phase === "walking" && next.room) {
    destination = next.room;
  } else if (
    next.phase === "working" &&
    next.room &&
    next.lingerUntil !== null &&
    input.now < next.lingerUntil
  ) {
    destination = next.room;
  } else {
    destination = "desk";
  }

  if (destination !== "desk" && destination !== "stay") {
    if (isOnErrand(next) && next.room === destination) {
      // Heading there or already there. Re-issue an interrupted walk.
      const resume =
        next.phase === "walking" && !input.isMoving ? next.spot : null;
      return { state: next, walkTo: resume };
    }
    const spot = input.freeSpots[destination];
    if (spot) {
      return {
        state: {
          ...next,
          phase: "walking",
          room: destination,
          spot,
          lingerUntil: null,
        },
        walkTo: spot,
      };
    }
    // Room full: work at the desk instead.
    destination = next.phase === "seated" ? "stay" : "desk";
  }

  if (destination === "desk") {
    if (next.phase === "returning") {
      // Re-issue an interrupted walk back.
      return { state: next, walkTo: input.isMoving ? null : input.desk };
    }
    if (next.phase !== "seated") {
      return {
        state: {
          ...next,
          phase: "returning",
          room: null,
          spot: null,
          lingerUntil: null,
        },
        walkTo: input.desk,
      };
    }
  }

  return { state: next, walkTo: null };
}
