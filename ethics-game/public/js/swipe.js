// 게임 B: 개념 스와이프 (카드를 알맞은 방향의 포털로 보낸다)
import { T, engine, Actor, makeSky, addLights, toonMat, glowMat, textTexture, COLORS, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store } from './core.js';
import { hexIsland, makeClouds, place } from './scenery.js';

const DIRS = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
const ARROW = { left: '←', right: '→', up: '↑', down: '↓' };
const LAYOUT = { 2: ['left', 'right'], 3: ['left', 'up', 'right'], 4: ['left', 'up', 'right', 'down'] };
const SHORT = 8; // 이 글자 수 이하의 보기만 포털에 직접 표시

export function createSwipe({ session, hud, onEnd }) {
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xffc4dc, 30, 150);
  makeSky(scene, 0x5b3fd6, 0xffb9d6, 0xffe6c2);
  const sun = addLights(scene, { sun: 0xfff0e2, sunI: 1.9, sky: 0xffe9f4, ground: 0x9fd08a, hemiI: 1.3, pos: [-6, 12, 9], area: 10, far: 50 });
  const camera = new T.PerspectiveCamera(60, 1, 0.1, 800);

  // 떠 있는 섬
  const island = new T.Group();
  island.add(hexIsland(1, 2));
  place(island, 'trees_B_large', 2.2, -3.2, 0, -2.6);
  place(island, 'tree_single_A', 2.8, 3.4, 0, -2.4);
  place(island, 'tree_single_B', 2.3, -4.3, 0, 0.8);
  place(island, 'tent', 3.2, 1.6, 0, -3.4, -0.4);
  place(island, 'flag_blue', 3.6, 3.9, 0, 0.6, -0.5);
  place(island, 'flag_red', 3.6, -2.2, 0, -4.2, 0.4);
  place(island, 'rock_single_C', 3.4, 3.0, 0, 2.8);
  place(island, 'crate_A_big', 3, -3.4, 0, 2.6, 0.5);
  place(island, 'target', 3.4, 0.2, 0, -4.4);
  place(island, 'rock_single_B', 4, -2.6, 0, 4.6, 1); place(island, 'rock_single_E', 3, 3.4, 0, 5.2, 2);
  place(island, 'barrel', 3, -1.4, 0, 5.6); place(island, 'sack', 5, -0.7, 0, 5.9, 0.8); place(island, 'bucket_water', 4, 3.6, 0, 3.6);
  island.position.set(0, -1.6, -3.5);
  scene.add(island);
  // 멀리 떠 있는 작은 섬들
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
  actor.root.position.set(1.9, 0, 3.4);
  actor.root.rotation.y = -0.7;
  actor.play('Idle');
  island.add(actor.root);

  // 카드
  const CARD = { w: 1.9, h: 2.5 };
  const home = new T.Vector3(0, 3.2, 3.2);
  const card = new T.Group();
  const body = new T.Mesh(new T.RoundedBoxGeometry(CARD.w, CARD.h, 0.08, 3, 0.14), toonMat(0x7c5cff));
  body.castShadow = true; body.userData.ownGeo = true;
  const faceMat = new T.MeshBasicMaterial({ toneMapped: false, color: 0xdcdcdc });
  const face = new T.Mesh(new T.PlaneGeometry(CARD.w - 0.16, CARD.h - 0.16), faceMat);
  face.position.z = 0.045; face.userData.ownGeo = true;
  card.add(body, face);
  card.position.copy(home);
  card.visible = false;
  scene.add(card);
  function setCardText(text, tint = '#fffaf0', sub = null) {
    if (faceMat.map) faceMat.map.dispose();
    faceMat.map = textTexture(text, { w: 512, h: 690, size: 78, min: 34, color: '#2b2140', bg: tint, border: '#2b2140', radius: 44, pad: 40, sub });
    faceMat.needsUpdate = true;
  }

  // 포털
  const portals = {};
  const PORTAL_POS = { left: [-2.15, 0, 0], right: [2.15, 0, 0], up: [0, 2.25, -0.3], down: [0, -2.3, 0.2] };
  for (const d of Object.keys(DIRS)) {
    const g = new T.Group();
    const ring = new T.Mesh(new T.TorusGeometry(0.62, 0.09, 10, 36), glowMat('#fff', 1.4));
    const disc = new T.Mesh(new T.CircleGeometry(0.56, 28), new T.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    ring.userData.ownGeo = disc.userData.ownGeo = true;
    g.add(ring, disc);
    g.position.set(home.x + PORTAL_POS[d][0], home.y + PORTAL_POS[d][1], home.z + PORTAL_POS[d][2]);
    if (d === 'left') g.rotation.y = 0.5; if (d === 'right') g.rotation.y = -0.5;
    if (d === 'up') g.rotation.x = 0.4; if (d === 'down') g.rotation.x = -0.6;
    g.visible = false;
    scene.add(g);
    portals[d] = { g, ring, disc, tag: null, opt: null, color: '#fff' };
  }

  // 상태
  let lives = 3, combo = 0, run = null, step = null, mode = '4dir', seq = null;
  let locked = true, timeLeft = 0, timeMax = 1, over = false, ended = false, t = 0;
  let drag = null, offset = new T.Vector2(), hot = null;
  hud.setHearts(lives); hud.setScore(0);

  // 방향 태그(DOM)
  const tags = {};
  for (const d of Object.keys(DIRS)) {
    const el = document.createElement('button');
    el.className = 'dir-tag';
    el.style.display = 'none';
    el.onclick = () => { if (!locked) commit(d); };
    hud.ui.appendChild(el);
    tags[d] = el;
  }
  const _p = {};
  function placeTags() {
    for (const d of Object.keys(DIRS)) {
      const p = portals[d];
      engine.project(p.g.position, _p);
      const el = tags[d];
      let x = _p.x, y = _p.y;
      if (d === 'left') x = Math.max(x, 46); if (d === 'right') x = Math.min(x, innerWidth - 46);
      if (d === 'up') y -= 4; if (d === 'down') y += 4;
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
  }
  function setPortals(map) {
    // map: { dir: { text, color, opt } }
    for (const d of Object.keys(DIRS)) {
      const p = portals[d], m = map[d], el = tags[d];
      p.opt = m ? m.opt : null;
      p.g.visible = !!m;
      el.className = 'dir-tag' + (d === 'up' || d === 'down' ? ' wide' : '') + (m && m.text.length <= 6 ? ' short' : '');
      if (!m) { el.style.display = 'none'; continue; }
      p.color = m.color;
      p.ring.material.color.set(m.color).multiplyScalar(1.5);
      p.disc.material.color.set(m.color);
      el.style.display = '';
      el.style.background = m.color;
      el.textContent = m.text;
      const g = p.g; g.scale.setScalar(0.01);
      engine.tween(0.3, (k) => g.scale.setScalar(k), { ease: ease.back });
    }
  }

  function stepTime(chars) {
    const scale = Math.max(0.65, 1 - session.count * 0.018);
    return Math.max(3.2, (3.6 + chars * 0.09) * scale);
  }

  function nextQuestion() {
    if (over) return;
    run = new QRun(session.next());
    showStep();
  }

  function showStep() {
    step = run.step;
    const allShort = step.options.every((o) => o.text.length <= SHORT);
    seq = null;
    let cardText, cfg;
    if (step.kind === 'ox' || step.kind === 'tf') {
      mode = '4dir';
      const [o, x] = step.options;
      setPortals({ right: { text: step.kind === 'ox' ? 'O →' : '옳음 →', color: COLORS[1], opt: o }, left: { text: step.kind === 'ox' ? '← X' : '← 틀림', color: COLORS[0], opt: x } });
      cardText = step.kind === 'ox' ? step.prompt : step.sub;
      cfg = { prompt: step.kind !== 'ox', sub: false, hint: '맞으면 오른쪽, 틀리면 왼쪽으로 밀기' };
    } else if (allShort) {
      mode = '4dir';
      const n = step.slots || step.options.length;
      const map = {};
      step.options.forEach((o, k) => { const i = o.slot ?? k; const d = LAYOUT[n][i]; map[d] = { text: o.text, color: COLORS[i], opt: o }; });
      setPortals(map);
      cardText = step.sub || step.prompt;
      cfg = { prompt: !!step.sub, sub: false, hint: '카드를 알맞은 방향으로 밀기' };
    } else {
      // 보기가 긴 문제: 보기를 한 장씩 보여 주고 정답만 오른쪽으로
      mode = 'seq';
      seq = { opts: step.options.slice(), i: 0 };
      setPortals({ right: { text: '정답 →', color: COLORS[1], opt: null }, left: { text: '← 아님', color: COLORS[0], opt: null } });
      cardText = seq.opts[0].text;
      cfg = { prompt: true, sub: false, hint: '정답 카드만 오른쪽으로, 나머지는 왼쪽으로' };
    }
    hud.showQuestion(run.q, step, cfg);
    dealCard(cardText, mode === 'seq' ? { text: `보기 1 / ${seq.opts.length}` } : null);
  }

  function dealCard(text, sub = null) {
    setCardText(text, '#fffaf0', sub);
    card.visible = true;
    offset.set(0, 0);
    card.position.set(home.x, home.y - 4.5, home.z + 1);
    card.rotation.set(0.6, 0, 0.3);
    card.scale.setScalar(1);
    const from = card.position.clone();
    engine.tween(0.3, (k) => { card.position.lerpVectors(from, home, k); card.rotation.set(0.6 * (1 - k), 0, 0.3 * (1 - k)); }, { ease: ease.back, done: () => { locked = false; } });
    timeMax = timeLeft = stepTime(text.length + (mode === '4dir' ? 6 : 0));
    hud.timer(1);
    sfx.play('swipe');
  }

  function flyTo(dir, dur, done) {
    const p = portals[dir];
    const from = card.position.clone(), to = p.g.position.clone();
    const r0 = card.rotation.z;
    engine.tween(dur, (k) => {
      card.position.lerpVectors(from, to, k);
      card.scale.setScalar(1 - 0.85 * k);
      card.rotation.z = r0 + k * 2.5 * (DIRS[dir][0] || 1);
    }, { ease: ease.inOut, done: () => { card.visible = false; burst(dir); if (done) done(); } });
  }
  function burst(dir, colors) {
    const p = portals[dir];
    engine.particles.emit(p.g.position, 26, { colors: colors || [p.color, '#ffffff'], speed: 3.5, up: 2.5, gravity: 5, life: 0.7 });
    engine.tween(0.3, (k) => p.g.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.5));
  }
  function dirOf(opt) { return Object.keys(DIRS).find((d) => portals[d].opt === opt); }

  function good() {
    combo++; hud.setCombo(combo); hud.flash(true); sfx.play('correct');
    actor.once(combo % 5 === 0 ? 'Cheer' : 'Spellcast_Shoot', 'Idle', { speed: 1.3 });
    if (combo % 5 === 0) engine.particles.emit(new T.Vector3(0, 4, 2), 60, { colors: CONFETTI, speed: 5, up: 6, life: 1.2 });
  }
  function bad() {
    combo = 0; hud.setCombo(0); hud.flash(false); sfx.play('wrong'); engine.shake(0.3);
    actor.once('Hit_A', 'Idle'); actor.flash();
  }
  function afterStep(res) {
    if (res.done) finishQuestion(); else showStep();
  }

  // dir가 null이면 시간 초과
  function commit(dir) {
    if (locked || over) return;
    locked = true;
    if (mode === 'seq') return commitSeq(dir);
    const opt = dir ? portals[dir].opt : null;
    const res = run.answer(opt);
    const cd = dirOf(res.correct);
    if (res.ok) {
      good();
      flyTo(dir, 0.26, () => engine.wait(0.12, () => afterStep(res)));
    } else {
      bad();
      setCardText(step.sub || step.prompt, '#ffd9de');
      tags[cd].classList.add('right');
      const back = card.position.clone();
      engine.tween(0.25, (k) => card.position.lerpVectors(back, home, k), { done: () => flyTo(cd, 0.55, () => engine.wait(0.25, () => afterStep(res))) });
    }
  }
  function commitSeq(dir) {
    const opt = seq.opts[seq.i];
    const next = () => {
      seq.i++;
      dealCard(seq.opts[seq.i].text, { text: `보기 ${seq.i + 1} / ${seq.opts.length}` });
    };
    if (dir === 'right') {
      const res = run.answer(opt);
      if (res.ok) { good(); flyTo('right', 0.26, () => engine.wait(0.12, () => afterStep(res))); }
      else { bad(); setCardText(opt.text, '#ffd9de'); flyTo('left', 0.5, () => engine.wait(0.2, () => afterStep(res))); }
    } else if (dir === 'left' && !opt.correct && seq.i < seq.opts.length - 1) {
      sfx.play('tick');
      flyTo('left', 0.22, next);
    } else {
      // 정답 카드를 버렸거나 시간 초과
      const res = run.answer(null);
      bad();
      setCardText(res.correct.text, '#d9f7e6', { text: '이 카드가 정답', color: '#129a55' });
      const back = card.position.clone();
      engine.tween(0.25, (k) => card.position.lerpVectors(back, home, k), { done: () => engine.wait(0.7, () => flyTo('right', 0.4, () => afterStep(res))) });
    }
  }

  function finishQuestion() {
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    run = null;
    for (const d of Object.keys(DIRS)) { tags[d].style.display = 'none'; portals[d].g.visible = false; }
    if (!ok) {
      lives--; hud.setHearts(lives);
      hud.toast(false, q, 3200);
      if (lives <= 0) return die();
      engine.wait(2.6, () => { hud.hideToast(); nextQuestion(); });
    } else {
      engine.wait(0.35, nextQuestion);
    }
    hud.clearQuestion();
  }
  function die() {
    over = true;
    sfx.play('lose');
    actor.once('Death_A', null);
    engine.wait(2.4, finish);
  }
  function finish() {
    if (ended) return;
    ended = true;
    onEnd({});
  }

  // ---------- 입력 ----------
  const onDown = (e) => {
    if (locked || over || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    offset.set(e.clientX - drag.x, e.clientY - drag.y);
  };
  const dirFromOffset = () => {
    const ax = Math.abs(offset.x), ay = Math.abs(offset.y);
    if (Math.max(ax, ay) < 56) return null;
    return ax >= ay ? (offset.x > 0 ? 'right' : 'left') : (offset.y > 0 ? 'down' : 'up');
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    const d = dirFromOffset();
    if (d && portals[d].g.visible && !locked) commit(d);
    offset.set(0, 0);
  };
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const onKey = (e) => { const d = KEYS[e.key]; if (d && !locked && portals[d].g.visible) { e.preventDefault(); commit(d); } };
  addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKey);

  let started = false;
  function update(dt) {
    t += dt;
    if (!started && t > 0.5) { started = true; nextQuestion(); }
    island.position.y = -1.6 + Math.sin(t * 0.8) * 0.15;
    minis.forEach((m, i) => { m.position.y += Math.sin(t * 0.6 + i * 2) * 0.004; m.rotation.y += dt * 0.05; });
    clouds.update(dt);
    actor.update(dt);
    for (const d of Object.keys(DIRS)) { const p = portals[d]; p.ring.rotation.z += dt * 1.5; p.disc.material.opacity = 0.38 + Math.sin(t * 4 + p.g.position.x) * 0.12; }
    // 카드 끌기
    if (!locked && card.visible) {
      const k = 0.0075;
      const tx = home.x + offset.x * k, ty = home.y - offset.y * k + Math.sin(t * 2.2) * 0.05;
      card.position.x += (tx - card.position.x) * Math.min(1, dt * 22);
      card.position.y += (ty - card.position.y) * Math.min(1, dt * 22);
      card.rotation.z = -offset.x * 0.0022;
      card.rotation.y = Math.sin(t * 1.3) * 0.06 + offset.x * 0.001;
      const h = drag ? dirFromOffset() : null;
      if (h !== hot) {
        if (hot) tags[hot].classList.remove('hot');
        hot = h && portals[h].g.visible ? h : null;
        if (hot) tags[hot].classList.add('hot');
      }
      timeLeft -= dt;
      hud.timer(timeLeft / timeMax);
      if (timeLeft <= 0) { drag = null; offset.set(0, 0); commit(null); }
    }
    const sway = Math.sin(t * 0.3) * 0.25;
    camera.position.set(sway, 4.4, 11.2);
    camera.lookAt(0, 3.75, 0);
    camera.updateMatrixWorld();
    placeTags();
  }

  const stage = {
    scene, camera, sun, update,
    bloom: { strength: 0.4, threshold: 0.93, radius: 0.7 },
    onResize(w, h) { camera.fov = w / h < 0.8 ? 62 : 44; },
    dispose() {
      removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      removeEventListener('keydown', onKey);
      if (faceMat.map) faceMat.map.dispose();
      disposeScene(scene);
    },
  };
  return { stage, quit() { over = true; finish(); } };
}
