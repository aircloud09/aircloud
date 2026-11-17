// 저장, 문제 은행, 출제(적응형 난이도 + 복습), 랭킹 통신

const KEY = 'ethics-quest.v1';
// 출제 비율: 틀린 문제(+아직 안 푼 문제) 70%, 맞히기만 한 문제 30%
export const WRONG_RATIO = 0.7;
// 그 70% 가운데 안 푼 문제의 몫(나머지는 틀린 문제)
export const NEW_SHARE = 0.5;
// 서술만 바꾼 변형 문제는 group이 같고, 같은 문제로 취급한다

export const TYPE_LABEL = {
  ox: 'O/X', choice: '객관식', multi: '모두 고르기',
  classify: '분류', order: '순서', passage: '제시문',
  fill: '빈칸', spot: '틀린 곳 찾기', match: '짝 맞추기',
  keywords: '키워드 모으기', case: '사례 판단', compare: '갑·을 비교',
};
// 처음 만든 6가지 유형(슬래시·배틀은 이 유형만 출제)
export const BASIC_TYPES = ['ox', 'choice', 'multi', 'classify', 'order', 'passage'];
export const COMPARE_BUCKETS = ['갑만', '을만', '둘 다', '둘 다 아님'];

// 테스트용 주소창 옵션: ?type=ox 처럼 문제 유형을 고정
const DEBUG_TYPE = new URLSearchParams(location.search).get('type');
const DEBUG_LEVEL = Number(new URLSearchParams(location.search).get('lv')) || 0; // ?lv=4 처럼 레벨 고정
const rand = (n) => Math.floor(Math.random() * n);
export function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = rand(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

const DEFAULTS = () => ({
  uid: uid(), nickname: '', solved: 0, correct: 0,
  level: 2, fixedLevel: 0,
  // hist[group] = { w: 한 번이라도 틀렸는지, n: 푼 횟수, last: 마지막으로 푼 순번, v: 마지막에 나온 변형 id }
  hist: {}, recent: [],
  concept: {},   // 개념 학습 스테이지별 { stars }
  best: { runner: 0, slash: 0, battle: 0 },
  // 게임별 최고 점수(한 판 기준): 러너=코인, 슬래시=벤 물건, 배틀=격파한 상대
  scores: { runner: 0, slash: 0, battle: 0 },
  opts: { sound: true, music: true, quality: 'auto', char: 'knight' },
});

export const store = {
  d: DEFAULTS(),
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw), def = DEFAULTS();
        this.d = { ...def, ...p, concept: { ...def.concept, ...p.concept }, best: { ...def.best, ...p.best }, scores: { ...def.scores, ...p.scores }, opts: { ...def.opts, ...p.opts } };
        if (!p.hist) {
          for (const id of p.seen || []) this.d.hist[id] = { w: false, n: 1, last: 0 };
          for (const id of Object.keys(p.srs || {})) this.d.hist[id] = { w: true, n: 1, last: 0 };
        }
        delete this.d.srs; delete this.d.seen;
      }
    } catch (e) { /* 저장소를 못 쓰는 환경에서도 동작 */ }
    this.save();
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { /* 무시 */ }
  },
};

export const bank = {
  list: [], byId: {},
  async load() {
    const idx = await (await fetch('questions/index.json')).json();
    const parts = await Promise.all(idx.files.map((f) => fetch('questions/' + f).then((r) => r.json())));
    this.list = parts.flat();
    this.byId = Object.fromEntries(this.list.map((q) => [q.id, q]));
    this.groups = new Map();
    for (const q of this.list) {
      q.group = q.group || q.id;
      if (!this.groups.has(q.group)) this.groups.set(q.group, []);
      this.groups.get(q.group).push(q);
    }
  },
};

// 화면에 낼 형태로 가공(보기 섞기 등)
export function prepare(q) {
  const p = JSON.parse(JSON.stringify(q));
  if (p.type === 'choice') {
    p.opts = shuffle(p.options.map((text, i) => ({ text, correct: i === p.answer })));
  } else if (p.type === 'multi') {
    p.items = shuffle(p.items);
  } else if (p.type === 'classify') {
    p.items = shuffle(p.items);
  } else if (p.type === 'order') {
    let s = shuffle(p.items);
    if (s.every((v, i) => v === p.items[i])) s = s.slice(1).concat(s[0]);
    p.shown = s;
  } else if (p.type === 'passage') {
    p.who.opts = shuffle(p.who.options.map((text, i) => ({ text, correct: i === p.who.answer })));
    p.then.opts = shuffle(p.then.options.map((text, i) => ({ text, correct: i === p.then.answer })));
  } else if (p.type === 'fill' || p.type === 'case') {
    p.opts = shuffle(p.options.map((text, i) => ({ text, correct: i === p.answer })));
  } else if (p.type === 'match') {
    p.lefts = shuffle(p.pairs.map((x) => x[0]));
    p.rights = shuffle(p.pairs.map((x) => x[1]));
  } else if (p.type === 'keywords') {
    // 한 줄에 관련 키워드 1개 + 관련 없는 키워드 2개
    const right = shuffle(p.right).slice(0, 3), wrong = shuffle(p.wrong);
    p.rows = right.map((r, k) => {
      const w = [wrong[(k * 2) % wrong.length], wrong[(k * 2 + 1) % wrong.length]];
      return shuffle([{ text: r, correct: true }, ...w.map((text) => ({ text, correct: false }))]);
    });
  } else if (p.type === 'compare') {
    p.nameOpts = shuffle(p.names);
    p.items = shuffle(p.items);
  }
  return p;
}

// 문제를 "한 번의 선택" 단위(step)로 분해. 세 게임이 같은 구조를 각자 방식으로 표현한다.
export function buildSteps(q) {
  const steps = [];
  const base = { prompt: q.stem, type: q.type };
  if (q.type === 'ox') {
    steps.push({ ...base, kind: 'ox', options: [{ text: 'O', correct: q.answer === true }, { text: 'X', correct: q.answer === false }] });
  } else if (q.type === 'choice') {
    steps.push({ ...base, kind: 'pick', options: q.opts });
  } else if (q.type === 'multi') {
    q.items.forEach((it) => steps.push({
      ...base, kind: 'tf', sub: it.text,
      options: [{ text: '옳음', correct: it.correct }, { text: '틀림', correct: !it.correct }],
    }));
  } else if (q.type === 'classify') {
    q.items.forEach((it) => steps.push({
      ...base, kind: 'pick', sub: it.text, fixed: true,
      options: q.buckets.map((text, i) => ({ text, correct: i === it.bucket, slot: i })),
    }));
  } else if (q.type === 'order') {
    const slotOf = (t) => q.shown.indexOf(t);
    for (let k = 0; k < q.items.length - 1; k++) {
      const remaining = q.shown.filter((t) => q.items.indexOf(t) >= k);
      steps.push({
        ...base, kind: 'pick', sub: `${k + 1}번째는?`, fixed: true, chain: q.items.slice(0, k),
        slots: q.shown.length,
        options: remaining.map((text) => ({ text, correct: text === q.items[k], slot: slotOf(text) })),
      });
    }
  } else if (q.type === 'passage') {
    const who = q.who.opts.find((o) => o.correct).text;
    steps.push({ ...base, kind: 'pick', prompt: q.who.stem || '이 주장을 한 사상가는?', passage: q.passage, options: q.who.opts, isWho: true });
    steps.push({ ...base, kind: 'pick', prompt: q.then.stem, passage: q.passage, options: q.then.opts, reveal: who });
  } else if (q.type === 'fill') {
    steps.push({ ...base, kind: 'pick', options: q.opts });
  } else if (q.type === 'case') {
    steps.push({ ...base, kind: 'pick', passage: q.case, options: q.opts });
  } else if (q.type === 'spot') {
    // 문장 조각 중 틀린 조각을 고른다(조각 순서는 그대로)
    steps.push({ ...base, kind: 'pick', sub: q.parts.join(' '), fixed: true, options: q.parts.map((text, i) => ({ text, correct: i === q.wrong, slot: i })) });
  } else if (q.type === 'match') {
    const pairOf = Object.fromEntries(q.pairs);
    q.lefts.forEach((l) => steps.push({
      ...base, kind: 'pick', sub: `${l} ↔ ?`, fixed: true,
      options: q.rights.map((text, i) => ({ text, correct: text === pairOf[l], slot: i })),
    }));
  } else if (q.type === 'keywords') {
    q.rows.forEach((row) => steps.push({ ...base, kind: 'pick', options: row }));
  } else if (q.type === 'compare') {
    const passage = `갑: ${q.gap}\n을: ${q.eul}`;
    steps.push({ ...base, kind: 'pick', prompt: '갑은 누구일까?', passage, options: q.nameOpts.map((text) => ({ text, correct: text === q.names[0] })) });
    steps.push({ ...base, kind: 'pick', prompt: '을은 누구일까?', passage, options: q.nameOpts.map((text) => ({ text, correct: text === q.names[1] })) });
    q.items.forEach((it) => steps.push({
      ...base, kind: 'pick', prompt: '이 진술에 해당하는 쪽은?', passage, sub: it.text, fixed: true,
      options: COMPARE_BUCKETS.map((text, i) => ({ text, correct: i === it.ans, slot: i })),
    }));
  }
  steps.forEach((s, i) => { s.index = i; s.total = steps.length; });
  return steps;
}

// 한 step의 보기를 칸(레인/구슬) 순서로 정리. 색과 짧은 표시도 함께 준다.
const SLOT_COLORS = ['#ff5d6c', '#35d07f', '#4aa8ff', '#ffc93c'];
export function stepSlots(step) {
  const n = step.slots || step.options.length;
  const opts = Array.from({ length: n }, (_, i) => step.options.find((o, k) => (o.slot ?? k) === i) || null);
  const binary = step.kind === 'ox' || step.kind === 'tf';
  const colors = binary ? [SLOT_COLORS[1], SLOT_COLORS[0]] : SLOT_COLORS.slice(0, n);
  const short = opts.every((o) => !o || o.text.length <= 6);
  const labels = opts.map((o, i) => (o ? (short ? o.text : String(i + 1)) : '—'));
  return { n, opts, colors, labels, short };
}

// 문제 하나의 진행 상태
export class QRun {
  constructor(q) { this.q = q; this.steps = buildSteps(q); this.i = 0; this.allOk = true; }
  get step() { return this.steps[this.i]; }
  get done() { return this.i >= this.steps.length; }
  // opt: 선택한 보기(없으면 시간 초과/미응답). 반환: {ok, correct, done}
  answer(opt) {
    const s = this.step;
    const correct = s.options.find((o) => o.correct);
    const ok = !!opt && opt.correct;
    if (!ok) this.allOk = false;
    this.i++;
    return { ok, correct, done: this.done };
  }
}

export function answerText(q) {
  switch (q.type) {
    case 'ox': return q.answer ? 'O' : 'X';
    case 'choice': return q.options[q.answer];
    case 'multi': return '옳은 것: ' + q.items.filter((i) => i.correct).map((i) => i.text).join(' / ');
    case 'classify': return q.buckets.map((b, i) => `${b}: ${q.items.filter((it) => it.bucket === i).map((it) => it.text).join(', ') || '-'}`).join(' | ');
    case 'order': return q.items.join(' → ');
    case 'passage': return `${q.who.options[q.who.answer]} — ${q.then.options[q.then.answer]}`;
    case 'fill': case 'case': return q.options[q.answer];
    case 'spot': return `틀린 부분 "${q.parts[q.wrong]}" → ${q.fix}`;
    case 'match': return q.pairs.map((x) => `${x[0]}-${x[1]}`).join(', ');
    case 'keywords': return '관련 키워드: ' + q.right.join(', ');
    case 'compare': return `갑 ${q.names[0]}, 을 ${q.names[1]} | ` + q.items.map((it) => `${it.text}: ${COMPARE_BUCKETS[it.ans]}`).join(' / ');
    default: return '';
  }
}
export function stemText(q) {
  if (q.type === 'passage') return `"${q.passage}"`;
  if (q.type === 'case') return `${q.case} — ${q.stem}`;
  if (q.type === 'spot') return `${q.stem} "${q.parts.join(' ')}"`;
  if (q.type === 'compare') return `갑: ${q.gap} / 을: ${q.eul}`;
  return q.stem;
}

// 한 판(게임 1회) 동안의 출제 관리
// ---------- 숙지도 ----------
// 프린트(단원)마다: 문제 묶음별 점수 × 난이도 가중치의 합 ÷ 만점
//  - 점수: 안 풂 0 / 마지막에 틀림 0.1 / 틀린 적 있지만 다시 맞힘 0.8 / 한 번도 안 틀리고 맞힘 1
//  - 가중치: Lv.1 1, Lv.2 1.5, Lv.3 2, Lv.4 3, Lv.5 4 → 어려운 문제까지 맞혀야 100%에 가까워짐
export const LEVEL_WEIGHT = [0, 1, 1.5, 2, 3, 4];
export function groupScore(h) {
  if (!h) return 0;
  const ok = h.ok === undefined ? !h.w : h.ok;   // 예전 기록은 틀린 적 여부로 판단
  if (!ok) return 0.1;
  return h.w ? 0.8 : 1;
}
export function mastery() {
  const d = store.d, units = new Map();
  for (const [g, list] of bank.groups) {
    const q = list[0];
    if (!units.has(q.unit)) units.set(q.unit, { unit: q.unit, got: 0, max: 0, solved: 0, total: 0, lv: [0, 1, 2, 3, 4, 5].map(() => ({ ok: 0, total: 0 })) });
    const u = units.get(q.unit), h = d.hist[g], w = LEVEL_WEIGHT[q.level] || 1, sc = groupScore(h);
    u.max += w; u.got += w * sc; u.total++;
    if (h) u.solved++;
    u.lv[q.level].total++;
    if (sc >= 0.8) u.lv[q.level].ok++;
  }
  const list = [...units.values()].sort((a, b) => a.unit.localeCompare(b.unit));
  for (const u of list) u.pct = u.max ? Math.round((u.got / u.max) * 100) : 0;
  const got = list.reduce((s, u) => s + u.got, 0), max = list.reduce((s, u) => s + u.max, 0);
  return { units: list, pct: max ? Math.round((got / max) * 100) : 0 };
}

export class Session {
  // types: 이 판에서 낼 유형 목록(없으면 전부)
  constructor(types = null) { this.count = 0; this.reviews = 0; this.correct = 0; this.log = []; this.lastId = null; this.allow = types ? new Set(types) : null; }
  ok(q) { return !!q && (!this.allow || this.allow.has(q.type)); }

  get targetLevel() {
    const d = store.d;
    return DEBUG_LEVEL || d.fixedLevel || Math.max(1, Math.min(5, Math.round(d.level)));
  }

  next() {
    const d = store.d;
    // 이 판에서 낼 수 있는 문제 묶음(같은 문제의 변형끼리 한 묶음)
    const members = (g) => bank.groups.get(g).filter((q) => this.ok(q) && (!DEBUG_TYPE || q.type === DEBUG_TYPE));
    let groups = [...bank.groups.keys()].filter((g) => members(g).length);
    if (DEBUG_LEVEL) { const f = groups.filter((g) => bank.groups.get(g)[0].level === DEBUG_LEVEL); if (f.length) groups = f; }
    // 틀린 문제(+안 푼 문제) 70%, 맞히기만 한 문제 30%
    // 70% 안에서는 안 푼 문제와 틀린 문제를 반반씩 낸다
    // (틀린 문제가 쌓여도 새 문제가 계속 나오도록)
    const NEW = groups.filter((g) => !d.hist[g]);
    const WRONG = groups.filter((g) => d.hist[g] && d.hist[g].w);
    const A = NEW.length && WRONG.length ? (Math.random() < NEW_SHARE ? NEW : WRONG) : NEW.length ? NEW : WRONG;
    const B = groups.filter((g) => d.hist[g] && !d.hist[g].w);
    // 방금 나온 문제는 잠시 쉬게 한다(최근 3개는 반드시, 문제가 많으면 최근 8개까지)
    const recentOf = (n) => new Set(d.recent.slice(Math.max(0, d.recent.length - n)));
    const rest = (p, n) => { const r = recentOf(n); return p.filter((g) => !r.has(g)); };
    const first = Math.random() < WRONG_RATIO ? A : B, second = first === A ? B : A;
    let pool = rest(first, Math.max(3, Math.min(8, Math.floor(first.length / 2))));
    if (!pool.length) pool = rest(first, 3);
    if (!pool.length) pool = rest(second, 3);
    if (!pool.length) pool = rest(groups, 3);   // 고른 쪽이 모두 방금 나온 문제면 다른 문제에서
    if (!pool.length) pool = groups;
    // 실력에 맞는 레벨 우선
    const t = this.targetLevel;
    const lv = (g) => bank.groups.get(g)[0].level;
    const cand = [1, 2, 4].map((k) => pool.filter((g) => Math.abs(lv(g) - t) <= k)).find((c) => c.length) || pool;
    // 오래전에 푼 문제(또는 안 푼 문제)를 먼저
    const last = (g) => (d.hist[g] ? d.hist[g].last : -1);
    const sorted = shuffle(cand).sort((a, b) => last(a) - last(b));
    const g = sorted[rand(Math.max(1, Math.ceil(sorted.length / 3)))];
    // 변형 중 지난번과 다른 것을 고른다
    const h = d.hist[g];
    let vs = members(g);
    if (h && h.v && vs.length > 1) vs = vs.filter((q) => q.id !== h.v);
    const raw = vs[rand(vs.length)];
    this.lastId = raw.id;
    const q = prepare(raw);
    q.group = g;
    q.isReview = !!(h && h.w);
    return q;
  }

  record(q, ok) {
    const d = store.d;
    d.solved++;
    this.count++;
    if (ok) { d.correct++; this.correct++; }
    const g = q.group || q.id;
    const h = d.hist[g] || { w: false, n: 0 };
    h.w = h.w || !ok; h.n++; h.last = d.solved; h.v = q.id;
    h.ok = ok; h.c = (h.c || 0) + (ok ? 1 : 0);
    d.hist[g] = h;
    d.recent.push(g);
    if (d.recent.length > 10) d.recent.shift();
    if (q.isReview) this.reviews++;
    // 자동 난이도: 정답률 약 75%에서 균형
    if (!d.fixedLevel) {
      d.level = Math.max(1, Math.min(5, d.level + (ok ? 0.1 : -0.3)));
    }
    this.log.push({ id: q.id, ok });
    store.save();
  }

}

export const api = {
  async submit() {
    const d = store.d;
    if (!d.nickname) return;
    try {
      await fetch('/api/rank', {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: d.uid, nickname: d.nickname, total: d.correct, solved: d.solved, scores: d.scores }),
      });
    } catch (e) { /* 오프라인이면 다음에 다시 전송 */ }
  },
  async top(sort = 'total') {
    const r = await fetch(`/api/rank?sort=${sort}&uid=${encodeURIComponent(store.d.uid)}`);
    if (!r.ok) throw new Error('rank ' + r.status);
    return r.json();
  },
  async report(qid, note) {
    try {
      await fetch('/api/report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qid, note: note || '', uid: store.d.uid }),
      });
      return true;
    } catch (e) { return false; }
  },
};
