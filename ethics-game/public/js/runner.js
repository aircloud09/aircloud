// 게임 A: 지식 러너
import { T, engine, Actor, makeSky, addLights, toonMat, glowMat, textSprite, COLORS, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store, stepSlots, shuffle } from './core.js';
import { makeClouds } from './scenery.js';

const ROAD_W = 5.4;
const LW = ROAD_W / 3;      // 기본 3레인의 한 칸 너비
const SHOW_TIME = 5;         // 문제를 크게 보여 주는 시간(초). 이때는 장애물이 없다
const GATE_CLEAR = 22;       // 게이트 앞뒤로 비워 두는 거리
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
  // 속도: 코인 0개 기본 → 200개에서 1.3배(최대)
  const BASE_SPEED = 15, MAX_MUL = 1.3, MAX_COINS = 200;
  let lanes = 3, speed = 0, baseSpeed = BASE_SPEED, dist = 0, jumpBuf = 0;
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

  // ---------- 문제 ----------
  // 흐름: 장애물 없이 달리며 문제를 5초간 크게 보여 줌 → 문제는 왼쪽 위에 작게
  //       → 평소처럼 장애물이 나오고, 보기마다 한 칸짜리 게이트가 장애물 사이에 따로따로 나옴
  //       → 맞는 보기 게이트는 통과, 틀린 보기 게이트는 피함 → 게이트마다 해설
  let showLeft = 0, gateWait = 0;
  let queue = [], gates = [], judged = [], stepTotal = 0;
  const GATE_W = LW * 0.92;
  function buildGate(opt, slot, color, label) {
    const g = new T.Group();
    const pane = new T.Mesh(new T.PlaneGeometry(GATE_W, 2.7), paneMats[color]);
    pane.position.y = 1.45; pane.userData.ownGeo = true; g.add(pane);
    const strip = new T.Mesh(new T.PlaneGeometry(GATE_W, 7), stripMats[color]);
    strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.05, 3.5); strip.userData.ownGeo = true; g.add(strip);
    for (const dx of [-GATE_W / 2, GATE_W / 2]) { const p = new T.Mesh(postGeo, whiteMat); p.scale.set(1, 3.0, 1); p.position.set(dx, 1.5, 0); p.castShadow = true; g.add(p); }
    const top = new T.Mesh(new T.BoxGeometry(GATE_W + 0.25, 0.2, 0.2), whiteMat); top.position.y = 3.0; top.userData.ownGeo = true; g.add(top);
    // 짧은 보기는 한 줄 크게, 긴 보기(최대 32자)는 여러 줄로 감싼 큰 글자판
    let sp;
    if (label.length <= 8) {
      const size = [0, 120, 110, 96, 80, 66, 58, 52, 48][label.length];
      sp = textSprite(label, { w: 360, h: 200, size, bg: color, border: '#ffffff', color: '#fff', stroke: 'rgba(0,0,0,.25)', scale: 2.3 });
      sp.position.y = 3.95;
    } else {
      sp = textSprite(label, { w: 480, h: 400, size: 74, min: 40, pad: 22, bg: color, border: '#ffffff', color: '#fff', stroke: 'rgba(0,0,0,.3)', scale: 2.9 });
      sp.position.y = 4.65;
    }
    g.add(sp);
    return g;
  }
  const HINT = (step) => (step.kind === 'ox' ? '곧 O, X 게이트가 따로 나와요. 맞는 쪽만 통과하고 나머지는 피하세요!'
    : step.kind === 'tf' ? '곧 옳음, 틀림 게이트가 나와요. 맞는 쪽만 통과!'
      : '보기마다 게이트가 따로 나와요. 정답 게이트만 통과하고 나머지는 피하세요!');
  function startQuestion() {
    run = new QRun(session.next());
    phase = 'show'; showLeft = SHOW_TIME;
    hud.showQuestion(run.q, run.step, { opts: true, hint: HINT(run.step) });
    sfx.play('gate');
  }
  function prepareStep() {
    const { opts, colors, labels, short } = stepSlots(run.step);
    queue = shuffle(opts.map((o, i) => (o ? { opt: o, slot: i, color: colors[i], label: o.text } : null)).filter(Boolean));
    stepTotal = queue.length; judged = [];
    gateWait = rnd(1.6, 2.4);
    hud.showQuestion(run.q, run.step, { opts: true, side: true });
  }
  function toAnswerPhase() {
    phase = 'answer';
    spawnGap = 3;
    prepareStep();
  }
  // 게이트 한 개를 비어 있는 레인에 낸다(앞뒤 장애물과 겹치지 않게)
  function trySpawnGate() {
    const near = (l) => ents.some((e) => (e.type === 'block' || e.type === 'solid') && (e.lanes ? e.lanes.includes(l) : e.lane === l)
      && e.z - (e.len || 0) < SPAWN_Z + 12 && e.z > SPAWN_Z - 4);
    const free = [0, 1, 2].filter((l) => !near(l) && !gates.some((g) => g.lane === l && g.z < SPAWN_Z + 10));
    if (!free.length) return false;
    const it = queue.shift();
    const lane = free[Math.floor(Math.random() * free.length)];
    const o = buildGate(it.opt, it.slot, it.color, it.label);
    o.position.set(laneX(lane, 3), 0, SPAWN_Z);
    scene.add(o); popIn(o);
    gates.push({ ...it, lane, o, z: SPAWN_Z });
    spawnGap = Math.max(spawnGap, 9);   // 게이트 바로 뒤에는 장애물을 잠깐 쉰다
    sfx.play('gate');
    return true;
  }
  function judgeGate(g) {
    const passed = Math.abs(player.x - laneX(g.lane, 3)) < LW * 0.5;
    const should = g.opt.correct;
    const ok = passed === should;
    judged.push({ ok, passed, opt: g.opt });
    const pos = new T.Vector3(player.x, 1.4 + player.y, 0);
    if (ok) {
      if (passed) { sfx.play('correct'); hud.flash(true); engine.particles.emit(pos, 40, { colors: CONFETTI, speed: 5, up: 6, life: 1.0 }); }
      else sfx.play('coin');
    } else {
      sfx.play('wrong'); hud.flash(false); engine.shake(0.3); actor.flash();
      engine.particles.emit(pos, 16, { colors: ['#ff5d6c', '#7a2a3a'], speed: 4, up: 3, life: 0.6 });
    }
    if (should) hud.markOption(g.slot, 'right'); else if (passed) hud.markOption(g.slot, 'wrong');
    // 지나간 게이트: 정답 게이트만 남기고 흐리게
    // 지나간 게이트는 글자판을 치워 앞을 가리지 않게 한다
    g.o.traverse((c) => { if (c.isSprite) c.visible = false; else if (c.material && c.material.transparent) { c.material = c.material.clone(); c.material.opacity *= 0.3; } });
    ents.push({ type: 'deco', z: g.z, o: g.o });
    const title = ok ? (passed ? '정답 통과!' : '잘 피했어요') : (passed ? '틀린 게이트를 통과했어요' : '정답 게이트를 놓쳤어요');
    const last = judged.length === stepTotal;
    if (!last || !run.steps || run.i < run.steps.length - 1) hud.toastTitle(ok, title, `「${g.opt.text}」는 ${should ? '정답' : '오답'}`, run.q.explanation, ok ? 1900 : 3200);
    if (last) resolveStep();
  }
  function resolveStep() {
    const stepOk = judged.every((j) => j.ok);
    const correctOpt = run.step.options.find((o) => o.correct);
    const passedWrong = judged.find((j) => j.passed && !j.opt.correct);
    const res = run.answer(stepOk ? correctOpt : (passedWrong ? passedWrong.opt : null));
    if (res.done) finishQuestion();
    else engine.wait(0.6, () => { if (!over && run) prepareStep(); });
  }

  function finishQuestion() {
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    hud.toast(ok, q, ok ? 2600 : 4200);
    engine.wait(0.6, () => hud.clearQuestion());
    run = null;
    if (!ok) loseHeart();
    else actor.once('Cheer', 'Running_A', { speed: 1.8 });
    if (!over) { phase = 'run'; runLeft = rnd(8, 11); spawnGap = 6; }
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
    onEnd({ score: coins, extra: `모은 코인 ${coins}개 · 달린 거리 ${Math.round(dist)}m` });
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
    if (over || phase === 'intro' || engine.paused) return;
    if (dir === 'left' || dir === 'right') {
      const to = player.lane + (dir === 'left' ? -1 : 1);
      if (to < 0 || to >= lanes) return;
      if (lanes === 3 && solidAt(to).block) {
        // 옆 수레에 부딪혀 제자리로 튕긴다
        bump = dir === 'left' ? -0.5 : 0.5; sfx.play('hit'); engine.shake(0.15);
        return;
      }
      player.lane = to; sfx.play('swipe');
    } else if (dir === 'up') {
      // 슬라이딩 중이어도 바로 일어나 점프. 공중이면 착지하자마자 점프하도록 잠깐 기억
      if (player.grounded) doJump(); else jumpBuf = 0.2;
    } else if (dir === 'down') {
      // 점프 중이어도 바로 내리꽂고 슬라이딩
      jumpBuf = 0;
      if (!player.grounded) player.vy = Math.min(player.vy, -30);
      player.slide = 0.72; lean = 1;
      actor.hold('Sit_Floor_Down', 0.62, 4.5);   // 앉은 자세를 슬라이딩 내내 유지
      sfx.play('slide');
    }
  }
  function doJump() {
    player.slide = 0; lean = 0; jumpBuf = 0;
    player.vy = 9.8; player.y += 0.02; player.grounded = false;
    actor.once('Jump_Full_Short', 'Running_A', { speed: 1.55, fade: 0.02 });
    sfx.play('jump');
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
    baseSpeed = BASE_SPEED * (1 + (MAX_MUL - 1) * Math.min(coins, MAX_COINS) / MAX_COINS);
    if (phase === 'run' || phase === 'clear' || phase === 'show' || phase === 'answer') target = baseSpeed;
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
      if (!ents.some((e) => (e.type === 'block' || e.type === 'solid') && e.z - (e.len || 0) < 3)) startQuestion();
    } else if (phase === 'show') {
      // 장애물 없이 달리면서 문제를 읽는다
      showLeft -= dt;
      hud.timer(showLeft / SHOW_TIME);
      if (showLeft <= 0) toAnswerPhase();
    } else if (phase === 'answer') {
      // 장애물은 계속 나오고, 그 사이에 게이트를 하나씩 낸다
      gateWait -= dt;
      if (queue.length && gateWait <= 0 && trySpawnGate()) gateWait = rnd(1.5, 2.3);
      spawnGap -= move;
      if (spawnGap <= 0 && !(queue.length && gateWait <= 0.6)) spawnPattern();
      hud.timer(stepTotal ? 1 - judged.length / stepTotal : 1);
    } else if (phase === 'dead' && phaseT > 1.9) finish();

    // 플레이어
    const tx = laneX(player.lane, lanes);
    const dx = tx - player.x;
    player.x += dx * Math.min(1, dt * 18);
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
    if (jumpBuf > 0) { jumpBuf -= dt; if (player.grounded && !over) doJump(); }
    camY += (player.y - camY) * Math.min(1, dt * 6);
    bump *= Math.exp(-dt * 12);
    if (player.slide > 0) {
      player.slide -= dt;
      if (player.grounded && Math.random() < dt * 40) engine.particles.emit(_dust.set(player.x, player.y + 0.15, 0.5), 1, { colors: ['#f5e3b5', '#e2c58a'], speed: 1.2, up: 1.5, gravity: 3, life: 0.4, size: 1.1 });
    }
    lean += ((player.slide > 0 ? 1 : 0) - lean) * Math.min(1, dt * 20);
    if (player.invuln > 0) player.invuln -= dt;
    actor.root.position.set(player.x + bump, player.y, 0);
    actor.root.rotation.z = -dx * 0.16;
    // 슬라이딩: 몸을 낮추고(납작하게) 살짝 숙인다
    actor.root.rotation.x = -0.25 * lean;
    actor.root.scale.set(0.72, 0.72 * (1 - 0.38 * lean), 0.72);
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
          coins++; hud.setExtra('🪙 ' + coins); hud.setGameScore(coins); sfx.play('coin');
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

    // 답 게이트
    for (let i = gates.length - 1; i >= 0; i--) {
      const g = gates[i];
      g.z += move; g.o.position.z = g.z;
      if (g.z >= -0.15) { gates.splice(i, 1); if (run && !over) judgeGate(g); }
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
