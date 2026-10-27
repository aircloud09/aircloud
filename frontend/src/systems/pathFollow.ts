/**
 * Path following shared by agents (animationSystem) and the boss errands
 * (bossErrands): move a character a given distance along its waypoints.
 */

import type { Position } from "@/types";
import type { PathState } from "@/stores/slices/types";

export interface PathAdvance {
  /** Position after moving */
  position: Position;
  /** Remaining path, or null once the last waypoint is reached */
  path: PathState | null;
  /** True when this step reached the last waypoint */
  arrived: boolean;
}

/**
 * Advance along `path` by `distance` pixels, carrying leftover distance
 * across waypoints so speed stays constant around corners.
 */
export function advanceAlongPath(
  path: PathState,
  distance: number,
): PathAdvance {
  const { waypoints } = path;
  let { currentIndex, progress } = path;

  if (currentIndex >= waypoints.length - 1) {
    return {
      position: waypoints[waypoints.length - 1],
      path: null,
      arrived: true,
    };
  }

  let remainingDistance = distance;

  // Advance through waypoints until the movement distance is used up
  while (remainingDistance > 0 && currentIndex < waypoints.length - 1) {
    const current = waypoints[currentIndex];
    const next = waypoints[currentIndex + 1];

    const segmentDx = next.x - current.x;
    const segmentDy = next.y - current.y;
    const segmentLength = Math.sqrt(
      segmentDx * segmentDx + segmentDy * segmentDy,
    );

    // Skip zero-length segments
    if (segmentLength < 0.1) {
      currentIndex++;
      progress = 0;
      continue;
    }

    const remainingInSegment = (1 - progress) * segmentLength;

    if (remainingDistance >= remainingInSegment) {
      // Move past this waypoint to the next segment
      remainingDistance -= remainingInSegment;
      currentIndex++;
      progress = 0;
    } else {
      // Stay within this segment
      progress += remainingDistance / segmentLength;
      remainingDistance = 0;
    }
  }

  if (currentIndex >= waypoints.length - 1) {
    return {
      position: waypoints[waypoints.length - 1],
      path: null,
      arrived: true,
    };
  }

  const current = waypoints[currentIndex];
  const next = waypoints[currentIndex + 1];
  return {
    position: {
      x: current.x + (next.x - current.x) * progress,
      y: current.y + (next.y - current.y) * progress,
    },
    path: { ...path, currentIndex, progress },
    arrived: false,
  };
}
