// 게임 화면 위의 공용 UI(체력, 문제 패널, 피드백)
import { TYPE_LABEL, answerText, stepSlots, QRun } from './core.js';
import { sfx } from './engine.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastTimer = 0, centerTimer = 0;

export const hud = {
  el: $('hud'), ui: $('game-ui'),

  show() {
    this.el.classList.remove('hidden');
    this.clearQuestion();
    this.ui.innerHTML = '';
    this.setCombo(0);
    this.setExtra('');
    this.hidePreview();
    $('toast').className = '';
  },
  hide() { this.el.classList.add('hidden'); this.ui.innerHTML = ''; this.hidePreview(); },

  setHearts(n, max = 3) {
    $('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < n ? '' : 'off'}">❤️</span>`).join('');
  },
  setScore(n) { $('hud-score').querySelector('b').textContent = n; },
  setExtra(t) { $('hud-extra').textContent = t; },

  // 화면 구석의 최고 점수와 등수. 판을 하는 동안 기록을 넘으면 바로 갱신한다.
  initBest(icon, best) {
    this._best = { icon, stored: best, now: 0, others: null, serverRank: null };
    this.drawBest();
  },
  // 서버 랭킹(해당 게임 점수 기준)을 받아 둔다
  setRankData(r) {
    if (!this._best || !r) return;
    this._best.others = r.top.filter((e) => !e.me).map((e) => e.value);
    this._best.serverRank = r.me ? r.me.rank : null;
    this.drawBest();
  },
  setGameScore(n) {
    if (!this._best) return;
    const wasNew = this._best.now > this._best.stored;
    this._best.now = n;
    this.drawBest();
    if (!wasNew && n > this._best.stored) { const el = $('hud-best'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  },
  drawBest() {
    const b = this._best, el = $('hud-best');
    const high = Math.max(b.stored, b.now), isNew = b.now > b.stored && b.stored > 0;
    let rank = '';
    if (b.others && high > 0) {
      const above = b.others.filter((v) => v > high).length;
      // 상위 100명 안이면 바로 계산하고, 밖이면 서버가 알려 준 등수를 쓴다
      const r = above < b.others.length || b.others.length < 100 ? above + 1 : b.serverRank;
      if (r) rank = `<br>랭킹 <b>${r}위</b>`;
    }
    el.innerHTML = `${isNew ? '<span class="new">신기록!</span> ' : '최고 '}${b.icon} <b>${high}</b>${rank}`;
  },
  setCombo(n) {
    const c = $('combo');
    if (n >= 2) { c.textContent = `${n} 콤보!`; c.classList.add('on'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } else c.classList.remove('on');
  },

  // 문제 패널. cfg: { prompt:false(숨김), sub:false, opts:'cols'|'list'|null, hint, colors, symbols }
  showQuestion(q, step, cfg = {}) {
    const p = $('qpanel');
    const fresh = p.classList.contains('hidden') || p.dataset.qid !== q.id;
    p.dataset.qid = q.id;
    p.classList.remove('hidden');
    if (fresh) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
    $('q-type').textContent = TYPE_LABEL[q.type];
    $('q-lv').textContent = 'Lv.' + q.level;
    $('q-review').style.display = q.isReview ? '' : 'none';
    $('q-prog').textContent = step.total > 1 ? `${step.index + 1} / ${step.total}` : '';
    const pass = $('q-passage');
    pass.style.display = step.passage ? '' : 'none';
    pass.textContent = step.passage || '';
    const prompt = $('q-prompt');
    prompt.style.display = cfg.prompt === false ? 'none' : '';
    prompt.textContent = step.prompt;
    const chain = $('q-chain');
    chain.style.display = step.chain && step.chain.length ? '' : 'none';
    chain.innerHTML = step.chain ? step.chain.map((t) => `<b>${esc(t)}</b>`).join('→') + ' →' : '';
    const sub = $('q-sub');
    const showSub = step.sub && cfg.sub !== false;
    sub.style.display = showSub ? '' : 'none';
    sub.textContent = step.sub || '';
    const opts = $('q-opts');
    if (cfg.opts) {
      const { n, opts: bySlot, colors } = stepSlots(step);
      const maxLen = Math.max(...bySlot.map((o) => (o ? o.text.length : 1)));
      // 보기 수와 글자 수에 따라 한 줄 / 2×2 / 세로 목록
      opts.className = maxLen <= [0, 14, 12, 7, 5][n] ? 'cols' : n === 4 && maxLen <= 11 ? 'grid' : 'list';
      opts.style.display = '';
      opts.innerHTML = bySlot.map((o, i) => `<div class="o ${o ? '' : 'gone'}" data-slot="${i}" style="background:${colors[i]}"><span class="n">${i + 1}</span><span>${o ? esc(o.text) : '—'}</span></div>`).join('');
    } else { opts.style.display = 'none'; opts.innerHTML = ''; }
    const hint = $('q-hint');
    hint.style.display = cfg.hint ? '' : 'none';
    hint.textContent = cfg.hint || '';
    $('q-timer').style.display = cfg.timer === false ? 'none' : '';
    this.timer(1);
  },
  markOption(slot, cls) {
    const o = $('q-opts').querySelector(`[data-slot="${slot}"]`);
    if (o) o.classList.add(cls);
  },
  clearQuestion() { $('qpanel').classList.add('hidden'); $('qpanel').dataset.qid = ''; },
  timer(frac) {
    const t = $('q-timer');
    t.firstElementChild.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
    t.classList.toggle('low', frac < 0.3);
  },

  flash(ok) {
    const f = $('flash');
    f.className = '';
    void f.offsetWidth;
    f.className = ok ? 'ok' : 'no';
  },
  // 문제 종료 피드백(게임을 멈추지 않는 방식)
  toast(ok, q, ms = 2600) {
    const t = $('toast');
    clearTimeout(toastTimer);
    t.className = ok ? 'ok' : 'no';
    t.innerHTML = `<b>${ok ? '정답!' : '오답'}</b>${ok ? '' : `<p class="ans">정답: ${esc(answerText(q))}</p>`}<p>${esc(q.explanation || '')}</p>`;
    void t.offsetWidth;
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },
  hideToast() { clearTimeout(toastTimer); $('toast').classList.remove('show'); },
  center(text, ms = 700) {
    const c = $('center-text');
    clearTimeout(centerTimer);
    c.textContent = text;
    c.style.fontSize = String(text).length > 2 ? '64px' : '';
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    c.style.animationDuration = ms + 'ms';
    centerTimer = setTimeout(() => c.classList.remove('show'), ms);
  },
  // 문제 풀이 창: 게임이 멈춘 상태에서 시간 제한 없이 푼다. 끝나면 done(맞혔는지)를 부른다.
  quiz(q, done) {
    const run = new QRun(q);
    const box = $('ready'), body = $('ready-body'), btn = $('ready-btn');
    $('ready-badges').innerHTML = `<span style="background:var(--blue);color:#fff">${TYPE_LABEL[q.type]}</span><span>Lv.${q.level}</span>${q.isReview ? '<span style="background:var(--purple);color:#fff">🔁 복습</span>' : ''}<span id="ready-prog" style="margin-left:auto;border:0;background:none;opacity:.6"></span>`;
    box.classList.remove('hidden');
    this.clearQuestion();
    const COL = ['#ff5d6c', '#35d07f', '#4aa8ff', '#ffc93c'];
    const finish = () => {
      const ok = run.allOk;
      sfx.play(ok ? 'correct' : 'wrong');
      body.innerHTML = `<div class="res ${ok ? 'ok' : 'no'}">${ok ? '정답!' : '오답'}</div>${ok ? '' : `<div class="ans">정답: ${esc(answerText(q))}</div>`}<div class="exp">${esc(q.explanation || '')}</div>`;
      $('ready-prog').textContent = '';
      btn.style.display = ''; btn.textContent = '계속하기';
      btn.onclick = () => { sfx.play('click'); box.classList.add('hidden'); done(ok); };
      box.firstElementChild.scrollTop = 0;
    };
    const head = (step) => `${step.passage ? `<div class="pass">${esc(step.passage)}</div>` : ''}<div class="stem">${esc(step.prompt)}</div>${step.chain && step.chain.length ? `<div class="chain">${step.chain.map((t) => `<b>${esc(t)}</b>`).join('→')} →</div>` : ''}${step.sub ? `<div class="subq">${esc(step.sub)}</div>` : ''}`;
    const showMulti = () => {
      // 모두 고르기: 옳은 것을 전부 고른 뒤 한 번에 확인
      const sel = new Set();
      body.innerHTML = `<div class="stem">${esc(q.stem)}</div><div class="opts">${run.steps.map((st, i) => `<button class="opt" data-i="${i}">${esc(st.sub)}</button>`).join('')}</div><div class="note">옳은 것을 모두 고르고 확인을 누르세요.</div>`;
      body.querySelectorAll('.opt').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.i); sfx.play('click'); if (sel.has(i)) sel.delete(i); else sel.add(i); b.classList.toggle('sel', sel.has(i)); }; });
      btn.style.display = ''; btn.textContent = '확인';
      btn.onclick = () => { run.steps.slice().forEach((st, i) => run.answer(sel.has(i) ? st.options[0] : st.options[1])); finish(); };
    };
    const showStep = () => {
      const step = run.step;
      const { opts, colors } = stepSlots(step);
      $('ready-prog').textContent = step.total > 1 ? `${step.index + 1} / ${step.total}` : '';
      const label = (o) => (step.kind === 'ox' ? (o.text === 'O' ? '⭕ 맞는 말이다' : '❌ 틀린 말이다') : esc(o.text));
      const grid = opts.every((o) => !o || o.text.length <= 8);
      body.innerHTML = head(step) + `<div class="opts ${grid ? 'grid' : ''}">${opts.map((o, i) => (o ? `<button class="opt" data-i="${i}"><span class="k" style="background:${colors[i]}">${i + 1}</span>${label(o)}</button>` : '')).join('')}</div>`;
      btn.style.display = 'none';
      const btns = [...body.querySelectorAll('.opt')];
      let locked = false;
      btns.forEach((b) => { b.onclick = () => {
        if (locked) return;
        locked = true;
        const res = run.answer(opts[Number(b.dataset.i)]);
        btns.forEach((x) => { const o = opts[Number(x.dataset.i)]; x.disabled = true; x.classList.add(o.correct ? 'right' : x === b ? 'wrong' : 'dim'); });
        if (!res.done) sfx.play(res.ok ? 'tick' : 'wrong');
        setTimeout(() => { if (box.classList.contains('hidden')) return; if (res.done) finish(); else showStep(); }, res.done ? 450 : res.ok ? 450 : 900);
      }; });
      box.firstElementChild.scrollTop = 0;
    };
    if (q.type === 'multi') showMulti(); else showStep();
  },
  hidePreview() { $('ready').classList.add('hidden'); },
  esc,
};
