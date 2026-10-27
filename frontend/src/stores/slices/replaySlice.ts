/**
 * Connection / replay slice (ARC-005).
 *
 * WebSocket connection flag and the replay flag that keeps the socket closed
 * while set. Independent scalar values with plain setters — no cross-slice
 * dependencies.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";

export type ReplaySlice = {
  isConnected: boolean;
  isReplaying: boolean;
  setConnected: (isConnected: boolean) => void;
  setReplaying: (replaying: boolean) => void;
};

export const initialReplayState = {
  isConnected: false,
  isReplaying: false,
};

export const createReplaySlice: StateCreator<GameStore, [], [], ReplaySlice> = (
  set,
) => ({
  ...initialReplayState,

  setConnected: (isConnected) => set({ isConnected }),
  setReplaying: (isReplaying) => set({ isReplaying }),
});
