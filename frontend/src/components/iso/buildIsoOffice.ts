/**
 * Assemble the isometric office from the floor plan: the floor plate, room
 * floors, walls, room names and furniture.
 */

import * as THREE from "three";
import {
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  FURNITURE,
  GLASS_HEIGHT,
  LOW_WALL_HEIGHT,
  ROOMS,
  WALLS,
  WALL_HEIGHT,
  type FloorFinish,
  type Room,
  type Wall,
} from "@/constants/isoFloorPlan";
import { ISO_COLORS as C } from "./isoPalette";
import { box, buildFurniture, material } from "./isoFurniture";
import {
  plankTexture,
  softShadowTexture,
  textTexture,
  tileTexture,
} from "./isoTextures";

export const PLATE_THICKNESS = 0.5;
const WALL_THICKNESS = 0.25;
/** Room floors sit just above the plate so they never flicker against it. */
const FINISH_Y = 0.012;

function finishTexture(finish: FloorFinish): THREE.Texture | null {
  switch (finish) {
    case "wood":
      return plankTexture(C.woodLight, C.woodDark);
    case "beige":
      return tileTexture(C.beigeA, C.beigeB, "#e2d0b4");
    case "meeting":
      return tileTexture(C.meetingA, C.meetingB, C.floorGrout);
    case "server":
      return tileTexture(C.serverA, C.serverB, "#cfd6df");
    case "mint":
      return tileTexture(C.mintA, C.mintB, "#bfe0d6");
    case "checker":
      return tileTexture(C.checkerA, C.checkerB, "#dcbf96");
    case "rug":
    case "plain":
      return null;
  }
}

/** World units one texture repeat covers, per finish. */
const FINISH_REPEAT: Record<FloorFinish, number> = {
  wood: 4,
  beige: 4,
  meeting: 4,
  server: 4,
  mint: 4,
  checker: 3,
  rug: 1,
  plain: 1,
};

function floorPlate(): THREE.Mesh {
  const top = tileTexture(C.floorTileA, C.floorTileB, C.floorGrout);
  top.repeat.set(FLOOR_WIDTH / 4, FLOOR_DEPTH / 4);
  const side = material(C.plateSide, { emissive: C.plateGlow });
  const topMaterial = new THREE.MeshLambertMaterial({ map: top });
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR_WIDTH, PLATE_THICKNESS, FLOOR_DEPTH),
    [side, side, topMaterial, side, side, side],
  );
  plate.position.set(FLOOR_WIDTH / 2, -PLATE_THICKNESS / 2, FLOOR_DEPTH / 2);
  plate.receiveShadow = true;
  return plate;
}

/** A soft shadow under the plate, so the floor looks like it floats. */
function plateShadow(): THREE.Mesh {
  const margin = 8;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_WIDTH + margin, FLOOR_DEPTH + margin),
    new THREE.MeshBasicMaterial({
      map: softShadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(FLOOR_WIDTH / 2 + 0.6, -2.2, FLOOR_DEPTH / 2 + 0.6);
  return shadow;
}

function roomFloor(room: Room): THREE.Object3D {
  const { x, z, w, d } = room.rect;
  const plane = (
    width: number,
    depth: number,
    mat: THREE.Material,
    y: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + w / 2, y, z + d / 2);
    mesh.receiveShadow = true;
    return mesh;
  };
  if (room.finish === "plain") return new THREE.Group();
  if (room.finish === "rug") {
    const g = new THREE.Group();
    g.add(plane(w, d, material(C.rugBorder), FINISH_Y));
    g.add(plane(w - 0.3, d - 0.3, material(C.rug), FINISH_Y + 0.004));
    return g;
  }
  const texture = finishTexture(room.finish);
  if (texture)
    texture.repeat.set(
      w / FINISH_REPEAT[room.finish],
      d / FINISH_REPEAT[room.finish],
    );
  return plane(w, d, new THREE.MeshLambertMaterial({ map: texture }), FINISH_Y);
}

/** Whether a wall end touches no other wall, so its cut face shows. */
function isFreeEnd([px, pz]: [number, number], self: Wall): boolean {
  const eps = 0.01;
  return !WALLS.some((other) => {
    if (other === self) return false;
    const [x1, z1] = other.from;
    const [x2, z2] = other.to;
    return (
      px >= Math.min(x1, x2) - eps &&
      px <= Math.max(x1, x2) + eps &&
      pz >= Math.min(z1, z2) - eps &&
      pz <= Math.max(z1, z2) + eps
    );
  });
}

function wall(segment: Wall): THREE.Object3D {
  const [x1, z1] = segment.from;
  const [x2, z2] = segment.to;
  const alongX = z1 === z2;
  const length = alongX ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const w = alongX ? length : WALL_THICKNESS;
  const d = alongX ? WALL_THICKNESS : length;
  if (segment.kind === "glass") {
    const g = new THREE.Group();
    g.add(box(w, GLASS_HEIGHT, d, C.glass, cx, 0, cz, { opacity: 0.32 }));
    g.add(box(w, 0.08, d, C.glassFrame, cx, GLASS_HEIGHT, cz));
    g.add(box(w, 0.12, d, C.glassFrame, cx, 0, cz));
    const posts = Math.max(1, Math.round(length / 2));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const px = alongX ? Math.min(x1, x2) + t * length : cx;
      const pz = alongX ? cz : Math.min(z1, z2) + t * length;
      g.add(box(0.08, GLASS_HEIGHT, 0.08, C.glassFrame, px, 0, pz));
    }
    return g;
  }
  const height = segment.kind === "low" ? LOW_WALL_HEIGHT : WALL_HEIGHT;
  const g = new THREE.Group();
  // Walls glow a little so the faces turned away from the sun stay light,
  // as in the video.
  g.add(box(w, height, d, C.wall, cx, 0, cz, { emissive: C.wallGlow }));
  // Free ends show the cut of the wall as a warm stripe.
  for (const end of [segment.from, segment.to]) {
    if (!isFreeEnd(end, segment)) continue;
    const [ex, ez] = end;
    const out = alongX ? Math.sign(ex - cx) : Math.sign(ez - cz);
    g.add(
      alongX
        ? box(0.06, height, d + 0.02, "#000000", ex + out * 0.02, 0, cz, {
            emissive: C.wallCap,
          })
        : box(w + 0.02, height, 0.06, "#000000", cx, 0, ez + out * 0.02, {
            emissive: C.wallCap,
          }),
    );
  }
  g.add(
    box(w + 0.02, 0.05, d + 0.02, C.wallTop, cx, height, cz, { shadow: false }),
  );
  return g;
}

/** The room's name, painted on the floor or hung near the top of a back wall. */
function roomLabel(room: Room): THREE.Mesh {
  const { ko, en, x, z, along, on } = room.label;
  const text = en ? `${ko} · ${en}` : ko;
  const label = textTexture(text, {
    color: on === "wall" ? C.wallLabelText : C.labelText,
    weight: 700,
  });
  const height = on === "wall" ? 0.56 : 0.72;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * label.aspect, height),
    new THREE.MeshBasicMaterial({
      map: label.texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  if (on === "wall") {
    // Facing out of the wall; text reads along +x on the right wall and
    // along -z on the left wall, which is left to right for the viewer.
    const y = WALL_HEIGHT - 0.44;
    if (along === "x") {
      mesh.position.set(x, y, z + WALL_THICKNESS / 2 + 0.02);
    } else {
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(x + WALL_THICKNESS / 2 + 0.02, y, z);
    }
  } else {
    mesh.rotation.x = -Math.PI / 2;
    if (along === "z") mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, FINISH_Y + 0.01, z);
  }
  return mesh;
}

/** Build the whole static office. */
export function buildIsoOffice(): THREE.Group {
  const office = new THREE.Group();
  office.add(plateShadow(), floorPlate());
  for (const room of ROOMS) office.add(roomFloor(room), roomLabel(room));
  for (const segment of WALLS) office.add(wall(segment));
  FURNITURE.forEach((item, index) => {
    const piece = buildFurniture(item.kind, index);
    piece.position.set(item.x, item.y ?? 0, item.z);
    piece.rotation.y = ((item.rot ?? 0) * Math.PI) / 2;
    piece.userData.furniture = item;
    office.add(piece);
  });
  return office;
}
