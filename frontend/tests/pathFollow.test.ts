/**
 * Shared path follower (systems/pathFollow.ts).
 */

import { describe, expect, it } from "vitest";
import { advanceAlongPath } from "@/systems/pathFollow";

const L_PATH = {
  waypoints: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
  currentIndex: 0,
  progress: 0,
};

describe("advanceAlongPath", () => {
  it("carries leftover distance around a corner", () => {
    const step = advanceAlongPath(L_PATH, 150);
    expect(step.arrived).toBe(false);
    expect(step.position).toEqual({ x: 100, y: 50 });
    expect(step.path?.currentIndex).toBe(1);
  });

  it("arrives at the last waypoint and clears the path", () => {
    const step = advanceAlongPath(L_PATH, 500);
    expect(step).toEqual({
      position: { x: 100, y: 100 },
      path: null,
      arrived: true,
    });
  });

  it("keeps a per-path speed on the remaining path", () => {
    const step = advanceAlongPath({ ...L_PATH, speed: 280 }, 10);
    expect(step.path?.speed).toBe(280);
  });
});
