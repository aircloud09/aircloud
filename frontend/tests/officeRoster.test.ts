import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "@/stores/slices/types";
import type { IsoPerson } from "@/systems/officePeople";
import {
  logLines,
  rosterRows,
  secondsSince,
  startedTasks,
  toolCounts,
  toolTargets,
  untilNextSecond,
  type RosterWords,
} from "@/systems/officeRoster";

const WORDS: RosterWords = {
  thinking: "고민 중",
  looking: "살펴보는 중",
  rooms: {
    library: "자료실",
    seat: "개발실",
    server: "서버실",
    search: "정보검색실",
    meeting: "회의실",
    mydesk: "내 자리",
  },
};

function person(fields: Partial<IsoPerson>): IsoPerson {
  return {
    id: "claude",
    kind: "claude",
    label: "Claude",
    title: "Claude",
    typeLabel: "Claude",
    activity: null,
    stuck: false,
    bubble: null,
    bubbleAt: null,
    thinking: false,
    arriving: false,
    leaving: false,
    breakRoom: null,
    idleSince: null,
    typedAt: null,
    since: null,
    passedTest: null,
    outfit: "general",
    ...fields,
  };
}

function entry(
  id: string,
  type: EventLogEntry["type"],
  agentId: string,
  detail: EventLogEntry["detail"] = {},
): EventLogEntry {
  return {
    id,
    type,
    agentId,
    summary: "",
    timestamp: new Date(2026, 9, 21, 12, 34, Number(id)),
    detail,
  };
}

describe("rosterRows", () => {
  it("lists everyone but me, with what they are doing", () => {
    const people = [
      person({ thinking: true }),
      person({ id: "me", kind: "me", title: "나" }),
      person({
        id: "sa1",
        kind: "subagent",
        title: "T-013 부속 작성",
        typeLabel: "범용",
        outfit: "explore",
        activity: "reading",
        bubble: {
          type: "thought",
          text: "src/auth.py",
          icon: "📖",
          persistent: false,
        },
      }),
      person({
        id: "sa2",
        kind: "subagent",
        title: "테스트",
        typeLabel: "범용",
        activity: "editing",
      }),
      person({
        id: "sa3",
        kind: "subagent",
        title: "빌드",
        typeLabel: "범용",
        activity: "running",
        stuck: true,
        bubble: {
          type: "thought",
          text: "Bash failed: Exit code 1",
          icon: "❗",
          persistent: false,
        },
      }),
    ];
    const rows = rosterRows(
      people,
      new Map([
        ["main", 30],
        ["sa1", 13],
      ]),
      WORDS,
    );
    expect(rows.map((r) => [r.id, r.status, r.doing, r.tools])).toEqual([
      ["claude", "thinking", "💭 고민 중...", 30],
      ["sa1", "working", "📖 자료실 · src/auth.py", 13],
      ["sa2", "working", "개발실", 0],
      ["sa3", "thinking", "❗ Bash failed: Exit code 1", 0],
    ]);
    expect(rows[1]).toMatchObject({
      title: "T-013 부속 작성",
      typeLabel: "범용",
      outfit: "explore",
    });
  });

  it("counts tool uses per character", () => {
    const counts = toolCounts([
      entry("1", "pre_tool_use", "main"),
      entry("2", "post_tool_use", "main"),
      entry("3", "pre_tool_use", "main"),
      entry("4", "pre_tool_use", "sa1"),
    ]);
    expect([...counts]).toEqual([
      ["main", 2],
      ["sa1", 1],
    ]);
  });
});

describe("toolTargets", () => {
  it("keeps the whole target of each one's latest tool", () => {
    const targets = toolTargets(
      [
        entry("1", "pre_tool_use", "main", {
          toolName: "Read",
          toolInput: { file_path: "/repo/old.py" },
        }),
        entry("2", "pre_tool_use", "sa1", { toolName: "Bash" }),
        entry("3", "pre_tool_use", "main", {
          toolName: "Read",
          toolInput: { file_path: "/repo/src/a/long/path/auth.py" },
        }),
      ].reverse(),
    );
    expect([...targets]).toEqual([
      ["main", "/repo/src/a/long/path/auth.py"],
      ["sa1", ""],
    ]);
  });

  it("shows the whole target on hover only when the bubble is it cut short", () => {
    const reading = (text: string) =>
      person({
        activity: "reading",
        bubble: { type: "thought", text, icon: "📖", persistent: false },
      });
    const targets = new Map([["main", "/repo/src/a/long/path/auth.py"]]);
    const [cut] = rosterRows(
      [reading("...a/long/path/auth.py")],
      new Map(),
      WORDS,
      targets,
    );
    expect(cut.doing).toBe("📖 자료실 · ...a/long/path/auth.py");
    expect(cut.doingInFull).toBe("📖 자료실 · /repo/src/a/long/path/auth.py");
    // A bubble from another tool keeps its own words.
    const [other] = rosterRows(
      [reading("...other.py")],
      new Map(),
      WORDS,
      targets,
    );
    expect(other.doingInFull).toBe("📖 자료실 · ...other.py");
  });
});

describe("startedTasks", () => {
  it("names each subagent by the task it was started with", () => {
    const tasks = startedTasks(
      [
        entry("1", "subagent_start", "sa1", {
          taskDescription: "Find the timeout",
        }),
        entry("2", "pre_tool_use", "sa1", { toolName: "Bash" }),
        entry("3", "subagent_start", "sa2", {}),
        // Started again later: its latest task names it.
        entry("4", "subagent_start", "sa1", { taskDescription: "Look again" }),
      ].reverse(),
    );
    expect([...tasks]).toEqual([["sa1", "Look again"]]);
  });
});

describe("logLines", () => {
  const whoOf = (agentId: string, type: EventLogEntry["type"]) =>
    type === "user_prompt_submit"
      ? "나"
      : agentId === "main"
        ? "Claude"
        : agentId;

  it("reads like the bubbles, newest first, leaving out tools that finished fine", () => {
    const lines = logLines(
      [
        // Written in order; the store keeps the log newest first.
        entry("1", "user_prompt_submit", "main", { prompt: "로그인 고치기" }),
        entry("2", "pre_tool_use", "main", {
          toolName: "Read",
          toolInput: { file_path: "src/auth.py" },
        }),
        entry("3", "post_tool_use", "main", { toolName: "Read" }),
        entry("4", "pre_tool_use", "sa1", {
          toolName: "mcp__github__get_issue",
          toolInput: {},
        }),
        entry("5", "post_tool_use", "sa1", {
          toolName: "Bash",
          errorType: "tool_error",
          resultSummary: "Exit code 1",
        }),
        entry("6", "stop", "main", { message: "고쳤어." }),
        entry("7", "session_end", "main"),
      ].reverse(),
      whoOf,
      WORDS,
    );
    expect(lines.map((l) => [l.id, l.who, l.what])).toEqual([
      ["6", "Claude", "💬 고쳤어."],
      ["5", "sa1", "❗ Bash: Exit code 1"],
      ["4", "sa1", "🌐 mcp__github__get_issue 살펴보는 중"],
      ["2", "Claude", "📖 src/auth.py 살펴보는 중"],
      ["1", "나", "📞 로그인 고치기"],
    ]);
  });

  it("keeps only the newest lines", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entry(String(i), "pre_tool_use", "main", {
        toolName: "Bash",
        toolInput: { command: `step ${i}` },
      }),
    );
    expect(logLines(many.reverse(), whoOf, WORDS, 3).map((l) => l.id)).toEqual([
      "9",
      "8",
      "7",
    ]);
  });
});

describe("secondsSince", () => {
  it("counts whole seconds, as the thinking bubble does", () => {
    expect(secondsSince(1000, 1999)).toBe(0);
    expect(secondsSince(1000, 2000)).toBe(1);
    expect(secondsSince(1000, 35_900)).toBe(34);
    // A start the clock has not reached yet counts as just now.
    expect(secondsSince(5000, 4000)).toBe(0);
  });
});

describe("untilNextSecond", () => {
  it("waits for the row whose count goes up first", () => {
    expect(untilNextSecond([0], 2300)).toBe(700);
    expect(untilNextSecond([0, 1900], 2300)).toBe(600);
    expect(untilNextSecond([2300], 2300)).toBe(1000);
  });

  it("waits at most a second", () => {
    expect(untilNextSecond([], 2300)).toBe(1000);
    // A start ahead of this clock (another machine's time) counts from there.
    expect(untilNextSecond([2500], 2300)).toBe(200);
    expect(untilNextSecond([9000], 2300)).toBe(1000);
  });
});
