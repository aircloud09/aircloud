// 게임 A: 지식 러너
import { T, engine, Actor, makeSky, addLights, toonMat, glowMat, textSprite, COLORS, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store, stepSlots } from './core.js';
import { makeClouds } from './scenery.js';

const ROAD_W = 5.4;
const LW = ROAD_W / 3;      // 기본 3레인의 한 칸 너비
const Q_SPEED = 11;          // 문제 구간 속도(고정)
const SPAWN_Z = -64;
const CAR = 8;               // 수레 한 칸 길이
const TOP = 1.9;             // 수레 지붕 높이
const COIN_GAP = 2.4;
const STEP = 0.5;            // 이 높이 차이까지는 그대로 올라선다
const laneX = (i, n) => (i - (n - 1) / 2) * (ROAD_W / n);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const GOD = new URLSearchParams(location.search).has('god'); // 테스트용: 장애물 무시

function grassTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#86d65f'; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    c.fillStyle = pick(['#7acb55', '#92de6a', '#79c653', '#9be374']);
    const x = Math.random() * 256, y = Math.random() * 256, r = rnd(6, 22);
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { c.beginPath(); c.ellipse(x + ox, y + oy, r, r * 0.6, 0, 0, 7); c.fill(); }
  }
  const t = new T.CanvasTexture(cv);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function roadTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#efd49a'; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = pick(['#e6c888', '#f5dcab', '#e9cd92']);
    const y = Math.random() * 256;
    c.fillRect(Math.random() * 256, y, rnd(14, 44), rnd(5, 12));
  }
  // 가로 널빤지 줄(달리는 속도감)
  c.fillStyle = 'rgba(150,105,50,.38)';
  for (let y = 0; y < 256; y += 64) c.fillRect(14, y, 228, 7);
  // 가장자리 돌
  c.fillStyle = '#b98d52'; c.fillRect(0, 0, 12, 256); c.fillRect(244, 0, 12, 256);
  c.fillStyle = '#fff3d0'; for (let y = 6; y < 256; y += 32) { c.fillRect(2, y, 8, 16); c.fillRect(246, y, 8, 16); }
  const t = new T.CanvasTexture(cv);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function stripeTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffc93c'; c.fillRect(0, 0, 128, 32);
  c.fillStyle = '#2b2140';
  for (let x = -32; x < 160; x += 32) { c.beginPath(); c.moveTo(x, 32); c.lineTo(x + 16, 32); c.lineTo(x + 32, 0); c.lineTo(x + 16, 0); c.fill(); }
  const t = new T.CanvasTexture(cv);
  t.wrapS = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace;
  return t;
}

function wagonTextures(color) {
  const mk = (draw, w = 256, h = 128) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const planks = (c, w, h, base, line) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.strokeStyle = line; c.lineWidth = 3;
    for (let x = 0; x <= w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  };
  const side = mk((c, w, h) => {
    planks(c, w, h, '#b9834c', '#8f5f33');
    c.fillStyle = color; c.fillRect(0, 0, w, 26); c.fillRect(0, h - 22, w, 22);
    c.fillStyle = '#2b2140';
    for (const x of [52, 128, 204]) { c.fillRect(x - 22, 44, 44, 34); }
    c.fillStyle = '#ffe9a8';
    for (const x of [52, 128, 204]) { c.fillRect(x - 18, 48, 36, 26); }
    c.strokeStyle = '#2b2140'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
  });
  const front = mk((c, w, h) => {
    planks(c, w, h, '#a8733f', '#8f5f33');
    c.fillStyle = color; c.fillRect(0, 0, w, 22);
    c.fillStyle = '#6d4526'; c.fillRect(38, 34, 52, 94);
    c.strokeStyle = '#2b2140'; c.lineWidth = 5; c.strokeRect(38, 34, 52, 94); c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#ffd23c'; c.beginPath(); c.arc(80, 84, 5, 0, 7); c.fill();
  }, 128, 128);
  const roof = mk((c, w, h) => {
    planks(c, w, h, '#d9b27a', '#b98d52');
    c.strokeStyle = color; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
  });
  return { side, front, roof };
}

export function createRunner({ session, hud, onEnd }) {
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xbfe9ff, 70, 330);
  makeSky(scene, 0x1f7bff, 0xbfe9ff, 0xbfe9ff);
  const sun = addLights(scene, { pos: [7, 15, 7], area: 16, far: 60 });
  sun.target.position.set(0, 0, -7);
  const camera = new T.PerspectiveCamera(58, 1, 0.1, 900);

  // 땅과 길
  const grassTex = grassTexture(); grassTex.repeat.set(70, 70);
  const ground = new T.Mesh(new T.PlaneGeometry(520, 520), toonMat(0xffffff, { map: grassTex }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = -120; ground.receiveShadow = true;
  scene.add(ground);
  const roadTex = roadTexture(); roadTex.repeat.set(1, 30);
  const road = new T.Mesh(new T.PlaneGeometry(ROAD_W + 0.9, 240), toonMat(0xffffff, { map: roadTex }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, -105); road.receiveShadow = true;
  scene.add(road);
  const GROUND_TILE = 520 / 70, ROAD_TILE = 240 / 30;

  // 배경(재활용 풀)
  const scenery = [];
  function addScenery(name, scale, xMin, xMax, count, fixedRot = null) {
    for (let i = 0; i < count; i++) {
      const o = engine.prop(name, scale * rnd(0.85, 1.2));
      o.userData.x = [xMin, xMax]; o.userData.rot = fixedRot;
      o.position.z = rnd(-185, 14);
      resetScenery(o);
      scene.add(o); scenery.push(o);
    }
  }
  function resetScenery(o) {
    const side = Math.random() < 0.5 ? -1 : 1;
    o.position.x = side * rnd(o.userData.x[0], o.userData.x[1]);
    o.rotation.y = o.userData.rot === null ? rnd(0, 6.28) : o.userData.rot * side;
  }
  addScenery('tree_single_A', 4, 4.6, 15, 9); addScenery('tree_single_B', 4, 4.6, 16, 9);
  addScenery('trees_A_medium', 3.4, 9, 30, 5); addScenery('trees_B_large', 3.6, 10, 34, 5); addScenery('trees_A_small', 3.2, 8, 26, 4);
  addScenery('rock_single_C', 5.5, 3.9, 14, 4); addScenery('rock_single_E', 5, 3.9, 18, 4); addScenery('rock_single_B', 6, 4, 12, 3);
  addScenery('hill_single_B', 7, 14, 36, 3); addScenery('hill_single_C', 7, 16, 38, 3); addScenery('hills_A_trees', 5, 18, 40, 2);
  addScenery('building_home_A_blue', 3.6, 9, 15, 1, -1.2); addScenery('building_home_B_red', 3.6, 9, 16, 1, -1.2);
  addScenery('building_home_A_yellow', 3.6, 10, 16, 1, -1.2); addScenery('building_home_B_green', 3.6, 10, 17, 1, -1.2);
  addScenery('building_windmill_red', 4.6, 14, 22, 1, -1.2); addScenery('building_tower_A_blue', 4, 13, 20, 1);
  addScenery('building_church_yellow', 4, 13, 20, 1, -1.2); addScenery('building_market_green', 3.6, 11, 16, 1, -1.5);
  addScenery('tent', 4.2, 6, 11, 2); addScenery('resource_lumber', 4, 4.6, 8, 2); addScenery('wheelbarrow', 4, 4.2, 7, 1);
  addScenery('flag_red', 4.5, 3.5, 3.6, 1, 0); addScenery('flag_blue', 4.5, 3.5, 3.6, 1, 0);
  addScenery('flag_yellow', 4.5, 3.5, 3.6, 1, 0); addScenery('flag_green', 4.5, 3.5, 3.6, 1, 0);
  // 먼 산(고정)
  for (let i = 0; i < 11; i++) {
    const m = engine.prop(pick(['mountain_A_grass_trees', 'mountain_B_grass_trees', 'mountain_C_grass', 'mountain_A']), rnd(30, 52));
    m.position.set(-170 + i * 34 + rnd(-8, 8), -1, rnd(-230, -200));
    m.rotation.y = rnd(0, 6.28);
    m.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(m);
  }
  const clouds = makeClouds(scene, 10, { x: 110, yMin: 26, yMax: 46, zMin: -190, zMax: -40, scale: [5, 10] });

  // 플레이어
  const actor = new Actor(store.d.opts.char);
  const player = { lane: 1, x: 0, y: 0, vy: 0, slide: 0, invuln: 0, grounded: true, root: actor.root };
  actor.root.scale.setScalar(0.72);
  actor.root.rotation.y = Math.PI;
  actor.play('Idle');
  scene.add(actor.root);
  // 발밑 그림자(품질 '하'에서도 위치감을 주기 위해)
  const blob = new T.Mesh(new T.CircleGeometry(0.55, 20), new T.MeshBasicMaterial({ color: 0x1c3b12, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.04; scene.add(blob);

  // 공용 형상/재질
  // 코인: 눕혀 있는 모델을 세워서 빙글빙글 돌린다
  function makeCoin() {
    const g = new T.Group();
    const c = engine.assets.coin.clone(true);
    c.rotation.x = Math.PI / 2; c.scale.setScalar(2.3);
    g.add(c);
    return g;
  }
  const stripeTex = stripeTexture();
  const postMat = toonMat(0x8a5a35), whiteMat = toonMat(0xffffff), stripeMat = toonMat(0xffffff, { map: stripeTex });
  const postGeo = new T.CylinderGeometry(0.1, 0.12, 1, 8);
  const paneMats = {}, stripMats = {};
  for (const c of COLORS) {
    paneMats[c] = glowMat(c, 1.2, { transparent: true, opacity: 0.62, side: T.DoubleSide, depthWrite: false });
    stripMats[c] = new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.34, depthWrite: false });
  }
  // 수레(올라탈 수 있는 긴 장애물)
  const texList = [];
  const wagonKinds = ['#ff5d6c', '#4aa8ff', '#35d07f', '#ffc93c'].map((c) => {
    const t = wagonTextures(c); texList.push(t.side, t.front, t.roof);
    const sideM = toonMat(0xffffff, { map: t.side }), frontM = toonMat(0xffffff, { map: t.front }), roofM = toonMat(0xffffff, { map: t.roof });
    return { body: [sideM, sideM, roofM, sideM, frontM, frontM], roof: roofM };
  });
  const bodyGeo = new T.BoxGeometry(1.5, TOP - 0.55, CAR - 0.3);
  const roofGeo = new T.BoxGeometry(1.64, 0.12, CAR - 0.1);
  const wheelGeo = new T.CylinderGeometry(0.42, 0.42, 0.14, 14); wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = toonMat(0x5a3a22), hubMat = toonMat(0xd9b27a);
  const hubGeo = new T.CylinderGeometry(0.13, 0.13, 0.18, 8); hubGeo.rotateZ(Math.PI / 2);
  const RAMP_L = 5.5;
  const rampGeo = (() => {
    const w = 0.75, L = RAMP_L, h = TOP;
    const v = [-w, 0, 0, w, 0, 0, w, h, -L, -w, h, -L, -w, 0, -L, w, 0, -L];
    const idx = [0, 1, 2, 0, 2, 3, /* 왼쪽 */ 0, 3, 4, /* 오른쪽 */ 1, 5, 2, /* 뒤 */ 3, 2, 5, 3, 5, 4];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    return ng;
  })();
  const rampMat = toonMat(0xd9a866);
  const barMats = {
    low: toonMat(0xff5d6c), mid: toonMat(0x4aa8ff),
  };

  // 상태
  let lanes = 3, speed = 0, baseSpeed = 15, dist = 0;
  let hearts = 3, coins = 0, phase = 'intro', phaseT = 0, runLeft = 5, spawnGap = 0;
  let run = null, gate = null, over = false, ended = false;
  const ents = [];
  let trainSeq = 0;
  hud.setHearts(hearts); hud.setScore(0); hud.setExtra('🪙 0');

  function remapLane(n) {
    lanes = n;
    let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const d = Math.abs(laneX(i, n) - player.x); if (d < bd) { bd = d; best = i; } }
    player.lane = best;
  }

  // ---------- 장애물/코인 ----------
  function addEnt(e) { e.o.position.z = e.z; scene.add(e.o); ents.push(e); popIn(e.o); return e; }
  function popIn(o) {
    const s = o.scale.clone();
    o.scale.set(s.x, 0.001, s.z);
    engine.tween(0.35, (k) => o.scale.set(s.x, s.y * k, s.z), { ease: ease.back });
  }
  function coinLine(lane, z, n = 5, arc = false, baseY = 0) {
    for (let i = 0; i < n; i++) {
      const m = makeCoin(); m.rotation.y = i * 0.7;
      const y = baseY + (arc ? 1.0 + Math.sin((i / (n - 1)) * Math.PI) * 1.5 : 1.0);
      m.position.set(laneX(lane, 3), y, 0);
      ents.push({ type: 'coin', z: z - i * COIN_GAP, o: m, lane });
      m.position.z = z - i * COIN_GAP; scene.add(m);
    }
  }
  function crate(lane, z) {
    const g = new T.Group();
    const kind = Math.random();
    if (kind < 0.6) { const c = engine.prop(pick(['crate_A_big', 'crate_B_big']), 5.6); c.rotation.y = rnd(-0.3, 0.3); g.add(c); } else {
      const b = engine.prop('barrel', 6.2); g.add(b);
    }
    g.position.x = laneX(lane, 3);
    addEnt({ type: 'block', z, o: g, lanes: [lane], need: 'jump' });
  }
  function logsWall(z) {
    const o = engine.prop('resource_lumber', 1);
    o.scale.set(ROAD_W / 0.69, 4.1, 3.4);
    addEnt({ type: 'block', z, o, lanes: [0, 1, 2], need: 'jump' });
  }
  function beam(laneList, z) {
    const g = new T.Group();
    const x0 = laneX(laneList[0], 3) - LW / 2, x1 = laneX(laneList[laneList.length - 1], 3) + LW / 2;
    for (const x of [x0 + 0.1, x1 - 0.1]) {
      const p = new T.Mesh(postGeo, postMat); p.scale.y = 2.5; p.position.set(x, 1.25, 0); p.castShadow = true; g.add(p);
    }
    const w = x1 - x0;
    const bar = new T.Mesh(new T.BoxGeometry(w, 0.9, 0.22), stripeMat.clone());
    bar.material.map = stripeTex.clone(); bar.material.map.repeat.set(w / 1.6, 1); bar.material.map.needsUpdate = true;
    bar.userData.ownGeo = true; bar.userData.ownTex = true;
    bar.position.set((x0 + x1) / 2, 1.75, 0); bar.castShadow = true; g.add(bar);
    addEnt({ type: 'block', z, o: g, lanes: laneList, need: 'slide' });
  }
  // 낮은 막대(점프), 중간 막대(점프 또는 슬라이드)
  function bar(lane, z, kind) {
    const g = new T.Group();
    const x = laneX(lane, 3), half = LW / 2 - 0.08;
    const y = kind === 'low' ? 0.5 : 0.98, hgt = kind === 'low' ? 0.5 : 0.26, postH = kind === 'low' ? 0.8 : 1.15;
    for (const dx of [-half, half]) { const p = new T.Mesh(postGeo, postMat); p.scale.y = postH; p.position.set(x + dx, postH / 2, 0); p.castShadow = true; g.add(p); }
    const b = new T.Mesh(new T.BoxGeometry(LW - 0.1, hgt, 0.16), barMats[kind]); b.position.set(x, y, 0); b.castShadow = true; b.userData.ownGeo = true; g.add(b);
    const w = new T.Mesh(new T.BoxGeometry(LW - 0.1, hgt * 0.34, 0.17), whiteMat); w.position.set(x, y, 0); w.userData.ownGeo = true; g.add(w);
    addEnt({ type: 'block', z, o: g, lanes: [lane], need: kind === 'low' ? 'jump' : 'either' });
  }
  function anyBarrier(lane, z) {
    const r = Math.random();
    if (r < 0.3) bar(lane, z, 'low'); else if (r < 0.55) bar(lane, z, 'mid'); else if (r < 0.8) beam([lane], z); else crate(lane, z);
  }
  function wagonMesh(kind, moving) {
    const g = new T.Group();
    const body = new T.Mesh(bodyGeo, kind.body); body.position.set(0, 0.55 + (TOP - 0.55) / 2 - 0.06, -CAR / 2); body.castShadow = true; g.add(body);
    const roof = new T.Mesh(roofGeo, kind.roof); roof.position.set(0, TOP - 0.06, -CAR / 2); roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
    for (const dz of [-1.5, -CAR + 1.5]) for (const dx of [-0.8, 0.8]) {
      const w = new T.Mesh(wheelGeo, wheelMat); w.position.set(dx, 0.42, dz); w.castShadow = true; g.add(w);
      const h = new T.Mesh(hubGeo, hubMat); h.position.copy(w.position); g.add(h);
      w.userData.wheel = h.userData.wheel = true;
    }
    if (moving) for (const dx of [-0.5, 0.5]) {
      const l = new T.Mesh(new T.SphereGeometry(0.16, 8, 6), glowMat(0xffe27a, 2.2)); l.position.set(dx, 1.25, 0.05); l.userData.ownGeo = true; g.add(l);
    }
    return g;
  }
  // 수레 줄. ramp: 앞에 경사로를 놓아 지붕으로 올라갈 수 있다. moving: 마주 달려온다.
  function train(lane, z, cars, { ramp = false, moving = false, coinsTop = false } = {}) {
    const id = ++trainSeq, x = laneX(lane, 3);
    const kind = pick(wagonKinds);
    const vz = moving ? 9 : 0;
    if (moving) z -= 38;
    if (ramp) {
      const m = new T.Mesh(rampGeo, rampMat); m.castShadow = true; m.receiveShadow = true; m.position.x = x;
      addEnt({ type: 'solid', z, o: m, lane, len: RAMP_L, top: TOP, ramp: true, train: id, vz });
      z -= RAMP_L;
    }
    for (let i = 0; i < cars; i++) {
      const o = wagonMesh(kind, moving && i === 0); o.position.x = x;
      addEnt({ type: 'solid', z: z - i * CAR, o, lane, len: CAR, top: TOP, train: id, vz, wheels: true });
    }
    if (coinsTop) coinLine(lane, z - 2, Math.floor((cars * CAR - 3) / COIN_GAP), false, TOP);
    return (ramp ? RAMP_L : 0) + cars * CAR;
  }

  // 한 묶음의 장애물을 놓고, 차지한 길이를 돌려준다
  function spawnPattern() {
    const z = SPAWN_Z;
    const hard = Math.min(1, session.count / 10);
    const ls = [0, 1, 2].sort(() => Math.random() - 0.5);
    const [a, b, c] = ls;
    const r = Math.random();
    let len = 6;
    if (r < 0.16) {
      // 수레 한 줄 + 나머지 길에 막대
      len = train(a, z, 2);
      anyBarrier(b, z - 6); coinLine(c, z - 2, 6);
    } else if (r < 0.32) {
      // 수레 두 줄, 남은 한 길에 막대
      len = train(a, z, 2); train(b, z - 3, 1 + Math.floor(Math.random() * 2));
      coinLine(c, z, 4); anyBarrier(c, z - 10);
    } else if (r < 0.48) {
      // 경사로로 지붕에 오르는 길 + 옆 길 선택
      len = train(a, z, 3, { ramp: true, coinsTop: true });
      train(b, z - 7, 2); anyBarrier(c, z - 9); anyBarrier(c, z - 20);
    } else if (r < 0.60) {
      // 세 길 모두 수레: 경사로로만 지나갈 수 있고, 지붕 위에서 옆 수레로 건너뛴다
      len = train(a, z, 2, { ramp: true, coinsTop: true });
      train(b, z - RAMP_L, 2 + Math.floor(Math.random() * 2), { coinsTop: Math.random() < 0.5 }); train(c, z - RAMP_L, 2);
      len += CAR;
    } else if (r < 0.60 + 0.12 * (0.5 + hard)) {
      // 마주 오는 수레
      train(a, z, 2, { moving: true });
      anyBarrier(b, z - 4); coinLine(c, z, 6);
      len = 14;
    } else if (r < 0.84) {
      // 막대 줄
      for (const l of ls.slice(0, 2 + Math.floor(Math.random() * 2))) anyBarrier(l, z);
      coinLine(c, z - 3, 4);
      if (Math.random() < 0.6) { for (const l of [a, c]) anyBarrier(l, z - 9); coinLine(b, z - 7, 4); len = 14; }
    } else if (r < 0.92) {
      logsWall(z); coinLine(a, z + 3.4, 5, true);
    } else {
      beam([0, 1, 2], z); coinLine(a, z - 3, 5);
    }
    spawnGap = len + rnd(10, 15) - hard * 4;
  }

  // ---------- 문제 게이트 ----------
  function readTime(step, first) {
    let chars = (step.sub || '').length;
    if (first || step.passage) chars += step.prompt.length;
    if (first && step.passage) chars += step.passage.length;
    if (!step.fixed || first) chars += step.options.reduce((s, o) => s + o.text.length, 0);
    const t = (first ? 2.6 : 1.9) + chars * 0.075;
    return Math.max(first ? 3.6 : 2.6, Math.min(13, t));
  }
  function buildGate(step) {
    const { n, opts, colors, labels, short } = stepSlots(step);
    const w = ROAD_W / n;
    const g = new T.Group();
    opts.forEach((o, i) => {
      const x = laneX(i, n);
      if (o) {
        const pane = new T.Mesh(new T.PlaneGeometry(w * 0.9, 2.7), paneMats[colors[i]]);
        pane.position.set(x, 1.45, 0); pane.userData.ownGeo = true; pane.userData.slot = i; g.add(pane);
        const strip = new T.Mesh(new T.PlaneGeometry(w * 0.9, 18), stripMats[colors[i]]);
        strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.05, 9); strip.userData.ownGeo = true; g.add(strip);
      }
      const s = textSprite(labels[i], { w: 320, h: 200, size: short ? 96 : 150, bg: o ? colors[i] : '#9a94a8', border: '#ffffff', color: '#fff', stroke: 'rgba(0,0,0,.25)', scale: Math.min(w * 0.94, 1.9) });
      s.position.set(x, 3.75, 0); g.add(s);
    });
    for (let i = 0; i <= n; i++) {
      const p = new T.Mesh(postGeo, whiteMat); p.scale.set(1, 3.0, 1); p.position.set(-ROAD_W / 2 + i * w, 1.5, 0); p.castShadow = true; g.add(p);
    }
    const top = new T.Mesh(new T.BoxGeometry(ROAD_W + 0.3, 0.2, 0.2), whiteMat);
    top.position.y = 3.0; top.userData.ownGeo = true; g.add(top);
    return { o: g, n, opts };
  }

  function askStep(first) {
    const step = run.step;
    const g = buildGate(step);
    const z0 = -Math.max(30, readTime(step, first) * Q_SPEED);
    gate = { ...g, z: z0, z0, step, done: false };
    gate.o.position.z = z0;
    scene.add(gate.o);
    remapLane(gate.n);
    const hint = step.kind === 'ox' ? '맞으면 O, 틀리면 X 길로 달리세요'
      : step.kind === 'tf' ? '옳은 내용이면 초록, 틀리면 빨강 길로'
        : '정답 색깔의 길로 달리세요';
    hud.showQuestion(run.q, step, { opts: true, hint });
    sfx.play('gate');
  }

  function resolveGate() {
    const g = gate; g.done = true;
    const opt = g.opts[player.lane] || null;
    const res = run.answer(opt);
    const pos = new T.Vector3(player.x, 1.4 + player.y, 0);
    hud.flash(res.ok);
    if (res.ok) {
      sfx.play('correct');
      engine.particles.emit(pos, 46, { colors: CONFETTI, speed: 5, up: 6, life: 1.0 });
    } else {
      sfx.play('wrong'); engine.shake(0.35);
      engine.particles.emit(pos, 18, { colors: ['#ff5d6c', '#7a2a3a'], speed: 4, up: 3, life: 0.6 });
      actor.flash();
    }
    const cs = g.opts.findIndex((o) => o && o.correct);
    hud.markOption(cs, 'right');
    g.o.children.forEach((c) => { if (c.userData.slot !== undefined && c.userData.slot !== cs) c.visible = false; });
    const old = g.o;
    ents.push({ type: 'deco', z: g.z, o: old });
    gate = null;
    remapLane(3);
    if (res.done) finishQuestion(); else engine.wait(0.3, () => { if (!over && run) askStep(false); });
  }

  function finishQuestion() {
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    hud.toast(ok, q, ok ? 1500 : 3800);
    engine.wait(0.6, () => hud.clearQuestion());
    run = null;
    if (!ok) loseHeart();
    else { actor.once('Cheer', 'Running_A', { speed: 1.8 }); baseSpeed = Math.min(23, baseSpeed + 0.45); }
    if (!over) { phase = 'run'; runLeft = rnd(7, 10); spawnGap = 4; }
  }

  function loseHeart() {
    hearts--;
    hud.setHearts(hearts);
    if (hearts <= 0) die();
  }
  function die() {
    over = true; phase = 'dead'; phaseT = 0;
    actor.once('Death_A', null);
    sfx.play('lose');
    hud.clearQuestion();
  }
  function finish() {
    if (ended) return;
    ended = true;
    onEnd({ extra: `모은 코인 ${coins}개 · 달린 거리 ${Math.round(dist)}m` });
  }

  // 해당 레인에서 플레이어 위치(z=0)에 있는 수레/경사로를 살핀다
  // ground: 올라설 수 있는 높이, block: 올라설 수 없어 부딪히는 대상
  function solidAt(lane) {
    let ground = 0, block = null;
    for (const e of ents) {
      if (e.type !== 'solid' || e.ghost || e.lane !== lane) continue;
      if (e.z < -0.45 || e.z - e.len > 0.45) continue;
      const h = e.ramp ? e.top * Math.max(0, Math.min(1, (e.z + 0.45) / e.len)) : e.top;
      if (player.y >= h - STEP) ground = Math.max(ground, h); else block = e;
    }
    return { ground, block };
  }

  // ---------- 입력 ----------
  function act(dir) {
    if (over || phase === 'intro') return;
    if (dir === 'left' || dir === 'right') {
      const to = player.lane + (dir === 'left' ? -1 : 1);
      if (to < 0 || to >= lanes) return;
      if (lanes === 3 && solidAt(to).block) {
        // 옆 수레에 부딪혀 제자리로 튕긴다
        bump = dir === 'left' ? -0.5 : 0.5; sfx.play('hit'); engine.shake(0.15);
        return;
      }
      player.lane = to; sfx.play('swipe');
    } else if (dir === 'up' && player.grounded && player.slide <= 0) {
      player.vy = 9.8; player.y += 0.02; player.grounded = false;
      actor.once('Jump_Full_Short', 'Running_A', { speed: 1.55, fade: 0.06 });
      sfx.play('jump');
    } else if (dir === 'down') {
      if (!player.grounded) player.vy = -22;
      player.slide = 0.72;
      actor.once('Sit_Floor_Down', null, { speed: 3.6, fade: 0.05 });
      sfx.play('slide');
    }
  }
  let tStart = null;
  const onTS = (e) => { const t = e.changedTouches[0]; tStart = { x: t.clientX, y: t.clientY, used: false }; };
  const onTM = (e) => {
    if (!tStart || tStart.used) return;
    const t = e.changedTouches[0], dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    tStart.used = true;
    act(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };
  const onTE = () => { tStart = null; };
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ' ': 'up' };
  const onKey = (e) => { if (KEYS[e.key]) { e.preventDefault(); act(KEYS[e.key]); } };
  addEventListener('touchstart', onTS, { passive: true });
  addEventListener('touchmove', onTM, { passive: true });
  addEventListener('touchend', onTE, { passive: true });
  addEventListener('keydown', onKey);

  // ---------- 진행 ----------
  let countdown = 3, cdT = 0.3, lean = 0, bump = 0, camY = 0;
  const _dust = new T.Vector3();
  let t0 = 0;
  function update(dt) {
    phaseT += dt; t0 += dt;
    // 속도
    let target = 0;
    if (phase === 'run' || phase === 'clear') target = baseSpeed;
    else if (phase === 'ask') target = Q_SPEED;
    speed += (target - speed) * Math.min(1, dt * (over ? 2.5 : 3.5));
    const move = speed * dt;
    dist += move;

    if (phase === 'intro') {
      cdT -= dt;
      if (cdT <= 0) {
        if (countdown > 0) { hud.center(String(countdown), 800); sfx.play('tick'); countdown--; cdT = 0.8; }
        else { hud.center('출발!', 700); sfx.play('go'); phase = 'run'; runLeft = 7; spawnGap = 2; actor.play('Running_A'); }
      }
    } else if (phase === 'run') {
      runLeft -= dt; spawnGap -= move;
      if (spawnGap <= 0 && runLeft > 0) spawnPattern();
      if (runLeft <= 0) phase = 'clear';
    } else if (phase === 'clear') {
      if (!ents.some((e) => (e.type === 'block' || e.type === 'solid') && e.z - (e.len || 0) < 3)) {
        phase = 'ask';
        run = new QRun(session.next());
        askStep(true);
      }
    } else if (phase === 'dead' && phaseT > 1.9) finish();

    // 플레이어
    const tx = laneX(player.lane, lanes);
    const dx = tx - player.x;
    player.x += dx * Math.min(1, dt * 13);
    // 발밑 높이(땅 또는 수레 지붕)와 정면 충돌
    const sa = lanes === 3 ? solidAt(player.lane) : { ground: 0, block: null };
    if (sa.block && !GOD && !over && player.invuln <= 0) {
      const id = sa.block.train;
      for (const e of ents) if (e.train === id && !e.ghost) {
        e.ghost = true;
        const o = e.o, sx = o.position.x, dirX = sx >= 0 ? 1 : -1;
        engine.tween(0.6, (k) => { o.position.x = sx + k * 14 * dirX; o.position.y = Math.sin(k * Math.PI) * 2.5; o.rotation.z = -k * 1.2 * dirX; });
      }
      player.invuln = 1.1;
      sfx.play('hit'); engine.shake(0.5); hud.flash(false);
      engine.particles.emit(new T.Vector3(player.x, 1 + player.y, 0), 26, { colors: ['#c98b4f', '#fff', '#8a5a35'], speed: 5, up: 4, life: 0.7 });
      actor.once('Hit_A', 'Running_A', { speed: 1.4 }); actor.flash();
      loseHeart();
    }
    const ground = sa.ground;
    player.vy -= 31 * dt; player.y += player.vy * dt;
    if (player.y <= ground) { player.y = ground; player.vy = 0; player.grounded = true; } else player.grounded = player.y - ground < 0.02;
    camY += (player.y - camY) * Math.min(1, dt * 6);
    bump *= Math.exp(-dt * 12);
    if (player.slide > 0) {
      player.slide -= dt;
      if (player.grounded && Math.random() < dt * 40) engine.particles.emit(_dust.set(player.x, player.y + 0.15, 0.5), 1, { colors: ['#f5e3b5', '#e2c58a'], speed: 1.2, up: 1.5, gravity: 3, life: 0.4, size: 1.1 });
    }
    lean += ((player.slide > 0 ? 0.42 : 0) - lean) * Math.min(1, dt * 16);
    if (player.invuln > 0) player.invuln -= dt;
    actor.root.position.set(player.x + bump, player.y, 0);
    actor.root.rotation.z = -dx * 0.16;
    actor.root.rotation.x = lean;
    actor.root.rotation.y = Math.PI - dx * 0.22;
    actor.root.visible = !(player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0);
    blob.position.x = player.x; blob.position.y = ground + 0.04; blob.scale.setScalar(1 - Math.min(0.6, (player.y - ground) * 0.25));
    if (!over && phase !== 'intro' && actor.onceLeft <= 0 && player.slide <= 0) actor.play('Running_A', { speed: 0.8 + speed / 22 });
    actor.update(dt);

    // 바닥 흐름
    grassTex.offset.y += move / GROUND_TILE;
    roadTex.offset.y += move / ROAD_TILE;
    for (const o of scenery) {
      o.position.z += move;
      if (o.position.z > 16) { o.position.z -= 200; resetScenery(o); }
    }
    clouds.update(dt);

    // 개체
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i];
      e.z += move + (e.vz || 0) * dt; e.o.position.z = e.z;
      if (e.wheels) e.o.children.forEach((c) => { if (c.userData.wheel) c.rotation.x -= (move + (e.vz || 0) * dt) / 0.42; });
      if (e.type === 'coin') {
        e.o.rotation.y += dt * 4.5; e.o.children[0].position.y = Math.sin(t0 * 4 + e.z * 0.4) * 0.08;
        if (Math.abs(e.z) < 0.75 && Math.abs(e.o.position.x - player.x) < LW * 0.48 && Math.abs(e.o.position.y - (player.y + 1)) < 1.25) {
          coins++; hud.setExtra('🪙 ' + coins); sfx.play('coin');
          engine.particles.emit(e.o.position, 7, { colors: ['#ffd23c', '#fff3a8'], speed: 2.5, up: 3, life: 0.45, size: 0.8 });
          scene.remove(e.o); ents.splice(i, 1); continue;
        }
      } else if (e.type === 'block' && !GOD && !e.hit && !over && player.invuln <= 0 && e.z > -0.55 && e.z < 0.75) {
        const inLane = e.lanes.some((l) => Math.abs(laneX(l, 3) - player.x) < LW * 0.46);
        const sliding = player.slide > 0 && player.y < 0.3;
        const safe = e.need === 'jump' ? player.y > 0.85 : e.need === 'either' ? (player.y > 1.02 || sliding) : (sliding || player.y > 2.3);
        if (inLane && !safe) {
          e.hit = true; player.invuln = 1.1;
          sfx.play('hit'); engine.shake(0.45); hud.flash(false);
          engine.particles.emit(new T.Vector3(player.x, 1, 0), 22, { colors: ['#c98b4f', '#fff', '#8a5a35'], speed: 5, up: 4, life: 0.7 });
          actor.once('Hit_A', 'Running_A', { speed: 1.4 }); actor.flash();
          const o = e.o, sx = o.position.x;
          engine.tween(0.45, (k) => { o.position.y = Math.sin(k * Math.PI) * 2; o.position.x = sx + k * (sx >= 0 ? 12 : -12); o.rotation.z = k * (sx >= 0 ? -2 : 2); });
          loseHeart();
        }
      }
      if (e.z - (e.len || 0) > 12) { scene.remove(e.o); disposeScene(e.o); ents.splice(i, 1); }
    }

    // 문제 게이트
    if (gate) {
      gate.z += move; gate.o.position.z = gate.z;
      hud.timer(gate.z / gate.z0);
      if (gate.z >= -0.15 && !gate.done) resolveGate();
    }

    // 카메라
    const cx = player.x * 0.5;
    camera.position.set(cx, 5.3 + camY * 0.75, 9.6);
    camera.lookAt(cx * 0.8, 3.0 + camY * 0.6, -8);
  }

  const stage = {
    scene, camera, sun, update,
    bloom: { strength: 0.32, threshold: 0.9, radius: 0.6 },
    onResize(w, h) { camera.fov = w / h < 0.8 ? 62 : 48; },
    dispose() {
      removeEventListener('touchstart', onTS); removeEventListener('touchmove', onTM);
      removeEventListener('touchend', onTE); removeEventListener('keydown', onKey);
      disposeScene(scene);
      grassTex.dispose(); roadTex.dispose(); stripeTex.dispose(); texList.forEach((t) => t.dispose());
    },
  };
  return { stage, quit() { over = true; finish(); } };
}
