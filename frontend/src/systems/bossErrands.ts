/**
 * Boss Errands
 *
 * The boss walks to the archive while a reading tool runs and to the server
 * room while a shell command runs (docs/plan/spec.md R1, R2), driven by the
 * backend's `boss.activity`. Movement rules (spec "동선 규칙"):
 * 1. A new activity sends the boss to that room's spot; on arrival it works there.
 * 2. When the activity ends the boss still finishes the walk, then lingers
 *    ERRAND_LINGER_MS at the spot before leaving, so a fast tool still shows
 *    a visible errand and back-to-back reads do not cause round trips.
 * 3. A different activity retargets the walk immediately, even mid-walk.
 * 4. With nothing to do the boss walks back to the desk and sits down.
 * 5. Desk duty wins: agents queued for the boss (or a handoff in progress)
 *    call the boss back to the desk.
 * 6. A stuck boss (failed tool, permission prompt) or one thinking long
 *    mid-turn ponders where it is (spec R3) and does not leave until it
 *    moves on. The one walk it still takes is to the room of the tool it is
 *    waiting on: a permission prompt arrives the moment the tool starts, and
 *    the boss waits for approval at the rack. Desk duty still calls it back.
 *
 * `stepBossErrand` is pure (the path finder is injected) and is ticked from
 * the single animation loop in animationSystem.
 */

import type { Activity, Position } from "@/types";
import type { BossErrandState, ErrandRoom } from "@/stores/slices/types";
import { initialBossErrandState } from "@/stores/slices/shared";
import { ARCHIVE_READING_SPOTS, SERVER_RACK_SPOTS } from "@/constants/rooms";
import { advanceAlongPath } from "./pathFollow";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Boss walking speed on errands (agents walk at 200 px/s) */
export const BOSS_ERRAND_SPEED = 260;

/** How long the boss stays in a room after its tool ends (ms) */
export const ERRAND_LINGER_MS = 1500;

/** A quiet spell mid-turn longer than this reads as thinking hard (ms) */
export const PONDER_AFTER_MS = 6000;

/** Where the boss stands in each room: the spot nearest the room's door */
export const BOSS_ERRAND_SPOTS: Record<ErrandRoom, Position> = {
  archive: ARCHIVE_READING_SPOTS[ARCHIVE_READING_SPOTS.length - 1],
  server: SERVER_RACK_SPOTS[0],
};

// ============================================================================
// TYPES
// ============================================================================

export interface BossErrandInput {
  /** Backend activity of the boss's current tool */
  activity: Activity | null;
  /** Agents are queued for the boss or a handoff is in progress */
  deskDuty: boolean;
  /** Backend marks the boss stuck (failed tool, permission prompt) */
  isStuck: boolean;
  /** Start of the current quiet spell mid-turn (same clock as `now`) */
  quietSince: number | null;
  /** Current time (ms, same clock as lingerUntil) */
  now: number;
  /** Time since the previous step */
  deltaSeconds: number;
}

/** Waypoints from one position to another; fewer than 2 means unreachable */
export type ErrandPathFinder = (from: Position, to: Position) => Position[];

export interface BossErrandStep {
  state: BossErrandState;
  /** True when the boss sat back down at the desk in this step */
  sat: boolean;
}

// ============================================================================
// LOGIC
// ============================================================================

/** The room an activity sends the boss to */
export function errandRoomFor(activity: Activity | null): ErrandRoom | null {
  if (activity === "reading") return "archive";
  if (activity === "running") return "server";
  return null;
}

/** True while the boss is in (or heading to) a room rather than at the desk */
function isOnErrand(state: BossErrandState): boolean {
  return state.phase === "walking" || state.phase === "working";
}

/** Where the boss should be heading right now */
function destinationFor(
  state: BossErrandState,
  input: BossErrandInput,
): ErrandRoom | "desk" {
  if (input.deskDuty) return "desk";
  const room = errandRoomFor(input.activity);
  if (room) return room;
  if (!state.room) return "desk";
  // The activity ended: finish the walk, then linger at the spot.
  if (state.phase === "walking") return state.room;
  if (
    state.phase === "working" &&
    state.lingerUntil !== null &&
    input.now < state.lingerUntil
  ) {
    return state.room;
  }
  return "desk";
}

/** Start a walk toward `to`; an unreachable target yields no path */
function walk(
  state: BossErrandState,
  to: Position,
  findPath: ErrandPathFinder,
): BossErrandState["path"] {
  const waypoints = findPath(state.position, to);
  return waypoints.length > 1
    ? { waypoints, currentIndex: 0, progress: 0 }
    : null;
}

/**
 * Advance the boss errand by one animation tick.
 */
export function stepBossErrand(
  state: BossErrandState,
  input: BossErrandInput,
  deskPosition: Position,
  findPath: ErrandPathFinder,
): BossErrandStep {
  const isPondering =
    !input.deskDuty &&
    (input.isStuck ||
      (input.quietSince !== null &&
        input.now - input.quietSince >= PONDER_AFTER_MS));
  if (isPondering) {
    let next = state.pondering ? state : { ...state, pondering: true };
    const toolRoom = errandRoomFor(input.activity);
    if (toolRoom && (next.room !== toolRoom || !isOnErrand(next))) {
      next = walkTo(next, toolRoom, deskPosition, findPath);
    }
    return move(next, input);
  }
  if (state.pondering) state = { ...state, pondering: false };

  // Linger clock: starts once the boss is at the spot with no activity
  // left, and is cleared whenever an activity is running.
  let lingerUntil = state.lingerUntil;
  if (errandRoomFor(input.activity)) {
    lingerUntil = null;
  } else if (lingerUntil === null && state.phase === "working") {
    lingerUntil = input.now + ERRAND_LINGER_MS;
  }
  let next: BossErrandState =
    lingerUntil === state.lingerUntil ? state : { ...state, lingerUntil };

  const destination = destinationFor(next, input);

  if (destination === "desk") {
    if (next.phase === "seated") return { state: next, sat: false };
    if (next.phase !== "returning") {
      next = {
        ...next,
        phase: "returning",
        lingerUntil: null,
        path: walk(next, deskPosition, findPath),
      };
    }
  } else if (next.room !== destination || !isOnErrand(next)) {
    next = walkTo(next, destination, deskPosition, findPath);
  }

  return move(next, input);
}

/** Start walking to a room's spot (from the desk when seated) */
function walkTo(
  state: BossErrandState,
  room: ErrandRoom,
  deskPosition: Position,
  findPath: ErrandPathFinder,
): BossErrandState {
  const from =
    state.phase === "seated" ? { ...state, position: deskPosition } : state;
  return {
    ...from,
    phase: "walking",
    room,
    lingerUntil: null,
    path: walk(from, BOSS_ERRAND_SPOTS[room], findPath),
  };
}

/** Advance along the current path; arriving settles at the spot or desk */
function move(next: BossErrandState, input: BossErrandInput): BossErrandStep {
  const seated: BossErrandState = {
    ...initialBossErrandState,
    pondering: next.pondering,
  };
  if (!next.path) {
    // Arrived earlier, or the target is unreachable: settle where we are.
    if (next.phase === "returning") return { state: seated, sat: true };
    if (next.phase === "walking") {
      return { state: { ...next, phase: "working" }, sat: false };
    }
    return { state: next, sat: false };
  }

  const step = advanceAlongPath(
    next.path,
    BOSS_ERRAND_SPEED * input.deltaSeconds,
  );
  if (!step.arrived) {
    return {
      state: { ...next, position: step.position, path: step.path },
      sat: false,
    };
  }
  if (next.phase === "returning") return { state: seated, sat: true };
  return {
    state: { ...next, phase: "working", position: step.position, path: null },
    sat: false,
  };
}
