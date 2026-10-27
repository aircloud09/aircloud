/**
 * Which bubble a person in the isometric office shows (docs/plan/spec.md
 * 「캐릭터」 and the video author's notes): a red bubble while a failed tool
 * keeps it stuck, the tool's icon and target while a tool runs, a cloud
 * with the thinking summary, a white bubble with what it said, and
 * otherwise 「💭 고민 중」 with how long it has been thinking.
 */

import type { Activity, BubbleContent } from "@/types";

/** How long a thought or a reply stays up after it arrives (ms). */
export const RECENT_BUBBLE_MS = 8000;

/** Thinking summaries from the transcript carry this icon. */
const THINKING_ICON = "💭";
/**
 * The boss's speech carries this icon both for the user's prompt (at the
 * start of a turn) and for its reply (when the turn ends). Only the reply is
 * persistent (backend state_machine), so a passing phone speech is the
 * prompt, not the agent speaking — even when the session ended without one.
 */
const PHONE_ICON = "📞";

export type IsoBubble =
  | { kind: "failed"; text: string }
  | { kind: "tool"; icon: string; text: string; asking: boolean }
  | { kind: "thought"; text: string }
  | { kind: "speech"; text: string }
  | { kind: "thinking"; seconds: number };

export interface BubbleInput {
  /** The latest bubble the backend gave this person. */
  bubble: Pick<BubbleContent, "type" | "text" | "icon" | "persistent"> | null;
  /** How long ago that bubble arrived (ms). */
  bubbleAgeMs: number | null;
  activity: Activity | null;
  stuck: boolean;
  /** Seconds it has been thinking, or null when it is not. */
  thinkingSeconds: number | null;
}

/** The bubble to show now, or null for none. */
export function pickBubble(input: BubbleInput): IsoBubble | null {
  const { bubble, bubbleAgeMs, activity, stuck, thinkingSeconds } = input;
  const recent = bubbleAgeMs !== null && bubbleAgeMs < RECENT_BUBBLE_MS;
  if (stuck) return { kind: "failed", text: bubble?.text ?? "" };
  if (bubble?.type === "thought" && bubble.icon !== THINKING_ICON && activity) {
    return {
      kind: "tool",
      icon: bubble.icon ?? "⚙️",
      text: bubble.text,
      asking: activity === "asking",
    };
  }
  if (bubble?.type === "thought" && bubble.icon === THINKING_ICON && recent) {
    return { kind: "thought", text: bubble.text };
  }
  const isPrompt = bubble?.icon === PHONE_ICON && !bubble.persistent;
  if (bubble?.type === "speech" && !isPrompt && recent) {
    return { kind: "speech", text: bubble.text };
  }
  if (thinkingSeconds !== null) {
    return { kind: "thinking", seconds: thinkingSeconds };
  }
  return null;
}
