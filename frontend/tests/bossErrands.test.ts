/**
 * Boss errand choreography (systems/bossErrands.ts) against the movement
 * rules in docs/plan/spec.md "동선 규칙". A straight-line path finder keeps
 * the timing arithmetic readable: distance / BOSS_ERRAND_SPEED seconds.
 */

import { describe, expect, it } from "vitest";
import {
  BOSS_ERRAND_SPEED,
  BOSS_ERRAND_SPOTS,
  ERRAND_LINGER_MS,
  PONDER_AFTER_MS,
  stepBossErrand,
  type BossErrandInput,
  type ErrandPathFinder,
} from "@/systems/bossErrands";
import { initialBossErrandState } from "@/stores/slices/shared";
import type { BossErrandState } from "@/stores/slices/types";
import type { Activity, Position } from "@/types";

const DESK: Position = { x: 640, y: 900 };
const straight: ErrandPathFinder = (from, to) => [from, to];
const unreachable: ErrandPathFinder = (from) => [from];

const TICK = 1 / 60;

interface Sim {
  state: BossErrandState;
  now: number;
  satCount: number;
}

function sim(): Sim {
  return { state: initialBossErrandState, now: 0, satCount: 0 };
}

/** Run ticks for `seconds` with fixed inputs. */
function run(
  s: Sim,
  seconds: number,
  inputs: Partial<Omit<BossErrandInput, "now" | "deltaSeconds">> = {},
  findPath: ErrandPathFinder = straight,
): Sim {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) {
    s.now += TICK * 1000;
    const step = stepBossErrand(
      s.state,
      {
        activity: null,
        deskDuty: false,
        isStuck: false,
        quietSince: null,
        ...inputs,
        now: s.now,
        deltaSeconds: TICK,
      },
      DESK,
      findPath,
    );
    s.state = step.state;
    if (step.sat) s.satCount++;
  }
  return s;
}

const walkSeconds = (to: Position, from: Position = DESK) =>
  Math.hypot(to.x - from.x, to.y - from.y) / BOSS_ERRAND_SPEED;

const reading: { activity: Activity } = { activity: "reading" };
const running: { activity: Activity } = { activity: "running" };

describe("stepBossErrand", () => {
  it("walks to the archive while reading and works at the spot", () => {
    const s = run(sim(), 0.1, reading);
    expect(s.state.phase).toBe("walking");
    expect(s.state.room).toBe("archive");

    run(s, walkSeconds(BOSS_ERRAND_SPOTS.archive), reading);
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.archive);
  });

  it("lingers after the tool ends, then walks back and sits down", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    expect(s.state.phase).toBe("working");

    run(s, ERRAND_LINGER_MS / 1000 - 0.2);
    expect(s.state.phase).toBe("working");

    run(s, 0.4);
    expect(s.state.phase).toBe("returning");

    run(s, walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2);
    expect(s.state.phase).toBe("seated");
    expect(s.state.position).toEqual(DESK);
    expect(s.satCount).toBe(1);
  });

  it("stays in the archive across back-to-back reads", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    for (let i = 0; i < 4; i++) {
      run(s, 0.5); // gap between two Read calls
      run(s, 1.0, reading);
      expect(s.state.phase).toBe("working");
    }
    expect(s.satCount).toBe(0);
  });

  it("goes straight from the archive to the server room when a command starts", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    run(s, 0.1, running);
    expect(s.state.phase).toBe("walking");
    expect(s.state.room).toBe("server");
    expect(s.state.path?.waypoints[0]).toEqual(BOSS_ERRAND_SPOTS.archive);

    run(
      s,
      walkSeconds(BOSS_ERRAND_SPOTS.server, BOSS_ERRAND_SPOTS.archive),
      running,
    );
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.server);
    expect(s.satCount).toBe(0);
  });

  it("retargets mid-walk", () => {
    const s = run(sim(), 0.5, reading);
    const midWalk = s.state.position;
    run(s, TICK, running);
    expect(s.state.room).toBe("server");
    expect(s.state.path?.waypoints[0]).toEqual(midWalk);
  });

  it("finishes the trip for a tool that ends before arrival", () => {
    const s = run(sim(), 0.2, reading); // a fast Read
    run(s, walkSeconds(BOSS_ERRAND_SPOTS.archive));
    expect(s.state.phase).toBe("working");
    run(s, ERRAND_LINGER_MS / 1000 - 0.2);
    expect(s.state.phase).toBe("working");
  });

  it("comes back to the desk for queued agents even while reading", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    run(s, 0.1, { ...reading, deskDuty: true });
    expect(s.state.phase).toBe("returning");
    run(s, walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, {
      ...reading,
      deskDuty: true,
    });
    expect(s.state.phase).toBe("seated");
    expect(s.satCount).toBe(1);
  });

  it("does not move toward an unreachable room", () => {
    const s = run(sim(), 0.5, reading, unreachable);
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(DESK);
  });

  it("ponders where it is when stuck, then resumes", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.server) + 0.2, running);
    // The command fails: no activity, stuck
    run(s, 3.0, { isStuck: true });
    expect(s.state.pondering).toBe(true);
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.server);

    // Unstuck with nothing to do: the usual linger, then back to the desk
    run(s, 0.1);
    expect(s.state.pondering).toBe(false);
    expect(s.state.phase).toBe("working");
    run(s, ERRAND_LINGER_MS / 1000 + 0.1);
    expect(s.state.phase).toBe("returning");
  });

  it("finishes the walk before pondering at the spot", () => {
    // A permission prompt right after the command starts
    const s = run(sim(), 0.1, running);
    run(s, walkSeconds(BOSS_ERRAND_SPOTS.server), {
      ...running,
      isStuck: true,
    });
    expect(s.state.pondering).toBe(true);
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.server);

    // Still waiting, the command is over for the boss: it stays put
    run(s, ERRAND_LINGER_MS / 1000 + 1, { isStuck: true });
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.server);
  });

  it("waits for a permission prompt at the rack even if it came at once", () => {
    // Tool start and permission prompt in the same frame, boss seated
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.server) + 0.2, {
      ...running,
      isStuck: true,
    });
    expect(s.state.pondering).toBe(true);
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.server);
  });

  it("does not leave the spot while stuck with no tool running", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    run(s, ERRAND_LINGER_MS / 1000 + 2, { isStuck: true });
    expect(s.state.room).toBe("archive");
    expect(s.state.phase).toBe("working");
    expect(s.state.position).toEqual(BOSS_ERRAND_SPOTS.archive);
  });

  it("ponders at the desk after a long quiet spell mid-turn", () => {
    const s = sim();
    run(s, 0.1, { quietSince: s.now });
    expect(s.state.pondering).toBe(false);
    run(s, 0.1, { quietSince: s.now - PONDER_AFTER_MS });
    expect(s.state.pondering).toBe(true);
    expect(s.state.phase).toBe("seated");
  });

  it("answers queued agents instead of pondering", () => {
    const s = run(sim(), walkSeconds(BOSS_ERRAND_SPOTS.archive) + 0.2, reading);
    run(s, 0.1, { isStuck: true, deskDuty: true });
    expect(s.state.pondering).toBe(false);
    expect(s.state.phase).toBe("returning");
  });
});
