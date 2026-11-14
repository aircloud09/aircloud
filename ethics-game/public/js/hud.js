// 게임 화면 위의 공용 UI(체력, 문제 패널, 피드백)
import { TYPE_LABEL, answerText, stepSlots } from './core.js';
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
  // 문제가 나오면 게임을 멈추고 문제 전체를 먼저 보여 준다. Ready!를 누르면 onReady가 불린다.
  preview(q, onReady, how) {
    const it = (t) => `<div class="it">${esc(t)}</div>`;
    let body = '';
    if (q.type === 'ox') body = `<div class="stem">${esc(q.stem)}</div><div class="note">맞는 말인지 틀린 말인지 판단하세요.</div>`;
    else if (q.type === 'choice') body = `<div class="stem">${esc(q.stem)}</div>${q.opts.map((o) => it(o.text)).join('')}`;
    else if (q.type === 'multi') body = `<div class="stem">${esc(q.stem)}</div>${q.items.map((i) => it(i.text)).join('')}<div class="note">한 문장씩 차례로 옳은지 틀린지 고릅니다.</div>`;
    else if (q.type === 'classify') body = `<div class="stem">${esc(q.stem)}</div><div class="cap">분류할 곳</div><div class="chips">${q.buckets.map((b) => `<span>${esc(b)}</span>`).join('')}</div><div class="cap">분류할 내용 (하나씩 차례로 나옵니다)</div>${q.items.map((i) => it(i.text)).join('')}`;
    else if (q.type === 'order') body = `<div class="stem">${esc(q.stem)}</div><div class="chips">${q.shown.map((t) => `<span>${esc(t)}</span>`).join('')}</div><div class="note">첫 번째부터 차례로 고릅니다.</div>`;
    else if (q.type === 'passage') body = `<div class="pass">${esc(q.passage)}</div><div class="stem">${esc(q.who.stem || '이 주장을 한 사상가는?')}</div><div class="chips">${q.who.opts.map((o) => `<span>${esc(o.text)}</span>`).join('')}</div><div class="cap">이어지는 질문: ${esc(q.then.stem)}</div>${q.then.opts.map((o) => it(o.text)).join('')}`;
    $('ready-badges').innerHTML = `<span style="background:var(--blue);color:#fff">${TYPE_LABEL[q.type]}</span><span>Lv.${q.level}</span>${q.isReview ? '<span style="background:var(--purple);color:#fff">🔁 복습</span>' : ''}`;
    $('ready-body').innerHTML = body + `<div class="note">시간 제한 없이 읽고, 준비되면 Ready!를 누르세요. ${esc(how || '')}</div>`;
    const box = $('ready');
    box.classList.remove('hidden');
    box.firstElementChild.scrollTop = 0;
    this.clearQuestion();
    const btn = $('ready-btn');
    btn.style.display = ''; btn.textContent = 'Ready!';
    btn.onclick = () => { sfx.play('go'); box.classList.add('hidden'); onReady(); };
  },
  hidePreview() { $('ready').classList.add('hidden'); },
  esc,
};
