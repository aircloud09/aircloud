/**
 * Boss slice (ARC-005).
 *
 * The boss character's animation state (backend state, position, bubble,
 * in-use flag, current task, typing flag) and its scalar mutators. Bubble
 * queue contents are mutated by bubbleSlice via cross-slice `set`.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type { Activity, BossState, StuckReason } from "@/types";
import type { BossAnimationState, BossErrandState } from "./types";
import { initialBossErrandState, initialBossState } from "./shared";

export type BossSlice = {
  boss: BossAnimationState;
  // Kept beside `boss` (not inside it) so 60fps walking updates do not
  // re-render every `selectBoss` subscriber.
  bossErrand: BossErrandState;
  setBossErrand: (errand: BossErrandState) => void;
  updateBossBackendState: (state: BossState) => void;
  updateBossTask: (task: string | null) => void;
  updateBossActivity: (activity: Activity | null) => void;
  updateBossTurn: (turn: {
    stuck: StuckReason | null;
    turnActive: boolean;
    quietSince: number | null;
  }) => void;
  setBossInUse: (by: "arrival" | "departure" | null) => void;
  setBossTyping: (typing: boolean) => void;
};

export const initialBossSliceState = {
  boss: initialBossState,
  bossErrand: initialBossErrandState,
};

export const createBossSlice: StateCreator<GameStore, [], [], BossSlice> = (
  set,
) => ({
  ...initialBossSliceState,

  updateBossBackendState: (backendState) =>
    set((state) => ({
      boss: { ...state.boss, backendState },
    })),

  updateBossTask: (task) =>
    set((state) => ({
      boss: { ...state.boss, currentTask: task },
    })),

  setBossErrand: (errand) => set({ bossErrand: errand }),

  updateBossActivity: (activity) =>
    set((state) =>
      state.boss.activity === activity
        ? state
        : { boss: { ...state.boss, activity } },
    ),

  updateBossTurn: ({ stuck, turnActive, quietSince }) =>
    set((state) =>
      state.boss.stuck === stuck &&
      state.boss.turnActive === turnActive &&
      state.boss.quietSince === quietSince
        ? state
        : { boss: { ...state.boss, stuck, turnActive, quietSince } },
    ),

  setBossInUse: (by) =>
    set((state) => ({
      boss: { ...state.boss, inUseBy: by },
    })),

  setBossTyping: (typing) =>
    set((state) => ({
      boss: { ...state.boss, isTyping: typing },
    })),
});
