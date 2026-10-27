/**
 * Characterization tests for `gameStore` — queue choreography, bubble
 * subsystem, the three reset variants, and `updateAgentMeta`.
 *
 * These tests pin EXISTING behavior so the planned frontend refactors
 * (ARC-004/005/006/017, QA-003/006) cannot silently change it. They assert
 * only on FINAL store state (after each action fully resolves), which survives
 * the QA-006 "collapse dequeue's two `set()` calls into one" fix.
 *
 * Add tests only — no source changes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { selectShownSessionId, useGameStore } from "@/stores/gameStore";
import type {
  Agent,
  BubbleContent,
  EventType,
  HistoryEntry,
  Position,
  WebSocketMessage,
} from "@/types";

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

const ORIGIN: Position = { x: 0, y: 0 };

/** Minimal backend Agent fixture; tests override fields as needed. */
function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    color: "#ff0000",
    number: 1,
    state: "working",
    ...overrides,
  };
}

function addAgent(id: string, overrides: Partial<Agent> = {}): void {
  useGameStore.getState().addAgent(makeAgent(id, overrides), ORIGIN);
}

const BUBBLE: BubbleContent = { type: "speech", text: "hi" };
const BUBBLE_B: BubbleContent = { type: "speech", text: "yo" };

/** Reset the store before every test so order never matters. */
beforeEach(() => {
  useGameStore.getState().reset();
});

// ---------------------------------------------------------------------------
// ADD / REMOVE
// ---------------------------------------------------------------------------

describe("addAgent", () => {
  it("inserts an agent with frontend-owned phase/queue defaults", () => {
    addAgent("A", { name: "Alice", desk: 2 });

    const agent = useGameStore.getState().agents.get("A");
    expect(agent).toBeDefined();
    expect(agent?.phase).toBe("arriving");
    expect(agent?.queueType).toBeNull();
    expect(agent?.queueIndex).toBe(-1);
    expect(agent?.name).toBe("Alice");
    expect(agent?.desk).toBe(2);
    // currentTask follows the backend `?? null` coercion.
    expect(agent?.currentTask).toBeNull();
  });
});

describe("removeAgent", () => {
  it("drops the agent and scrubs them from both queues", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueDeparture("B");

    useGameStore.getState().removeAgent("A");

    expect(useGameStore.getState().agents.has("A")).toBe(false);
    expect(useGameStore.getState().arrivalQueue).not.toContain("A");
    // B unaffected.
    expect(useGameStore.getState().agents.get("B")?.queueType).toBe(
      "departure",
    );
  });
});

// ---------------------------------------------------------------------------
// QUEUE ACTIONS
// ---------------------------------------------------------------------------

describe("arrival queue", () => {
  it("enqueue appends and stamps queueType / queueIndex on the agent", () => {
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");

    expect(useGameStore.getState().arrivalQueue).toEqual(["A"]);
    const agent = useGameStore.getState().agents.get("A");
    expect(agent?.queueType).toBe("arrival");
    expect(agent?.queueIndex).toBe(0);
  });

  it("enqueue is a no-op when the id is already queued (guard against dupes)", () => {
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("A");

    expect(useGameStore.getState().arrivalQueue).toEqual(["A"]);
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
  });

  it("dequeue returns the front id, removes it, and re-indexes the rest 0..n-1", () => {
    addAgent("A");
    addAgent("B");
    addAgent("C");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("B");
    useGameStore.getState().enqueueArrival("C");

    const front = useGameStore.getState().dequeueArrival();

    expect(front).toBe("A");
    expect(useGameStore.getState().arrivalQueue).toEqual(["B", "C"]);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("C")?.queueIndex).toBe(1);
    // The dequeued agent's queueIndex is NOT touched by dequeue itself
    // (callers clear it via updateAgentQueueInfo). Characterized here so a
    // refactor that "helpfully" clears it shows up as a diff.
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
  });

  it("dequeue on an empty queue returns undefined and changes nothing", () => {
    const before = useGameStore.getState().arrivalQueue;
    const front = useGameStore.getState().dequeueArrival();

    expect(front).toBeUndefined();
    expect(useGameStore.getState().arrivalQueue).toBe(before);
  });

  it("interleaving: enqueue A then B, dequeue returns A and B becomes index 0", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("B");

    expect(useGameStore.getState().dequeueArrival()).toBe("A");
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
  });
});

describe("departure queue", () => {
  it("mirror behavior of the arrival queue with queueType='departure'", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueDeparture("A");
    useGameStore.getState().enqueueDeparture("B");
    useGameStore.getState().enqueueDeparture("A"); // dupe no-op

    expect(useGameStore.getState().departureQueue).toEqual(["A", "B"]);
    expect(useGameStore.getState().agents.get("A")?.queueType).toBe(
      "departure",
    );
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(1);

    const front = useGameStore.getState().dequeueDeparture();
    expect(front).toBe("A");
    expect(useGameStore.getState().departureQueue).toEqual(["B"]);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
  });

  it("dequeue on empty departure queue returns undefined", () => {
    expect(useGameStore.getState().dequeueDeparture()).toBeUndefined();
  });
});

describe("advanceQueue", () => {
  it("re-indexes every queued agent to match the current queue order", () => {
    addAgent("A");
    addAgent("B");
    addAgent("C");
    // Put them in the queue but deliberately desync their stored queueIndex.
    useGameStore.getState().arrivalQueue = ["A", "B", "C"];
    useGameStore.getState().updateAgentQueueInfo("A", "arrival", 99);
    useGameStore.getState().updateAgentQueueInfo("B", "arrival", 99);
    useGameStore.getState().updateAgentQueueInfo("C", "arrival", 99);

    useGameStore.getState().advanceQueue("arrival");

    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(1);
    expect(useGameStore.getState().agents.get("C")?.queueIndex).toBe(2);
  });

  it("is a no-op on an empty queue", () => {
    useGameStore.getState().advanceQueue("departure");
    expect(useGameStore.getState().departureQueue).toEqual([]);
  });
});

describe("syncQueues", () => {
  it("replaces both queues and re-stamps every listed agent's queue info", () => {
    addAgent("A");
    addAgent("B");
    addAgent("D");

    useGameStore.getState().syncQueues(["A", "B"], ["D"]);

    expect(useGameStore.getState().arrivalQueue).toEqual(["A", "B"]);
    expect(useGameStore.getState().departureQueue).toEqual(["D"]);
    expect(useGameStore.getState().agents.get("A")).toMatchObject({
      queueType: "arrival",
      queueIndex: 0,
    });
    expect(useGameStore.getState().agents.get("B")).toMatchObject({
      queueType: "arrival",
      queueIndex: 1,
    });
    expect(useGameStore.getState().agents.get("D")).toMatchObject({
      queueType: "departure",
      queueIndex: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// BUBBLE SUBSYSTEM
// ---------------------------------------------------------------------------

/**
 * Every bubble action has two branches: `entityId === "boss"` and an agent
 * branch. Each test below exercises both.
 */
describe("enqueueBubble — boss branch", () => {
  it("displays immediately when no bubble is current", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE);
    expect(boss.bubble.displayStartTime).not.toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("queues when a bubble is already displaying", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    const firstStart = useGameStore.getState().boss.bubble.displayStartTime;
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE); // unchanged
    expect(boss.bubble.displayStartTime).toBe(firstStart); // unchanged
    expect(boss.bubble.queue).toEqual([BUBBLE_B]);
  });

  it("preserves already-queued bubbles when displaying a new one", () => {
    // Nothing on display, but two bubbles still wait in the queue.
    const { boss } = useGameStore.getState();
    useGameStore.setState({
      boss: {
        ...boss,
        bubble: {
          content: null,
          displayStartTime: null,
          queue: [BUBBLE, BUBBLE_B],
        },
      },
    });

    const bubbleC: BubbleContent = { type: "speech", text: "now" };
    useGameStore.getState().enqueueBubble("boss", bubbleC);

    const bubble = useGameStore.getState().boss.bubble;
    expect(bubble.content).toEqual(bubbleC);
    expect(bubble.queue).toEqual([BUBBLE, BUBBLE_B]);
  });
});

describe("enqueueBubble — agent branch", () => {
  it("displays immediately when the agent has no current bubble", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);

    expect(useGameStore.getState().agents.get("A")?.bubble.content).toEqual(
      BUBBLE,
    );
  });

  it("queues when the agent already has a displaying bubble", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);
    useGameStore.getState().enqueueBubble("A", BUBBLE_B);

    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toEqual(BUBBLE);
    expect(bubble?.queue).toEqual([BUBBLE_B]);
  });

  it("is a no-op for an unknown agent id", () => {
    // No throw, no state change.
    useGameStore.getState().enqueueBubble("ghost", BUBBLE);
    expect(useGameStore.getState().agents.has("ghost")).toBe(false);
  });
});

describe("advanceBubble", () => {
  it("boss: pops the next queued bubble into content", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);
    useGameStore.getState().advanceBubble("boss");

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE_B);
    expect(boss.bubble.queue).toEqual([]);
  });

  it("boss: clears when the queue is empty", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().advanceBubble("boss"); // queue now empty
    useGameStore.getState().advanceBubble("boss"); // should clear

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("agent: pops and clears analogously", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);
    useGameStore.getState().enqueueBubble("A", BUBBLE_B);
    useGameStore.getState().advanceBubble("A");

    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toEqual(BUBBLE_B);
    expect(bubble?.queue).toEqual([]);
  });
});

describe("clearBubbles / getCurrentBubble / isBubbleQueueEmpty / hasBubbleText", () => {
  beforeEach(() => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);
    useGameStore.getState().enqueueBubble("A", BUBBLE);
  });

  it("clearBubbles resets boss bubble to empty state", () => {
    useGameStore.getState().clearBubbles("boss");
    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("clearBubbles resets an agent's bubble to empty state", () => {
    useGameStore.getState().clearBubbles("A");
    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toBeNull();
    expect(bubble?.queue).toEqual([]);
  });

  it("getCurrentBubble returns the displaying content for boss and agent", () => {
    expect(useGameStore.getState().getCurrentBubble("boss")).toEqual(BUBBLE);
    expect(useGameStore.getState().getCurrentBubble("A")).toEqual(BUBBLE);
    expect(useGameStore.getState().getCurrentBubble("ghost")).toBeNull();
  });

  it("isBubbleQueueEmpty is false while anything is displaying or queued", () => {
    expect(useGameStore.getState().isBubbleQueueEmpty("boss")).toBe(false);
    expect(useGameStore.getState().isBubbleQueueEmpty("A")).toBe(false);
  });

  it("isBubbleQueueEmpty is true once cleared", () => {
    useGameStore.getState().clearBubbles("boss");
    useGameStore.getState().clearBubbles("A");
    expect(useGameStore.getState().isBubbleQueueEmpty("boss")).toBe(true);
    expect(useGameStore.getState().isBubbleQueueEmpty("A")).toBe(true);
  });

  it("hasBubbleText matches current content OR any queued bubble, for boss and agent", () => {
    expect(useGameStore.getState().hasBubbleText("boss", "hi")).toBe(true); // current
    expect(useGameStore.getState().hasBubbleText("boss", "yo")).toBe(true); // queued
    expect(useGameStore.getState().hasBubbleText("boss", "nope")).toBe(false);
    expect(useGameStore.getState().hasBubbleText("A", "hi")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RESET VARIANTS
// ---------------------------------------------------------------------------

describe("reset variants", () => {
  function seedNonDefaults(): void {
    // Populate enough state that a "reset" is observable.
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().setSessionId("sess-123");
    useGameStore.getState().setReplaying(true);
    useGameStore.getState().setCodingAgent("opencode");
  }

  describe("reset()", () => {
    beforeEach(seedNonDefaults);

    it("restores initialState with a fresh empty agents Map", () => {
      useGameStore.getState().reset();
      const s = useGameStore.getState();
      expect(s.agents.size).toBe(0);
      expect(s.arrivalQueue).toEqual([]);
      expect(s.sessionId).toBe("None");
    });

    it("forgets the coding agent", () => {
      useGameStore.getState().reset();
      expect(useGameStore.getState().codingAgent).toBeNull();
    });

    it("leaves isReplaying false", () => {
      useGameStore.getState().reset();
      expect(useGameStore.getState().isReplaying).toBe(false);
    });
  });

  describe("resetForSessionSwitch()", () => {
    beforeEach(seedNonDefaults);

    it("clears game state (agents, queues, sessionId)", () => {
      useGameStore.getState().resetForSessionSwitch();
      const s = useGameStore.getState();
      expect(s.agents.size).toBe(0);
      expect(s.arrivalQueue).toEqual([]);
      expect(s.departureQueue).toEqual([]);
      expect(s.sessionId).toBe("None");
    });

    it("forgets the previous session's coding agent", () => {
      useGameStore.getState().resetForSessionSwitch();
      expect(useGameStore.getState().codingAgent).toBeNull();
    });

    it("sets isReplaying=false so the WebSocket may reconnect", () => {
      useGameStore.getState().resetForSessionSwitch();
      expect(useGameStore.getState().isReplaying).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// updateAgentMeta
// ---------------------------------------------------------------------------

describe("updateAgentMeta", () => {
  beforeEach(() => {
    addAgent("A", { name: "Alice", currentTask: "old task" });
  });

  it("name: null keeps the previous name (?? nullish fallback)", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: "old task",
    });
    // `name ?? agent.name` — null is nullish, so the old name is retained.
    expect(useGameStore.getState().agents.get("A")?.name).toBe("Alice");
  });

  it("currentTask: a non-empty new task replaces the old one", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: "brand new",
    });
    expect(useGameStore.getState().agents.get("A")?.currentTask).toBe(
      "brand new",
    );
  });

  it("currentTask: null keeps the previous task (?? nullish fallback)", () => {
    // QA-012 changed `||` to `??`. null is nullish, so the old task is kept.
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: null,
    });
    expect(useGameStore.getState().agents.get("A")?.currentTask).toBe(
      "old task",
    );
  });

  it("currentTask: empty string CLEARS the previous task (QA-012 fix)", () => {
    // Before QA-012 this case was a bug: `||` treated "" as falsy and silently
    // kept the old task, so an empty-string currentTask could never clear it.
    // With `??`, only null/undefined fall back; "" is a meaningful value and
    // overwrites.
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: "",
    });
    expect(useGameStore.getState().agents.get("A")?.currentTask).toBe("");
  });

  it("always overwrites backendState with the supplied value", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "thinking",
      name: null,
      currentTask: null,
    });
    expect(useGameStore.getState().agents.get("A")?.backendState).toBe(
      "thinking",
    );
  });

  // QA-012 note: the `currentTask: ""` case was previously excluded because
  // the old `||` fallback made it a known bug (empty string treated as falsy,
  // silently keeping the previous task). QA-012 switched to `??` and added
  // the explicit empty-string test above to pin the corrected behavior.
});

// ---------------------------------------------------------------------------
// EVENT LOG
// ---------------------------------------------------------------------------

describe("event log", () => {
  /** Backend history entry; the same shape arrives as a live `event`. */
  function makeEntry(
    second: number,
    overrides: Partial<HistoryEntry> = {},
  ): HistoryEntry {
    const timestamp = new Date(Date.UTC(2026, 9, 20, 0, 0, second));
    return {
      id: String(timestamp.getTime() / 1000),
      type: "pre_tool_use",
      agentId: "main",
      summary: `event ${second}`,
      timestamp: timestamp.toISOString(),
      detail: {},
      ...overrides,
    };
  }

  function asLiveEvent(
    entry: HistoryEntry,
  ): NonNullable<WebSocketMessage["event"]> {
    return { ...entry, type: entry.type as EventType };
  }

  const summaries = (): string[] =>
    useGameStore.getState().eventLog.map((entry) => entry.summary);

  it("fills an empty log from history, newest first", () => {
    useGameStore
      .getState()
      .mergeEventHistory([makeEntry(1), makeEntry(2), makeEntry(3)]);
    expect(summaries()).toEqual(["event 3", "event 2", "event 1"]);
  });

  it("does not repeat a live event that the snapshot already added", () => {
    // The backend broadcasts the state snapshot before the event message.
    const store = useGameStore.getState();
    store.mergeEventHistory([makeEntry(1), makeEntry(2)]);
    store.addEventLog(asLiveEvent(makeEntry(2)));
    expect(summaries()).toEqual(["event 2", "event 1"]);
  });

  it("adds older history behind live events without repeating them", () => {
    const store = useGameStore.getState();
    store.addEventLog(asLiveEvent(makeEntry(5)));
    store.mergeEventHistory([makeEntry(3), makeEntry(4), makeEntry(5)]);
    expect(summaries()).toEqual(["event 5", "event 4", "event 3"]);
  });

  it("keeps the same log array when history has nothing new", () => {
    const store = useGameStore.getState();
    store.mergeEventHistory([makeEntry(1)]);
    const before = useGameStore.getState().eventLog;
    store.mergeEventHistory([makeEntry(1)]);
    expect(useGameStore.getState().eventLog).toBe(before);
  });

  it("keeps two events that share a timestamp", () => {
    const first = makeEntry(1);
    useGameStore
      .getState()
      .mergeEventHistory([
        first,
        { ...first, type: "post_tool_use", summary: "done" },
      ]);
    expect(summaries()).toHaveLength(2);
  });

  it("caps the log at 500 entries, dropping the oldest", () => {
    const history = Array.from({ length: 520 }, (_, i) => makeEntry(i));
    useGameStore.getState().mergeEventHistory(history);
    const log = summaries();
    expect(log).toHaveLength(500);
    expect(log[0]).toBe("event 519");
    expect(log[499]).toBe("event 20");
  });
});

describe("selectShownSessionId", () => {
  it("is null until the session's snapshot is in, and again after a switch", () => {
    const store = useGameStore.getState();
    expect(selectShownSessionId(useGameStore.getState())).toBeNull();

    store.setSessionId("s1");
    expect(selectShownSessionId(useGameStore.getState())).toBeNull();
    store.markSnapshot("s1");
    expect(selectShownSessionId(useGameStore.getState())).toBe("s1");

    store.resetForSessionSwitch();
    store.setSessionId("s2");
    expect(selectShownSessionId(useGameStore.getState())).toBeNull();
    store.markSnapshot("s2");
    expect(selectShownSessionId(useGameStore.getState())).toBe("s2");
  });
});
