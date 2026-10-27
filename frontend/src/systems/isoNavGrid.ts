/**
 * Walkable floor of the isometric office for the shared A* path finder
 * (docs/plan/spec.md 동선 규칙): walls and furniture block, chairs do not,
 * since people sit on them.
 *
 * The path finder and smoother were written for the 2D office's 32px tiles,
 * so this grid works in "nav units": a cell is half a metre wide and
 * NAV_UNITS_PER_METRE turns metres into nav units.
 */

import type { Position } from "@/types";
import {
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  FOOTPRINTS,
  FURNITURE,
  WALLS,
} from "@/constants/isoFloorPlan";
import { findWorldPath } from "./astar";
import { TILE_SIZE, type GridPosition, type PathGrid } from "./navigationGrid";
import { smoothPath } from "./pathSmoothing";

/** A point on the floor in metres. */
export interface FloorPoint {
  x: number;
  z: number;
}

const CELL_METRES = 0.5;
export const NAV_UNITS_PER_METRE = TILE_SIZE / CELL_METRES;
const COLUMNS = Math.round(FLOOR_WIDTH / CELL_METRES);
const ROWS = Math.round(FLOOR_DEPTH / CELL_METRES);
/** Room kept clear around a walking person's centre (m). */
const CLEARANCE = 0.2;
const WALL_THICKNESS = 0.25;

const toNav = (p: FloorPoint): Position => ({
  x: p.x * NAV_UNITS_PER_METRE,
  y: p.z * NAV_UNITS_PER_METRE,
});
const fromNav = (p: Position): FloorPoint => ({
  x: p.x / NAV_UNITS_PER_METRE,
  z: p.y / NAV_UNITS_PER_METRE,
});

/** Block every cell whose centre lies in the rectangle grown by CLEARANCE. */
function blockArea(
  blocked: Uint8Array,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): void {
  for (let gz = 0; gz < ROWS; gz++) {
    const cz = (gz + 0.5) * CELL_METRES;
    if (cz < minZ - CLEARANCE || cz > maxZ + CLEARANCE) continue;
    for (let gx = 0; gx < COLUMNS; gx++) {
      const cx = (gx + 0.5) * CELL_METRES;
      if (cx >= minX - CLEARANCE && cx <= maxX + CLEARANCE) {
        blocked[gz * COLUMNS + gx] = 1;
      }
    }
  }
}

function buildBlockedCells(): Uint8Array {
  const blocked = new Uint8Array(COLUMNS * ROWS);
  const half = WALL_THICKNESS / 2;
  for (const wall of WALLS) {
    const [x1, z1] = wall.from;
    const [x2, z2] = wall.to;
    blockArea(
      blocked,
      Math.min(x1, x2) - half,
      Math.min(z1, z2) - half,
      Math.max(x1, x2) + half,
      Math.max(z1, z2) + half,
    );
  }
  for (const item of FURNITURE) {
    const size = FOOTPRINTS[item.kind];
    if (!size || item.y) continue;
    const turned = (item.rot ?? 0) % 2 === 1;
    const w = turned ? size[1] : size[0];
    const d = turned ? size[0] : size[1];
    blockArea(
      blocked,
      item.x - w / 2,
      item.z - d / 2,
      item.x + w / 2,
      item.z + d / 2,
    );
  }
  return blocked;
}

class IsoNavGrid implements PathGrid {
  private readonly blocked = buildBlockedCells();

  worldToGrid(x: number, y: number): GridPosition {
    return { gx: Math.floor(x / TILE_SIZE), gy: Math.floor(y / TILE_SIZE) };
  }

  gridToWorld(gx: number, gy: number): Position {
    return { x: (gx + 0.5) * TILE_SIZE, y: (gy + 0.5) * TILE_SIZE };
  }

  isWalkable(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= COLUMNS || gy >= ROWS) return false;
    return this.blocked[gy * COLUMNS + gx] === 0;
  }

  getCost(): number {
    return 1;
  }

  /** Eight neighbours; a diagonal step needs both sides open (no corner cutting). */
  getNeighbors(gx: number, gy: number): GridPosition[] {
    const neighbors: GridPosition[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!this.isWalkable(gx + dx, gy + dy)) continue;
        if (
          dx !== 0 &&
          dy !== 0 &&
          (!this.isWalkable(gx + dx, gy) || !this.isWalkable(gx, gy + dy))
        ) {
          continue;
        }
        neighbors.push({ gx: gx + dx, gy: gy + dy });
      }
    }
    return neighbors;
  }
}

let grid: IsoNavGrid | null = null;

/** The office's grid, built on first use. */
export function getIsoNavGrid(): PathGrid {
  grid ??= new IsoNavGrid();
  return grid;
}

/** Whether a person can stand at this point. */
export function isFloorWalkable(point: FloorPoint): boolean {
  const g = getIsoNavGrid();
  const cell = g.worldToGrid(toNav(point).x, toNav(point).y);
  return g.isWalkable(cell.gx, cell.gy);
}

/**
 * A smoothed walking path between two floor points in metres, starting and
 * ending exactly on them; empty when there is no way through.
 */
export function findFloorPath(from: FloorPoint, to: FloorPoint): FloorPoint[] {
  const g = getIsoNavGrid();
  const cells = findWorldPath(toNav(from), toNav(to), undefined, g);
  if (cells.length === 0) return [];
  const exact = [toNav(from), ...cells.slice(1, -1), toNav(to)];
  return smoothPath(exact, g).map(fromNav);
}
