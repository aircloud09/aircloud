// 개념 학습: 학습지 내용을 스테이지로 나눠, 개념 카드를 읽은 뒤 러너에서 빈칸·비교표 게이트로 복습한다
import { prepare, shuffle, store } from './core.js';

export const concepts = {
  units: [], byId: {},
  async load() {
    if (this.units.length) return;
    const idx = await (await fetch('concepts/index.json')).json();
    this.units = await Promise.all(idx.files.map((f) => fetch('concepts/' + f).then((r) => r.json())));
    for (const u of this.units) for (const s of u.stages) { s.unit = u.unit; this.byId[s.id] = s; }
  },
  stars(id) { return (store.d.concept[id] || {}).stars || 0; },
  // 보스 스테이지는 같은 단원의 일반 스테이지를 모두 끝내야 열린다
  unlocked(stage) {
    if (!stage.boss) return true;
    const u = this.units.find((x) => x.unit === stage.unit);
    return u.stages.filter((s) => !s.boss).every((s) => this.stars(s.id) > 0);
  },
};

// 스테이지 문항을 러너가 쓰는 문제 형태로 만든다
export function stageItems(stage) {
  if (stage.kind === 'fill') {
    return stage.items.map((it, i) => ({
      id: `${stage.id}-${i}`, unit: stage.unit, level: 0, type: 'fill', badge: '개념 빈칸',
      stem: it.text.replace(/\{.+?\}/, '(　　)'),
      options: [it.answer, ...it.wrong], answer: 0,
      explanation: it.text.replace(/[{}]/g, ''), full: it.text,
    }));
  }
  const items = [];
  stage.rows.forEach((r, ri) => r.cells.forEach((cell, ci) => items.push({
    id: `${stage.id}-${ri}-${ci}`, unit: stage.unit, level: 0, type: 'fill', badge: '비교표',
    stem: `[${r.label}] 「${cell}」은(는) 누구의 것?`,
    options: [stage.cols[ci], ...stage.cols.filter((c, k) => k !== ci)], answer: 0,
    explanation: `${stage.cols[ci]} – ${r.label}: ${cell}`, row: ri, col: ci,
  })));
  return shuffle(items);
}

// 러너의 session 자리에 들어가는 개념 학습용 진행 관리(기록·랭킹에는 반영하지 않음)
export class ConceptSession {
  constructor(stage) {
    this.stage = stage;
    this.items = stageItems(stage);
    this.i = 0; this.count = 0; this.correct = 0; this.log = []; this.reviews = 0;
  }
  get done() { return this.i >= this.items.length; }
  next() { const q = prepare(this.items[this.i++]); q.group = q.id; return q; }
  record(q, ok) { this.count++; if (ok) this.correct++; this.log.push({ id: q.id, ok }); }
  result() {
    const wrong = this.log.filter((l) => !l.ok).map((l) => l.id);
    const n = this.items.length, finished = this.log.length >= n;
    const stars = !finished ? 0 : wrong.length === 0 ? 3 : wrong.length <= Math.ceil(n * 0.25) ? 2 : 1;
    return { wrong: new Set(wrong), finished, stars, n };
  }
}
