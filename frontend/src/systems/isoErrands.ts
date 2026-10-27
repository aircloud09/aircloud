/**
 * Errands in the isometric office (docs/plan/spec.md 동선 규칙): a person
 * walks to the room of the tool it is running and works there (rule 1),
 * stays ERRAND_LINGER_MS after the tool ends, finishing the walk first
 * (rule 2), turns at once when another tool starts, even mid-walk (rule 3),
 * and otherwise walks back to its seat and sits down (rule 4). Editing is
 * done at its own desk. On a break it goes to the break room instead: the
 * lounge sofa with its turn over, the cafe while its conversation is being
 * compacted. When the break ends it leaves at once, even on the way there
 * (docs/plan/spec.md 「라운지 · 카페」). A stuck person (a failed tool) stops where it is,
 * even mid-walk, and does not move until it moves on (rule 7).
 *
 * Subagents come and go by elevator (작성자 댓글): a newcomer steps out of
 * the cab and goes to work; one whose work is done walks to Claude, reports,
 * waves 「👋 퇴근합니다!」, has a coffee at the cafe, walks back into the cab
 * and is gone. Handed more work on the way, it turns back to work.
 *
 * `stepIsoWalker` is pure: the path finder and the spot a walker holds in a
 * room are passed in.
 */

import type { Activity } from "@/types";
import type { PathState } from "@/stores/slices/types";
import type {
  BreakRoomId,
  ErrandRoomId,
  IsoSpot,
} from "@/constants/isoFloorPlan";
import { ERRAND_LINGER_MS } from "./bossErrands";
import type { FloorPoint } from "./isoNavGrid";
import { advanceAlongPath } from "./pathFollow";

/** Where each activity sends a person (spec 「방 ↔ 도구」); editing stays at its desk. */
export const ROOM_FOR_ACTIVITY: Record<Activity, ErrandRoomId | "seat"> = {
  reading: "library",
  editing: "seat",
  running: "server",
  browsing: "search",
  planning: "meeting",
  asking: "mydesk",
};

/** Walking speed in metres per second. */
export const ISO_WALK_SPEED = 3.2;
/** How long a finished subagent tells Claude its result, then waves goodbye (ms). */
export const REPORT_MS = 3500;
export const BYE_MS = 1800;
/** How long it stops at the cafe for a coffee on its way out (ms). */
export const COFFEE_MS = 4000;

/** Sitting idle, typing at the desk, walking, working in a room, standing, or waving. */
export type IsoPose = "sit" | "type" | "walk" | "work" | "stand" | "wave";

/** A room a walker can be sent to: for a tool, or for a break. */
export type IsoRoomId = ErrandRoomId | BreakRoomId;

/** Where a walker is heading: its seat, a room, beside Claude, the elevator door or cab. */
export type IsoGoal = "seat" | IsoRoomId | "report" | "elevator" | "cab";

/** A subagent's way in or out of the office. */
export type IsoTrip =
  | { kind: "arrive" }
  | { kind: "report"; until: number | null }
  | { kind: "bye"; until: number }
  | { kind: "coffee"; until: number | null }
  | { kind: "leave" }
  | { kind: "board" }
  | { kind: "gone" };

export interface IsoElevator {
  door: IsoSpot;
  cab: IsoSpot;
}

export interface IsoWalker {
  x: number;
  z: number;
  facing: number;
  /** Where it is heading or staying. */
  goal: IsoGoal;
  /** Waypoints in metres (x, y = z) while walking. */
  path: PathState | null;
  pose: IsoPose;
  /** Set when its tool has ended: it stays in the room until then. */
  lingerUntil: number | null;
  /** On its way in or out by elevator. */
  trip: IsoTrip | null;
}

export interface IsoWalkerInput {
  activity: Activity | null;
  /** A failed tool: it stays where it is until it moves on. */
  stuck: boolean;
  seat: IsoSpot;
  /** The spot this walker holds in a room. */
  spotIn: (room: IsoRoomId) => IsoSpot;
  findPath: (from: FloorPoint, to: FloorPoint) => FloorPoint[];
  /** Milliseconds, the clock lingering is measured with. */
  now: number;
  /** Seconds since the last step. */
  dt: number;
  /** Its work is done: it reports to Claude and goes home. */
  leaving: boolean;
  /** With nothing to run it takes a break there: the lounge or the cafe. */
  breakRoom: BreakRoomId | null;
  /** Where it stands to report beside Claude (asked only while it leaves). */
  reportSpot: () => IsoSpot;
  elevator: IsoElevator;
}

/**
 * A walker settled in its seat, or in a room when ``goal`` is one (its first
 * step stands it up to work there).
 */
export function seatedWalker(
  seat: IsoSpot,
  goal: "seat" | IsoRoomId = "seat",
): IsoWalker {
  return {
    x: seat.x,
    z: seat.z,
    facing: seat.facing,
    goal,
    path: null,
    pose: "sit",
    lingerUntil: null,
    trip: null,
  };
}

function pathThrough(points: FloorPoint[]): PathState {
  return {
    waypoints: points.map((p) => ({ x: p.x, y: p.z })),
    currentIndex: 0,
    progress: 0,
  };
}

/** A newcomer in the elevator cab, stepping out of the door. */
export function arrivingWalker(elevator: IsoElevator): IsoWalker {
  const { cab, door } = elevator;
  return {
    x: cab.x,
    z: cab.z,
    facing: Math.atan2(door.x - cab.x, door.z - cab.z),
    goal: "elevator",
    path: pathThrough([cab, door]),
    pose: "walk",
    lingerUntil: null,
    trip: { kind: "arrive" },
  };
}

function spotFor(walker: IsoWalker, input: IsoWalkerInput): IsoSpot {
  switch (walker.goal) {
    case "seat":
      return input.seat;
    case "report":
      return input.reportSpot();
    case "elevator":
      return input.elevator.door;
    case "cab":
      return input.elevator.cab;
    default:
      return input.spotIn(walker.goal);
  }
}

/** How it looks once it is where it was going. */
function restingPose(walker: IsoWalker, input: IsoWalkerInput): IsoPose {
  if (walker.trip?.kind === "bye") return "wave";
  switch (walker.goal) {
    case "seat":
      return input.activity === "editing" ? "type" : "sit";
    case "lounge":
      return "sit";
    case "report":
    case "elevator":
    case "cab":
      return "stand";
    default:
      return "work";
  }
}

/**
 * Set off for ``goal``. The cab is off the floor's paths, so the steps in
 * and out of it are straight.
 */
function headTo(
  walker: IsoWalker,
  goal: IsoGoal,
  input: IsoWalkerInput,
  trip: IsoTrip | null = null,
  straight = false,
): IsoWalker {
  const turned = { ...walker, goal, trip, lingerUntil: null };
  const spot = spotFor(turned, input);
  const points = straight
    ? []
    : input.findPath({ x: walker.x, z: walker.z }, spot);
  // No way through (should not happen on this floor): step straight there.
  const route =
    points.length > 1 ? points : [{ x: walker.x, z: walker.z }, spot];
  return { ...turned, pose: "walk", path: pathThrough(route) };
}

const isBreakRoom = (goal: IsoGoal): goal is BreakRoomId =>
  goal === "lounge" || goal === "cafe";

/** Where its work sends it: the room of its tool, or its seat. */
const workGoal = (input: IsoWalkerInput): IsoGoal =>
  input.activity ? ROOM_FOR_ACTIVITY[input.activity] : "seat";

/** The next step home: to Claude, report, wave, a coffee, to the elevator, into the cab. */
function goHome(walker: IsoWalker, input: IsoWalkerInput): IsoWalker {
  const trip = walker.trip;
  switch (trip?.kind) {
    case undefined:
      return headTo(walker, "report", input, { kind: "report", until: null });
    case "arrive":
      // Finished before it was out of the cab: step out first.
      return walker.path
        ? walker
        : headTo(walker, "report", input, { kind: "report", until: null });
    case "report":
      if (walker.path) return walker;
      if (trip.until === null) {
        return {
          ...walker,
          trip: { kind: "report", until: input.now + REPORT_MS },
        };
      }
      return input.now < trip.until
        ? walker
        : { ...walker, trip: { kind: "bye", until: input.now + BYE_MS } };
    case "bye":
      return input.now < trip.until
        ? walker
        : headTo(walker, "cafe", input, { kind: "coffee", until: null });
    case "coffee":
      if (walker.path) return walker;
      if (trip.until === null) {
        return {
          ...walker,
          trip: { kind: "coffee", until: input.now + COFFEE_MS },
        };
      }
      return input.now < trip.until
        ? walker
        : headTo(walker, "elevator", input, { kind: "leave" });
    case "leave":
      return walker.path
        ? walker
        : headTo(walker, "cab", input, { kind: "board" }, true);
    case "board":
      return walker.path ? walker : { ...walker, trip: { kind: "gone" } };
    case "gone":
      return walker;
  }
}

/** Handed more work on its way out: back out of the cab, or straight to work. */
function backToWork(walker: IsoWalker, input: IsoWalkerInput): IsoWalker {
  if (walker.trip?.kind === "board") {
    return headTo(walker, "elevator", input, { kind: "arrive" }, true);
  }
  return headTo(walker, workGoal(input), input);
}

function advance(walker: IsoWalker, input: IsoWalkerInput): IsoWalker {
  if (!walker.path) {
    const pose = restingPose(walker, input);
    return pose === walker.pose ? walker : { ...walker, pose };
  }
  const step = advanceAlongPath(walker.path, ISO_WALK_SPEED * input.dt);
  if (step.arrived) {
    const spot = spotFor(walker, input);
    const arrived = {
      ...walker,
      x: spot.x,
      z: spot.z,
      facing: spot.facing,
      path: null,
    };
    return { ...arrived, pose: restingPose(arrived, input) };
  }
  const x = step.position.x;
  const z = step.position.y;
  const dx = x - walker.x;
  const dz = z - walker.z;
  return {
    ...walker,
    x,
    z,
    facing: dx !== 0 || dz !== 0 ? Math.atan2(dx, dz) : walker.facing,
    path: step.path,
  };
}

/** Move a walker one frame along the rules. */
export function stepIsoWalker(
  walker: IsoWalker,
  input: IsoWalkerInput,
): IsoWalker {
  const trip = walker.trip;
  if (trip?.kind === "gone") return walker;
  if (input.leaving) return advance(goHome(walker, input), input);
  if (trip && trip.kind !== "arrive") {
    return advance(backToWork(walker, input), input);
  }
  if (trip?.kind === "arrive") {
    // Out of the cab it goes to work; the step out is not cut short.
    return advance(
      walker.path ? walker : headTo(walker, workGoal(input), input),
      input,
    );
  }
  // Stuck: it stops right where it is, even mid-walk, and ponders there.
  if (input.stuck) {
    return walker.path || walker.lingerUntil !== null
      ? { ...walker, path: null, pose: "work", lingerUntil: null }
      : walker;
  }
  const wanted = input.activity ? ROOM_FOR_ACTIVITY[input.activity] : null;
  const home: IsoGoal = input.breakRoom ?? "seat";
  let next = walker;
  if (wanted) {
    next =
      next.goal === wanted
        ? { ...next, lingerUntil: null }
        : headTo(next, wanted, input);
  } else if (isBreakRoom(next.goal) && next.goal !== home) {
    // The break is over (or another began): off at once, even mid-walk.
    next = headTo(next, home, input);
  } else if (next.goal !== home && !next.path) {
    if (next.lingerUntil === null) {
      next = { ...next, lingerUntil: input.now + ERRAND_LINGER_MS };
    } else if (input.now >= next.lingerUntil) {
      next = headTo(next, home, input);
    }
  }
  return advance(next, input);
}
