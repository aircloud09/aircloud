/**
 * Tests for the pure spawn-policy branch extracted from useWebSocketEvents
 * (ARC-018). `resolveSpawn()` was previously trapped in the hook's
 * `handleStateUpdate` closure — untestable in isolation. It is now a pure
 * function of `(backendAgent, state)` and these tests pin all four branches
 * plus the fallback.
 *
 * Note: full `reconcileState()` integration tests (which require mocking
 * `useGameStore` + `agentMachineService`) are deferred to QA-005 / ARC-007 —
 * out of scope for this ARC-018 cut.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  reconcileState,
  resolveSpawn,
  type ReconcilerContext,
} from "@/systems/stateReconciler";
import { useGameStore } from "@/stores/gameStore";
import { resetSpawnIndex } from "@/systems/queuePositions";
import {
  ARRIVAL_QUEUE_POSITIONS,
  DEPARTURE_QUEUE_POSITIONS,
  ELEVATOR_SPAWN_POSITIONS,
  getDeskPosition,
} from "@/systems/queuePositions";
import type { Agent, GameState } from "@/types";

/** Build a minimal valid Agent for testing. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    color: "#ff0000",
    number: 1,
    state: "working",
    ...overrides,
  };
}

/** Build a minimal valid GameState for testing. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    sessionId: "session-1",
    boss: { state: "idle" },
    agents: [],
    lastUpdated: "0",
    ...overrides,
  };
}

describe("resolveSpawn", () => {
  beforeEach(() => resetSpawnIndex());

  it("branch 1: arriving agent spawns from the elevator (no skip)", () => {
    const agent = makeAgent({ id: "a1", state: "arriving" });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(false);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    // First elevator slot after a reset.
    expect(decision.spawnPosition).toEqual(ELEVATOR_SPAWN_POSITIONS[0]);
  });

  it("branch 2: agent in arrival queue spawns at queue position and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBe("arrival");
    expect(decision.queueIndex).toBe(0);
    // arrivalQueueIndex 0 → getQueuePosition("arrival", 1) = ARRIVAL_QUEUE_POSITIONS[1].
    expect(decision.spawnPosition).toEqual(ARRIVAL_QUEUE_POSITIONS[1]);
  });

  it("branch 3: agent in departure queue spawns at queue position and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      departureQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBe("departure");
    expect(decision.queueIndex).toBe(0);
    // departureQueueIndex 0 → getQueuePosition("departure", 1) = DEPARTURE_QUEUE_POSITIONS[1].
    expect(decision.spawnPosition).toEqual(DEPARTURE_QUEUE_POSITIONS[1]);
  });

  it("branch 4: working agent with a desk spawns at the desk and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "working", desk: 3 });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    expect(decision.spawnPosition).toEqual(getDeskPosition(3));
  });

  it("fallback: not arriving, not queued, no desk → elevator spawn, no skip", () => {
    const agent = makeAgent({ id: "a1", state: "working" });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(false);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    expect(decision.spawnPosition).toEqual(ELEVATOR_SPAWN_POSITIONS[0]);
  });

  it("arrival queue takes precedence over departure queue when both contain the id", () => {
    // (Backend should never put an id in both, but the branch order matters:
    // arrival is checked first.)
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
      departureQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueType).toBe("arrival");
    expect(decision.queueIndex).toBe(0);
  });

  it("non-arriving state in arrival queue still uses the queue-position branch (only 'arriving' forces branch 1)", () => {
    // 'leaving' is a valid non-arriving AgentState; the branch must NOT take
    // the elevator-spawn path because state !== "arriving".
    const agent = makeAgent({ id: "a1", state: "leaving" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueType).toBe("arrival");
    expect(decision.skipArrival).toBe(true);
  });

  it("higher arrival-queue index maps to a deeper queue position", () => {
    const agent = makeAgent({ id: "a2", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1", "a2"], // a2 is at index 1
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueIndex).toBe(1);
    // index 1 → getQueuePosition("arrival", 2) = ARRIVAL_QUEUE_POSITIONS[2].
    expect(decision.spawnPosition).toEqual(ARRIVAL_QUEUE_POSITIONS[2]);
  });
});

describe("reconcileState — tool activity", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  const ctx = (): ReconcilerContext => ({
    currentSessionId: "session-1",
    processedAgents: new Set<string>(),
    lastSeenBubbleText: new Map<string, string>(),
    initialQueueSyncDone: { current: "session-1" },
  });

  it("copies the boss activity and clears it when the backend drops it", () => {
    reconcileState(
      makeState({ boss: { state: "working", activity: "reading" } }),
      ctx(),
    );
    expect(useGameStore.getState().boss.activity).toBe("reading");

    reconcileState(makeState({ boss: { state: "idle" } }), ctx());
    expect(useGameStore.getState().boss.activity).toBeNull();
  });

  it("copies an existing agent's activity", () => {
    const agent = makeAgent({ id: "agent-7" });
    useGameStore.getState().addAgent(agent, { x: 0, y: 0 });
    const context = ctx();
    context.processedAgents.add("agent-7");

    reconcileState(
      makeState({ agents: [{ ...agent, activity: "running" }] }),
      context,
    );
    expect(useGameStore.getState().agents.get("agent-7")?.activity).toBe(
      "running",
    );

    reconcileState(makeState({ agents: [agent] }), context);
    expect(useGameStore.getState().agents.get("agent-7")?.activity).toBeNull();
  });
});

describe("reconcileState — pondering inputs", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  const ctx = (): ReconcilerContext => ({
    currentSessionId: "session-1",
    processedAgents: new Set<string>(),
    lastSeenBubbleText: new Map<string, string>(),
    initialQueueSyncDone: { current: "session-1" },
  });

  it("starts a quiet spell mid-turn and keeps its start across updates", () => {
    const context = ctx();
    reconcileState(
      makeState({ boss: { state: "idle", turnActive: true } }),
      context,
    );
    const since = useGameStore.getState().boss.quietSince;
    expect(since).not.toBeNull();

    reconcileState(
      makeState({ boss: { state: "idle", turnActive: true } }),
      context,
    );
    expect(useGameStore.getState().boss.quietSince).toBe(since);
  });

  it("is not quiet outside a turn, while a tool runs, or when stuck", () => {
    for (const boss of [
      { state: "idle" as const, turnActive: false },
      {
        state: "working" as const,
        turnActive: true,
        activity: "running" as const,
      },
      {
        state: "idle" as const,
        turnActive: true,
        stuck: "tool_failed" as const,
      },
    ]) {
      reconcileState(makeState({ boss }), ctx());
      expect(useGameStore.getState().boss.quietSince).toBeNull();
    }
    expect(useGameStore.getState().boss.stuck).toBe("tool_failed");
  });

  it("copies an agent's stuck reason", () => {
    const agent = makeAgent({ id: "agent-9" });
    useGameStore.getState().addAgent(agent, { x: 0, y: 0 });
    const context = ctx();
    context.processedAgents.add("agent-9");
    reconcileState(
      makeState({ agents: [{ ...agent, stuck: "waiting_permission" }] }),
      context,
    );
    expect(useGameStore.getState().agents.get("agent-9")?.stuck).toBe(
      "waiting_permission",
    );
  });
});

describe("reconcileState — event history", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  const ctx = (): ReconcilerContext => ({
    currentSessionId: "session-1",
    processedAgents: new Set<string>(),
    lastSeenBubbleText: new Map<string, string>(),
    initialQueueSyncDone: { current: "session-1" },
  });

  it("shows a finished session's history in the event log", () => {
    reconcileState(
      makeState({
        history: [
          {
            id: "1",
            type: "session_start",
            agentId: "main",
            summary: "Session started",
            timestamp: "2026-10-20T00:00:01Z",
            detail: {},
          },
          {
            id: "2",
            type: "stop",
            agentId: "main",
            summary: "Done",
            timestamp: "2026-10-20T00:00:02Z",
            detail: {},
          },
        ],
      }),
      ctx(),
    );
    expect(
      useGameStore.getState().eventLog.map((entry) => entry.summary),
    ).toEqual(["Done", "Session started"]);
  });
});

describe("reconcileState — coding agent", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  const ctx = (): ReconcilerContext => ({
    currentSessionId: "session-1",
    processedAgents: new Set<string>(),
    lastSeenBubbleText: new Map<string, string>(),
    initialQueueSyncDone: { current: "session-1" },
  });

  it("copies the session's coding agent for the boss's name tag", () => {
    reconcileState(makeState({ codingAgent: "opencode" }), ctx());
    expect(useGameStore.getState().codingAgent).toBe("opencode");

    reconcileState(makeState(), ctx());
    expect(useGameStore.getState().codingAgent).toBeNull();
  });
});

describe("reconcileState — returning agents", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  const ctx = (): ReconcilerContext => ({
    currentSessionId: "session-1",
    processedAgents: new Set<string>(),
    lastSeenBubbleText: new Map<string, string>(),
    initialQueueSyncDone: { current: "session-1" },
  });

  it("brings back an agent that went home and is handed more work under the same id", () => {
    const context = ctx();
    reconcileState(
      makeState({ agents: [makeAgent({ id: "sa1", state: "arriving" })] }),
      context,
    );
    expect(useGameStore.getState().agents.has("sa1")).toBe(true);

    // It finished and left the office.
    useGameStore.getState().removeAgent("sa1");
    reconcileState(makeState({ agents: [] }), context);
    expect(useGameStore.getState().agents.has("sa1")).toBe(false);

    // The same id comes back to work.
    reconcileState(
      makeState({ agents: [makeAgent({ id: "sa1", state: "arriving" })] }),
      context,
    );
    expect(useGameStore.getState().agents.get("sa1")?.backendState).toBe(
      "arriving",
    );
  });

  it("lets a returning agent say again what it said last time", () => {
    const context = ctx();
    context.lastSeenBubbleText.set("sa1", "Found it in src/auth.py.");
    context.processedAgents.add("sa1");

    reconcileState(
      makeState({ agents: [makeAgent({ id: "sa1", state: "arriving" })] }),
      context,
    );
    expect(context.lastSeenBubbleText.has("sa1")).toBe(false);
  });

  it("does not bring back an agent the backend still lists as finished", () => {
    const context = ctx();
    reconcileState(
      makeState({ agents: [makeAgent({ id: "sa1", state: "working" })] }),
      context,
    );
    useGameStore.getState().removeAgent("sa1");

    reconcileState(
      makeState({ agents: [makeAgent({ id: "sa1", state: "waiting" })] }),
      context,
    );
    expect(useGameStore.getState().agents.has("sa1")).toBe(false);
  });
});

describe("reconcileState — snapshot", () => {
  beforeEach(() => {
    useGameStore.getState().resetForSessionSwitch();
  });

  it("marks the session's snapshot as applied, and a switch clears it", () => {
    expect(useGameStore.getState().snapshotSessionId).toBeNull();
    reconcileState(makeState(), {
      currentSessionId: "session-1",
      processedAgents: new Set<string>(),
      lastSeenBubbleText: new Map<string, string>(),
      initialQueueSyncDone: { current: "session-1" },
    });
    expect(useGameStore.getState().snapshotSessionId).toBe("session-1");
    useGameStore.getState().resetForSessionSwitch();
    expect(useGameStore.getState().snapshotSessionId).toBeNull();
  });

  it("ignores another session's snapshot", () => {
    reconcileState(makeState({ sessionId: "old" }), {
      currentSessionId: "session-1",
      processedAgents: new Set<string>(),
      lastSeenBubbleText: new Map<string, string>(),
      initialQueueSyncDone: { current: "session-1" },
    });
    expect(useGameStore.getState().snapshotSessionId).toBeNull();
  });
});
