// 게임 C: 논쟁 배틀 (턴제)
import { T, engine, Actor, makeSky, addLights, glowMat, COLORS, CONFETTI, sfx, ease, disposeScene } from './engine.js';
import { QRun, store, answerText } from './core.js';
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
  place(arena, 'weaponrack', 4.2, -5.2, 0, -1.2, 1.2); place(arena, 'target', 4, 5.4, 0, -0.6, -1.1);
  place(arena, 'rock_single_C', 4.5, -3.6, 0, 5.2, 1); place(arena, 'rock_single_E', 4, 3.9, 0, 5.8, 2); place(arena, 'resource_lumber', 3.4, -4.4, 0, 3.6, 0.5); place(arena, 'sack', 6, 3.2, 0, 4.4, 1);
  place(arena, 'barrel', 4, -4.6, 0, 1.6); place(arena, 'crate_A_big', 3.8, 4.8, 0, 2.2, 0.4); place(arena, 'crate_B_big', 3.4, 5.6, 0, 1.4);
  for (const [x, z, s] of [[-13, -8, 4], [13, -7, 4.4], [-12, 2, 3.6], [12.5, 3, 3.8], [-15, -14, 5], [15, -15, 5]]) place(arena, Math.random() < 0.5 ? 'trees_A_medium' : 'trees_B_large', s, x, 0, z, Math.random() * 6);
  scene.add(arena);
  // 횃불 느낌의 따뜻한 조명
  for (const x of [-5.5, 5.5]) {
    const l = new T.PointLight(0xffa040, 28, 16, 2); l.position.set(x, 2.6, -2.5); scene.add(l);
    const orb = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), glowMat(0xffb040, 2)); orb.position.copy(l.position); orb.userData.ownGeo = true; scene.add(orb);
  }
  const clouds = makeClouds(scene, 7, { x: 70, yMin: 16, yMax: 30, zMin: -90, zMax: -30, scale: [4, 8] });

  // 선수
  const P_POS = new T.Vector3(-1.5, 0, 1.2), E_POS = new T.Vector3(1.5, 0, -0.8);
  const hero = new Actor(store.d.opts.char);
  hero.root.scale.setScalar(0.95);
  hero.root.position.copy(P_POS);
  hero.root.lookAt(E_POS.x, 0, E_POS.z);
  hero.play('Idle');
  scene.add(hero.root);
  const foeOrder = Object.keys(FOES).filter((k) => k !== store.d.opts.char);
  let foe = null, foeIdx = 0;

  // 상태
  let lives = 3, wins = 0, run = null, over = false, ended = false, busy = true, t = 0;
  hud.setHearts(lives); hud.setScore(0); hud.setExtra('격파 0');

  // 이름표
  const mkPlate = () => { const el = document.createElement('div'); el.className = 'nameplate'; el.style.pointerEvents = 'none'; hud.ui.appendChild(el); return el; };
  const heroPlate = mkPlate(), foePlate = mkPlate();
  heroPlate.textContent = store.d.nickname || '나';
  function drawFoePlate() {
    if (!foe) { foePlate.innerHTML = ''; return; }
    foePlate.innerHTML = `<span>${esc(foe.label)}</span><div class="hp">${Array.from({ length: foe.max }, (_, i) => `<i class="${i < foe.hp ? '' : 'off'}"></i>`).join('')}</div>`;
  }
  const dock = document.createElement('div');
  dock.className = 'dock';
  hud.ui.appendChild(dock);

  function spawnFoe(done) {
    const name = foeOrder[foeIdx++ % foeOrder.length];
    const a = new Actor(name);
    a.root.scale.setScalar(0.95);
    const from = new T.Vector3(7.5, 0, -3.5);
    a.root.position.copy(from);
    a.root.lookAt(E_POS.x, 0, E_POS.z);
    a.play('Walking_A', { speed: 1.4 });
    scene.add(a.root);
    const hp = Math.min(5, 2 + wins);
    foe = { a, name, base: FOES[name], label: FOES[name], hp, max: hp };
    drawFoePlate();
    engine.tween(1.0, (k) => a.root.position.lerpVectors(from, E_POS, k), {
      ease: ease.lin,
      done: () => { a.root.lookAt(P_POS.x, 0, P_POS.z); a.play('Idle'); sfx.play('gate'); if (done) done(); },
    });
  }

  // ---------- 턴 진행 ----------
  function nextTurn() {
    if (over) return;
    run = new QRun(session.next());
    const q = run.q;
    if (q.type === 'passage') {
      // 정체를 숨긴 채 사상가를 흉내 낸다
      foe.a.setSilhouette(true); foe.label = '???'; drawFoePlate();
      poof(foe.a.root.position, ['#1b1630', '#6a5d86']);
      foe.a.once('Spellcast_Raise', 'Idle', { speed: 1.6 });
    } else {
      foe.a.once('Interact', 'Idle', { speed: 1.3 });
    }
    showStep();
  }

  function button(html, cls = '') {
    const b = document.createElement('button');
    b.className = 'opt ' + cls;
    b.innerHTML = html;
    dock.appendChild(b);
    return b;
  }

  function showStep() {
    const q = run.q, step = run.step;
    dock.innerHTML = '';
    dock.className = 'dock';
    busy = false;
    if (q.type === 'multi') return showMulti();
    const hint = step.kind === 'ox' ? '상대의 주장입니다. 맞는 말일까요?'
      : q.type === 'classify' ? '이 내용은 누구의 것일까요?'
        : q.type === 'order' ? '순서대로 이어서 연속 공격!'
          : step.isWho ? '상대가 흉내 내는 대상을 맞히세요'
            : '알맞은 카드로 반박하세요';
    hud.showQuestion(q, step, { timer: false, hint });
    let opts = step.options;
    if (step.kind === 'ox') {
      dock.classList.add('grid2');
      opts.forEach((o) => { o._label = o.text === 'O' ? '⭕ 맞는 말이다' : '❌ 틀린 말이다'; });
    } else if (opts.every((o) => o.text.length <= 8) && opts.length >= 2) {
      dock.classList.add('grid2');
    }
    const btns = opts.map((o) => {
      const b = button(o._label || esc(o.text));
      b.onclick = () => choose(o, b, btns, opts);
      return b;
    });
  }

  function choose(opt, btn, btns, opts) {
    if (busy || over) return;
    busy = true;
    const step = run.step;
    const res = run.answer(opt);
    btns.forEach((b, i) => { b.disabled = true; if (opts[i].correct) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); else b.classList.add('dim'); });
    if (res.ok) { sfx.play('correct'); jab(true); } else { sfx.play('wrong'); jab(false); }
    if (step.isWho) reveal(step, res.ok);
    engine.wait(res.ok ? 0.55 : 1.0, () => { if (res.done) resolve(); else showStep(); });
  }

  function showMulti() {
    const q = run.q;
    hud.showQuestion(q, { ...run.steps[0], total: 1, index: 0 }, { timer: false, sub: false, hint: '옳은 카드를 모두 고르고 발동하세요' });
    const sel = new Set();
    const btns = run.steps.map((s, i) => {
      const b = button(esc(s.sub));
      b.onclick = () => { if (busy) return; sfx.play('click'); if (sel.has(i)) sel.delete(i); else sel.add(i); b.classList.toggle('sel', sel.has(i)); };
      return b;
    });
    const go = button('⚡ 콤보 발동', 'primary');
    go.style.background = 'var(--yellow)';
    go.onclick = () => {
      if (busy || over) return;
      busy = true;
      go.disabled = true;
      const steps = run.steps.slice();
      steps.forEach((s, i) => {
        const truth = s.options[0].correct;
        const res = run.answer(sel.has(i) ? s.options[0] : s.options[1]);
        const b = btns[i];
        b.disabled = true; b.classList.remove('sel');
        b.classList.add(truth ? 'right' : 'dim');
        if (!res.ok) b.classList.add('wrong');
        b.innerHTML = `${truth ? '⭕' : '❌'} ${esc(s.sub)}`;
      });
      sfx.play(run.allOk ? 'correct' : 'wrong');
      engine.wait(run.allOk ? 0.7 : 1.3, resolve);
    };
  }

  function reveal(step, ok) {
    foe.a.setSilhouette(false);
    foe.label = `${step.options.find((o) => o.correct).text} 흉내`;
    drawFoePlate();
    poof(foe.a.root.position, ok ? CONFETTI : ['#ffffff', '#c9b8ff']);
    sfx.play('magic');
  }
  function poof(pos, colors) {
    engine.particles.emit(new T.Vector3(pos.x, pos.y + 1.4, pos.z), 34, { colors, speed: 3, up: 3, gravity: 4, life: 0.8 });
  }
  // 중간 단계의 가벼운 주고받기(체력 변화 없음)
  function jab(ok) {
    if (ok) {
      hero.once('Unarmed_Melee_Attack_Kick', 'Idle', { speed: 1.6 });
      engine.particles.emit(new T.Vector3(E_POS.x, 1.5, E_POS.z), 10, { colors: ['#fff', '#ffc93c'], speed: 3, up: 2, life: 0.4 });
    } else {
      hero.once('Hit_A', 'Idle'); engine.shake(0.15);
    }
  }

  function strike(att, def, attPos, defPos, isMage, onHit) {
    const dur = att.once(isMage ? 'Spellcast_Shoot' : '1H_Melee_Attack_Chop', 'Idle', { speed: 1.25 });
    if (isMage) {
      sfx.play('magic');
      const orb = new T.Mesh(new T.SphereGeometry(0.22, 10, 8), glowMat(0x9b6bff, 2.2));
      orb.userData.ownGeo = true; scene.add(orb);
      const from = new T.Vector3(attPos.x, 1.6, attPos.z), to = new T.Vector3(defPos.x, 1.4, defPos.z);
      engine.tween(0.32, (k) => { orb.position.lerpVectors(from, to, k); orb.position.y += Math.sin(k * Math.PI) * 0.6; }, { delay: 0.3, ease: ease.lin, done: () => { scene.remove(orb); onHit(); } });
    } else {
      sfx.play('attack');
      const mid = attPos.clone().lerp(defPos, 0.62);
      engine.tween(0.22, (k) => att.root.position.lerpVectors(attPos, mid, k), { done: () => {
        engine.wait(0.12, () => {
          onHit();
          engine.tween(0.3, (k) => att.root.position.lerpVectors(mid, attPos, k), { delay: 0.15 });
        });
      } });
    }
    return dur;
  }

  function resolve() {
    const ok = run.allOk, q = run.q;
    session.record(q, ok);
    hud.setScore(session.correct);
    dock.innerHTML = '';
    hud.clearQuestion();
    if (foe.a.sil) { foe.a.setSilhouette(false); foe.label = foe.base; drawFoePlate(); }
    if (ok) {
      const dmg = run.steps.length > 1 ? 2 : 1;
      strike(hero, foe.a, P_POS, E_POS, hero.name === 'mage', () => {
        sfx.play('hit'); engine.shake(0.4); hud.flash(true);
        foe.hp = Math.max(0, foe.hp - dmg); drawFoePlate();
        foe.a.flash(0xffffff);
        engine.particles.emit(new T.Vector3(E_POS.x, 1.5, E_POS.z), 30, { colors: ['#fff', '#ffc93c', '#ff5d6c'], speed: 5, up: 4, life: 0.7 });
        if (dmg > 1) hud.center('연속 타격!', 700);
        if (foe.hp <= 0) {
          foe.a.once('Death_A', null);
          wins++; hud.setExtra('격파 ' + wins);
          const dead = foe;
          engine.wait(1.0, () => { poof(dead.a.root.position, CONFETTI); scene.remove(dead.a.root); sfx.play('win'); hero.once('Cheer', 'Idle'); });
        } else foe.a.once('Hit_A', 'Idle');
      });
    } else {
      strike(foe.a, hero, E_POS, P_POS, foe.name === 'mage', () => {
        sfx.play('hit'); engine.shake(0.45); hud.flash(false);
        lives--; hud.setHearts(lives);
        hero.flash();
        engine.particles.emit(new T.Vector3(P_POS.x, 1.5, P_POS.z), 24, { colors: ['#ff5d6c', '#7a2a3a', '#fff'], speed: 5, up: 4, life: 0.7 });
        if (lives <= 0) { hero.once('Death_A', null); sfx.play('lose'); } else hero.once('Hit_B', 'Idle');
      });
    }
    engine.wait(1.15, () => explain(ok, q));
  }

  function explain(ok, q) {
    const s = document.createElement('div');
    s.className = 'sheet-explain ' + (ok ? 'ok' : 'no');
    s.innerHTML = `<h3>${ok ? '정답! 공격 성공' : '오답… 반격당했다'}</h3>${ok ? '' : `<p class="ans">정답: ${esc(answerText(q))}</p>`}<p>${esc(q.explanation || '')}</p><button class="btn primary">${lives <= 0 ? '결과 보기' : '다음'}</button>`;
    hud.ui.appendChild(s);
    s.querySelector('button').onclick = () => {
      sfx.play('click');
      s.remove();
      if (lives <= 0) { over = true; return finish(); }
      if (foe.hp <= 0) { foe = null; drawFoePlate(); spawnFoe(() => engine.wait(0.3, nextTurn)); } else nextTurn();
    };
  }

  function finish() {
    if (ended) return;
    ended = true;
    onEnd({ extra: `격파한 상대 ${wins}명` });
  }

  const _p = {}, _v = new T.Vector3();
  function plate(el, obj) {
    _v.copy(obj.position); _v.y += 2.75;
    engine.project(_v, _p);
    el.style.left = _p.x + 'px'; el.style.top = _p.y + 'px';
  }

  let started = false;
  function update(dt) {
    t += dt;
    if (!started && t > 0.4) { started = true; spawnFoe(() => engine.wait(0.3, nextTurn)); }
    hero.update(dt);
    if (foe) foe.a.update(dt);
    clouds.update(dt);
    arena.children.forEach((c) => { if (c.userData.wave !== undefined) c.rotation.z = Math.sin(t * 2 + c.userData.wave) * 0.06; });
    const sway = Math.sin(t * 0.35) * 0.35;
    camera.position.set(-0.4 + sway, 4.3, 12.2);
    camera.lookAt(0, 2.15, 0);
    camera.updateMatrixWorld();
    plate(heroPlate, hero.root);
    if (foe) plate(foePlate, foe.a.root);
  }

  const stage = {
    scene, camera, sun, update,
    bloom: { strength: 0.4, threshold: 0.9, radius: 0.7 },
    onResize(w, h) { camera.fov = w / h < 0.8 ? 58 : 40; },
    dispose() { disposeScene(scene); },
  };
  return { stage, quit() { over = true; finish(); } };
}
