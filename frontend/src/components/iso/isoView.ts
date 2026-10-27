/**
 * The three.js side of the isometric office: renderer, orthographic camera,
 * lights, pan/zoom controls and the render loop.
 */

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  FLOOR_CENTER,
  FLOOR_DEPTH,
  FLOOR_WIDTH,
  WALL_HEIGHT,
} from "@/constants/isoFloorPlan";
import type { IsoPerson } from "@/systems/officePeople";
import type { NoteStatus } from "@/systems/roomGimmicks";
import type { Theme } from "@/utils/theme";
import { buildIsoOffice, PLATE_THICKNESS } from "./buildIsoOffice";
import type { BubbleWords } from "./isoBubbles";
import { IsoEffects } from "./isoEffects";
import { setNightView } from "./isoFurniture";
import { IsoPeople } from "./isoPeople";

/** The reference video uses a 2:1 isometric view: floor edges climb 1 in 2. */
const CAMERA_AZIMUTH = THREE.MathUtils.degToRad(45);
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(30);
const CAMERA_DISTANCE = 120;
/** Space kept around the office at zoom 1, in CSS pixels; the top clears the header. */
const FIT_PADDING = { top: 72, right: 40, bottom: 44, left: 40 };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const RESET_MS = 350;
/** Longest frame step the walkers take, so a background tab does not teleport them. */
const MAX_STEP_SECONDS = 0.1;

export interface IsoView {
  setPeople(people: IsoPerson[]): void;
  setBubbleWords(words: BubbleWords): void;
  setTheme(theme: Theme): void;
  /** Take everyone off the floor, to place them afresh. */
  clearPeople(): void;
  /** Stick a whiteboard note per to-do (null: the board's plain notes). */
  setNotes(statuses: readonly NoteStatus[] | null): void;
  zoomBy(factor: number): void;
  resetView(): void;
  dispose(): void;
}

function cameraOffset(): THREE.Vector3 {
  const horizontal = CAMERA_DISTANCE * Math.cos(CAMERA_ELEVATION);
  return new THREE.Vector3(
    horizontal * Math.sin(CAMERA_AZIMUTH),
    CAMERA_DISTANCE * Math.sin(CAMERA_ELEVATION),
    horizontal * Math.cos(CAMERA_AZIMUTH),
  );
}

/** Points that must stay in view: the plate's bottom corners and the wall tops. */
function officeOutline(): THREE.Vector3[] {
  const corners: [number, number][] = [
    [0, 0],
    [FLOOR_WIDTH, 0],
    [0, FLOOR_DEPTH],
    [FLOOR_WIDTH, FLOOR_DEPTH],
  ];
  return [
    ...corners.map(([x, z]) => new THREE.Vector3(x, -PLATE_THICKNESS, z)),
    ...corners
      .slice(0, 3)
      .map(([x, z]) => new THREE.Vector3(x, WALL_HEIGHT, z)),
  ];
}

/**
 * Bring the camera frustum to the container so the whole office fits inside
 * the padding at zoom 1. The frustum is shifted rather than the camera, so
 * panning and the reset target stay on the floor centre.
 */
function fitFrustum(
  camera: THREE.OrthographicCamera,
  home: THREE.Vector3,
  width: number,
  height: number,
): void {
  const right = new THREE.Vector3(
    Math.cos(CAMERA_AZIMUTH),
    0,
    -Math.sin(CAMERA_AZIMUTH),
  );
  const up = new THREE.Vector3(
    -Math.sin(CAMERA_AZIMUTH) * Math.sin(CAMERA_ELEVATION),
    Math.cos(CAMERA_ELEVATION),
    -Math.cos(CAMERA_AZIMUTH) * Math.sin(CAMERA_ELEVATION),
  );
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of officeOutline()) {
    const offset = point.sub(home);
    const x = offset.dot(right);
    const y = offset.dot(up);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const { top, right: padRight, bottom, left } = FIT_PADDING;
  const usableWidth = Math.max(width - left - padRight, width / 2);
  const usableHeight = Math.max(height - top - bottom, height / 2);
  const pixelsPerUnit = Math.min(
    usableWidth / (maxX - minX),
    usableHeight / (maxY - minY),
  );
  const centerX = (minX + maxX) / 2 - (left - padRight) / (2 * pixelsPerUnit);
  const centerY = (minY + maxY) / 2 + (top - bottom) / (2 * pixelsPerUnit);
  camera.left = centerX - width / (2 * pixelsPerUnit);
  camera.right = centerX + width / (2 * pixelsPerUnit);
  camera.top = centerY + height / (2 * pixelsPerUnit);
  camera.bottom = centerY - height / (2 * pixelsPerUnit);
  camera.updateProjectionMatrix();
}

/**
 * Daylight as in the video, and the dark theme's office at night: the lights
 * are on, a little warmer, and only the view out of the windows turns dark
 * (docs/plan/spec.md 「어두운 테마」).
 */
const LIGHTING: Record<Theme, { color: string; ambient: number; sun: number }> =
  {
    light: { color: "#ffffff", ambient: 1.9, sun: 1.6 },
    dark: { color: "#fff7ee", ambient: 1.8, sun: 1.45 },
  };

/**
 * Mostly even light with the sun high over the front, a little to the left,
 * as in the video: faces towards the lower left are the brightest, faces
 * towards the lower right a step darker. Shadows are kept faint.
 */
function addLights(scene: THREE.Scene): {
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
} {
  const {
    color,
    ambient: ambientIntensity,
    sun: sunIntensity,
  } = LIGHTING.light;
  const ambient = new THREE.AmbientLight(color, ambientIntensity);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(color, sunIntensity);
  sun.position.set(FLOOR_CENTER.x + 4, 30, FLOOR_CENTER.z + 26);
  sun.target.position.set(FLOOR_CENTER.x, 0, FLOOR_CENTER.z);
  sun.castShadow = true;
  sun.shadow.intensity = 0.35;
  sun.shadow.mapSize.set(2048, 2048);
  const half = Math.max(FLOOR_WIDTH, FLOOR_DEPTH) * 0.8;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  return { ambient, sun };
}

/** ``onPersonLeft`` hears of each subagent that rode the elevator away. */
export function createIsoView(
  container: HTMLElement,
  onPersonLeft?: (id: string) => void,
): IsoView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  // Name chips and bubbles are HTML laid over the canvas, so text stays sharp.
  const labels = new CSS2DRenderer();
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const office = buildIsoOffice();
  scene.add(office);
  const lights = addLights(scene);
  const people = new IsoPeople(scene, onPersonLeft);
  const effects = new IsoEffects(office);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const home = new THREE.Vector3(FLOOR_CENTER.x, 0, FLOOR_CENTER.z);
  camera.position.copy(home).add(cameraOffset());
  camera.lookAt(home);

  const controls = new MapControls(camera, renderer.domElement);
  controls.target.copy(home);
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minZoom = MIN_ZOOM;
  controls.maxZoom = MAX_ZOOM;
  controls.zoomToCursor = true;
  controls.update();

  const resize = (): void => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    fitFrustum(camera, home, width, height);
    renderer.setSize(width, height);
    labels.setSize(width, height);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // Reset eases the camera back to where it started.
  let reset: { start: number; from: THREE.Vector3; fromZoom: number } | null =
    null;
  const resetView = (): void => {
    reset = {
      start: performance.now(),
      from: controls.target.clone(),
      fromZoom: camera.zoom,
    };
  };
  const stepReset = (now: number): void => {
    if (!reset) return;
    const t = Math.min(1, (now - reset.start) / RESET_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    controls.target.lerpVectors(reset.from, home, eased);
    camera.position.copy(controls.target).add(cameraOffset());
    camera.zoom = reset.fromZoom + (1 - reset.fromZoom) * eased;
    camera.updateProjectionMatrix();
    if (t >= 1) reset = null;
  };
  renderer.domElement.addEventListener("dblclick", resetView);

  let frame = 0;
  let lastFrame = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(MAX_STEP_SECONDS, Math.max(0, now - lastFrame) / 1000);
    lastFrame = now;
    stepReset(now);
    controls.update();
    effects.update(now / 1000, dt, people.update(now, dt));
    renderer.render(scene, camera);
    labels.render(scene, camera);
    const view = labels.getSize();
    people.liftCrowdedLabels(camera, view.width, view.height);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    setPeople(list: IsoPerson[]): void {
      people.sync(list);
    },
    setBubbleWords(words: BubbleWords): void {
      people.setWords(words);
    },
    clearPeople(): void {
      people.clear();
    },
    setNotes(statuses: readonly NoteStatus[] | null): void {
      effects.setNotes(statuses);
    },
    setTheme(theme: Theme): void {
      const { color, ambient, sun } = LIGHTING[theme];
      lights.ambient.color.set(color);
      lights.ambient.intensity = ambient;
      lights.sun.color.set(color);
      lights.sun.intensity = sun;
      setNightView(theme === "dark");
    },
    zoomBy(factor: number): void {
      camera.zoom = THREE.MathUtils.clamp(
        camera.zoom * factor,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      camera.updateProjectionMatrix();
    },
    resetView,
    dispose(): void {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", resetView);
      controls.dispose();
      people.dispose();
      effects.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const m of materials) {
            if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
