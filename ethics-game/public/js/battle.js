// 게임 C: 논쟁 배틀 (실시간)
// 손가락을 끌어 불덩이를 피한다. 잠깐 버티면 게임이 멈추고 문제가 나오며, 맞히면 반격한다.
import { T, engine, Actor, makeSky, addLights, glowMat, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { store } from './core.js';
import { hexIsland, makeClouds, place } from './scenery.js';

const FOES = {
  knight: '고집불통 기사', mage: '궤변의 마법사', barbarian: '억지의 전사',
  rogue: '말꼬리 도적', rogue_hooded: '가면 쓴 논객',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createBattle({ session, hud, onEnd }) {
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xf2a98a, 34, 150);
  makeSky(scene, 0x2a2f8f, 0xffa27a, 0xffd2a0);
  const sun = addLights(scene, { sun: 0xffe2c0, sunI: 2.0, sky: 0xd6dcff, ground: 0x8fb08a, hemiI: 1.3, pos: [-9, 10, 5], area: 13, far: 50 });
  const camera = new T.PerspectiveCamera(56, 1, 0.1, 800);

  // 경기장
  const arena = new T.Group();
  arena.add(hexIsland(4, 2.2));
  const R = 9.6;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    if (Math.sin(a) < -0.7) continue; // 카메라 쪽(z > 0)은 비워 둔다
    const w = place(arena, i % 3 === 0 ? 'wall_straight_gate' : 'wall_straight', 2.6, Math.cos(a) * R, 0, -Math.sin(a) * R);
    w.rotation.y = a + Math.PI / 2;
    const f = place(arena, ['flag_red', 'flag_blue', 'flag_yellow', 'flag_green'][i % 4], 4.2, Math.cos(a) * (R - 0.2), 2.8, -Math.sin(a) * (R - 0.2), a);
    f.userData.wave = i;
  }
  place(arena, 'building_tower_B_yellow', 3.4, -8.5, 0, -9.5); place(arena, 'building_tower_A_blue', 3.4, 9, 0, -9);
  place(arena, 'building_castle_blue', 3.4, 0, 0, -21);
  place(arena, 'tent', 3.6, -6.2, 0, -4.4, 0.6); place(arena, 'tent', 3.6, 6.4, 0, -3.8, -0.6);
  place(arena, 'weaponrack', 4.2, -6.2, 0, -1.2, 1.2); place(arena, 'target', 4, 6.4, 0, -0.6, -1.1);
  place(arena, 'rock_single_C', 4.5, -5.6, 0, 5.2, 1); place(arena, 'rock_single_E', 4, 5.9, 0, 5.8, 2);
  place(arena, 'barrel', 4, -5.6, 0, 1.6); place(arena, 'crate_A_big', 3.8, 5.8, 0, 2.2, 0.4); place(arena, 'crate_B_big', 3.4, 6.6, 0, 1.4);
  for (const [x, z, s] of [[-13, -8, 4], [13, -7, 4.4], [-12, 2, 3.6], [12.5, 3, 3.8], [-15, -14, 5], [15, -15, 5]]) place(arena, Math.random() < 0.5 ? 'trees_A_medium' : 'trees_B_large', s, x, 0, z, Math.random() * 6);
  scene.add(arena);
  // 횃불 느낌의 따뜻한 조명
  for (const x of [-5.5, 5.5]) {
    const l = new T.PointLight(0xffa040, 28, 16, 2); l.position.set(x, 2.6, -2.5); scene.add(l);
    const orb = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), glowMat(0xffb040, 2)); orb.position.copy(l.position); orb.userData.ownGeo = true; scene.add(orb);
  }
  const clouds = makeClouds(scene, 7, { x: 70, yMin: 16, yMax: 30, zMin: -90, zMax: -30, scale: [4, 8] });

  // 경기장 크기
  const FW = 2.3;                 // 움직일 수 있는 가로 반폭
  const PZ = 3.4, EZ = -6.2;      // 플레이어 / 상대의 z 위치
  const rnd = (a, b) => a + Math.random() * (b - a);
  const GOD = new URLSearchParams(location.search).has('god'); // 테스트용: 불덩이 무시

  const hero = new Actor(store.d.opts.char);
  hero.root.scale.setScalar(0.9);
  hero.root.position.set(0, 0, PZ);
  hero.root.rotation.y = Math.PI;
  hero.play('Idle');
  scene.add(hero.root);
  const foeOrder = Object.keys(FOES).filter((k) => k !== store.d.opts.char);
  let foe = null, foeIdx = 0;

  // 상태
  let lives = 4, wins = 0, over = false, ended = false, t = 0;
  let nextQ = 7, quizzing = false;
  let px = 0, tx = 0, invuln = 0, fireT = 2, keyDir = 0;
  const balls = [];
  hud.setHearts(lives, 4); hud.setScore(0); hud.setExtra('격파 0');

  const foePlate = document.createElement('div');
  foePlate.className = 'nameplate'; foePlate.style.pointerEvents = 'none';
  hud.ui.appendChild(foePlate);
  function drawFoePlate() {
    if (!foe) { foePlate.innerHTML = ''; return; }
    foePlate.innerHTML = `<span>${esc(foe.label)}</span><div class="hp">${Array.from({ length: foe.max }, (_, i) => `<i class="${i < foe.hp ? '' : 'off'}"></i>`).join('')}</div>`;
  }

  const ballGeo = new T.SphereGeometry(0.3, 12, 10);
  const ballMat = glowMat(0xff8a2a, 2.0);
  const markGeo = new T.RingGeometry(0.42, 0.55, 24);
  const markMat = new T.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.7, depthWrite: false });
  const orbGeo = new T.IcosahedronGeometry(0.4, 1);

  async function spawnFoe() {
    const name = foeOrder[foeIdx++ % foeOrder.length];
    if (!engine.hasChar(name)) await engine.ensureChar(name);
    if (over) return;
    const a = new Actor(name);
    a.root.scale.setScalar(0.95);
    const from = new T.Vector3(0, 0, EZ - 5), to = new T.Vector3(0, 0, EZ);
    a.root.position.copy(from);
    a.play('Walking_A', { speed: 1.4 });
    scene.add(a.root);
    const hp = Math.min(5, 2 + wins);
    const f = { a, name, base: FOES[name], label: FOES[name], hp, max: hp, ready: false };
    foe = f;
    drawFoePlate();
    engine.tween(1.0, (k) => a.root.position.lerpVectors(from, to, k), { ease: ease.lin, done: () => { a.play('Idle'); f.ready = true; sfx.play('gate'); } });
  }

  // ---------- 불덩이(쉬지 않고 피해야 하는 것) ----------
  function fire(targetX) {
    if (!foe || !foe.ready) return;
    const m = new T.Mesh(ballGeo, ballMat);
    const from = new T.Vector3(foe.a.root.position.x, 1.5, EZ + 0.6);
    m.position.copy(from);
    scene.add(m);
    const mark = new T.Mesh(markGeo, markMat); mark.rotation.x = -Math.PI / 2; mark.position.set(targetX, 0.05, PZ); scene.add(mark);
    const hard = Math.min(1, wins / 4 + session.count / 30);
    const speed = 7.2 + hard * 3.5;
    const dir = new T.Vector3(targetX - from.x, 0, PZ - from.z).normalize();
    balls.push({ m, mark, dir, speed, done: false });
    foe.a.once('Spellcast_Shoot', 'Idle', { speed: 2.2, fade: 0.05 });
    sfx.play('swipe');
  }
  function hurt(pos) {
    if (over) return;
    lives--; hud.setHearts(lives, 4);
    invuln = 1.0;
    sfx.play('hit'); engine.shake(0.45); hud.flash(false);
    hero.flash();
    engine.particles.emit(pos, 24, { colors: ['#ff5d6c', '#ffb040', '#fff'], speed: 5, up: 4, life: 0.7 });
    if (lives <= 0) {
      over = true;
      hero.once('Death_A', null); sfx.play('lose');
      engine.wait(2.2, finish);
    }
  }

  // ---------- 문제 ----------
  // 게임을 멈추고 문제를 낸다. 맞히면 반격 구슬이 상대에게 날아간다.
  function askQuestion() {
    quizzing = true;
    engine.paused = true;
    dragging = false; keyDir = 0;
    const q = session.next();
    hud.quiz(q, (ok) => {
      engine.paused = false; quizzing = false;
      session.record(q, ok);
      hud.setScore(session.correct);
      nextQ = rnd(6, 9);
      const pos = new T.Vector3(px, 1.2, PZ);
      if (ok) {
        hud.flash(true);
        hero.once('1H_Melee_Attack_Slice_Horizontal', 'Idle', { speed: 1.8, fade: 0.05 });
        engine.particles.emit(pos, 30, { colors: CONFETTI, speed: 4, up: 4, life: 0.8 });
        const orb = new T.Mesh(orbGeo, glowMat(0x35d07f, 1.6));
        scene.add(orb);
        const to = new T.Vector3(foe ? foe.a.root.position.x : 0, 1.4, EZ);
        // 여러 번 골라야 하는 문제는 2칸
        const dmg = q.type === 'ox' || q.type === 'choice' ? 1 : 2;
        engine.tween(0.4, (k) => { orb.position.lerpVectors(pos, to, k); orb.position.y += Math.sin(k * Math.PI) * 1.4; }, { ease: ease.lin, done: () => { scene.remove(orb); strikeFoe(dmg); } });
      } else hurt(pos);
    });
  }
  function poof(pos, colors) {
    engine.particles.emit(new T.Vector3(pos.x, pos.y + 1.4, pos.z), 34, { colors, speed: 3, up: 3, gravity: 4, life: 0.8 });
  }
  // 정답 구슬이 상대에게 맞았을 때
  function strikeFoe(dmg) {
    if (!foe) return;
    const f = foe;
    sfx.play('attack'); engine.shake(0.3);
    f.a.flash(0xffffff);
    engine.particles.emit(new T.Vector3(f.a.root.position.x, 1.5, EZ), 26, { colors: ['#fff', '#ffc93c', '#ff5d6c'], speed: 5, up: 4, life: 0.7 });
    if (!dmg) { f.a.once('Hit_A', 'Idle'); return; }
    f.hp = Math.max(0, f.hp - dmg); drawFoePlate();
    if (dmg > 1) hud.center('연속 타격!', 700);
    if (f.hp <= 0) {
      f.ready = false;
      f.a.once('Death_A', null);
      wins++; hud.setExtra('격파 ' + wins); hud.setGameScore(wins);
      sfx.play('win'); hero.once('Cheer', 'Idle');
      engine.wait(1.0, () => { poof(f.a.root.position, CONFETTI); scene.remove(f.a.root); if (foe === f) foe = null; drawFoePlate(); if (!over) spawnFoe(); });
    } else f.a.once('Hit_A', 'Idle');
  }

  function finish() { if (!ended) { ended = true; onEnd({ score: wins, extra: `격파한 상대 ${wins}명` }); } }

  // ---------- 입력: 끌어서 이동 ----------
  const toWorldX = (cx) => Math.max(-FW, Math.min(FW, ((cx / innerWidth) - 0.5) * 2 * FW * 1.3));
  let dragging = false;
  const onDown = (e) => { if (engine.paused || e.target.closest('button')) return; dragging = true; tx = toWorldX(e.clientX); };
  const onMove = (e) => { if (engine.paused) return; if (dragging || e.pointerType === 'mouse') tx = toWorldX(e.clientX); };
  const onUp = () => { dragging = false; };
  const onKey = (e) => { if (e.key === 'ArrowLeft') keyDir = -1; if (e.key === 'ArrowRight') keyDir = 1; };
  const onKeyUp = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keyDir = 0; };
  addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKey); addEventListener('keyup', onKeyUp);

  const _p = {}, _v = new T.Vector3();
  let started = false;
  function update(dt) {
    t += dt;
    if (!started && t > 0.4) { started = true; spawnFoe(); }
    clouds.update(dt);
    arena.children.forEach((c) => { if (c.userData.wave !== undefined) c.rotation.z = Math.sin(t * 2 + c.userData.wave) * 0.06; });

    // 플레이어 이동
    if (keyDir) tx = Math.max(-FW, Math.min(FW, tx + keyDir * 9 * dt));
    const before = px;
    if (!over) px += Math.max(-13 * dt, Math.min(13 * dt, tx - px));
    const vx = (px - before) / Math.max(dt, 1e-4);
    hero.root.position.x = px;
    hero.root.rotation.z = -vx * 0.02;
    hero.root.rotation.y = Math.PI - vx * 0.03;
    if (!over && hero.onceLeft <= 0) hero.play(Math.abs(vx) > 1.2 ? 'Running_A' : 'Idle', { speed: 1.3 });
    if (invuln > 0) invuln -= dt;
    hero.root.visible = !(invuln > 0 && Math.floor(invuln * 14) % 2 === 0);
    hero.update(dt);

    // 상대
    if (foe) {
      if (foe.ready) foe.a.root.position.x = Math.sin(t * 0.7) * 1.6;
      foe.a.update(dt);
      _v.copy(foe.a.root.position); _v.y += 2.9;
      engine.project(_v, _p);
      foePlate.style.left = _p.x + 'px'; foePlate.style.top = _p.y + 'px';
    }

    if (!over && !quizzing) {
      // 불덩이는 쉬지 않고 날아온다
      const hard = Math.min(1, wins / 4 + session.count / 30);
      fireT -= dt;
      if (fireT <= 0 && foe && foe.ready) {
        if (Math.random() < 0.15 + hard * 0.25) { for (const d of [-1.3, 0, 1.3]) fire(Math.max(-FW, Math.min(FW, px + d))); }
        else fire(Math.max(-FW, Math.min(FW, px + rnd(-0.5, 0.5))));
        fireT = 1.15 - hard * 0.45 + rnd(0, 0.3);
      }
      // 잠깐 버틴 뒤, 날아오던 불덩이가 다 지나가면 문제를 낸다
      nextQ -= dt;
      if (nextQ <= 0 && foe && foe.ready) { fireT = 9; if (!balls.length) askQuestion(); }
    }

    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.m.position.addScaledVector(b.dir, b.speed * dt);
      b.m.position.y = 0.9 + Math.max(0, (PZ - b.m.position.z) / (PZ - EZ)) * 0.6;
      b.mark.material.opacity = 0.4 + Math.sin(t * 14) * 0.3;
      if (Math.random() < dt * 30) engine.particles.emit(b.m.position, 1, { colors: ['#ffb040', '#ff5d2a'], speed: 0.6, up: 0.8, gravity: 1, life: 0.3, size: 0.9 });
      const z = b.m.position.z;
      if (!b.done && z > PZ - 0.35 && z < PZ + 0.45 && Math.abs(b.m.position.x - px) < 0.55 && invuln <= 0 && !over && !GOD) {
        b.done = true;
        hero.once('Hit_B', 'Idle', { speed: 1.5 });
        hurt(b.m.position.clone());
      }
      if (b.done || z > PZ + 2.5) { scene.remove(b.m); scene.remove(b.mark); balls.splice(i, 1); }
    }

    camera.position.set(px * 0.25, 9.2, 10.6);
    camera.lookAt(px * 0.15, 0.6, -3.8);
    camera.updateMatrixWorld();
  }

  const stage = {
    scene, camera, sun, update,
    bloom: { strength: 0.4, threshold: 0.9, radius: 0.7 },
    onResize(w, h) { camera.fov = w / h < 0.8 ? 60 : 40; },
    dispose() {
      removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKeyUp);
      ballGeo.dispose(); markGeo.dispose(); orbGeo.dispose();
      disposeScene(scene);
    },
  };
  return { stage, quit() { over = true; finish(); } };
}
