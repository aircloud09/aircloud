/**
 * Two-head-tall people of the isometric office (docs/plan/spec.md 「캐릭터」):
 * a big round head with hair and rosy cheeks on a small body, with arms and
 * legs that swing while walking. Built from simple solids like the furniture;
 * a person faces +z at rotation 0.
 */

import * as THREE from "three";
import type { IsoPose, IsoRoomId } from "@/systems/isoErrands";
import type { LoungeAct } from "@/systems/loungeActs";
import { MAX_PILE } from "@/systems/roomGimmicks";

/**
 * Something a person is up to besides its pose: a lounge pastime, waiting
 * on a command, scratching its head while typing, or cheering passed tests.
 */
export type PoseAct = LoungeAct | "watch" | "scratch" | "cheer";

const isPastime = (act: PoseAct): act is LoungeAct =>
  act !== "watch" && act !== "scratch" && act !== "cheer";
import type { Outfit, PersonKind } from "@/systems/officePeople";
import { ISO_COLORS as C } from "./isoPalette";
import { box, cylinder, material } from "./isoFurniture";

interface Look {
  shirt: string;
  hair: string;
  pants: string;
  cap?: boolean;
  glasses?: boolean;
}

/** Claude in coral, me in navy, subagents in blue, as in the video. */
const LOOKS: Record<PersonKind, Look> = {
  claude: { shirt: C.claudeShirt, hair: C.claudeHair, pants: C.pants },
  me: { shirt: C.myShirt, hair: C.darkHair, pants: C.myPants },
  subagent: { shirt: C.subagentShirt, hair: C.darkHair, pants: C.pants },
  // Another session's lead agent is a Claude too; its chip tells them apart.
  colleague: { shirt: C.claudeShirt, hair: C.claudeHair, pants: C.pants },
};

/** Explore comes in green with a cap, Plan in purple with glasses (작성자 댓글). */
const OUTFIT_LOOKS: Record<Exclude<Outfit, "general">, Look> = {
  explore: {
    shirt: C.exploreShirt,
    hair: C.darkHair,
    pants: C.pants,
    cap: true,
  },
  plan: { shirt: C.planShirt, hair: C.darkHair, pants: C.pants, glasses: true },
};

/** Whole figure scale; about 3.1m tall standing, a little under the walls. */
const SCALE = 1.1;
const HIP_HEIGHT = 0.75;
const SEATED_HIP_HEIGHT = 0.52;
const STRIDE_RATE = 9;

export interface CharacterRig {
  root: THREE.Group;
  /** Hips and everything above them; lowered to sit. */
  hips: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  book: THREE.Object3D;
  /** A mug in the right hand while having a coffee (cafe, lounge). */
  cup: THREE.Object3D;
  /** A phone held in both hands, looked at on the lounge sofa. */
  handset: THREE.Object3D;
  /** A wristwatch on the left wrist, checked while waiting on a command. */
  watch: THREE.Object3D;
  /** Books piled on the floor beside it in the library, shown up to how many it read. */
  pile: THREE.Group;
  /** A handset at the ear while Claude calls a subagent in. */
  phone: THREE.Object3D;
  /** Cold sweat beside the head while a failed tool keeps it stuck. */
  sweat: THREE.Group;
  /** Where the name chip hangs, just above the hair. */
  chipAnchor: THREE.Object3D;
}

function sphere(
  radius: number,
  color: string,
  x: number,
  y: number,
  z: number,
  segments: [number, number] = [20, 14],
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments[0], segments[1]),
    material(color),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** A partial sphere: three.js measures phi around y from -x towards +z. */
function shell(
  radius: number,
  color: string,
  phi: [number, number],
  theta: [number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      radius,
      24,
      16,
      phi[0],
      phi[1],
      theta[0],
      theta[1],
    ),
    material(color),
  );
  mesh.castShadow = true;
  return mesh;
}

function leg(look: Look, side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0.17 * side, 0, 0);
  g.add(cylinder(0.12, 0.11, 0.62, look.pants, 0, -0.62, 0, 12));
  g.add(box(0.22, 0.13, 0.32, C.shoes, 0, -0.75, 0.05));
  return g;
}

function arm(look: Look, side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0.49 * side, 0.72, 0);
  g.add(cylinder(0.1, 0.09, 0.55, look.shirt, 0, -0.55, 0, 10));
  g.add(sphere(0.1, C.skin, 0, -0.62, 0, [12, 8]));
  return g;
}

function head(look: Look): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0, 1.42, 0);
  g.add(sphere(0.62, C.skin, 0, 0, 0, [28, 20]));
  // Hair: a cap over the top, and a longer piece down the back and sides.
  g.add(shell(0.66, look.hair, [0, Math.PI * 2], [0, Math.PI * 0.42]));
  g.add(
    shell(0.65, look.hair, [Math.PI * 0.95, Math.PI * 1.1], [0, Math.PI * 0.8]),
  );
  const eye = (x: number) => sphere(0.075, C.eyes, x, -0.08, 0.565, [10, 8]);
  g.add(eye(-0.22), eye(0.22));
  const cheek = (x: number) => {
    const c = sphere(0.075, C.cheeks, x, -0.22, 0.47, [10, 8]);
    c.scale.set(1, 0.6, 0.4);
    return c;
  };
  g.add(cheek(-0.36), cheek(0.36));
  if (look.cap) {
    g.add(shell(0.69, C.exploreCap, [0, Math.PI * 2], [0, Math.PI * 0.3]));
    const brim = box(0.78, 0.05, 0.42, C.exploreCap, 0, 0.38, 0.58);
    brim.rotation.x = 0.12;
    g.add(brim);
  }
  if (look.glasses) {
    for (const x of [-0.22, 0.22]) {
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.028, 8, 20),
        material(C.glasses),
      );
      rim.position.set(x, -0.08, 0.6);
      g.add(rim);
    }
    g.add(box(0.18, 0.035, 0.03, C.glasses, 0, -0.075, 0.62));
  }
  return g;
}

/** Build one person standing at the origin; subagents dress by ``outfit``. */
export function buildCharacter(
  kind: PersonKind,
  outfit: Outfit = "general",
): CharacterRig {
  const look =
    kind === "subagent" && outfit !== "general"
      ? OUTFIT_LOOKS[outfit]
      : LOOKS[kind];
  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  const hips = new THREE.Group();
  hips.position.y = HIP_HEIGHT;
  root.add(hips);

  const legs: [THREE.Group, THREE.Group] = [leg(look, -1), leg(look, 1)];
  const arms: [THREE.Group, THREE.Group] = [arm(look, -1), arm(look, 1)];
  hips.add(...legs, ...arms);
  hips.add(box(0.8, 0.82, 0.52, look.shirt, 0, 0, 0));
  hips.add(box(0.36, 0.06, 0.06, C.collar, 0, 0.78, 0.25));
  hips.add(head(look));

  const book = new THREE.Group();
  book.add(box(0.5, 0.36, 0.08, C.bookCover, 0, 0, 0));
  book.add(box(0.46, 0.32, 0.02, C.bookPages, 0, 0.02, 0.05));
  book.position.set(0, 0.42, 0.5);
  book.rotation.x = -0.5;
  book.visible = false;
  hips.add(book);

  // In the right hand, upright while the arm holds it out in front.
  const cup = new THREE.Group();
  cup.add(cylinder(0.11, 0.09, 0.24, C.cup, 0, -0.12, 0, 14));
  cup.add(cylinder(0.095, 0.095, 0.02, C.coffee, 0, 0.11, 0, 14));
  cup.position.set(0, -0.72, 0.14);
  cup.rotation.x = 0.9;
  cup.visible = false;
  arms[1].add(cup);

  // On the floor a step behind it, to its left: facing a shelf, that is
  // toward the camera and clear of its legs and the walls. Each book a bit
  // askew.
  const pile = new THREE.Group();
  pile.position.set(0.85, 0, -0.5);
  for (let i = 0; i < MAX_PILE; i++) {
    const book = box(
      0.5,
      0.12,
      0.36,
      C.books[(i * 3 + 1) % C.books.length],
      0,
      i * 0.12,
      0,
    );
    book.rotation.y = ((i * 37) % 9) * 0.06 - 0.24;
    book.visible = false;
    pile.add(book);
  }
  root.add(pile);

  // On the left wrist, the face turned out.
  const watch = new THREE.Group();
  watch.add(box(0.2, 0.06, 0.2, C.watchBand, 0, -0.5, 0));
  watch.add(box(0.12, 0.02, 0.12, C.watchFace, 0, -0.5, 0.1));
  watch.visible = false;
  arms[0].add(watch);

  // Held low in both hands in front, screen up.
  const handset = box(0.22, 0.04, 0.36, C.phone, 0, 0.3, 0.62);
  handset.rotation.x = 0.5;
  handset.visible = false;
  hips.add(handset);

  // Held at the left ear, where the raised left hand meets it: seated at
  // its desk, Claude shows its left side to the camera.
  const phone = box(0.22, 0.56, 0.16, C.phone, -0.84, 1, 0.25);
  phone.rotation.z = -0.45;
  phone.visible = false;
  hips.add(phone);

  const sweat = new THREE.Group();
  // On both sides of the head, so one shows whichever way it faces.
  for (const [x, y, z] of SWEAT_DROPS) {
    const drop = new THREE.Group();
    drop.add(sphere(0.12, C.sweat, 0, 0, 0, [12, 10]));
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.105, 0.18, 10),
      material(C.sweat),
    );
    tip.position.y = 0.13;
    drop.add(tip);
    drop.position.set(x, y, z);
    sweat.add(drop);
  }
  sweat.visible = false;
  hips.add(sweat);

  const chipAnchor = new THREE.Object3D();
  chipAnchor.position.set(0, 2.2, 0);
  hips.add(chipAnchor);

  return {
    root,
    hips,
    legs,
    arms,
    book,
    cup,
    handset,
    watch,
    pile,
    phone,
    sweat,
    chipAnchor,
  };
}

/** Where the sweat drops start, beside the head (x, y, z in the hips' frame). */
const SWEAT_DROPS: [number, number, number][] = [
  [0.66, 1.78, 0.28],
  [-0.66, 1.72, 0.28],
  [0.72, 1.5, 0.12],
];

/** Chin on the right hand, the left arm folded under it. */
const PONDER_ARMS: [number, number] = [-1.2, -2.1];
/** The left hand up at the ear, holding the phone (about x, then out about z). */
const PHONE_ARM: [number, number] = [-2.5, -0.6];
/** How often a waiting person glances at its watch (s). */
const WATCH_CHECK_SECONDS = 4;

/** Arm angles (about x, forward is negative) while working in each room. */
function workArms(room: IsoRoomId | null, seconds: number): [number, number] {
  switch (room) {
    case "library":
      return [-1.0, -1.0]; // holding a book
    case "server":
      return [-0.6, -0.6]; // hands at the rack
    case "search":
      return [-0.9, -0.9]; // touching the kiosk
    case "meeting":
      return [0, -2.3 + 0.15 * Math.sin(seconds * 6)]; // writing on the board
    case "mydesk":
      return [0, -0.3 + 0.2 * Math.sin(seconds * 3)]; // talking to me
    case "cafe":
      // the mug held out, raised to the mouth now and then
      return [0, -0.9 - 1.1 * Math.max(0, Math.sin(seconds * 1.6)) ** 4];
    default:
      return [-0.6, -0.6];
  }
}

/** Arm angles (about x) for each lounge pastime, seated on the sofa. */
function loungeArms(act: LoungeAct, seconds: number): [number, number] {
  switch (act) {
    case "coffee":
      // the mug in the right hand, raised to the mouth now and then
      return [-0.35, -0.9 - 1.1 * Math.max(0, Math.sin(seconds * 1.6)) ** 4];
    case "phone": {
      const thumb = 0.04 * Math.sin(seconds * 7);
      return [-1.05 + thumb, -1.05 - thumb];
    }
    case "book":
      return [-1.0, -1.0];
    case "tv":
      return [-0.35, -0.35];
    case "doze":
      return [-0.25, -0.25];
  }
}

/**
 * Arms crossed while waiting on a long command, the left wrist raised to
 * the eyes every few seconds to check the watch: [x, z] per arm.
 */
function watchArms(seconds: number): [[number, number], [number, number]] {
  const checking = seconds % WATCH_CHECK_SECONDS < 1.2;
  return checking
    ? [
        [-1.75, 0.35],
        [-1.2, -0.75],
      ]
    : [
        [-1.35, 0.75],
        [-1.2, -0.75],
      ];
}

/** Leaning back to watch TV, slumped and nodding while dozing (about x). */
function loungeLean(act: LoungeAct, seconds: number): number {
  if (act === "tv") return -0.12;
  if (act === "doze") return 0.2 + 0.07 * Math.sin(seconds * 1.3);
  return 0;
}

/** Sweat drops slide down and start again, each on its own beat. */
function drip(sweat: THREE.Group, seconds: number): void {
  sweat.children.forEach((drop, i) => {
    const t = (seconds * 0.9 + i * 0.37) % 1;
    drop.position.y = SWEAT_DROPS[i][1] - 0.25 * t;
  });
}

/**
 * Pose a person for this frame: swinging limbs while walking, legs forward
 * on a chair (hands moving on the keyboard while typing), and in a room a
 * book in hand, hands at the rack or kiosk, writing on the whiteboard, or
 * talking at my desk. A stuck person (a failed tool) props its chin on a
 * hand and sweats (spec R3). Standing to report it talks with a hand, waving
 * it raises its left arm, and on the phone (seated) it holds a handset to
 * its ear. Seated in the lounge it keeps busy with ``act`` (a coffee, its
 * phone, a book, the TV, a doze); at the rack, waiting on a long command, it
 * crosses its arms and checks its watch; typing it scratches its head now
 * and then; and when its tests pass it throws its arms up. ``seconds``
 * drives the motion.
 */
export function poseCharacter(
  rig: CharacterRig,
  pose: IsoPose | "phone",
  room: IsoRoomId | null,
  seconds: number,
  stuck = false,
  act: PoseAct | null = null,
): void {
  const [legL, legR] = rig.legs;
  const [armL, armR] = rig.arms;
  const pastime =
    pose === "sit" && !stuck && act !== null && isPastime(act) ? act : null;
  const waiting = pose === "work" && !stuck && act === "watch";
  rig.watch.visible = waiting;
  rig.book.visible =
    (pose === "work" && room === "library" && !stuck) || pastime === "book";
  rig.cup.visible =
    (pose === "work" && room === "cafe" && !stuck) || pastime === "coffee";
  rig.handset.visible = pastime === "phone";
  rig.phone.visible = pose === "phone";
  rig.hips.rotation.x = pastime ? loungeLean(pastime, seconds) : 0;
  rig.sweat.visible = stuck;
  if (stuck) drip(rig.sweat, seconds);
  // Only waving and the phone swing an arm out sideways.
  armL.rotation.z = 0;
  armR.rotation.z = 0;
  if (pose === "walk") {
    const swing = Math.sin(seconds * STRIDE_RATE);
    legL.rotation.x = 0.55 * swing;
    legR.rotation.x = -0.55 * swing;
    armL.rotation.x = -0.45 * swing;
    armR.rotation.x = 0.45 * swing;
    rig.hips.position.y =
      HIP_HEIGHT + 0.05 * Math.abs(Math.cos(seconds * STRIDE_RATE));
    return;
  }
  const seated = pose === "sit" || pose === "type" || pose === "phone";
  if (act === "cheer" && !stuck) {
    // Both arms up and out, swinging, with a hop when on its feet.
    const swing = 0.25 * Math.sin(seconds * 9);
    armL.rotation.set(0, 0, -2.6 + swing);
    armR.rotation.set(0, 0, 2.6 - swing);
    legL.rotation.x = seated ? -Math.PI / 2 : 0;
    legR.rotation.x = seated ? -Math.PI / 2 : 0;
    rig.hips.position.y = seated
      ? SEATED_HIP_HEIGHT
      : HIP_HEIGHT + 0.08 * Math.abs(Math.sin(seconds * 9));
    return;
  }
  if (seated) {
    const tap = pose === "type" ? 0.12 * Math.sin(seconds * 14) : 0;
    const rest = pose === "type" ? -1.1 : -0.35;
    legL.rotation.x = -Math.PI / 2;
    legR.rotation.x = -Math.PI / 2;
    armL.rotation.x = stuck ? PONDER_ARMS[0] : rest + tap;
    armR.rotation.x = stuck ? PONDER_ARMS[1] : rest - tap;
    if (pose === "phone") {
      armL.rotation.x = PHONE_ARM[0];
      armL.rotation.z = PHONE_ARM[1];
    }
    if (pastime) {
      [armL.rotation.x, armR.rotation.x] = loungeArms(pastime, seconds);
    }
    if (pose === "type" && act === "scratch" && !stuck) {
      // The right arm up beside the head, the hand scratching its side;
      // raised out to the side it shows from behind as well as in front.
      armR.rotation.x = -0.4;
      armR.rotation.z = 2.7 + 0.12 * Math.sin(seconds * 16);
    }
    rig.hips.position.y = SEATED_HIP_HEIGHT;
    return;
  }
  if (pose === "stand" || pose === "wave") {
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    armR.rotation.x = 0.03 * Math.sin(seconds * 2);
    armL.rotation.x =
      pose === "stand" ? -0.5 + 0.18 * Math.sin(seconds * 5) : 0;
    // Waving: the left arm up and out, swinging side to side. Facing
    // Claude's desk, a reporter shows its left side to the camera.
    if (pose === "wave") armL.rotation.z = -2.5 - 0.3 * Math.sin(seconds * 10);
    rig.hips.position.y = HIP_HEIGHT;
    return;
  }
  if (waiting) {
    const [[lx, lz], [rx, rz]] = watchArms(seconds);
    armL.rotation.set(lx, 0, lz);
    armR.rotation.set(rx, 0, rz);
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    rig.hips.position.y = HIP_HEIGHT;
    return;
  }
  const [left, right] = stuck ? PONDER_ARMS : workArms(room, seconds);
  const breath = 0.03 * Math.sin(seconds * 2);
  legL.rotation.x = 0;
  legR.rotation.x = 0;
  armL.rotation.x = left + breath;
  armR.rotation.x = right - breath;
  rig.hips.position.y = HIP_HEIGHT;
}
