/**
 * Agent errand decisions (systems/agentErrands.ts). Agents walk with their
 * regular path movement, so these tests stand in for it: a walk "arrives"
 * by setting the position to the target with isMoving false.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_ERRAND_SPOTS,
  SEATED_AGENT_ERRAND,
  freeSpotsFor,
  stepAgentErrand,
  type AgentErrandInput,
} from "@/systems/agentErrands";
import { ERRAND_LINGER_MS } from "@/systems/bossErrands";
import type { AgentErrandState } from "@/stores/slices/types";
import type { Position } from "@/types";

const DESK: Position = { x: 256, y: 432 };
const ARCHIVE_SPOT = AGENT_ERRAND_SPOTS.archive[0];
const SERVER_SPOT = AGENT_ERRAND_SPOTS.server[0];

function input(overrides: Partial<AgentErrandInput> = {}): AgentErrandInput {
  return {
    activity: null,
    isStuck: false,
    position: DESK,
    isMoving: false,
    desk: DESK,
    freeSpots: { archive: ARCHIVE_SPOT, server: SERVER_SPOT },
    now: 0,
    ...overrides,
  };
}

/** Walk to the archive and arrive, returning the working state. */
function arriveInArchive(): AgentErrandState {
  const leave = stepAgentErrand(
    SEATED_AGENT_ERRAND,
    input({ activity: "reading" }),
  );
  const arrived = stepAgentErrand(
    leave.state,
    input({ activity: "reading", position: ARCHIVE_SPOT }),
  );
  return arrived.state;
}

describe("stepAgentErrand", () => {
  it("walks a reading agent to a free archive spot", () => {
    const { state, walkTo } = stepAgentErrand(
      SEATED_AGENT_ERRAND,
      input({ activity: "reading" }),
    );
    expect(state.phase).toBe("walking");
    expect(state.room).toBe("archive");
    expect(state.spot).toEqual(ARCHIVE_SPOT);
    expect(walkTo).toEqual(ARCHIVE_SPOT);
  });

  it("works at the spot once the walk arrives", () => {
    const leave = stepAgentErrand(
      SEATED_AGENT_ERRAND,
      input({ activity: "reading" }),
    );
    const walking = stepAgentErrand(
      leave.state,
      input({
        activity: "reading",
        position: { x: 200, y: 700 },
        isMoving: true,
      }),
    );
    expect(walking.walkTo).toBeNull();
    expect(walking.state.phase).toBe("walking");
    expect(arriveInArchive().phase).toBe("working");
  });

  it("lingers after the tool ends, then walks back and frees the spot", () => {
    const working = arriveInArchive();
    const lingering = stepAgentErrand(
      working,
      input({ position: ARCHIVE_SPOT, now: 1000 }),
    );
    expect(lingering.state.phase).toBe("working");
    expect(lingering.walkTo).toBeNull();

    const back = stepAgentErrand(
      lingering.state,
      input({ position: ARCHIVE_SPOT, now: 1000 + ERRAND_LINGER_MS + 1 }),
    );
    expect(back.state.phase).toBe("returning");
    expect(back.state.spot).toBeNull();
    expect(back.walkTo).toEqual(DESK);

    const seated = stepAgentErrand(
      back.state,
      input({ position: DESK, now: 5000 }),
    );
    expect(seated.state).toBe(SEATED_AGENT_ERRAND);
  });

  it("works at the desk when the room is full", () => {
    const { state, walkTo } = stepAgentErrand(
      SEATED_AGENT_ERRAND,
      input({
        activity: "reading",
        freeSpots: { archive: null, server: SERVER_SPOT },
      }),
    );
    expect(state).toBe(SEATED_AGENT_ERRAND);
    expect(walkTo).toBeNull();
  });

  it("goes straight from the archive to the server room", () => {
    const { state, walkTo } = stepAgentErrand(
      arriveInArchive(),
      input({ activity: "running", position: ARCHIVE_SPOT }),
    );
    expect(state.phase).toBe("walking");
    expect(state.room).toBe("server");
    expect(walkTo).toEqual(SERVER_SPOT);
  });

  it("stays put while stuck and lingers once unstuck", () => {
    const stuck = stepAgentErrand(
      arriveInArchive(),
      input({ isStuck: true, position: ARCHIVE_SPOT, now: 1000 }),
    );
    expect(stuck.state.pondering).toBe(true);
    const stillStuck = stepAgentErrand(
      stuck.state,
      input({ isStuck: true, position: ARCHIVE_SPOT, now: 60_000 }),
    );
    expect(stillStuck.state.phase).toBe("working");
    expect(stillStuck.walkTo).toBeNull();

    const unstuck = stepAgentErrand(
      stillStuck.state,
      input({ position: ARCHIVE_SPOT, now: 61_000 }),
    );
    expect(unstuck.state.pondering).toBe(false);
    expect(unstuck.state.phase).toBe("working");
  });

  it("re-issues an interrupted walk", () => {
    const leave = stepAgentErrand(
      SEATED_AGENT_ERRAND,
      input({ activity: "reading" }),
    );
    const stalled = stepAgentErrand(
      leave.state,
      input({
        activity: "reading",
        position: { x: 300, y: 860 },
        isMoving: false,
      }),
    );
    expect(stalled.walkTo).toEqual(ARCHIVE_SPOT);
  });
});

describe("freeSpotsFor", () => {
  const working = (spot: Position): AgentErrandState => ({
    phase: "working",
    room: "archive",
    spot,
    lingerUntil: null,
    pondering: false,
  });

  it("skips spots other agents hold, but not the asking agent's own", () => {
    const errands = new Map<string, AgentErrandState>([
      ["a", working(AGENT_ERRAND_SPOTS.archive[0])],
      ["b", working(AGENT_ERRAND_SPOTS.archive[1])],
    ]);
    expect(freeSpotsFor(errands, "c").archive).toEqual(
      AGENT_ERRAND_SPOTS.archive[2],
    );
    expect(freeSpotsFor(errands, "a").archive).toEqual(
      AGENT_ERRAND_SPOTS.archive[0],
    );
    expect(freeSpotsFor(errands, "c").server).toEqual(
      AGENT_ERRAND_SPOTS.server[0],
    );
  });

  it("runs out once every spot is held", () => {
    const errands = new Map<string, AgentErrandState>(
      AGENT_ERRAND_SPOTS.archive.map((spot, i) => [
        `agent-${i}`,
        working(spot),
      ]),
    );
    expect(freeSpotsFor(errands, "late").archive).toBeNull();
  });
});
