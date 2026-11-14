// 게임 B: 개념 슬래시
// 물건이 계속 튀어 오르고, 손가락으로 그어서 벤다. 문제가 나오면 정답 구슬만 베어야 한다.
import { T, engine, Actor, makeSky, addLights, toonMat, glowMat, textSprite, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store, stepSlots } from './core.js';
import { hexIsland, makeClouds, place } from './scenery.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const FILLERS = [['crate_A_big', 3.6], ['crate_B_big', 3.6], ['barrel', 4], ['sack', 6.5], ['bucket_water', 5.5], ['target', 3], ['crate_A_small', 5]];
const GRAV = 6.2;
const FIELD_W = 2.0;   // 구슬이 날아다니는 가로 반폭
const PLANE_Z = 3;
const ANSWER_G = 0.5;
const WAVE = 4.2;      // 정답 구슬 묶음이 다시 올라오는 간격(초)

export function createSlash({ session, hud, onEnd }) {
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xffc4dc, 30, 150);
  makeSky(scene, 0x5b3fd6, 0xffb9d6, 0xffe6c2);
  const sun = addLights(scene, { sun: 0xfff0e2, sunI: 1.9, sky: 0xffe9f4, ground: 0x9fd08a, hemiI: 1.3, pos: [-6, 12, 9], area: 10, far: 50 });
  const camera = new T.PerspectiveCamera(60, 1, 0.1, 800);

  const island = new T.Group();
  island.add(hexIsland(1, 2));
  place(island, 'trees_B_large', 2.2, -3.2, 0, -2.6); place(island, 'tree_single_A', 2.8, 3.4, 0, -2.4);
  place(island, 'tree_single_B', 2.3, -4.3, 0, 0.8); place(island, 'tent', 3.2, 1.6, 0, -3.4, -0.4);
  place(island, 'flag_blue', 3.6, 3.9, 0, 0.6, -0.5); place(island, 'flag_red', 3.6, -2.2, 0, -4.2, 0.4);
  place(island, 'rock_single_C', 3.4, 3.0, 0, 2.8); place(island, 'weaponrack', 3.6, -3.2, 0, 2.6, 0.9);
  place(island, 'rock_single_B', 4, -2.6, 0, 4.6, 1); place(island, 'rock_single_E', 3, 3.4, 0, 5.2, 2);
  island.position.set(0, -1.6, -3.5);
  scene.add(island);
  const minis = [];
  for (const [x, y, z, s] of [[-14, 3, -26, 1.6], [16, -2, -34, 2], [-22, -5, -48, 2.4], [10, 7, -55, 2]]) {
    const g = new T.Group();
    g.add(hexIsland(0, s));
    place(g, Math.random() < 0.5 ? 'trees_A_small' : 'building_tower_A_blue', s * 0.9, 0, 0, 0, Math.random() * 6);
    g.position.set(x, y, z);
    scene.add(g); minis.push(g);
  }
  const clouds = makeClouds(scene, 12, { x: 45, yMin: -14, yMax: 2, zMin: -60, zMax: -2, scale: [2, 5] });

  const actor = new Actor(store.d.opts.char);
  actor.root.scale.setScalar(0.95);
  actor.root.position.set(0, 0, 4.2);
  actor.play('Idle');
  island.add(actor.root);

  // 공용 형상
  const orbGeo = new T.IcosahedronGeometry(0.46, 2);
  const ringGeo = new T.TorusGeometry(0.62, 0.05, 8, 28);
  const bombGeo = new T.IcosahedronGeometry(0.42, 0);
  const bombMat = toonMat(0x2b2140, { emissive: 0xff2244, emissiveIntensity: 0.5 });
  const spikeMat = glowMat(0xff3355, 1.6);

  // 상태
  let lives = 3, combo = 0, sliced = 0, over = false, ended = false, t = 0;
  let run = null, step = null, slots = null, answering = false;
  let readLeft = 0, waveLeft = 0, wavesLeft = 0, stepMax = 1, stepLeft = 0;
  let fillT = 1, bombT = 6, nextQ = 1.2;
  const things = [];
  hud.setHearts(lives); hud.setScore(0); hud.setExtra('🗡️ 0');

  // 베는 궤적(2D 캔버스)
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  hud.ui.appendChild(cv);
  const ctx = cv.getContext('2d');
  const trail = [];
  function sizeTrail() { const d = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * d; cv.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  sizeTrail();

  function toss(o, kind, extra = {}) {
    const x = extra.x ?? rnd(-FIELD_W, FIELD_W);
    const apex = extra.apex ?? rnd(1.4, 4.0);          // 도달할 최고 높이(월드 y)
    const y0 = -2.6;
    const gk = kind === 'answer' ? ANSWER_G : 1;       // 정답 구슬은 천천히 움직여 읽을 시간을 준다
    const vy = Math.sqrt(2 * GRAV * gk * (apex - y0));
    const th = { o, kind, r: extra.r ?? 0.55, vel: new T.Vector3((extra.tx ?? rnd(-FIELD_W, FIELD_W)) - x, vy, 0), spin: new T.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)), dead: false, ...extra };
    th.vel.x /= (2 * vy) / (GRAV * gk);                       // 떠 있는 동안 tx까지 이동
    if (extra.still) th.vel.x = 0;
    o.position.set(x, y0, PLANE_Z);
    scene.add(o);
    things.push(th);
    return th;
  }
  function tossFiller() {
    const [name, s] = pick(FILLERS);
    const o = engine.prop(name, s);
    toss(o, 'filler');
  }
  function tossBomb() {
    const g = new T.Group();
    g.add(new T.Mesh(bombGeo, bombMat));
    for (let i = 0; i < 6; i++) {
      const sp = new T.Mesh(new T.ConeGeometry(0.1, 0.3, 6), spikeMat); sp.userData.ownGeo = true;
      const d = new T.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * (i + 0.5) / 6), i * 2.4);
      sp.position.copy(d).multiplyScalar(0.48); sp.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
      g.add(sp);
    }
    toss(g, 'bomb', { r: 0.5 });
    sfx.play('tick');
  }
  function tossAnswers() {
    const { n, opts, colors, labels, short } = slots;
    const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    const span = Math.min(3.1, (n - 1) * 1.15);
    order.forEach((slot, k) => {
      const o = opts[slot];
      if (!o) return;
      const g = new T.Group();
      const orb = new T.Mesh(orbGeo, glowMat(colors[slot], 1.15)); g.add(orb);
      const ring = new T.Mesh(ringGeo, glowMat('#ffffff', 1.3)); g.add(ring);
      const s = textSprite(labels[slot], { w: 256, h: 256, size: short ? [0, 120, 110, 76, 56][labels[slot].length] || 56 : 170, color: '#fff', stroke: 'rgba(0,0,0,.4)', scale: 0.8 });
      s.position.z = 0.6; s.renderOrder = 5; g.add(s);
      const x = n === 1 ? 0 : -span / 2 + (span * k) / (n - 1);
      toss(g, 'answer', { x, still: true, apex: rnd(2.4, 3.3), r: 0.55, opt: o, slot, color: colors[slot], noSpin: true, ring });
    });
    sfx.play('gate');
  }

  function readTime(first) {
    let chars = (step.sub || '').length;
    if (first || step.passage) chars += step.prompt.length;
    if (first && step.passage) chars += step.passage.length;
    if (!step.fixed || first) chars += step.options.reduce((s, o) => s + o.text.length, 0);
    return Math.max(first ? 2.4 : 1.4, Math.min(10, (first ? 1.6 : 1.0) + chars * 0.07));
  }
  function startStep(first) {
    step = run.step;
    slots = stepSlots(step);
    answering = true;
    readLeft = readTime(first);
    wavesLeft = 2; waveLeft = 0;
    stepMax = stepLeft = readLeft + wavesLeft * WAVE;
    const hint = step.kind === 'ox' ? '맞으면 O 구슬, 틀리면 X 구슬을 베세요'
      : step.kind === 'tf' ? '옳으면 초록, 틀리면 빨강 구슬을 베세요'
        : '정답 구슬만 베세요 (다른 물건은 계속 베어도 됩니다)';
    hud.showQuestion(run.q, step, { opts: true, hint });
  }
  function clearAnswers(exceptSlot = -1) {
    for (const th of things) if (th.kind === 'answer' && !th.dead && th.slot !== exceptSlot) { th.dead = true; popOut(th, 0.2); }
  }
  function popOut(th, dur) {
    const s0 = th.o.scale.x;
    engine.tween(dur, (k) => th.o.scale.setScalar(s0 * (1 - k)), { done: () => removeThing(th) });
  }
  function removeThing(th) {
    scene.remove(th.o); disposeScene(th.o);
    const i = things.indexOf(th); if (i >= 0) things.splice(i, 1);
  }

  function resolve(opt, th) {
    if (!answering) return;
    answering = false;
    const res = run.answer(opt);
    const cs = slots.opts.findIndex((o) => o && o.correct);
    hud.markOption(cs, 'right');
    hud.flash(res.ok);
    if (res.ok) {
      combo++; hud.setCombo(combo); sfx.play('correct');
      engine.particles.emit(th.o.position, 44, { colors: CONFETTI, speed: 5, up: 4, life: 0.9 });
      actor.once(combo % 5 === 0 ? 'Cheer' : '1H_Melee_Attack_Slice_Horizontal', 'Idle', { speed: 1.4 });
      clearAnswers();
    } else {
      combo = 0; hud.setCombo(0); sfx.play('wrong'); engine.shake(0.35);
      actor.once('Hit_A', 'Idle'); actor.flash();
      clearAnswers(cs);   // 정답 구슬은 잠깐 남겨서 보여 준다
      for (const a of things) if (a.kind === 'answer' && a.slot === cs && !a.dead) { a.dead = true; a.vel.set(0, 1.5, 0); engine.wait(0.8, () => popOut(a, 0.25)); }
    }
    if (res.done) engine.wait(res.ok ? 0.3 : 0.9, finishQuestion);
    else engine.wait(res.ok ? 0.35 : 1.0, () => { if (!over && run) startStep(false); });
  }
  function finishQuestion() {
    if (!run) return;
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    hud.toast(ok, q, ok ? 1300 : 3800);
    hud.clearQuestion();
    run = null;
    if (!ok) hurt();
    nextQ = ok ? 2.4 : 4.2;   // 다음 문제 전까지는 물건만 벤다
  }
  function hurt() {
    lives--; hud.setHearts(lives);
    if (lives <= 0) {
      over = true; answering = false;
      sfx.play('lose'); actor.once('Death_A', null); hud.clearQuestion();
      engine.wait(2.2, finish);
    }
  }
  function finish() { if (!ended) { ended = true; onEnd({ score: sliced, extra: `벤 물건 ${sliced}개` }); } }

  function slice(th) {
    if (th.dead || over) return;
    if (th.kind === 'answer') { if (answering) { th.dead = true; popOut(th, 0.15); resolve(th.opt, th); } return; }
    th.dead = true;
    if (th.kind === 'filler') {
      sliced++; hud.setExtra('🗡️ ' + sliced);
      combo++; hud.setCombo(combo); sfx.play('coin');
      engine.particles.emit(th.o.position, 16, { colors: ['#c98b4f', '#ffe9a8', '#fff'], speed: 4, up: 3, life: 0.6 });
      popOut(th, 0.12);
    } else {
      combo = 0; hud.setCombo(0); sfx.play('hit'); engine.shake(0.5); hud.flash(false);
      engine.particles.emit(th.o.position, 30, { colors: ['#ff3355', '#2b2140', '#ffc93c'], speed: 6, up: 4, life: 0.7 });
      actor.once('Hit_A', 'Idle'); actor.flash();
      popOut(th, 0.1);
      hurt();
    }
  }

  // ---------- 입력 ----------
  const _p = {}, _v = new T.Vector3();
  function hitTest(x0, y0, x1, y1) {
    for (const th of things) {
      if (th.dead) continue;
      engine.project(th.o.position, _p);
      const cx = _p.x, cy = _p.y;
      _v.copy(th.o.position); _v.x += th.r;
      const rp = Math.abs(engine.project(_v, {}).x - cx) * 1.2 + 6;
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
      const k = l2 ? Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / l2)) : 0;
      const px = x0 + k * dx, py = y0 + k * dy;
      if ((px - cx) ** 2 + (py - cy) ** 2 < rp * rp) slice(th);
    }
  }
  let last = null;
  const onDown = (e) => { if (e.target.closest('button')) return; last = { x: e.clientX, y: e.clientY, id: e.pointerId }; trail.push({ x: e.clientX, y: e.clientY, t }); hitTest(e.clientX, e.clientY, e.clientX, e.clientY); };
  const onMove = (e) => {
    if (!last || e.pointerId !== last.id) return;
    hitTest(last.x, last.y, e.clientX, e.clientY);
    if ((e.clientX - last.x) ** 2 + (e.clientY - last.y) ** 2 > 900 && Math.random() < 0.3) sfx.play('swipe');
    last.x = e.clientX; last.y = e.clientY;
    trail.push({ x: e.clientX, y: e.clientY, t });
  };
  const onUp = (e) => { if (last && e.pointerId === last.id) { last = null; trail.push(null); } };
  // 키보드(테스트/PC): 숫자 = 해당 번호 구슬, 스페이스 = 아무 물건
  const onKey = (e) => {
    if (e.key >= '1' && e.key <= '4') { const th = things.find((a) => a.kind === 'answer' && !a.dead && a.slot === Number(e.key) - 1); if (th) slice(th); }
    if (e.key === ' ') { const th = things.find((a) => a.kind === 'filler' && !a.dead); if (th) slice(th); }
  };
  addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKey); addEventListener('resize', sizeTrail);

  function update(dt) {
    t += dt;
    island.position.y = -1.6 + Math.sin(t * 0.8) * 0.15;
    minis.forEach((m, i) => { m.position.y += Math.sin(t * 0.6 + i * 2) * 0.004; m.rotation.y += dt * 0.05; });
    clouds.update(dt);
    actor.update(dt);

    if (!over) {
      // 물건은 쉬지 않고 올라온다(문제를 읽는 동안에도)
      const hard = Math.min(1, session.count / 14);
      fillT -= dt;
      if (fillT <= 0) { tossFiller(); if (Math.random() < 0.35) tossFiller(); fillT = rnd(0.55, 0.95) - hard * 0.2 + (answering && readLeft <= 0 ? 0.35 : 0); }
      bombT -= dt;
      if (bombT <= 0) { tossBomb(); bombT = rnd(3.2, 6) - hard * 1.5; }
      if (!run) {
        nextQ -= dt;
        if (nextQ <= 0) { run = new QRun(session.next()); startStep(true); }
      } else if (answering) {
        stepLeft -= dt;
        hud.timer(stepLeft / stepMax);
        if (readLeft > 0) readLeft -= dt;
        else {
          waveLeft -= dt;
          if (waveLeft <= 0) {
            if (wavesLeft > 0) { wavesLeft--; waveLeft = WAVE; tossAnswers(); }
            else { // 시간 초과
              const dummy = { o: { position: new T.Vector3(0, 3, PLANE_Z) } };
              resolve(null, dummy);
            }
          }
        }
      }
    }

    for (let i = things.length - 1; i >= 0; i--) {
      const th = things[i];
      th.vel.y -= GRAV * dt * (th.kind === 'answer' ? ANSWER_G : 1);
      th.o.position.addScaledVector(th.vel, dt);
      if (!th.noSpin) { th.o.rotation.x += th.spin.x * dt; th.o.rotation.y += th.spin.y * dt; th.o.rotation.z += th.spin.z * dt; }
      if (th.ring) { th.ring.rotation.x += dt * 2; th.ring.rotation.y += dt * 1.3; }
      if (th.o.position.y < -3.2 && th.vel.y < 0) removeThing(th);
    }

    // 궤적 그리기
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    while (trail.length && trail[0] && t - trail[0].t > 0.22) trail.shift();
    while (trail.length && trail[0] === null) trail.shift();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (!a || !b) continue;
      const k = 1 - (t - b.t) / 0.22;
      ctx.strokeStyle = `rgba(255,236,150,${0.5 * k})`; ctx.lineWidth = 18 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.95 * k})`; ctx.lineWidth = 7 * k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    const sway = Math.sin(t * 0.3) * 0.2;
    camera.position.set(sway, 3.4, 11.2);
    camera.lookAt(0, 2.2, 0);
    camera.updateMatrixWorld();
  }

  // 시간 흐름과 무관하게 answer 구슬은 천천히 떨어지도록(읽을 시간) 중력을 줄였다
  const stage = {
    scene, camera, sun, update,
    bloom: { strength: 0.4, threshold: 0.93, radius: 0.7 },
    onResize(w, h) { camera.fov = w / h < 0.8 ? 62 : 44; },
    dispose() {
      removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      removeEventListener('keydown', onKey); removeEventListener('resize', sizeTrail);
      orbGeo.dispose(); ringGeo.dispose(); bombGeo.dispose();
      disposeScene(scene);
    },
  };
  return { stage, quit() { over = true; finish(); } };
}
