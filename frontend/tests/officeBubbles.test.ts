import { describe, expect, it } from "vitest";
import {
  pickBubble,
  RECENT_BUBBLE_MS,
  type BubbleInput,
} from "@/systems/officeBubbles";

const base: BubbleInput = {
  bubble: null,
  bubbleAgeMs: null,
  activity: null,
  stuck: false,
  thinkingSeconds: null,
};

describe("pickBubble", () => {
  it("shows nothing when there is nothing to say", () => {
    expect(pickBubble(base)).toBeNull();
  });

  it("shows the tool's icon and target while it runs", () => {
    const bubble = {
      type: "thought" as const,
      text: "src/auth.py",
      icon: "📖",
    };
    expect(
      pickBubble({ ...base, bubble, bubbleAgeMs: 20000, activity: "reading" }),
    ).toEqual({
      kind: "tool",
      icon: "📖",
      text: "src/auth.py",
      asking: false,
    });
    // Once the tool is over the target is not shown any more.
    expect(pickBubble({ ...base, bubble, bubbleAgeMs: 100 })).toBeNull();
  });

  it("marks a permission wait as asking", () => {
    const bubble = {
      type: "thought" as const,
      text: "Waiting: Bash",
      icon: "❓",
    };
    expect(
      pickBubble({ ...base, bubble, bubbleAgeMs: 0, activity: "asking" }),
    ).toMatchObject({
      kind: "tool",
      asking: true,
    });
  });

  it("shows a failed tool in red while stuck, over everything else", () => {
    const bubble = {
      type: "thought" as const,
      text: "Read failed: File not found",
      icon: "❗",
    };
    expect(
      pickBubble({
        ...base,
        bubble,
        bubbleAgeMs: 30000,
        stuck: true,
        thinkingSeconds: 4,
      }),
    ).toEqual({ kind: "failed", text: "Read failed: File not found" });
  });

  it("shows a thinking summary as a cloud and a reply as a white bubble, for a while", () => {
    const thought = {
      type: "thought" as const,
      text: "Check the token refresh",
      icon: "💭",
    };
    expect(
      pickBubble({
        ...base,
        bubble: thought,
        bubbleAgeMs: 1000,
        activity: "reading",
      }),
    ).toEqual({
      kind: "thought",
      text: "Check the token refresh",
    });
    const reply = {
      type: "speech" as const,
      text: "Fixed the timeout.",
      icon: "💬",
    };
    expect(pickBubble({ ...base, bubble: reply, bubbleAgeMs: 1000 })).toEqual({
      kind: "speech",
      text: "Fixed the timeout.",
    });
    expect(
      pickBubble({ ...base, bubble: reply, bubbleAgeMs: RECENT_BUBBLE_MS + 1 }),
    ).toBeNull();
  });

  it("does not put the user's prompt in the agent's mouth", () => {
    const prompt = {
      type: "speech" as const,
      text: "Fix the login",
      icon: "📞",
    };
    expect(
      pickBubble({
        ...base,
        bubble: prompt,
        bubbleAgeMs: 100,
        thinkingSeconds: 2,
      }),
    ).toEqual({
      kind: "thinking",
      seconds: 2,
    });
  });

  it("keeps the prompt out of the agent's mouth after the session ends without a reply", () => {
    const prompt = {
      type: "speech" as const,
      text: "Fix the login",
      icon: "📞",
    };
    expect(
      pickBubble({ ...base, bubble: prompt, bubbleAgeMs: 100 }),
    ).toBeNull();
  });

  it("shows the boss's reply at the end of a turn, which also carries the phone icon", () => {
    const reply = {
      type: "speech" as const,
      text: "Fixed it.",
      icon: "📞",
      persistent: true,
    };
    expect(pickBubble({ ...base, bubble: reply, bubbleAgeMs: 500 })).toEqual({
      kind: "speech",
      text: "Fixed it.",
    });
  });

  it("counts how long it has been thinking", () => {
    expect(pickBubble({ ...base, thinkingSeconds: 12 })).toEqual({
      kind: "thinking",
      seconds: 12,
    });
  });
});
