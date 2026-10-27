/**
 * Canvas textures for the isometric office: floor tiles, wood planks,
 * checker tiles and painted text.
 */

import * as THREE from "three";

const TEXTURE_SIZE = 256;

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = TEXTURE_SIZE,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Square tiles, two shades alternating, with grout lines. One texture repeat
 * covers ``tilesPerSide`` tiles per side.
 */
export function tileTexture(
  colorA: string,
  colorB: string,
  grout: string,
  tilesPerSide = 2,
): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    const tile = size / tilesPerSide;
    for (let i = 0; i < tilesPerSide; i++) {
      for (let j = 0; j < tilesPerSide; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? colorA : colorB;
        ctx.fillRect(i * tile, j * tile, tile, tile);
      }
    }
    ctx.strokeStyle = grout;
    ctx.lineWidth = 2;
    for (let k = 0; k <= tilesPerSide; k++) {
      ctx.beginPath();
      ctx.moveTo(k * tile, 0);
      ctx.lineTo(k * tile, size);
      ctx.moveTo(0, k * tile);
      ctx.lineTo(size, k * tile);
      ctx.stroke();
    }
  });
}

/** Wood planks running along the texture's x axis. */
export function plankTexture(light: string, dark: string): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    const planks = 8;
    const h = size / planks;
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = i % 2 === 0 ? light : dark;
      ctx.fillRect(0, i * h, size, h);
      // Stagger the plank ends so the floor does not read as a grid.
      const end = ((i * 97) % 5) * (size / 5);
      ctx.fillStyle = "rgba(120, 80, 40, 0.18)";
      ctx.fillRect(end, i * h, 2, h);
    }
    ctx.fillStyle = "rgba(120, 80, 40, 0.15)";
    for (let i = 1; i < planks; i++) ctx.fillRect(0, i * h - 1, size, 2);
  });
}

/** A blurred dark rectangle on a transparent canvas, for the plate's shadow. */
export function softShadowTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Draw the rectangle off the canvas so only its blurred shadow lands on it.
    const inset = size * 0.13;
    ctx.shadowColor = "rgba(48, 60, 84, 0.32)";
    ctx.shadowBlur = size * 0.07;
    ctx.shadowOffsetX = size;
    ctx.fillRect(inset - size, inset, size - inset * 2, size - inset * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface TextTexture {
  texture: THREE.CanvasTexture;
  /** Width / height of the painted text block. */
  aspect: number;
}

/** Text painted on a transparent canvas, for floor and wall signs. */
export function textTexture(
  text: string,
  options: { color: string; weight?: number; background?: string } = {
    color: "#5b6575",
  },
): TextTexture {
  const fontSize = 64;
  const font = `${options.weight ?? 600} ${fontSize}px "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  if (measure) measure.font = font;
  const textWidth = Math.ceil(
    measure?.measureText(text).width ?? text.length * fontSize * 0.6,
  );
  const pad = options.background ? 28 : 8;
  const canvas = document.createElement("canvas");
  canvas.width = textWidth + pad * 2;
  canvas.height = fontSize + pad * 2;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (options.background) {
      ctx.fillStyle = options.background;
      const r = canvas.height / 2;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, r);
      ctx.fill();
    }
    ctx.font = font;
    ctx.fillStyle = options.color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, canvas.height / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: canvas.width / canvas.height };
}
