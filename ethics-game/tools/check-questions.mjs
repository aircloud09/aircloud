// 문제 파일 검사: 형식, 정답 범위, 중복, 모바일 화면에 맞는 글자 수
// 실행: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'questions');
const TYPES = ['ox', 'choice', 'multi', 'classify', 'order', 'passage'];
const LIMIT = { stem: 70, option: 34, item: 30, passage: 130, explanation: 140 };
const errors = [], warns = [];
const ids = new Set(), stems = new Map();
const count = {};

const files = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).files;
for (const f of files) {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { errors.push(`${f}: JSON을 읽을 수 없음 (${e.message})`); continue; }
  for (const q of list) {
    const at = `${f} ${q.id || '(id 없음)'}`;
    const err = (m) => errors.push(`${at}: ${m}`);
    const warn = (m) => warns.push(`${at}: ${m}`);
    const str = (v) => typeof v === 'string' && v.trim().length > 0;
    const long = (v, max, what) => { if (str(v) && v.length > max) warn(`${what}이(가) ${v.length}자로 김 (권장 ${max}자 이하)`); };

    if (!str(q.id)) err('id 없음'); else if (ids.has(q.id)) err('id 중복'); else ids.add(q.id);
    if (!TYPES.includes(q.type)) { err(`알 수 없는 유형 "${q.type}"`); continue; }
    if (!Number.isInteger(q.level) || q.level < 1 || q.level > 5) err('level은 1~5 정수');
    if (!str(q.unit)) err('unit 없음');
    if (!Array.isArray(q.tags) || !q.tags.length) err('tags 없음');
    if (!str(q.explanation)) err('explanation 없음'); else long(q.explanation, LIMIT.explanation, '해설');
    if (q.type !== 'passage') { if (!str(q.stem)) err('stem 없음'); else long(q.stem, LIMIT.stem, '문제'); }
    count[q.type] = (count[q.type] || 0) + 1;

    const checkOptions = (opts, answer, what) => {
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 4) return err(`${what} 보기는 2~4개`);
      if (!opts.every(str)) err(`${what} 보기에 빈 값`);
      if (new Set(opts).size !== opts.length) err(`${what} 보기 중복`);
      if (!Number.isInteger(answer) || answer < 0 || answer >= opts.length) err(`${what} 정답 번호가 보기 범위를 벗어남`);
      opts.forEach((o) => long(o, LIMIT.option, `${what} 보기`));
    };

    if (q.type === 'ox') {
      if (typeof q.answer !== 'boolean') err('answer는 true/false');
    } else if (q.type === 'choice') {
      checkOptions(q.options, q.answer, '');
    } else if (q.type === 'multi') {
      if (!Array.isArray(q.items) || q.items.length < 2 || q.items.length > 5) err('items는 2~5개');
      else {
        if (!q.items.every((i) => str(i.text) && typeof i.correct === 'boolean')) err('items 형식 오류');
        if (!q.items.some((i) => i.correct)) err('옳은 항목이 하나도 없음');
        q.items.forEach((i) => long(i.text, LIMIT.item, '항목'));
      }
    } else if (q.type === 'classify') {
      if (!Array.isArray(q.buckets) || q.buckets.length < 2 || q.buckets.length > 4) err('buckets는 2~4개');
      else if (!Array.isArray(q.items) || q.items.length < 2 || q.items.length > 6) err('items는 2~6개');
      else {
        if (!q.items.every((i) => str(i.text) && Number.isInteger(i.bucket) && i.bucket >= 0 && i.bucket < q.buckets.length)) err('items의 bucket 번호 오류');
        q.buckets.forEach((b) => { if (b.length > 8) warn(`분류 이름 "${b}"이(가) 8자를 넘음`); });
        q.items.forEach((i) => long(i.text, LIMIT.item, '항목'));
      }
    } else if (q.type === 'order') {
      if (!Array.isArray(q.items) || q.items.length < 3 || q.items.length > 4) err('items는 3~4개');
      else {
        if (new Set(q.items).size !== q.items.length) err('items 중복');
        q.items.forEach((i) => { if (i.length > 12) warn(`순서 항목 "${i}"이(가) 12자를 넘음`); });
      }
    } else if (q.type === 'passage') {
      if (!str(q.passage)) err('passage 없음'); else long(q.passage, LIMIT.passage, '제시문');
      if (!q.who || !q.then) err('who/then 없음');
      else {
        checkOptions(q.who.options, q.who.answer, 'who');
        checkOptions(q.then.options, q.then.answer, 'then');
        if (!str(q.then.stem)) err('then.stem 없음');
      }
    }
    const key = (q.stem || q.passage || '').replace(/\s+/g, '');
    if (key) { if (stems.has(key)) warn(`${stems.get(key)}와 문제 문장이 같음`); else stems.set(key, q.id); }
  }
}

console.log(`문제 ${ids.size}개`, count);
warns.forEach((w) => console.log('주의:', w));
errors.forEach((e) => console.log('오류:', e));
console.log(errors.length ? `오류 ${errors.length}건` : '오류 없음', `· 주의 ${warns.length}건`);
process.exit(errors.length ? 1 : 0);
