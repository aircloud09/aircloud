/**
 * Animation System
 *
 * Single requestAnimationFrame loop that updates all animation state:
 * - Agent position interpolation along paths
 * - Bubble display timing
 * - Queue advancement checks
 *
 * This is the core animation tick that drives all movement and timing.
 */

import {
  useGameStore,
  type AgentPhase,
  type PathState,
  type AgentMovement,
} from "@/stores/gameStore";
import {
  calculatePath,
  getNavigationGrid,
  updateAgentObstacle,
} from "./pathfinding";
import { BOSS_POSITION, getDeskPosition } from "./queuePositions";
import { stepBossErrand, type ErrandPathFinder } from "./bossErrands";
import {
  AGENT_ERRAND_SPEED,
  SEATED_AGENT_ERRAND,
  freeSpotsFor,
  stepAgentErrand,
} from "./agentErrands";
import type { PathGrid } from "./navigationGrid";
import { collisionManager } from "./agentCollision";
import { advanceAlongPath } from "./pathFollow";
import type { Position } from "@/types";

// ============================================================================
// CONSTANTS
// ============================================================================

const MOVEMENT_SPEED = 200; // pixels per second
const BUBBLE_DURATION_MS = 3000; // 3 seconds per bubble

// The boss routes around walls and furniture only; it walks through agents
// the same way agents walk through each other.
const bossErrandPath: ErrandPathFinder = (from, to) =>
  calculatePath(from, to, undefined, getNavigationGrid().staticView());

// ============================================================================
// ANIMATION SYSTEM CLASS
// ============================================================================

/**
 * Port the animation tick uses to talk back to the agent-machine layer.
 * Wired in one composition root (gameRuntime.ts) so AnimationSystem never
 * imports agentMachineService at runtime — breaking the machines↔systems
 * import cycle (ARC-017).
 */
export interface AnimationListener {
  notifyArrival(agentId: string, phase: AgentPhase): void;
  notifyBubbleComplete(entityId: string): void;
  notifyBossAvailable(): void;
}

interface AnimationState {
  isRunning: boolean;
  lastTickTime: number;
  rafId: number | null;
}

class AnimationSystem {
  private state: AnimationState = {
    isRunning: false,
    lastTickTime: 0,
    rafId: null,
  };

  private listener: AnimationListener | null = null;

  /**
   * Wire the machine-layer listener. Called once from the composition root
   * (gameRuntime.ts) so this module never imports agentMachineService at runtime.
   */
  setListener(listener: AnimationListener | null): void {
    this.listener = listener;
  }

  /**
   * Start the animation loop.
   */
  start(): void {
    if (this.state.isRunning) return;

    this.state.isRunning = true;
    this.state.lastTickTime = performance.now();
    this.tick();
  }

  /**
   * Stop the animation loop.
   */
  stop(): void {
    this.state.isRunning = false;
    if (this.state.rafId !== null) {
      cancelAnimationFrame(this.state.rafId);
      this.state.rafId = null;
    }
  }

  /**
   * Check if animation system is running.
   */
  isRunning(): boolean {
    return this.state.isRunning;
  }

  /**
   * Calculate and set a path for an agent.
   * Skips recalculation if agent is already moving to the same destination.
   *
   * @param grid - Grid to route on (defaults to the office grid with other
   *   agents as obstacles; errands pass the static view)
   * @param speed - Walking speed for this path (px/s; default MOVEMENT_SPEED)
   */
  setAgentPath(
    agentId: string,
    target: Position,
    grid?: PathGrid,
    speed?: number,
  ): void {
    const store = useGameStore.getState();
    const agent = store.agents.get(agentId);
    if (!agent) return;

    // Check if agent is already at the target (within 5px tolerance)
    const dx = Math.abs(agent.currentPosition.x - target.x);
    const dy = Math.abs(agent.currentPosition.y - target.y);
    if (dx < 5 && dy < 5) {
      // Already at destination - trigger immediate arrival
      store.updateAgentPath(agentId, null);
      this.handleArrival(agentId, agent.phase);
      return;
    }

    // Check if agent is already moving to this target (within 10px tolerance)
    // This prevents path recalculation mid-movement which causes skipping
    if (agent.path && agent.targetPosition) {
      const targetDx = Math.abs(agent.targetPosition.x - target.x);
      const targetDy = Math.abs(agent.targetPosition.y - target.y);
      if (targetDx < 10 && targetDy < 10) {
        // Already heading to same destination - skip path reset
        return;
      }
    }

    // Register agent for collision tracking if not already
    collisionManager.registerAgent(agentId, agent.currentPosition);

    const waypoints = calculatePath(
      agent.currentPosition,
      target,
      agentId,
      grid,
    );

    if (waypoints.length > 1) {
      store.updateAgentTarget(agentId, target);
      store.updateAgentPath(agentId, {
        waypoints,
        currentIndex: 0,
        progress: 0,
        speed,
      });
    } else {
      // Path calculation returned no valid path or single point - treat as arrival
      store.updateAgentPath(agentId, null);
      this.handleArrival(agentId, agent.phase);
    }
  }

  /**
   * Register a new agent for collision tracking.
   */
  registerAgent(agentId: string, position: Position): void {
    collisionManager.registerAgent(agentId, position);
  }

  /**
   * Unregister an agent from collision tracking.
   */
  unregisterAgent(agentId: string): void {
    collisionManager.unregisterAgent(agentId);
  }

  // ==========================================================================
  // MAIN TICK LOOP
  // ==========================================================================

  private tick = (): void => {
    if (!this.state.isRunning) return;

    const now = performance.now();
    const deltaMs = now - this.state.lastTickTime;
    const deltaSeconds = deltaMs / 1000;
    this.state.lastTickTime = now;

    // Update all systems
    this.updateAgentPositions(deltaSeconds);
    this.updateBossErrand(deltaSeconds);
    this.updateAgentErrands();
    this.updateBubbleTimers();
    this.checkQueueAdvancement();

    // Schedule next frame
    this.state.rafId = requestAnimationFrame(this.tick);
  };

  // ==========================================================================
  // POSITION UPDATES
  // ==========================================================================

  private updateAgentPositions(deltaSeconds: number): void {
    const store = useGameStore.getState();

    // Collect every moving agent's position/path delta, then apply them in one
    // store write at the end (ARC-006: was one Map clone + one subscriber
    // notification per agent per frame). The loop reads from the snapshot taken
    // above, so batching the writes is behavior-equivalent. Non-moving agents
    // keep their object reference, so React.memo on the sprites bails out.
    const movements: AgentMovement[] = [];
    const arrivals: Array<{ agentId: string; phase: AgentPhase }> = [];

    for (const [agentId, agent] of store.agents) {
      if (!agent.path) {
        // Still update obstacle position for stationary agents
        updateAgentObstacle(agentId, agent.currentPosition);
        collisionManager.updatePosition(agentId, agent.currentPosition);
        continue;
      }

      // Calculate what the next position would be
      const result = this.updatePathProgress(
        {
          currentPosition: agent.currentPosition,
          targetPosition: agent.targetPosition,
          path: agent.path,
        },
        deltaSeconds,
      );
      if (!result) continue;

      const { newPosition, newPath, arrived } = result;

      // Agent collision disabled - agents pass through each other
      // This simplifies pathfinding and avoids deadlock issues

      // Update obstacle position for pathfinding
      updateAgentObstacle(agentId, newPosition);

      // Update collision manager position for agent-to-agent collision
      collisionManager.updatePosition(agentId, newPosition);

      // Queue the delta: path omitted => unchanged, null => cleared on arrival.
      if (arrived) {
        movements.push({ agentId, position: newPosition, path: null });
        arrivals.push({ agentId, phase: agent.phase });
      } else if (newPath) {
        movements.push({ agentId, position: newPosition, path: newPath });
      } else {
        movements.push({ agentId, position: newPosition });
      }
    }

    // One set() per tick instead of one per agent. Non-moving agents are not in
    // `movements`, so their entries in the new Map keep the same object ref.
    if (movements.length > 0) {
      store.applyAgentMovements(movements);
    }

    // Arrival notifications fire after the batched state update.
    for (const { agentId, phase } of arrivals) {
      this.handleArrival(agentId, phase);
    }
  }

  /**
   * Walk the boss to the archive / server room and back (bossErrands.ts).
   * Sitting back down frees the boss for the next queued agent.
   */
  private updateBossErrand(deltaSeconds: number): void {
    const store = useGameStore.getState();
    const { state, sat } = stepBossErrand(
      store.bossErrand,
      {
        activity: store.boss.activity,
        deskDuty:
          store.boss.inUseBy !== null ||
          store.arrivalQueue.length > 0 ||
          store.departureQueue.length > 0,
        isStuck: store.boss.stuck !== null,
        quietSince: store.boss.quietSince,
        now: performance.now(),
        deltaSeconds,
      },
      BOSS_POSITION,
      bossErrandPath,
    );
    if (state !== store.bossErrand) store.setBossErrand(state);
    if (sat) this.listener?.notifyBossAvailable();
  }

  /**
   * Send agents seated at their desks on errands (agentErrands.ts). Agents
   * that left their desk phase are handed back to their state machines.
   */
  private updateAgentErrands(): void {
    const store = useGameStore.getState();
    const now = performance.now();
    const errands = new Map(store.agentErrands);
    let changed = false;

    for (const id of errands.keys()) {
      if (store.agents.get(id)?.phase !== "idle") {
        errands.delete(id);
        changed = true;
      }
    }

    for (const [id, agent] of store.agents) {
      if (agent.phase !== "idle" || agent.desk === null) continue;
      const current = errands.get(id) ?? SEATED_AGENT_ERRAND;
      const { state, walkTo } = stepAgentErrand(current, {
        activity: agent.activity,
        isStuck: agent.stuck !== null,
        position: agent.currentPosition,
        isMoving: agent.path !== null,
        desk: getDeskPosition(agent.desk),
        freeSpots: freeSpotsFor(errands, id),
        now,
      });
      if (state !== current) {
        if (state === SEATED_AGENT_ERRAND) errands.delete(id);
        else errands.set(id, state);
        changed = true;
      }
      if (walkTo) {
        this.setAgentPath(
          id,
          walkTo,
          getNavigationGrid().staticView(),
          AGENT_ERRAND_SPEED,
        );
      }
    }

    if (changed) store.setAgentErrands(errands);
  }

  private updatePathProgress(
    agent: {
      currentPosition: Position;
      targetPosition: Position;
      path: PathState;
    },
    deltaSeconds: number,
  ): {
    newPosition: Position;
    newPath: PathState | null;
    arrived: boolean;
  } | null {
    const { position, path, arrived } = advanceAlongPath(
      agent.path,
      (agent.path.speed ?? MOVEMENT_SPEED) * deltaSeconds,
    );
    return { newPosition: position, newPath: path, arrived };
  }

  private handleArrival(agentId: string, phase: AgentPhase): void {
    this.listener?.notifyArrival(agentId, phase);
  }

  // ==========================================================================
  // BUBBLE TIMING
  // ==========================================================================

  private updateBubbleTimers(): void {
    const store = useGameStore.getState();
    const now = Date.now(); // Use Date.now() to match displayStartTime

    // Check boss bubble
    const bossBubble = store.boss.bubble;
    if (bossBubble.content && bossBubble.displayStartTime) {
      const elapsed = now - bossBubble.displayStartTime;
      if (elapsed >= BUBBLE_DURATION_MS) {
        // Only advance if bubble is NOT persistent, OR there's a queued bubble to show
        if (!bossBubble.content.persistent || bossBubble.queue.length > 0) {
          store.advanceBubble("boss");

          // Notify any waiting state machines
          this.notifyBubbleComplete("boss");
        }
      }
    } else if (!bossBubble.content && bossBubble.queue.length > 0) {
      // No current bubble but items in queue - display the next one
      store.advanceBubble("boss");
    }

    // Check agent bubbles
    for (const [agentId, agent] of store.agents) {
      const bubble = agent.bubble;
      if (bubble.content && bubble.displayStartTime) {
        const elapsed = now - bubble.displayStartTime;
        if (elapsed >= BUBBLE_DURATION_MS) {
          // Only advance if bubble is NOT persistent, OR there's a queued bubble to show
          if (!bubble.content.persistent || bubble.queue.length > 0) {
            store.advanceBubble(agentId);

            // Notify the agent's state machine
            this.notifyBubbleComplete(agentId);
          }
        }
      }
    }
  }

  private notifyBubbleComplete(entityId: string): void {
    if (entityId === "boss") {
      // Find any agent in conversing state that's waiting for boss bubble
      const store = useGameStore.getState();
      for (const [agentId, agent] of store.agents) {
        if (agent.phase === "conversing") {
          this.listener?.notifyBubbleComplete(agentId);
          break;
        }
      }
    } else {
      // Notify specific agent
      this.listener?.notifyBubbleComplete(entityId);
    }
  }

  // ==========================================================================
  // QUEUE ADVANCEMENT
  // ==========================================================================

  private lastNotifiedAgentId: string | null = null;

  private checkQueueAdvancement(): void {
    const store = useGameStore.getState();

    // The queue must not advance while the boss is busy with an agent or away
    // from the desk on an errand (it is called back and notifies on sitting
    // down). With single-writer queue ownership (ARC-004) the boss lock can no
    // longer leak, so the previous 3-second "stuck boss" auto-release watchdog
    // is gone.
    if (store.boss.inUseBy !== null || store.bossErrand.phase !== "seated") {
      this.lastNotifiedAgentId = null;
      return;
    }

    // Priority: arrival queue first
    if (store.arrivalQueue.length > 0) {
      const frontId = store.arrivalQueue[0];
      const frontAgent = store.agents.get(frontId);

      // Only advance if agent is:
      // 1. In queue phase
      // 2. At front of queue (index 0)
      // 3. NOT currently walking (no active path)
      // 4. Not already notified (prevents duplicate BOSS_AVAILABLE per tick)
      if (
        frontAgent?.phase === "in_arrival_queue" &&
        frontAgent.queueIndex === 0 &&
        frontAgent.path === null &&
        this.lastNotifiedAgentId !== frontId
      ) {
        this.lastNotifiedAgentId = frontId;
        this.listener?.notifyBossAvailable();
        return;
      }
    }

    // Then departure queue
    if (store.departureQueue.length > 0) {
      const frontId = store.departureQueue[0];
      const frontAgent = store.agents.get(frontId);

      if (
        frontAgent?.phase === "in_departure_queue" &&
        frontAgent.queueIndex === 0 &&
        frontAgent.path === null &&
        this.lastNotifiedAgentId !== frontId
      ) {
        this.lastNotifiedAgentId = frontId;
        this.listener?.notifyBossAvailable();
      }
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const animationSystem = new AnimationSystem();
