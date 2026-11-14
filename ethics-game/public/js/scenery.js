// 여러 장면이 함께 쓰는 배경 조립 도구
import { T, engine } from './engine.js';

// 육각 타일로 만든 섬. rings=1이면 7칸, 2이면 19칸.
export function hexIsland(rings = 1, scale = 2, tile = 'hex_grass') {
  const g = new T.Group();
  const w = 2 * scale, h = 1.732 * scale;
  for (let q = -rings; q <= rings; q++) {
    for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
      const t = engine.prop(tile, scale);
      t.position.set(w * (q + r / 2), 0, h * r);
      t.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.material = tileMat(o.material); } });
      g.add(t);
    }
  }
  return g;
}

// 떠다니는 구름. update(dt)로 천천히 흐른다.
export function makeClouds(scene, n, { x = 60, yMin = 14, yMax = 30, zMin = -120, zMax = 10, scale = [3, 7] } = {}) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const c = engine.prop(Math.random() < 0.5 ? 'cloud_big' : 'cloud_small', scale[0] + Math.random() * (scale[1] - scale[0]));
    c.position.set((Math.random() * 2 - 1) * x, yMin + Math.random() * (yMax - yMin), zMin + Math.random() * (zMax - zMin));
    c.rotation.y = Math.random() * Math.PI;
    c.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = cloudMat(o.material); } });
    c.userData.v = 0.3 + Math.random() * 0.6;
    scene.add(c);
    list.push(c);
  }
  return {
    list,
    update(dt) {
      for (const c of list) { c.position.x += c.userData.v * dt; if (c.position.x > x) c.position.x = -x; }
    },
  };
}

// 물건을 놓는 짧은 표현
export function place(parent, name, scale, x, y, z, ry = 0) {
  const o = engine.prop(name, scale);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  parent.add(o);
  return o;
}

// 구름은 음영 없이 밝게
let _cloud = null;
function cloudMat(src) {
  if (!_cloud) { _cloud = src.clone(); _cloud.emissive = new T.Color(0xffffff); _cloud.emissiveIntensity = 0.22; _cloud.fog = false; }
  return _cloud;
}

// 바닥 타일은 조명 색과 상관없이 풀색이 살도록 초록빛을 더한다
let _tile = null;
function tileMat(src) {
  if (!_tile) { _tile = src.clone(); _tile.color = new T.Color(0x9dff8a); }
  return _tile;
}
