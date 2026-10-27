/**
 * Every plugin event names OpenCode as its coding agent, so the office shows
 * "OpenCode" on the boss's name tag and in the session list.
 */

import { afterEach, describe, expect, it } from "bun:test";
import plugin from "../src/index";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("coding_agent tag", () => {
  it("tags tool events with coding_agent opencode", async () => {
    const sent: Array<{ event_type: string; data: Record<string, unknown> }> =
      [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const hooks = await plugin({
      directory: "/tmp/demo",
      worktree: "/tmp/demo",
    } as never);
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "ses_1", callID: "call_1" } as never,
      { args: { filePath: "a.ts" } } as never,
    );
    await hooks["tool.execute.after"]?.(
      { tool: "read", sessionID: "ses_1", callID: "call_1" } as never,
      { title: "a.ts", output: "", metadata: {} } as never,
    );

    expect(sent.map((e) => e.event_type)).toEqual([
      "pre_tool_use",
      "post_tool_use",
    ]);
    for (const event of sent) {
      expect(event.data.coding_agent).toBe("opencode");
      expect(event.data.source).toBe("opencode");
    }
  });
});
