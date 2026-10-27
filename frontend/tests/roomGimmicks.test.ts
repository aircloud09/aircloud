import { describe, expect, it } from "vitest";
import {
  LAMP_HOLD_SECONDS,
  lampLit,
  SCRATCH_EVERY_MS,
  SCRATCH_MS,
  isTestCommand,
  lastPassedTestId,
  scratchesHead,
  GLOBE_SPIN_SPEED,
  MAX_PILE,
  NO_PILE,
  bookPile,
  MAX_NOTES,
  WATCH_AFTER_MS,
  globeSpeed,
  latestTodoNotes,
  todoNotes,
  watchesTheClock,
} from "../src/systems/roomGimmicks";

describe("watchesTheClock", () => {
  it("checks the watch only once a command has run for a while", () => {
    expect(watchesTheClock(0)).toBe(false);
    expect(watchesTheClock(WATCH_AFTER_MS - 1)).toBe(false);
    expect(watchesTheClock(WATCH_AFTER_MS)).toBe(true);
  });
});

describe("todoNotes", () => {
  it("reads the to-do list of TodoWrite and the plan of update_plan", () => {
    expect(
      todoNotes({
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress" },
          { content: "c", status: "pending" },
        ],
      }),
    ).toEqual(["completed", "in_progress", "pending"]);
    expect(
      todoNotes({ plan: [{ step: "a", status: "completed" }, { step: "b" }] }),
    ).toEqual(["completed", "pending"]);
  });

  it("is not a list for other tools, and holds at most MAX_NOTES", () => {
    expect(todoNotes({ file_path: "a.ts" })).toBeNull();
    expect(todoNotes(undefined)).toBeNull();
    const many = Array.from({ length: 20 }, () => ({ status: "pending" }));
    expect(todoNotes({ todos: many })).toHaveLength(MAX_NOTES);
  });

  it("takes the newest list in the log", () => {
    const log = [
      { detail: { toolInput: { command: "ls" } } },
      { detail: { toolInput: { todos: [{ status: "completed" }] } } },
      { detail: { toolInput: { todos: [{}, {}] } } },
    ];
    expect(latestTodoNotes(log)).toEqual(["completed"]);
    expect(latestTodoNotes([])).toBeNull();
  });
});

describe("globeSpeed", () => {
  it("winds up to full speed while searching and down to still after", () => {
    let speed = 0;
    for (let i = 0; i < 30; i++) speed = globeSpeed(speed, true, 0.1);
    expect(speed).toBe(GLOBE_SPIN_SPEED);
    const easing = globeSpeed(speed, false, 0.1);
    expect(easing).toBeGreaterThan(0);
    expect(easing).toBeLessThan(GLOBE_SPIN_SPEED);
    for (let i = 0; i < 30; i++) speed = globeSpeed(speed, false, 0.1);
    expect(speed).toBe(0);
  });
});

describe("bookPile", () => {
  it("adds a book for each new reading tool while in the library", () => {
    let pile = bookPile(NO_PILE, true, true, 100);
    expect(pile.count).toBe(1);
    pile = bookPile(pile, true, true, 100);
    expect(pile.count).toBe(1);
    pile = bookPile(pile, true, true, 200);
    expect(pile.count).toBe(2);
    pile = bookPile(pile, true, false, 300);
    expect(pile.count).toBe(2);
  });

  it("stops at MAX_PILE and is cleared on leaving the library", () => {
    let pile = NO_PILE;
    for (let at = 1; at <= 10; at++) pile = bookPile(pile, true, true, at);
    expect(pile.count).toBe(MAX_PILE);
    expect(bookPile(pile, false, true, 11)).toEqual(NO_PILE);
  });
});

describe("scratchesHead", () => {
  it("scratches for a moment at the end of each round of typing", () => {
    expect(scratchesHead(0)).toBe(false);
    expect(scratchesHead(SCRATCH_EVERY_MS - SCRATCH_MS - 1)).toBe(false);
    expect(scratchesHead(SCRATCH_EVERY_MS - SCRATCH_MS)).toBe(true);
    expect(scratchesHead(SCRATCH_EVERY_MS)).toBe(false);
    expect(scratchesHead(2 * SCRATCH_EVERY_MS - 1)).toBe(true);
  });
});

describe("test passes", () => {
  const post = (
    agentId: string,
    command: string,
    id: number,
    errorType?: string,
  ) => ({
    id: String(id),
    type: "post_tool_use",
    agentId,
    detail: { toolInput: { command }, ...(errorType ? { errorType } : {}) },
  });

  it("knows a test command when it sees one", () => {
    for (const command of [
      "npm test",
      "pytest -q",
      "bun run test:unit",
      "go test ./...",
    ]) {
      expect(isTestCommand(command)).toBe(true);
    }
    for (const command of ["npm run build", "git status", undefined]) {
      expect(isTestCommand(command)).toBe(false);
    }
  });

  it("names the agent's latest test run when it passed", () => {
    const log = [
      post("main", "git status", 30),
      post("sub", "npm test", 20, "tool_error"),
      post("main", "npm test", 10),
    ];
    expect(lastPassedTestId(log, "main")).toBe("10");
    expect(lastPassedTestId(log, "sub")).toBeNull();
    expect(lastPassedTestId(log, "other")).toBeNull();
  });

  it("does not cheer when the latest run failed after a pass", () => {
    const log = [
      post("main", "npm test", 20, "tool_error"),
      post("main", "npm test", 10),
    ];
    expect(lastPassedTestId(log, "main")).toBeNull();
  });
});

describe("lampLit", () => {
  it("lights while someone steps out and a moment after", () => {
    expect(lampLit(null, 10)).toBe(false);
    expect(lampLit(10, 10)).toBe(true);
    expect(lampLit(10, 10 + LAMP_HOLD_SECONDS - 0.01)).toBe(true);
    expect(lampLit(10, 10 + LAMP_HOLD_SECONDS)).toBe(false);
  });
});
