import { describe, expect, it } from "vitest";
import type { Activity } from "@/types";
import type { BreakRoomId, IsoSpot } from "@/constants/isoFloorPlan";
import { ERRAND_LINGER_MS } from "@/systems/bossErrands";
import {
  BYE_MS,
  COFFEE_MS,
  REPORT_MS,
  arrivingWalker,
  seatedWalker,
  stepIsoWalker,
  type IsoElevator,
  type IsoRoomId,
  type IsoWalker,
} from "@/systems/isoErrands";
import type { FloorPoint } from "@/systems/isoNavGrid";

const SEAT: IsoSpot = { x: 0, z: 0, facing: Math.PI };
const SPOTS: Record<IsoRoomId, IsoSpot> = {
  library: { x: 6.4, z: 0, facing: 0 },
  server: { x: 0, z: 6.4, facing: Math.PI / 2 },
  search: { x: 3.2, z: 3.2, facing: 0 },
  meeting: { x: -3.2, z: 0, facing: 0 },
  mydesk: { x: 0, z: -3.2, facing: 0 },
  lounge: { x: -3.2, z: 3.2, facing: 0 },
  cafe: { x: -3.2, z: -3.2, facing: 0 },
};
const REPORT: IsoSpot = { x: -1.6, z: 1.6, facing: 0 };
const ELEVATOR: IsoElevator = {
  door: { x: 3.2, z: -3.2, facing: 0 },
  cab: { x: 3.2, z: -4.8, facing: Math.PI },
};
const straight = (from: FloorPoint, to: FloorPoint): FloorPoint[] => [from, to];

/** Run the walker for `seconds` in 0.1s steps starting at `start` ms. */
function run(
  walker: IsoWalker,
  activity: Activity | null,
  seconds: number,
  start = 0,
  stuck = false,
  leaving = false,
  onStep?: (walker: IsoWalker, now: number) => void,
  breakRoom: BreakRoomId | null = null,
): { walker: IsoWalker; now: number } {
  let w = walker;
  let now = start;
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    now += 100;
    w = stepIsoWalker(w, {
      activity,
      stuck,
      seat: SEAT,
      spotIn: (room) => SPOTS[room],
      findPath: straight,
      now,
      dt: 0.1,
      leaving,
      breakRoom,
      reportSpot: () => REPORT,
      elevator: ELEVATOR,
    });
    onStep?.(w, now);
  }
  return { walker: w, now };
}

/** Run a finished subagent home, noting each stage of its trip once. */
function goHome(
  walker: IsoWalker,
  seconds: number,
  start = 0,
): {
  walker: IsoWalker;
  now: number;
  stages: string[];
  at: Record<string, number>;
} {
  const stages: string[] = [];
  const at: Record<string, number> = {};
  const done = run(walker, null, seconds, start, false, true, (w, now) => {
    const trip = w.trip;
    const stage =
      trip?.kind === "report" && trip.until !== null
        ? "reporting"
        : trip?.kind === "coffee" && trip.until !== null
          ? "sipping"
          : (trip?.kind ?? "none");
    if (stages[stages.length - 1] !== stage) {
      stages.push(stage);
      at[stage] = now;
    }
  });
  return { ...done, stages, at };
}

describe("iso errands", () => {
  it("walks to the library while reading and works there facing the shelf", () => {
    const { walker } = run(seatedWalker(SEAT), "reading", 3);
    expect(walker).toMatchObject({
      x: 6.4,
      z: 0,
      goal: "library",
      pose: "work",
      facing: 0,
    });
  });

  it.each([
    ["running", "server"],
    ["browsing", "search"],
    ["planning", "meeting"],
    ["asking", "mydesk"],
  ] as const)("sends %s to the %s", (activity, room) => {
    const { walker } = run(seatedWalker(SEAT), activity, 3);
    expect(walker).toMatchObject({
      x: SPOTS[room].x,
      z: SPOTS[room].z,
      goal: room,
      pose: "work",
    });
  });

  it("stays in the room for the linger time after the tool ends, then sits down again", () => {
    const working = run(seatedWalker(SEAT), "running", 3);
    const lingering = run(
      working.walker,
      null,
      (ERRAND_LINGER_MS - 200) / 1000,
      working.now,
    );
    expect(lingering.walker).toMatchObject({ goal: "server", pose: "work" });
    const back = run(lingering.walker, null, 3.5, lingering.now);
    expect(back.walker).toMatchObject({
      x: 0,
      z: 0,
      goal: "seat",
      pose: "sit",
      facing: Math.PI,
    });
  });

  it("finishes the walk when the tool ends on the way, then lingers", () => {
    const halfway = run(seatedWalker(SEAT), "reading", 1);
    expect(halfway.walker.pose).toBe("walk");
    const arrived = run(halfway.walker, null, 1.2, halfway.now);
    expect(arrived.walker).toMatchObject({
      x: 6.4,
      goal: "library",
      pose: "work",
    });
    expect(arrived.walker.lingerUntil).not.toBeNull();
  });

  it("turns at once towards another room when the next tool starts mid-walk", () => {
    const halfway = run(seatedWalker(SEAT), "reading", 1);
    const turned = run(halfway.walker, "running", 0.1, halfway.now);
    expect(turned.walker.goal).toBe("server");
    expect(turned.walker.path?.waypoints[0]).toEqual({
      x: halfway.walker.x,
      y: halfway.walker.z,
    });
  });

  it("a new tool for the same room cancels the linger", () => {
    const working = run(seatedWalker(SEAT), "reading", 3);
    const lingering = run(working.walker, null, 0.5, working.now);
    expect(lingering.walker.lingerUntil).not.toBeNull();
    const again = run(lingering.walker, "reading", 0.1, lingering.now);
    expect(again.walker).toMatchObject({
      goal: "library",
      pose: "work",
      lingerUntil: null,
    });
  });

  it("edits at its own desk: goes straight back without lingering and types", () => {
    const working = run(seatedWalker(SEAT), "reading", 3);
    const turned = run(working.walker, "editing", 0.1, working.now);
    expect(turned.walker).toMatchObject({ goal: "seat", lingerUntil: null });
    const typing = run(turned.walker, "editing", 3, turned.now);
    expect(typing.walker).toMatchObject({ x: 0, z: 0, pose: "type" });
    const idle = run(typing.walker, null, 0.2, typing.now);
    expect(idle.walker.pose).toBe("sit");
  });

  it("a stuck person stays where it is until it moves on", () => {
    const working = run(seatedWalker(SEAT), "reading", 3);
    const stuck = run(working.walker, null, 4, working.now, true);
    expect(stuck.walker).toMatchObject({
      x: 6.4,
      goal: "library",
      lingerUntil: null,
    });
    const movedOn = run(stuck.walker, "running", 4, stuck.now);
    expect(movedOn.walker).toMatchObject({ goal: "server", pose: "work" });
  });

  it("a person stuck on the way stops right there", () => {
    const halfway = run(seatedWalker(SEAT), "reading", 1);
    const stuck = run(halfway.walker, null, 2, halfway.now, true);
    expect(stuck.walker).toMatchObject({
      x: halfway.walker.x,
      z: halfway.walker.z,
      path: null,
      pose: "work",
    });
  });

  it("seen afresh in a room it works there at once, without a walk", () => {
    const steps: IsoWalker[] = [];
    run(
      seatedWalker(SPOTS.library, "library"),
      "reading",
      1,
      0,
      false,
      false,
      (w) => steps.push(w),
    );
    expect(steps.every((w) => w.path === null && w.x === 6.4)).toBe(true);
    expect(steps[0]).toMatchObject({ goal: "library", pose: "work" });
  });

  it("sits still with nothing to do", () => {
    const { walker } = run(seatedWalker(SEAT), null, 2);
    expect(walker).toEqual(seatedWalker(SEAT));
  });

  it("a newcomer steps out of the elevator and goes to its seat", () => {
    const out = run(arrivingWalker(ELEVATOR), null, 0.4);
    expect(out.walker).toMatchObject({
      trip: { kind: "arrive" },
      pose: "walk",
    });
    const seated = run(out.walker, null, 4, out.now);
    expect(seated.walker).toMatchObject({
      x: 0,
      z: 0,
      goal: "seat",
      pose: "sit",
      trip: null,
    });
  });

  it("a newcomer with work goes from the elevator straight to that room", () => {
    const out = run(arrivingWalker(ELEVATOR), "reading", 4);
    expect(out.walker).toMatchObject({
      x: 6.4,
      z: 0,
      goal: "library",
      pose: "work",
      trip: null,
    });
  });

  it("when its work is done it reports beside Claude, waves, has a coffee, and rides the elevator away", () => {
    const home = goHome(seatedWalker(SEAT), 20);
    expect(home.stages).toEqual([
      "report",
      "reporting",
      "bye",
      "coffee",
      "sipping",
      "leave",
      "board",
      "gone",
    ]);
    // It reports for REPORT_MS and waves for BYE_MS before setting off,
    // then has its coffee for COFFEE_MS.
    expect(home.at.bye - home.at.reporting).toBe(REPORT_MS);
    expect(home.at.coffee - home.at.bye).toBe(BYE_MS);
    expect(home.at.leave - home.at.sipping).toBe(COFFEE_MS);
    expect(home.walker).toMatchObject({ x: 3.2, z: -4.8, goal: "cab" });
  });

  it("has its coffee standing at the cafe", () => {
    const home = goHome(seatedWalker(SEAT), 20);
    const sipping = goHome(
      seatedWalker(SEAT),
      home.at.sipping / 1000 + 1,
    ).walker;
    expect(sipping).toMatchObject({
      x: -3.2,
      z: -3.2,
      goal: "cafe",
      pose: "work",
      trip: { kind: "coffee" },
    });
  });

  it("handed more work at the cafe, it goes straight to work", () => {
    const home = goHome(seatedWalker(SEAT), 20);
    const sipping = goHome(seatedWalker(SEAT), home.at.sipping / 1000 + 1);
    const back = run(sipping.walker, "reading", 6, sipping.now);
    expect(back.walker).toMatchObject({
      x: 6.4,
      z: 0,
      goal: "library",
      pose: "work",
      trip: null,
    });
  });

  it("stands facing Claude while reporting and waves goodbye", () => {
    const reporting = goHome(seatedWalker(SEAT), 1.5);
    expect(reporting.walker).toMatchObject({
      x: -1.6,
      z: 1.6,
      facing: 0,
      goal: "report",
      pose: "stand",
    });
    const waving = goHome(
      reporting.walker,
      REPORT_MS / 1000 + 0.2,
      reporting.now,
    );
    expect(waving.walker).toMatchObject({
      trip: { kind: "bye" },
      pose: "wave",
    });
  });

  it("handed more work on its way to report, it turns back to work", () => {
    const leaving = goHome(seatedWalker(SEAT), 0.3);
    expect(leaving.walker).toMatchObject({ goal: "report", pose: "walk" });
    const back = run(leaving.walker, "reading", 4, leaving.now);
    expect(back.walker).toMatchObject({
      x: 6.4,
      z: 0,
      goal: "library",
      pose: "work",
      trip: null,
    });
  });

  it("called back while stepping into the cab, it steps out again and sits down", () => {
    const home = goHome(seatedWalker(SEAT), 20);
    // Replay up to the moment it is half way into the cab.
    const boarding = run(
      seatedWalker(SEAT),
      null,
      home.at.board / 1000 + 0.2,
      0,
      false,
      true,
    ).walker;
    expect(boarding.trip).toEqual({ kind: "board" });
    const out = run(boarding, null, 0.2, home.at.board + 200);
    expect(out.walker).toMatchObject({
      goal: "elevator",
      trip: { kind: "arrive" },
    });
    const seated = run(out.walker, null, 6, out.now);
    expect(seated.walker).toMatchObject({
      x: 0,
      z: 0,
      pose: "sit",
      trip: null,
    });
  });

  it("once gone it stays gone", () => {
    const home = goHome(seatedWalker(SEAT), 20);
    const later = run(home.walker, "reading", 2, home.now);
    expect(later.walker).toEqual(home.walker);
  });
});

describe("stepIsoWalker — resting in the lounge", () => {
  const rest = (walker: IsoWalker, seconds: number, start = 0) =>
    run(walker, null, seconds, start, false, false, undefined, "lounge");
  const walkTo = (from: IsoSpot, to: IsoSpot): number =>
    Math.hypot(to.x - from.x, to.z - from.z) / 3.2;

  it("leaves its seat after lingering and sits on the sofa", () => {
    const early = rest(seatedWalker(SEAT), ERRAND_LINGER_MS / 1000 - 0.2);
    expect(early.walker).toMatchObject({ goal: "seat", pose: "sit" });
    const there = rest(
      seatedWalker(SEAT),
      ERRAND_LINGER_MS / 1000 + walkTo(SEAT, SPOTS.lounge) + 0.3,
    );
    expect(there.walker).toMatchObject({
      goal: "lounge",
      x: SPOTS.lounge.x,
      z: SPOTS.lounge.z,
      pose: "sit",
      path: null,
    });
  });

  it("stays seated on the sofa while the turn is over", () => {
    const sofa = seatedWalker(SPOTS.lounge, "lounge");
    expect(rest(sofa, 10).walker).toEqual(sofa);
  });

  it("goes straight back to its seat when a new turn starts", () => {
    const sofa = seatedWalker(SPOTS.lounge, "lounge");
    const first = run(sofa, null, 0.1);
    expect(first.walker).toMatchObject({ goal: "seat", pose: "walk" });
    const back = run(sofa, null, walkTo(SPOTS.lounge, SEAT) + 0.3);
    expect(back.walker).toMatchObject({
      goal: "seat",
      x: 0,
      z: 0,
      pose: "sit",
    });
  });

  it("turns back mid-walk when the turn starts on the way to the sofa", () => {
    const leaving = rest(
      seatedWalker(SEAT),
      ERRAND_LINGER_MS / 1000 + 0.3,
    ).walker;
    expect(leaving).toMatchObject({ goal: "lounge", pose: "walk" });
    expect(run(leaving, null, 0.1).walker.goal).toBe("seat");
  });

  it("still runs its tools from the sofa", () => {
    const sofa = seatedWalker(SPOTS.lounge, "lounge");
    const { walker } = run(
      sofa,
      "reading",
      0.1,
      0,
      false,
      false,
      undefined,
      "lounge",
    );
    expect(walker.goal).toBe("library");
  });
});

describe("stepIsoWalker — coffee while compacting", () => {
  const sip = (walker: IsoWalker, seconds: number, start = 0) =>
    run(walker, null, seconds, start, false, false, undefined, "cafe");
  const walkTo = (from: IsoSpot, to: IsoSpot): number =>
    Math.hypot(to.x - from.x, to.z - from.z) / 3.2;

  it("goes from its seat to the cafe and stands there with a coffee", () => {
    const there = sip(
      seatedWalker(SEAT),
      ERRAND_LINGER_MS / 1000 + walkTo(SEAT, SPOTS.cafe) + 0.3,
    );
    expect(there.walker).toMatchObject({
      goal: "cafe",
      x: SPOTS.cafe.x,
      z: SPOTS.cafe.z,
      pose: "work",
      path: null,
    });
  });

  it("leaves the sofa for the cafe at once when compacting starts", () => {
    const sofa = seatedWalker(SPOTS.lounge, "lounge");
    expect(sip(sofa, 0.1).walker).toMatchObject({ goal: "cafe", pose: "walk" });
  });

  it("goes back at once when the compaction ends", () => {
    const cafe = seatedWalker(SPOTS.cafe, "cafe");
    expect(run(cafe, null, 0.1).walker).toMatchObject({
      goal: "seat",
      pose: "walk",
    });
    const idle = run(cafe, null, 0.1, 0, false, false, undefined, "lounge");
    expect(idle.walker.goal).toBe("lounge");
    expect(run(cafe, "reading", 0.1).walker.goal).toBe("library");
  });
});
