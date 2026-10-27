/**
 * Furniture of the isometric office, built from simple solids.
 *
 * Every builder returns a group whose origin is the piece's centre on the
 * floor, facing +z (a chair's seat faces +z, a shelf's books face +z).
 */

import * as THREE from "three";
import type { FurnitureKind } from "@/constants/isoFloorPlan";
import { ISO_COLORS as C } from "./isoPalette";
import { textTexture } from "./isoTextures";

const materials = new Map<string, THREE.MeshLambertMaterial>();

/** What the windows show at night: the sky and the towers turn dark. */
const NIGHT_COLORS: Readonly<Record<string, string>> = {
  [C.window]: C.nightWindow,
  [C.skyline]: C.nightSkyline,
};
let night = false;

/** Switch the view out of the windows; materials made later follow it too. */
export function setNightView(isNight: boolean): void {
  night = isNight;
  for (const [key, found] of materials) {
    const day = key.split("|")[0];
    if (day in NIGHT_COLORS) found.color.set(night ? NIGHT_COLORS[day] : day);
  }
}

/** Shared Lambert material per colour (and transparency/emission). */
export function material(
  color: string,
  options: { opacity?: number; emissive?: string } = {},
): THREE.MeshLambertMaterial {
  const key = `${color}|${options.opacity ?? 1}|${options.emissive ?? ""}`;
  let found = materials.get(key);
  if (!found) {
    found = new THREE.MeshLambertMaterial({
      color,
      transparent: options.opacity !== undefined && options.opacity < 1,
      opacity: options.opacity ?? 1,
      depthWrite: options.opacity === undefined || options.opacity >= 1,
      emissive: options.emissive ?? "#000000",
    });
    if (night && color in NIGHT_COLORS) found.color.set(NIGHT_COLORS[color]);
    materials.set(key, found);
  }
  return found;
}

/** A box whose bottom sits at ``y`` (not its centre). */
export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
  options: { opacity?: number; emissive?: string; shadow?: boolean } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material(color, options),
  );
  mesh.position.set(x, y + h / 2, z);
  const shadow =
    options.shadow ?? (options.opacity === undefined || options.opacity >= 1);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

/** A cylinder whose bottom sits at ``y``. */
export function cylinder(
  radiusTop: number,
  radiusBottom: number,
  h: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
  segments = 20,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments),
    material(color),
  );
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

/** Deterministic 0..1 values, so every bookshelf looks the same on each load. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function bookshelf(seed: number): THREE.Group {
  const width = 2.3;
  const depth = 0.5;
  const height = 2.7;
  const g = group(
    box(width, height, 0.06, C.shelfBack, 0, 0, -depth / 2 + 0.03),
    box(0.08, height, depth, C.shelfWood, -width / 2 + 0.04, 0, 0),
    box(0.08, height, depth, C.shelfWood, width / 2 - 0.04, 0, 0),
  );
  const shelves = 5;
  const random = seeded(seed + 1);
  const books = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: "#ffffff" }),
    shelves * 16,
  );
  books.castShadow = true;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let count = 0;
  for (let s = 0; s < shelves; s++) {
    const y = 0.08 + (s * height) / shelves;
    g.add(box(width - 0.12, 0.05, depth, C.shelfBack, 0, y - 0.05, 0));
    let x = -width / 2 + 0.14;
    while (x < width / 2 - 0.2 && count < books.count) {
      const w = 0.09 + random() * 0.07;
      const h = 0.32 + random() * 0.14;
      matrix.compose(
        new THREE.Vector3(x + w / 2, y + h / 2, 0.02),
        new THREE.Quaternion(),
        new THREE.Vector3(w, h, depth - 0.12),
      );
      books.setMatrixAt(count, matrix);
      books.setColorAt(
        count,
        color.set(C.books[Math.floor(random() * C.books.length)]),
      );
      count++;
      // Leave a gap now and then so the white back shows, as in the video.
      x += w + 0.01 + (random() < 0.12 ? 0.25 + random() * 0.3 : 0);
    }
  }
  books.count = count;
  g.add(books, box(width, 0.06, depth, C.shelfBack, 0, height, 0));
  return g;
}

function woodenChair(): THREE.Group {
  return group(
    box(0.5, 0.06, 0.5, "#8a6a4f", 0, 0.42, 0),
    box(0.5, 0.5, 0.06, "#8a6a4f", 0, 0.48, -0.22),
    box(0.05, 0.42, 0.05, "#5f4632", -0.2, 0, -0.2),
    box(0.05, 0.42, 0.05, "#5f4632", 0.2, 0, -0.2),
    box(0.05, 0.42, 0.05, "#5f4632", -0.2, 0, 0.2),
    box(0.05, 0.42, 0.05, "#5f4632", 0.2, 0, 0.2),
  );
}

function officeChair(): THREE.Group {
  return group(
    box(0.56, 0.1, 0.54, C.officeChair, 0, 0.46, 0),
    box(0.54, 0.62, 0.08, C.officeChair, 0, 0.56, -0.26),
    cylinder(0.04, 0.04, 0.4, "#5b616b", 0, 0.06, 0),
    box(0.62, 0.05, 0.08, "#5b616b", 0, 0.03, 0),
    box(0.08, 0.05, 0.62, "#5b616b", 0, 0.03, 0),
  );
}

function longDesk(): THREE.Group {
  const length = 9.6;
  return group(
    box(length, 0.06, 1.2, C.desk, 0, 0.72, 0),
    box(0.08, 0.72, 1.1, C.deskLeg, -length / 2 + 0.1, 0, 0),
    box(0.08, 0.72, 1.1, C.deskLeg, length / 2 - 0.1, 0, 0),
    box(length - 0.3, 0.3, 0.03, C.deskLeg, 0, 0.4, -0.52),
  );
}

function imac(): THREE.Group {
  const screen = box(0.84, 0.48, 0.01, C.imacScreen, 0, 0.27, 0.03, {
    emissive: C.imacScreenDark,
  });
  // Shows running code while someone edits at this desk (see isoEffects).
  screen.userData.imacScreen = true;
  return group(
    box(0.32, 0.03, 0.22, C.imacFrame, 0, 0, 0),
    box(0.06, 0.24, 0.05, C.imacFrame, 0, 0.02, -0.04),
    box(0.92, 0.6, 0.05, C.imacFrame, 0, 0.2, 0),
    screen,
  );
}

function roundTable(): THREE.Group {
  return group(
    cylinder(1.0, 1.0, 0.08, C.tableLight, 0, 0.7, 0, 28),
    cylinder(0.08, 0.08, 0.7, "#9aa1ab", 0, 0, 0),
    cylinder(0.4, 0.4, 0.04, "#9aa1ab", 0, 0, 0),
  );
}

function meetingTable(): THREE.Group {
  return group(
    box(4.7, 0.07, 2.4, C.meetingTop, 0, 0.7, 0),
    box(0.12, 0.7, 1.9, C.deskLeg, -2.0, 0, 0),
    box(0.12, 0.7, 1.9, C.deskLeg, 2.0, 0, 0),
  );
}

function meetingChair(): THREE.Group {
  return group(
    box(0.52, 0.08, 0.5, C.meetingChair, 0, 0.44, 0),
    box(0.52, 0.55, 0.08, C.meetingChair, 0, 0.5, -0.22),
    cylinder(0.035, 0.035, 0.44, "#3a3f48", 0, 0, 0),
    box(0.5, 0.04, 0.06, "#3a3f48", 0, 0, 0),
  );
}

/** Rows and columns of the to-do sticky notes on the whiteboard's top left. */
const NOTE_COLUMNS = 4;
const NOTE_ROWS = 3;

/**
 * A wide board with sticky notes and a little diagram across its top half;
 * the bottom half is left clear for planning to write on (see isoEffects).
 * The notes are a grid of slots isoEffects fills, one per to-do.
 */
function whiteboard(): THREE.Group {
  const line = "#3a4250";
  const notes: THREE.Mesh[] = [];
  for (let i = 0; i < NOTE_COLUMNS * NOTE_ROWS; i++) {
    const column = i % NOTE_COLUMNS;
    const row = Math.floor(i / NOTE_COLUMNS);
    const note = box(
      0.26,
      0.2,
      0.02,
      C.notePending,
      -1.98 + column * 0.3,
      2.25 - row * 0.25,
      0.06,
      { shadow: false },
    );
    note.userData.todoNote = i;
    notes.push(note);
  }
  return group(
    box(4.6, 1.6, 0.06, C.whiteboardFrame, 0, 1.0, 0),
    box(4.44, 1.44, 0.02, C.whiteboard, 0, 1.08, 0.04, {
      emissive: C.boardGlow,
    }),
    ...notes,
    box(0.9, 0.44, 0.02, "#e86b6b", -0.2, 1.72, 0.06),
    box(0.8, 0.36, 0.02, C.whiteboard, -0.2, 1.76, 0.07),
    box(0.9, 0.44, 0.02, "#5b8de0", 1.15, 1.72, 0.06),
    box(0.8, 0.36, 0.02, C.whiteboard, 1.15, 1.76, 0.07),
    box(0.36, 0.04, 0.02, line, 0.48, 1.92, 0.06),
    box(1.6, 0.04, 0.02, line, 0.95, 2.3, 0.06),
    box(1.1, 0.04, 0.02, line, 1.2, 2.4, 0.06),
  );
}

function sofa(): THREE.Group {
  return group(
    box(3.3, 0.48, 1.2, C.sofa, 0, 0, 0),
    box(3.3, 1.0, 0.34, C.sofaDark, 0, 0, -0.43),
    box(0.32, 0.72, 1.2, C.sofaDark, -1.49, 0, 0),
    box(0.32, 0.72, 1.2, C.sofaDark, 1.49, 0, 0),
    box(1.3, 0.12, 0.82, "#7d5747", -0.67, 0.48, 0.1),
    box(1.3, 0.12, 0.82, "#7d5747", 0.67, 0.48, 0.1),
  );
}

function armchair(): THREE.Group {
  return group(
    box(1.4, 0.5, 1.2, C.armchair, 0, 0, 0),
    box(1.4, 0.95, 0.3, "#e7e2da", 0, 0, -0.45),
    box(0.28, 0.7, 1.2, "#e7e2da", -0.56, 0, 0),
    box(0.28, 0.7, 1.2, "#e7e2da", 0.56, 0, 0),
  );
}

function coffeeTable(): THREE.Group {
  return group(
    box(2.0, 0.08, 1.0, C.tableWood, 0, 0.4, 0),
    box(1.9, 0.4, 0.9, "#c9ad84", 0, 0, 0),
  );
}

function sideTable(): THREE.Group {
  return group(
    cylinder(0.55, 0.55, 0.06, C.tableWood, 0, 0.55, 0),
    cylinder(0.06, 0.06, 0.55, "#4a4f58", 0, 0, 0),
    cylinder(0.26, 0.26, 0.03, "#4a4f58", 0, 0, 0),
  );
}

/** A long wooden cabinet against the wall with a TV on it. */
function tvStand(): THREE.Group {
  // The screen lights up while someone in the lounge watches (isoEffects).
  const screen = box(1.16, 0.7, 0.01, "#323a47", 0, 0.87, 0.26);
  screen.userData.tvScreen = true;
  return group(
    box(4.4, 0.75, 0.7, C.cabinetWood, 0, 0, 0),
    box(4.44, 0.05, 0.74, C.tableWood, 0, 0.75, 0),
    box(1.3, 0.85, 0.5, C.tv, 0, 0.8, 0),
    screen,
  );
}

/** A framed picture hanging on the wall. */
function picture(): THREE.Group {
  return group(
    box(1.1, 0.85, 0.05, C.pictureFrame, 0, 0, 0),
    box(0.96, 0.71, 0.01, C.whiteboard, 0, 0.07, 0.03, {
      emissive: C.boardGlow,
    }),
    box(0.34, 0.3, 0.01, "#e86b6b", -0.2, 0.15, 0.04),
    box(0.3, 0.42, 0.01, "#5b8de0", 0.2, 0.34, 0.04),
  );
}

/** A tall white cabinet. */
function locker(): THREE.Group {
  return group(
    box(1.7, 2.2, 0.9, C.locker, 0, 0, 0),
    box(0.02, 2.0, 0.01, "#d5dae1", 0, 0.1, 0.455),
  );
}

function serverRack(seed: number): THREE.Group {
  const g = group(box(1.2, 2.7, 1.1, C.rack, 0, 0, 0));
  const random = seeded(seed + 7);
  for (let row = 0; row < 12; row++) {
    const y = 0.25 + row * 0.2;
    g.add(box(1.0, 0.12, 0.02, "#2b3342", 0, y, 0.56));
    for (let led = 0; led < 3; led++) {
      const color = random() > 0.3 ? C.rackLedGreen : C.rackLedAmber;
      const light = box(
        0.06,
        0.05,
        0.02,
        color,
        -0.4 + led * 0.1,
        y + 0.035,
        0.575,
        {
          emissive: color,
          shadow: false,
        },
      );
      // Each light blinks on its own beat (see isoEffects).
      light.userData.ledPhase = random() * Math.PI * 2;
      g.add(light);
    }
  }
  return g;
}

function kiosk(): THREE.Group {
  return group(
    box(0.8, 0.1, 0.56, "#4b3399", 0, 0, 0),
    box(0.66, 2.35, 0.4, C.kiosk, 0, 0.1, 0),
    box(0.5, 1.0, 0.02, C.kioskScreen, 0, 1.25, 0.21, { emissive: "#24184f" }),
  );
}

function globe(): THREE.Group {
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 24, 18),
    material(C.globeSea),
  );
  sphere.position.set(0, 1.45, 0);
  sphere.castShadow = true;
  const land = new THREE.Mesh(
    new THREE.SphereGeometry(0.556, 24, 18, 0.3, 1.4, 0.6, 1.0),
    material(C.globeLand),
  );
  land.position.copy(sphere.position);
  const land2 = new THREE.Mesh(
    new THREE.SphereGeometry(0.556, 24, 18, 2.6, 1.0, 1.2, 0.9),
    material(C.globeLand),
  );
  land2.position.copy(sphere.position);
  // The ball turns while someone searches the web (isoEffects).
  const ball = new THREE.Group();
  ball.position.copy(sphere.position);
  for (const part of [sphere, land, land2]) part.position.set(0, 0, 0);
  ball.add(sphere, land, land2);
  ball.userData.globeSpin = true;
  return group(
    cylinder(0.36, 0.4, 0.06, C.shelfWood, 0, 0, 0),
    cylinder(0.05, 0.05, 0.9, C.shelfWood, 0, 0.06, 0),
    ball,
  );
}

function workDesk(): THREE.Group {
  return group(
    box(2.2, 0.06, 0.9, C.desk, 0, 0.72, 0),
    box(0.06, 0.72, 0.8, C.deskLeg, -1.0, 0, 0),
    box(0.06, 0.72, 0.8, C.deskLeg, 1.0, 0, 0),
    box(0.62, 0.42, 0.04, "#2a303a", -0.45, 0.95, -0.2),
    box(0.62, 0.42, 0.04, "#2a303a", 0.45, 0.95, -0.2),
    box(0.06, 0.2, 0.04, "#2a303a", -0.45, 0.78, -0.2),
    box(0.06, 0.2, 0.04, "#2a303a", 0.45, 0.78, -0.2),
  );
}

function cafeTable(): THREE.Group {
  return group(
    box(1.15, 0.06, 1.15, C.cafeTable, 0, 0.82, 0),
    box(0.12, 0.82, 0.12, "#2f343c", 0, 0, 0),
    box(0.6, 0.03, 0.6, "#2f343c", 0, 0, 0),
  );
}

function cafeChair(): THREE.Group {
  return group(
    box(0.6, 0.08, 0.6, C.cafeChair, 0, 0.6, 0),
    box(0.6, 0.85, 0.08, C.cafeChair, 0, 0.68, -0.26),
    box(0.05, 0.6, 0.05, "#4a4f58", -0.24, 0, -0.24),
    box(0.05, 0.6, 0.05, "#4a4f58", 0.24, 0, -0.24),
    box(0.05, 0.6, 0.05, "#4a4f58", -0.24, 0, 0.24),
    box(0.05, 0.6, 0.05, "#4a4f58", 0.24, 0, 0.24),
  );
}

function receptionDesk(): THREE.Group {
  const sign = textTexture("Agent Office", { color: "#ffffff", weight: 700 });
  const signHeight = 0.32;
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(signHeight * sign.aspect, signHeight),
    new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true }),
  );
  signMesh.position.set(-1.2, 0.48, 0.62);
  return group(
    box(6.6, 0.95, 1.2, C.receptionFront, 0, 0, 0),
    box(6.8, 0.06, 1.4, C.receptionTop, 0, 0.95, 0),
    signMesh,
    box(0.86, 0.56, 0.05, C.imacFrame, -0.4, 1.2, -0.3),
    box(0.78, 0.46, 0.01, C.imacScreen, -0.4, 1.25, -0.33, {
      emissive: C.imacScreenDark,
    }),
    box(0.06, 0.2, 0.05, C.imacFrame, -0.4, 1.0, -0.3),
    box(0.6, 0.4, 0.05, "#2a303a", 1.2, 1.01, -0.3),
  );
}

/**
 * Leaves fanning out from ``y``, ``tilt`` radians off vertical: thin cones
 * for a palm, or broad rounded blades for a bush.
 */
function addLeaves(
  g: THREE.Group,
  seed: number,
  options: {
    count: number;
    y: number;
    length: number;
    width: number;
    tilt: number;
    broad?: boolean;
  },
): void {
  const random = seeded(seed + 3);
  const { count, y, length, width, tilt, broad = false } = options;
  for (let i = 0; i < count; i++) {
    const leaf = new THREE.Mesh(
      broad
        ? new THREE.SphereGeometry(1, 10, 8)
        : new THREE.ConeGeometry(width, length, 4),
      material(i % 2 === 0 ? C.leafA : C.leafB),
    );
    if (broad) leaf.scale.set(width, length / 2, width * 0.45);
    const angle = (i / count) * Math.PI * 2 + random() * 0.5;
    const lean = tilt + (random() - 0.5) * 0.35;
    // Lean the leaf outwards and push it out so its base stays at the stem.
    const reach = Math.sin(lean) * (length / 2);
    leaf.position.set(
      Math.cos(angle) * reach,
      y + Math.cos(lean) * (length / 2),
      Math.sin(angle) * reach,
    );
    leaf.rotation.set(Math.sin(angle) * lean, 0, -Math.cos(angle) * lean);
    leaf.castShadow = true;
    g.add(leaf);
  }
}

/** A tall palm in a pot: a bare stem with a crown of spiky leaves. */
function plant(seed: number): THREE.Group {
  const g = group(
    cylinder(0.3, 0.24, 0.42, C.pot, 0, 0, 0, 18),
    cylinder(0.05, 0.06, 1.6, C.stem, 0, 0.4, 0, 8),
  );
  addLeaves(g, seed, {
    count: 11,
    y: 1.9,
    length: 1.4,
    width: 0.09,
    tilt: 1.0,
  });
  addLeaves(g, seed + 11, {
    count: 6,
    y: 1.9,
    length: 1.2,
    width: 0.08,
    tilt: 0.4,
  });
  return g;
}

/** A low leafy plant in a pot. */
function bush(seed: number): THREE.Group {
  const g = group(cylinder(0.34, 0.28, 0.4, C.pot, 0, 0, 0, 18));
  addLeaves(g, seed, {
    count: 10,
    y: 0.38,
    length: 1.2,
    width: 0.24,
    tilt: 1.1,
    broad: true,
  });
  addLeaves(g, seed + 5, {
    count: 6,
    y: 0.38,
    length: 1.0,
    width: 0.22,
    tilt: 0.55,
    broad: true,
  });
  return g;
}

function elevator(): THREE.Group {
  const floorSign = textTexture("▲", { color: "#3fb950", weight: 800 });
  const indicator = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2 * floorSign.aspect, 0.2),
    new THREE.MeshBasicMaterial({ map: floorSign.texture, transparent: true }),
  );
  indicator.position.set(0, 2.95, 0.16);
  // The panel and its arrow light up as someone steps out (isoEffects).
  indicator.userData.elevatorArrow = true;
  const lamp = box(0.7, 0.26, 0.04, "#20252e", 0, 2.82, 0.12);
  lamp.userData.elevatorLamp = true;
  // Doors slide apart over the dark cab (isoEffects); people walking into
  // the cab pass behind it and are gone.
  const doors = [-1, 1].map((side) => {
    const door = box(1.12, 2.55, 0.06, C.elevatorDoor, 0.58 * side, 0, 0.12);
    door.userData.elevatorDoor = side;
    return door;
  });
  return group(
    box(2.7, 2.75, 0.2, C.elevatorFrame, 0, 0, 0),
    box(2.24, 2.55, 0.01, C.elevatorCab, 0, 0, 0.105, { shadow: false }),
    ...doors,
    lamp,
    indicator,
  );
}

function clock(): THREE.Group {
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.05, 28),
    material(C.clockFace),
  );
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 2.4, 0.05);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.06, 8, 28),
    material(C.clockRim),
  );
  rim.position.set(0, 2.4, 0.07);
  const hour = box(0.05, 0.28, 0.02, C.clockRim, 0, 2.4, 0.09);
  const minute = box(0.04, 0.4, 0.02, C.clockRim, 0, 2.4, 0.09);
  minute.rotation.z = -2.1;
  minute.position.set(0.17, 2.48, 0.09);
  return group(face, rim, hour, minute);
}

/** A two-pane window with a strip of city skyline at the bottom. */
function windowPane(): THREE.Group {
  const width = 3.4;
  const g = group(
    box(width, 1.6, 0.04, C.window, 0, 1.0, 0.13, { opacity: 0.85 }),
    box(width + 0.1, 0.08, 0.08, C.glassFrame, 0, 0.94, 0.13),
    box(width + 0.1, 0.08, 0.08, C.glassFrame, 0, 2.6, 0.13),
    box(0.08, 1.66, 0.08, C.glassFrame, -width / 2, 0.94, 0.13),
    box(0.08, 1.66, 0.08, C.glassFrame, width / 2, 0.94, 0.13),
    box(0.08, 1.66, 0.08, C.glassFrame, 0, 0.94, 0.13),
  );
  const skyline = [0.5, 0.8, 0.35, 0.65, 0.45, 0.9, 0.3, 0.6, 0.75, 0.4, 0.55];
  skyline.forEach((h, i) => {
    g.add(box(0.26, h, 0.02, C.skyline, -1.5 + i * 0.3, 1.0, 0.16));
  });
  return g;
}

/** Build one piece of furniture; ``seed`` varies books, LEDs and leaves. */
export function buildFurniture(kind: FurnitureKind, seed = 0): THREE.Group {
  switch (kind) {
    case "bookshelf":
      return bookshelf(seed);
    case "roundTable":
      return roundTable();
    case "chair":
      return woodenChair();
    case "officeChair":
      return officeChair();
    case "longDesk":
      return longDesk();
    case "imac":
      return imac();
    case "meetingTable":
      return meetingTable();
    case "meetingChair":
      return meetingChair();
    case "whiteboard":
      return whiteboard();
    case "sofa":
      return sofa();
    case "armchair":
      return armchair();
    case "coffeeTable":
      return coffeeTable();
    case "sideTable":
      return sideTable();
    case "tvStand":
      return tvStand();
    case "picture":
      return picture();
    case "locker":
      return locker();
    case "serverRack":
      return serverRack(seed);
    case "kiosk":
      return kiosk();
    case "globe":
      return globe();
    case "workDesk":
      return workDesk();
    case "cafeTable":
      return cafeTable();
    case "cafeChair":
      return cafeChair();
    case "receptionDesk":
      return receptionDesk();
    case "plant":
      return plant(seed);
    case "bush":
      return bush(seed);
    case "elevator":
      return elevator();
    case "clock":
      return clock();
    case "window":
      return windowPane();
  }
}
