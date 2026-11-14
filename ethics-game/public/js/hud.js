// 게임 화면 위의 공용 UI(체력, 문제 패널, 피드백)
import { TYPE_LABEL, answerText, stepSlots } from './core.js';

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
    $('toast').className = '';
  },
  hide() { this.el.classList.add('hidden'); this.ui.innerHTML = ''; },

  setHearts(n, max = 3) {
    $('hearts').innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < n ? '' : 'off'}">❤️</span>`).join('');
  },
  setScore(n) { $('hud-score').querySelector('b').textContent = n; },
  setExtra(t) { $('hud-extra').textContent = t; },
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
  esc,
};
