import { describe, expect, it } from "vitest";
import { codingAgentName } from "@/constants/codingAgents";

describe("codingAgentName", () => {
  it("names the coding agents producers report", () => {
    expect(codingAgentName("claude-code")).toBe("Claude");
    expect(codingAgentName("opencode")).toBe("OpenCode");
    expect(codingAgentName("gemini-cli")).toBe("Gemini");
    expect(codingAgentName("codex")).toBe("Codex");
  });

  it("shows an unknown producer's own tag, cut to fit the name tag", () => {
    expect(codingAgentName("aider")).toBe("aider");
    expect(codingAgentName("a-very-long-agent-name-here")).toBe(
      "a-very-long-agen",
    );
  });

  it("names nothing when the session does not say", () => {
    expect(codingAgentName(null)).toBeNull();
    expect(codingAgentName(undefined)).toBeNull();
    expect(codingAgentName("")).toBeNull();
  });
});
