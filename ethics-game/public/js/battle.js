// 게임 C: 논쟁 배틀 (실시간)
// 손가락을 끌어 불덩이를 피하면서, 정답 구슬이 도착할 때 그 줄에 서서 받아친다.
import { T, engine, Actor, makeSky, addLights, glowMat, textSprite, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store, stepSlots } from './core.js';
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
  const PZ = 3.4, EZ = -3.0;      // 플레이어 / 상대의 z 위치
  const rnd = (a, b) => a + Math.random() * (b - a);
  const GOD = new URLSearchParams(location.search).has('god'); // 테스트용: 불덩이 무시
  const AUTO = new URLSearchParams(location.search).has('auto'); // 테스트용: 정답 구슬을 자동으로 받아침

  const hero = new Actor(store.d.opts.char);
  hero.root.scale.setScalar(0.9);
  hero.root.position.set(0, 0, PZ);
  hero.root.rotation.y = Math.PI;
  hero.play('Idle');
  scene.add(hero.root);
  const foeOrder = Object.keys(FOES).filter((k) => k !== store.d.opts.char);
  let foe = null, foeIdx = 0;

  // 상태
  // 점수 = 적에게 입힌 피해량 합계
  let lives = 4, wins = 0, dealt = 0, over = false, ended = false, t = 0;
  let run = null, step = null, wave = null, nextQ = 2.2;
  let px = 0, tx = 0, invuln = 0, fireT = 2, keyDir = 0;
  const balls = [];
  hud.setHearts(lives, 4); hud.setScore(0); hud.setExtra('💥 0 · 격파 0');

  const foePlate = document.createElement('div');
  foePlate.className = 'nameplate'; foePlate.style.pointerEvents = 'none';
  hud.ui.appendChild(foePlate);
  function drawFoePlate() {
    if (!foe) { foePlate.innerHTML = ''; return; }
    foePlate.innerHTML = `<span>${esc(foe.label)}</span><div class="hpbar"><i style="width:${(foe.hp / foe.max) * 100}%"></i><b>${foe.hp} / ${foe.max}</b></div>`;
  }

  const ballGeo = new T.SphereGeometry(0.3, 12, 10);
  const ballMat = glowMat(0xff8a2a, 2.0);
  const markGeo = new T.RingGeometry(0.42, 0.55, 24);
  const markMat = new T.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.7, depthWrite: false });
  const orbGeo = new T.IcosahedronGeometry(0.5, 1);
  const stripGeo = new T.PlaneGeometry(1, 1);

  // 적 체력: 처음 6칸, 쓰러뜨릴 때마다 2칸씩 늘어나 최대 14칸
  const foeHp = () => Math.min(14, 6 + wins * 2);
  async function spawnFoe() {
    // 다음 적 모델을 아직 내려받는 중이면 기다리지 않고 이미 받은 캐릭터로 낸다(게임이 멈추지 않도록)
    let name = foeOrder[foeIdx++ % foeOrder.length];
    if (!engine.hasChar(name)) {
      engine.ensureChar(name);
      name = foeOrder.find((n) => engine.hasChar(n)) || store.d.opts.char;
      if (!engine.hasChar(name)) await engine.ensureChar(name);
    }
    if (over) return;
    const a = new Actor(name);
    a.root.scale.setScalar(0.95);
    const from = new T.Vector3(0, 0, EZ - 5), to = new T.Vector3(0, 0, EZ);
    a.root.position.copy(from);
    a.play('Walking_A', { speed: 1.4 });
    scene.add(a.root);
    const hp = foeHp();
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
    const speed = 5.2 + hard * 2.4;   // 거리가 짧아서 느리게
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
      hero.once('Death_A', null); sfx.play('lose'); hud.clearQuestion(); clearWave();
      engine.wait(2.2, finish);
    }
  }

  // ---------- 정답 구슬 ----------
  function readTime(first) {
    let chars = (step.sub || '').length;
    if (first || step.passage) chars += step.prompt.length;
    if (first && step.passage) chars += step.passage.length;
    if (!step.fixed || first) chars += step.options.reduce((s, o) => s + o.text.length, 0);
    return Math.max(first ? 3.8 : 2.8, Math.min(13, (first ? 2.8 : 2.0) + chars * 0.075));
  }
  // 날아오던 불덩이를 모두 없앤다(정답을 고르는 동안 맞지 않도록)
  function clearBalls() {
    for (const b of balls) { engine.particles.emit(b.m.position, 6, { colors: ['#ffb040', '#fff'], speed: 2, up: 2, life: 0.4 }); scene.remove(b.m); scene.remove(b.mark); }
    balls.length = 0;
  }
  function startStep(first, quick = false) {
    clearBalls();
    step = run.step;
    const sl = stepSlots(step);
    const colW = Math.min(1.5, (FW * 2) / sl.n);
    const g = new T.Group();
    const orbs = [];
    sl.opts.forEach((o, i) => {
      const x = (i - (sl.n - 1) / 2) * colW;
      if (!o) return;
      const strip = new T.Mesh(stripGeo, new T.MeshBasicMaterial({ color: sl.colors[i], transparent: true, opacity: 0.3, depthWrite: false }));
      strip.rotation.x = -Math.PI / 2; strip.scale.set(colW * 0.9, PZ - EZ - 1, 1); strip.position.set(x, 0.04, (PZ + EZ + 1) / 2);
      scene.add(strip);
      const orb = new T.Group();
      orb.add(new T.Mesh(orbGeo, glowMat(sl.colors[i], 1.15)));
      const sp = textSprite(sl.labels[i], { w: 256, h: 256, size: sl.short ? [0, 120, 110, 76, 56][sl.labels[i].length] || 56 : 170, color: '#fff', stroke: 'rgba(0,0,0,.4)', scale: 0.95 });
      sp.position.set(0, 0.25, 0.55); sp.renderOrder = 5; orb.add(sp);
      orb.position.set(x, 1.0, EZ + 1.4);
      scene.add(orb);
      orbs.push({ orb, strip, x, opt: o, slot: i, color: sl.colors[i] });
    });
    const time = quick ? 4 : readTime(first);
    wave = { orbs, colW, z: EZ + 1.4, z0: EZ + 1.4, speed: (PZ - (EZ + 1.4)) / time, sl };
    const hint = '불덩이를 피하면서, 정답 구슬이 올 때 그 줄에 서세요';
    hud.showQuestion(run.q, step, { opts: true, hint });
    if (foe) foe.a.once('Spellcast_Raise', 'Idle', { speed: 1.8 });
    sfx.play('gate');
  }
  function clearWave() {
    if (!wave) return;
    for (const o of wave.orbs) { scene.remove(o.orb); scene.remove(o.strip); disposeScene(o.orb); o.strip.material.dispose(); }
    wave = null;
  }
  function resolveWave() {
    fireT = Math.max(fireT, 1.4); // 답한 직후 잠깐 숨 돌릴 틈
    const w = wave;
    let best = null, bd = 1e9;
    for (const o of w.orbs) { const d = Math.abs(o.x - px); if (d < bd) { bd = d; best = o; } }
    let chosen = best && bd <= w.colW * 0.55 ? best : null;
    if (AUTO) chosen = w.orbs.find((o) => o.opt.correct) || chosen; // 테스트용: 자동 정답
    const wasWho = step.isWho;
    const res = run.answer(chosen ? chosen.opt : null);
    // 문제의 마지막 단계까지 모두 맞혀야 상대 체력이 깎인다(여러 단계 문제는 2칸)
    const dmg = res.ok && res.done && run.allOk ? (run.steps.length > 1 ? 2 : 1) : 0;
    const cs = w.sl.opts.findIndex((o) => o && o.correct);
    hud.markOption(cs, 'right');
    wave = null;
    const pos = new T.Vector3(px, 1.2, PZ);
    for (const o of w.orbs) {
      scene.remove(o.strip); o.strip.material.dispose();
      if (o === chosen && res.ok) {
        // 받아쳐서 상대에게 날린다
        const from = o.orb.position.clone(), to = new T.Vector3(foe ? foe.a.root.position.x : 0, 1.4, EZ);
        engine.tween(0.32, (k) => { o.orb.position.lerpVectors(from, to, k); o.orb.position.y += Math.sin(k * Math.PI) * 1.2; }, { ease: ease.lin, done: () => { scene.remove(o.orb); disposeScene(o.orb); strikeFoe(dmg); } });
      } else {
        const keep = !res.ok && o.slot === cs;   // 틀렸을 때 정답 구슬을 잠깐 보여 준다
        const s0 = o.orb.scale.x;
        engine.tween(0.25, (k) => o.orb.scale.setScalar(s0 * (1 - k)), { delay: keep ? 0.9 : 0, done: () => { scene.remove(o.orb); disposeScene(o.orb); } });
      }
    }
    if (res.ok) {
      sfx.play('correct'); hud.flash(true);
      hero.once('1H_Melee_Attack_Slice_Horizontal', 'Idle', { speed: 1.8, fade: 0.05 });
      engine.particles.emit(pos, 30, { colors: CONFETTI, speed: 4, up: 4, life: 0.8 });
    } else {
      sfx.play('wrong');
      hurt(pos);
    }
    if (wasWho && foe) {
      foe.a.setSilhouette(false);
      foe.label = `${w.sl.opts[cs].text} 흉내`; drawFoePlate();
      poof(foe.a.root.position, res.ok ? CONFETTI : ['#ffffff', '#c9b8ff']);
    }
    if (over) return;
    if (res.done) engine.wait(0.5, finishQuestion);
    else engine.wait(0.55, () => { if (!over && run) startStep(false); });
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
    const real = Math.min(f.hp, dmg);
    f.hp -= real; drawFoePlate();
    dealt += real; hud.setExtra(`💥 ${dealt} · 격파 ${wins}`); hud.setGameScore(dealt);
    if (dmg > 1) hud.center('연속 타격!', 700);
    if (f.hp <= 0) {
      f.ready = false;
      f.a.once('Death_A', null);
      wins++; hud.setExtra(`💥 ${dealt} · 격파 ${wins}`);
      sfx.play('win'); hero.once('Cheer', 'Idle');
      engine.wait(1.0, () => { poof(f.a.root.position, CONFETTI); scene.remove(f.a.root); if (foe === f) foe = null; drawFoePlate(); if (!over) spawnFoe(); });
    } else f.a.once('Hit_A', 'Idle');
  }

  function finishQuestion() {
    if (!run || over) return;
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    hud.toast(ok, q, ok ? 1300 : 3800);
    hud.clearQuestion();
    if (foe && foe.a.sil) { foe.a.setSilhouette(false); }
    if (foe) { foe.label = foe.base; drawFoePlate(); }
    run = null;
    nextQ = ok ? 2.2 : 4.0;
  }
  function finish() { if (!ended) { ended = true; onEnd({ score: dealt, extra: `입힌 피해 ${dealt} · 격파한 상대 ${wins}명` }); } }

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

    if (!over) {
      // 불덩이는 문제를 읽는 동안에도 계속 날아온다
      const hard = Math.min(1, wins / 4 + session.count / 30);
      fireT -= dt;
      // 정답 구슬이 다가오는 동안에는 공격하지 않는다
      if (fireT <= 0 && foe && foe.ready && !wave) {
        if (Math.random() < 0.15 + hard * 0.25) { for (const d of [-1.3, 0, 1.3]) fire(Math.max(-FW, Math.min(FW, px + d))); }
        else fire(Math.max(-FW, Math.min(FW, px + rnd(-0.5, 0.5))));
        fireT = 1.15 - hard * 0.45 + rnd(0, 0.3);
      }
      // 문제
      if (!run) {
        nextQ -= dt;
        if (nextQ <= 0 && foe && foe.ready) {
          run = new QRun(session.next());
          if (run.q.type === 'passage') { foe.a.setSilhouette(true); foe.label = '???'; drawFoePlate(); poof(foe.a.root.position, ['#1b1630', '#6a5d86']); }
          // 게임을 멈추고 문제를 먼저 읽게 한다. Ready!를 누르면 정답 구슬이 다가온다.
          engine.paused = true; dragging = false; keyDir = 0;
          hud.preview(run.q, () => { engine.paused = false; startStep(true, true); }, '누르면 정답 구슬이 다가옵니다. 불덩이를 피하면서 정답 줄에 서세요.');
        }
      } else if (wave) {
        wave.z += wave.speed * dt;
        for (const o of wave.orbs) { o.orb.position.z = wave.z; o.orb.position.y = 1.0 + Math.sin(t * 3 + o.x) * 0.12; o.orb.children[0].rotation.y += dt * 1.5; }
        hud.timer(1 - (wave.z - wave.z0) / (PZ - wave.z0));
        if (wave.z >= PZ - 0.25) resolveWave();
      }
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

    camera.position.set(px * 0.25, 10.5, 9.6);
    camera.lookAt(px * 0.15, 0, -2.9);
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
      ballGeo.dispose(); markGeo.dispose(); orbGeo.dispose(); stripGeo.dispose();
      disposeScene(scene);
    },
  };
  return { stage, quit() { over = true; finish(); } };
}
