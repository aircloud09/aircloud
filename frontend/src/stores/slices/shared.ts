/**
 * Shared store constants and helpers (ARC-005).
 * Used by bossSlice, bubbleSlice, agentSlice, and the gameStore reset variants.
 */
import type { Position } from "@/types";
import type { BubbleState, BossAnimationState, BossErrandState } from "./types";

export const BOSS_POSITION: Position = { x: 640, y: 900 };

export const createEmptyBubbleState = (): BubbleState => ({
  content: null,
  displayStartTime: null,
  queue: [],
});

export const initialBossErrandState: BossErrandState = {
  phase: "seated",
  pondering: false,
  room: null,
  position: BOSS_POSITION,
  path: null,
  lingerUntil: null,
};

export const initialBossState: BossAnimationState = {
  backendState: "idle",
  position: BOSS_POSITION,
  bubble: createEmptyBubbleState(),
  inUseBy: null,
  currentTask: null,
  activity: null,
  stuck: null,
  turnActive: false,
  quietSince: null,
  isTyping: false,
};
