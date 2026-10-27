import { describe, expect, it } from "vitest";
import {
  BREAK_SPOTS,
  CLAUDE_SEAT,
  ERRAND_SPOTS,
  FLOOR_WIDTH,
  MY_SEAT,
  SUBAGENT_SEATS,
} from "@/constants/isoFloorPlan";
import {
  findFloorPath,
  isFloorWalkable,
  type FloorPoint,
} from "@/systems/isoNavGrid";

const workSpots = Object.values(ERRAND_SPOTS).flat();
// The cafe is stood in; the lounge spots are on the sofas, off the paths.
const allSpots = [
  CLAUDE_SEAT,
  ...SUBAGENT_SEATS,
  MY_SEAT,
  ...workSpots,
  ...BREAK_SPOTS.cafe,
];

/** Sample a path every 0.1m and check each point is open floor. */
function staysOnFloor(path: FloorPoint[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (!isFloorWalkable(p)) return false;
    }
  }
  return true;
}

describe("iso navigation grid", () => {
  it("leaves every seat and work spot open", () => {
    for (const spot of allSpots)
      expect(isFloorWalkable(spot), JSON.stringify(spot)).toBe(true);
  });

  it("blocks walls, desks and furniture", () => {
    expect(isFloorWalkable({ x: 20, z: 0.1 })).toBe(false); // back wall
    expect(isFloorWalkable({ x: 18, z: 3.9 })).toBe(false); // dev desk
    expect(isFloorWalkable({ x: 5.9, z: 6.1 })).toBe(false); // library round table
    expect(isFloorWalkable({ x: 37, z: 0.8 })).toBe(false); // server rack
    expect(isFloorWalkable({ x: FLOOR_WIDTH + 1, z: 5 })).toBe(false);
  });

  it("finds a way from Claude's seat into the library and the server room", () => {
    for (const spot of [ERRAND_SPOTS.library[0], ERRAND_SPOTS.server[2]]) {
      const path = findFloorPath(CLAUDE_SEAT, spot);
      expect(path.length).toBeGreaterThan(1);
      expect(path[0]).toEqual({ x: CLAUDE_SEAT.x, z: CLAUDE_SEAT.z });
      expect(path[path.length - 1]).toEqual({ x: spot.x, z: spot.z });
      expect(staysOnFloor(path)).toBe(true);
    }
  });

  it("enters the server room through its open side, not through the glass", () => {
    const path = findFloorPath(MY_SEAT, ERRAND_SPOTS.server[2]);
    expect(staysOnFloor(path)).toBe(true);
    // Somewhere on the way the path passes the opening at x = 32.3, z 6.9–11.3.
    const crossing = path.find(
      (p, i) => i > 0 && path[i - 1].x < 32.3 && p.x >= 32.3,
    );
    const before = crossing ? path[path.indexOf(crossing) - 1] : undefined;
    expect(crossing && before).toBeTruthy();
    const zAtGlass =
      before!.z +
      ((crossing!.z - before!.z) * (32.3 - before!.x)) /
        (crossing!.x - before!.x);
    expect(zAtGlass).toBeGreaterThan(6.9);
    expect(zAtGlass).toBeLessThan(11.3);
  });

  it("reaches every seat from every work spot", () => {
    for (const from of workSpots) {
      for (const seat of [CLAUDE_SEAT, ...SUBAGENT_SEATS, MY_SEAT]) {
        expect(
          findFloorPath(from, seat).length,
          `${JSON.stringify(from)} → ${JSON.stringify(seat)}`,
        ).toBeGreaterThan(1);
      }
    }
  });
});
