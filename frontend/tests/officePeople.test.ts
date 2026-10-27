import { describe, expect, it } from "vitest";
import type {
  AgentAnimationState,
  BubbleState,
  EventLogEntry,
} from "@/stores/slices/types";
import {
  isCompacting,
  isQuietTurn,
  officePeople,
  type PeopleWords,
} from "@/systems/officePeople";

const WORDS: PeopleWords = {
  agentName: "Claude",
  me: "나",
  generalType: "범용",
};
const NO_BUBBLE: BubbleState = {
  content: null,
  displayStartTime: null,
  queue: [],
};

function boss(
  fields: Partial<Parameters<typeof officePeople>[0]["boss"]> = {},
) {
  return {
    activity: null,
    stuck: null,
    bubble: NO_BUBBLE,
    quietSince: null,
    turnActive: true,
    ...fields,
  };
}

function agent(
  id: string,
  fields: Partial<AgentAnimationState>,
): AgentAnimationState {
  return {
    id,
    name: null,
    currentTask: null,
    activity: null,
    stuck: null,
    agentType: null,
    phase: "idle",
    backendState: "working",
    bubble: NO_BUBBLE,
    ...fields,
  } as AgentAnimationState;
}

describe("officePeople", () => {
  it("puts Claude and me first, Claude with the boss's activity", () => {
    const people = officePeople(
      { boss: boss({ activity: "reading" }), agents: new Map(), eventLog: [] },
      WORDS,
    );
    expect(people).toMatchObject([
      {
        id: "claude",
        kind: "claude",
        label: "Claude",
        activity: "reading",
        stuck: false,
      },
      {
        id: "me",
        kind: "me",
        label: "나",
        activity: null,
        stuck: false,
        thinking: false,
      },
    ]);
  });

  it("labels a subagent with its type and task", () => {
    const agents = new Map([
      [
        "a1",
        agent("a1", {
          agentType: "general-purpose",
          currentTask: "T-013 부속 작성",
          activity: "running",
        }),
      ],
      [
        "a2",
        agent("a2", {
          agentType: "Explore",
          currentTask: "Find the login code",
        }),
      ],
      ["a3", agent("a3", { name: "Scout" })],
    ]);
    const people = officePeople({ boss: boss(), agents, eventLog: [] }, WORDS);
    expect(people.slice(2).map((p) => [p.id, p.label, p.activity])).toEqual([
      ["a1", "범용 · T-013 부속 작성", "running"],
      ["a2", "Explore · Find the login code", null],
      ["a3", "Scout", null],
    ]);
  });

  it("keeps subagents whose work is done, marked leaving, so they can go home", () => {
    const agents = new Map([
      ["a1", agent("a1", { currentTask: "stays" })],
      ["a2", agent("a2", { currentTask: "leaves", phase: "departing" })],
      ["a3", agent("a3", { currentTask: "gone", phase: "in_elevator" })],
      // SUBAGENT_STOP: the backend marks it waiting before it removes it.
      ["a4", agent("a4", { currentTask: "done", backendState: "waiting" })],
    ]);
    const people = officePeople({ boss: boss(), agents, eventLog: [] }, WORDS);
    expect(people.slice(2).map((p) => [p.id, p.leaving, p.thinking])).toEqual([
      ["a1", false, true],
      ["a2", true, false],
      ["a3", true, false],
      ["a4", true, false],
    ]);
  });

  it("brings a subagent the backend just made by elevator", () => {
    const agents = new Map([
      ["a1", agent("a1", { backendState: "arriving" })],
      // SUBAGENT_START walks it to its desk at once, until its first tool.
      ["a2", agent("a2", { backendState: "walking_to_desk" })],
      ["a3", agent("a3", { backendState: "working" })],
    ]);
    const people = officePeople({ boss: boss(), agents, eventLog: [] }, WORDS);
    expect(people.map((p) => p.arriving)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("dresses Explore in green and Plan in purple, the rest in blue", () => {
    const agents = new Map(
      ["Explore", "Plan", "general-purpose", null].map((type, i) => [
        `a${i}`,
        agent(`a${i}`, { agentType: type }),
      ]),
    );
    const people = officePeople({ boss: boss(), agents, eventLog: [] }, WORDS);
    expect(people.slice(2).map((p) => p.outfit)).toEqual([
      "explore",
      "plan",
      "general",
      "general",
    ]);
  });

  it("sends a person waiting for a permission to my desk, and keeps a failed one in place", () => {
    const agents = new Map([
      ["a1", agent("a1", { activity: "running", stuck: "tool_failed" })],
    ]);
    const [claude, , a1] = officePeople(
      {
        boss: boss({ activity: "running", stuck: "waiting_permission" }),
        agents,
        eventLog: [],
      },
      WORDS,
    );
    expect(claude).toMatchObject({ activity: "asking", stuck: false });
    expect(a1).toMatchObject({ activity: "running", stuck: true });
  });

  it("passes on the latest bubble and who is thinking", () => {
    const bubble: BubbleState = {
      content: { type: "speech", text: "Done.", icon: "💬", persistent: false },
      displayStartTime: 1234,
      queue: [],
    };
    const agents = new Map([
      ["a1", agent("a1", {})],
      ["a2", agent("a2", { activity: "reading" })],
      ["a3", agent("a3", { backendState: "waiting" })],
      ["a4", agent("a4", { backendState: "arriving" })],
    ]);
    const people = officePeople(
      { boss: boss({ bubble, quietSince: 99 }), agents, eventLog: [] },
      WORDS,
    );
    expect(people[0]).toMatchObject({
      bubble: bubble.content,
      bubbleAt: 1234,
      thinking: true,
    });
    expect(people.slice(2).map((p) => p.thinking)).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
});

describe("officePeople — breaks", () => {
  const compaction = (type: string) =>
    ({
      id: type,
      type,
      agentId: "main",
      summary: "",
      timestamp: new Date(0),
    }) as unknown as EventLogEntry;

  it("rests Claude in the lounge between turns and no one else", () => {
    const agents = new Map([["a", agent("a", {})]]);
    const idle = officePeople(
      { boss: boss({ turnActive: false }), agents, eventLog: [] },
      WORDS,
      [],
    );
    expect(idle.map((p) => [p.id, p.breakRoom])).toEqual([
      ["claude", "lounge"],
      ["me", null],
      ["a", null],
    ]);
    const busy = officePeople({ boss: boss(), agents, eventLog: [] }, WORDS);
    expect(busy[0].breakRoom).toBeNull();
  });

  it("sends Claude to the cafe while compacting, not thinking aloud", () => {
    const eventLog = [compaction("context_compaction"), compaction("stop")];
    const [claude] = officePeople(
      { boss: boss({ quietSince: 5 }), agents: new Map(), eventLog },
      WORDS,
    );
    expect(claude).toMatchObject({ breakRoom: "cafe", thinking: false });
    // Even with the turn over, compacting wins over the lounge.
    const [idle] = officePeople(
      { boss: boss({ turnActive: false }), agents: new Map(), eventLog },
      WORDS,
    );
    expect(idle.breakRoom).toBe("cafe");
  });

  it("dates Claude's rest in the lounge from the last event", () => {
    const stop = { ...compaction("stop"), timestamp: new Date(42_000) };
    const [idle] = officePeople(
      {
        boss: boss({ turnActive: false }),
        agents: new Map(),
        eventLog: [stop],
      },
      WORDS,
    );
    expect(idle).toMatchObject({ breakRoom: "lounge", idleSince: 42_000 });
    const [busy] = officePeople(
      { boss: boss(), agents: new Map(), eventLog: [stop] },
      WORDS,
    );
    expect(busy.idleSince).toBeNull();
  });

  it("tells me when I last sent a question, and no one else", () => {
    const prompt = {
      ...compaction("user_prompt_submit"),
      timestamp: new Date(7_000),
    };
    const later = { ...compaction("pre_tool_use"), timestamp: new Date(9_000) };
    const people = officePeople(
      { boss: boss(), agents: new Map(), eventLog: [later, prompt] },
      WORDS,
    );
    expect(people.map((p) => [p.id, p.typedAt])).toEqual([
      ["claude", null],
      ["me", 7_000],
    ]);
    const quiet = officePeople(
      { boss: boss(), agents: new Map(), eventLog: [later] },
      WORDS,
    );
    expect(quiet[1].typedAt).toBeNull();
  });

  it("dates what each one is doing from its own latest event", () => {
    const at = (agentId: string, type: string, ms: number) =>
      ({
        ...compaction(type),
        agentId,
        timestamp: new Date(ms),
      }) as EventLogEntry;
    const people = officePeople(
      {
        boss: boss(),
        agents: new Map([["a1", agent("a1", {})]]),
        eventLog: [
          at("a1", "pre_tool_use", 9_000),
          at("main", "user_prompt_submit", 5_000),
        ],
      },
      WORDS,
    );
    expect(people.map((p) => [p.id, p.since])).toEqual([
      ["claude", 5_000],
      ["me", null],
      ["a1", 9_000],
    ]);
  });

  it("cheers whoever's tests just passed", () => {
    const passed = (agentId: string, at: number) =>
      ({
        id: `${agentId}${at}`,
        type: "post_tool_use",
        agentId,
        summary: "",
        timestamp: new Date(at),
        detail: { toolInput: { command: "npm test" } },
      }) as unknown as EventLogEntry;
    const agents = new Map([["a1", agent("a1", {})]]);
    const people = officePeople(
      {
        boss: boss(),
        agents,
        eventLog: [passed("a1", 9_000), passed("main", 5_000)],
      },
      WORDS,
    );
    expect(people.map((p) => [p.id, p.passedTest])).toEqual([
      ["claude", "main5000"],
      ["me", null],
      ["a1", "a19000"],
    ]);
  });

  it("ends the coffee with the next event", () => {
    expect(isCompacting([])).toBe(false);
    expect(isCompacting([compaction("context_compaction")])).toBe(true);
    expect(
      isCompacting([
        compaction("pre_tool_use"),
        compaction("context_compaction"),
      ]),
    ).toBe(false);
  });
});

describe("officePeople — colleagues", () => {
  it("brings other sessions' lead agents in last, named by their session", () => {
    const people = officePeople(
      { boss: boss(), agents: new Map(), eventLog: [] },
      WORDS,
      [
        {
          sessionId: "s2",
          agentName: "Claude",
          title: "로그인 고치기",
          activity: "reading",
          stuck: null,
          bubble: { type: "thought", text: "src/auth.py", icon: "📖" },
          bubbleAt: 5,
          thinking: false,
          since: null,
        },
        {
          sessionId: "s3",
          agentName: "Codex",
          title: "문서 정리",
          activity: null,
          stuck: "waiting_permission",
          bubble: null,
          bubbleAt: null,
          thinking: false,
          since: null,
        },
      ],
    );
    expect(people.map((p) => [p.id, p.kind, p.label])).toEqual([
      ["claude", "claude", "Claude"],
      ["me", "me", "나"],
      ["colleague:s2", "colleague", "Claude · 로그인 고치기"],
      ["colleague:s3", "colleague", "Codex · 문서 정리"],
    ]);
    expect(people[2]).toMatchObject({
      title: "로그인 고치기",
      typeLabel: "Claude",
      activity: "reading",
      bubbleAt: 5,
    });
    // Waiting for a permission sends it to my desk, as with Claude.
    expect(people[3].activity).toBe("asking");
  });
});

describe("isQuietTurn", () => {
  it("is a turn with no tool running and nothing stuck", () => {
    expect(isQuietTurn({ state: "idle", turnActive: true })).toBe(true);
    expect(isQuietTurn({ state: "receiving", turnActive: true })).toBe(true);
    expect(isQuietTurn({ state: "working", turnActive: true })).toBe(false);
    expect(
      isQuietTurn({ state: "idle", turnActive: true, activity: "reading" }),
    ).toBe(false);
    expect(
      isQuietTurn({ state: "idle", turnActive: true, stuck: "tool_failed" }),
    ).toBe(false);
    expect(isQuietTurn({ state: "idle", turnActive: false })).toBe(false);
  });
});
