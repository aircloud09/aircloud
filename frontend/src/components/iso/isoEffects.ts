/**
 * Room effects of the isometric office, from the video author's notes in
 * docs/plan/spec.md 「화면 재설계」: code runs down the iMac of whoever is
 * editing, the rack lights blink faster while a command runs, and planning
 * writes on the meeting room whiteboard. The elevator doors open while
 * someone steps in or out.
 */

import * as THREE from "three";
import type { Furniture, IsoSpot } from "@/constants/isoFloorPlan";
import { globeSpeed, lampLit, type NoteStatus } from "@/systems/roomGimmicks";
import { material } from "./isoFurniture";
import { ISO_COLORS } from "./isoPalette";
import type { RoomsInUse } from "./isoPeople";

/** Blink speed of the rack lights (rad/s), idle and while a command runs. */
const LED_IDLE_SPEED = 2.5;
const LED_BUSY_SPEED = 14;
/** How far the code scrolls per second, in screen heights. */
const CODE_SCROLL_SPEED = 0.25;
/** Seconds of planning to fill the whiteboard's writing rows. */
const BOARD_FILL_SECONDS = 8;
/** An iMac sits this far in front of the chair of the person using it (m). */
const SEAT_TO_SCREEN = 1.6;
/** How fast the elevator doors open and close (fully per second). */
const DOOR_SPEED = 2.2;
/** Where a closed elevator door sits from the middle, and how far it slides. */
const DOOR_CLOSED_X = 0.58;
const DOOR_SLIDE = 0.5;
/** An open door narrows to this share of its width in its pocket. */
const DOOR_OPEN_WIDTH = 0.2;
/** The lamp over the elevator door when lit, and its arrow's opacity when not. */
const LAMP_COLOR = "#f5b942";
const ARROW_DIM = 0.3;
/** The TV cuts to a new scene this often while someone watches (s). */
const TV_SCENE_SECONDS = 4;
/** A to-do note's colour by status, and the board's notes before any list. */
const NOTE_COLORS: Record<NoteStatus, string> = {
  pending: ISO_COLORS.notePending,
  in_progress: ISO_COLORS.noteInProgress,
  completed: ISO_COLORS.noteDone,
};
const DEFAULT_NOTES: readonly NoteStatus[] = [
  "pending",
  "in_progress",
  "completed",
];

const CODE_COLORS = [
  "#7dd3fc",
  "#fca5a5",
  "#fde68a",
  "#86efac",
  "#c4b5fd",
  "#e2e8f0",
];
const INK = ["#2f5bd3", "#1f2937", "#2f5bd3"];

/** Deterministic 0..1 values so every load looks the same. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const placeKey = (x: number, z: number): string =>
  `${x.toFixed(2)},${z.toFixed(2)}`;

/** Lines of make-believe code, tiled vertically so it can scroll forever. */
function codeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1d2636";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const random = seeded(11);
    for (let y = 6; y < canvas.height - 4; y += 11) {
      let x = 6 + Math.floor(random() * 4) * 8;
      const words = 1 + Math.floor(random() * 4);
      for (let w = 0; w < words && x < canvas.width - 10; w++) {
        const width = 8 + random() * 26;
        ctx.fillStyle = CODE_COLORS[Math.floor(random() * CODE_COLORS.length)];
        ctx.fillRect(x, y, Math.min(width, canvas.width - 6 - x), 5);
        x += width + 5;
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 0.5);
  return texture;
}

/** Handwriting rows: words as wavy strokes, drawn up to a fraction of their length. */
interface Board {
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  words: { row: number; x0: number; x1: number; seed: number }[];
  length: number;
  progress: number;
  drawnPercent: number;
}

function makeBoard(whiteboard: THREE.Object3D): Board | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The clear bottom half of the board, under its notes and boxes.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.3, 0.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.set(0, 1.39, 0.075);
  whiteboard.add(mesh);
  const random = seeded(5);
  const words: Board["words"] = [];
  for (let row = 0; row < 3; row++) {
    let x = 8 + random() * 20;
    while (x < canvas.width - 40) {
      const width = 24 + random() * 60;
      words.push({ row, x0: x, x1: x + width, seed: random() * 10 });
      x += width + 14;
    }
  }
  const length = words.reduce((sum, w) => sum + (w.x1 - w.x0), 0);
  return { ctx, texture, mesh, words, length, progress: 0, drawnPercent: 0 };
}

function drawBoard(board: Board): void {
  const { ctx, words } = board;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  let left = board.progress * board.length;
  for (const word of words) {
    if (left <= 0) break;
    const end = Math.min(word.x1, word.x0 + left);
    left -= word.x1 - word.x0;
    const baseline = 12 + word.row * 20;
    ctx.strokeStyle = INK[word.row];
    ctx.beginPath();
    for (let x = word.x0; x <= end; x += 2) {
      const y = baseline + 4 * Math.sin((x + word.seed * 7) * 0.45);
      if (x === word.x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  board.texture.needsUpdate = true;
}

export class IsoEffects {
  private readonly leds: { mesh: THREE.Object3D; phase: number }[] = [];
  private readonly screens = new Map<
    string,
    { mesh: THREE.Mesh; idle: THREE.Material | THREE.Material[] }
  >();
  private readonly code = codeTexture();
  private readonly codeMaterial = new THREE.MeshBasicMaterial({
    map: this.code,
  });
  private readonly board: Board | null = null;
  private wasPlanning = false;
  private readonly doors: { mesh: THREE.Object3D; side: number }[] = [];
  private doorsOpen = 0;
  private tv: {
    mesh: THREE.Mesh;
    off: THREE.Material | THREE.Material[];
  } | null = null;
  private readonly tvOn = new THREE.MeshBasicMaterial();
  /** The whiteboard's to-do note slots, in order. */
  private readonly notes: THREE.Mesh[] = [];
  private readonly globes: THREE.Object3D[] = [];
  private globeTurn = 0;
  private lamp: {
    mesh: THREE.Mesh;
    off: THREE.Material | THREE.Material[];
  } | null = null;
  private arrow: THREE.MeshBasicMaterial | null = null;
  private readonly lampOn = new THREE.MeshBasicMaterial({
    color: LAMP_COLOR,
  });
  private lastArrival: number | null = null;

  constructor(office: THREE.Object3D) {
    const found: { whiteboard?: THREE.Object3D } = {};
    office.traverse((object) => {
      if (typeof object.userData.ledPhase === "number") {
        this.leds.push({ mesh: object, phase: object.userData.ledPhase });
      }
      if (typeof object.userData.elevatorDoor === "number") {
        this.doors.push({ mesh: object, side: object.userData.elevatorDoor });
      }
      if (
        typeof object.userData.todoNote === "number" &&
        object instanceof THREE.Mesh
      ) {
        this.notes[object.userData.todoNote] = object;
      }
      if (object.userData.globeSpin) this.globes.push(object);
      if (object.userData.elevatorLamp && object instanceof THREE.Mesh) {
        this.lamp = { mesh: object, off: object.material };
      }
      if (
        object.userData.elevatorArrow &&
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshBasicMaterial
      ) {
        this.arrow = object.material;
      }
      if (object.userData.tvScreen && object instanceof THREE.Mesh) {
        this.tv = { mesh: object, off: object.material };
      }
      const item = object.userData.furniture as Furniture | undefined;
      if (item?.kind === "whiteboard") found.whiteboard = object;
      if (item?.kind === "imac") {
        const screen = object.children.find((c) => c.userData.imacScreen);
        if (screen instanceof THREE.Mesh) {
          this.screens.set(placeKey(item.x, item.z), {
            mesh: screen,
            idle: screen.material,
          });
        }
      }
    });
    if (found.whiteboard) this.board = makeBoard(found.whiteboard);
    this.setNotes(null);
  }

  /**
   * Stick a note on the whiteboard per to-do, coloured by its status. With
   * no list yet the board keeps three plain notes, as it always had.
   */
  setNotes(statuses: readonly NoteStatus[] | null): void {
    const shown = statuses ?? DEFAULT_NOTES;
    this.notes.forEach((note, i) => {
      const status = shown[i];
      note.visible = status !== undefined;
      if (status) note.material = material(NOTE_COLORS[status]);
    });
  }

  /** Bring the rooms up to date for this frame; ``seconds`` is the clock. */
  update(seconds: number, dt: number, inUse: RoomsInUse): void {
    const speed = inUse.serverBusy ? LED_BUSY_SPEED : LED_IDLE_SPEED;
    for (const led of this.leds) {
      led.mesh.visible = Math.sin(seconds * speed + led.phase) > -0.35;
    }

    const typing = new Set(
      inUse.editingSeats.map((seat: IsoSpot) =>
        placeKey(seat.x, seat.z - SEAT_TO_SCREEN),
      ),
    );
    for (const [key, screen] of this.screens) {
      screen.mesh.material = typing.has(key) ? this.codeMaterial : screen.idle;
    }
    this.code.offset.y -= dt * CODE_SCROLL_SPEED;

    if (this.board) {
      // A new round of planning on a full board starts on a clean one.
      if (inUse.planning && !this.wasPlanning && this.board.progress >= 1) {
        this.board.progress = 0;
      }
      if (inUse.planning) {
        this.board.progress = Math.min(
          1,
          this.board.progress + dt / BOARD_FILL_SECONDS,
        );
      }
      const percent = Math.floor(this.board.progress * 100);
      if (percent !== this.board.drawnPercent) {
        this.board.drawnPercent = percent;
        drawBoard(this.board);
      }
    }
    this.wasPlanning = inUse.planning;

    // A show on the TV: colours drifting, with the odd cut to a new scene.
    if (this.tv) {
      this.tv.mesh.material = inUse.tvOn ? this.tvOn : this.tv.off;
      if (inUse.tvOn) {
        const scene = Math.floor(seconds / TV_SCENE_SECONDS);
        const hue = (scene * 0.37 + seconds * 0.02) % 1;
        const flicker = 0.55 + 0.08 * Math.sin(seconds * 9);
        this.tvOn.color.setHSL(hue, 0.55, flicker);
      }
    }

    // The lamp over the elevator: dark until someone steps out.
    if (inUse.arriving) this.lastArrival = seconds;
    const lit = lampLit(this.lastArrival, seconds);
    if (this.lamp) this.lamp.mesh.material = lit ? this.lampOn : this.lamp.off;
    if (this.arrow) this.arrow.opacity = lit ? 1 : ARROW_DIM;

    this.globeTurn = globeSpeed(this.globeTurn, inUse.browsing, dt);
    for (const globe of this.globes) globe.rotation.y += this.globeTurn * dt;

    const target = inUse.elevatorOpen ? 1 : 0;
    const step = DOOR_SPEED * dt;
    this.doorsOpen += Math.max(-step, Math.min(step, target - this.doorsOpen));
    for (const door of this.doors) {
      door.mesh.position.x =
        door.side * (DOOR_CLOSED_X + DOOR_SLIDE * this.doorsOpen);
      door.mesh.scale.x = 1 - (1 - DOOR_OPEN_WIDTH) * this.doorsOpen;
    }
  }

  dispose(): void {
    this.code.dispose();
    this.codeMaterial.dispose();
    this.tvOn.dispose();
    this.lampOn.dispose();
    if (this.board) {
      this.board.texture.dispose();
      this.board.mesh.geometry.dispose();
      (this.board.mesh.material as THREE.Material).dispose();
    }
  }
}
