// 랭킹: 맞힌 문제 수, 푼 문제 수, 게임별 최고 점수 저장과 조회
// 저장소: Netlify Blobs (사용자 1명 = 키 1개)
import { getStore } from '@netlify/blobs';

const CACHE_MS = 20000;       // 순위표를 다시 만드는 최소 간격
const MAX_STEP = 500;         // 한 번 제출로 늘어날 수 있는 최대 개수(비정상 점수 방지)
const MAX_SCORE = 100000;     // 게임 점수 상한
const GAMES = ['runner', 'slash', 'battle'];
const SORTS = ['total', 'solved', ...GAMES];

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
const validUid = (s) => /^[A-Za-z0-9-]{8,64}$/.test(s);

const int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
// 저장된 기록에서 정렬 기준 값을 꺼낸다
const valueOf = (r, sort) => (GAMES.includes(sort) ? (r.scores && r.scores[sort]) || 0 : r[sort] || 0);

async function board(users, cache) {
  const cached = await cache.get('board', { type: 'json' });
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const { blobs } = await users.list();
  const rows = (await Promise.all(blobs.map(async (b) => {
    const v = await users.get(b.key, { type: 'json' });
    return v ? { id: b.key, ...v } : null;
  }))).filter(Boolean);
  await cache.setJSON('board', { at: Date.now(), rows });
  return rows;
}

export default async (req) => {
  // 방금 저장한 기록이 바로 조회되도록 즉시 반영 방식으로 연다
  const users = getStore({ name: 'rank-users', consistency: 'strong' });
  const cache = getStore({ name: 'rank-cache', consistency: 'strong' });

  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const uid = String(b.uid || ''), nickname = cleanName(b.nickname);
    if (!validUid(uid) || !nickname) return json({ error: 'invalid' }, 400);
    const prev = (await users.get(uid, { type: 'json' })) || { total: 0, solved: 0, scores: {} };
    // 누적 값은 줄어들지 않고, 한 번에 MAX_STEP까지만 늘어난다
    const grow = (old, now, step) => Math.max(old || 0, Math.min(int(now), (old || 0) + step));
    const total = grow(prev.total, b.total, MAX_STEP);
    const solved = Math.max(total, grow(prev.solved, b.solved, MAX_STEP * 3));
    const scores = {};
    for (const g of GAMES) scores[g] = Math.max((prev.scores && prev.scores[g]) || 0, Math.min(int(b.scores && b.scores[g]), MAX_SCORE));
    const next = { nickname, total, solved, scores, at: prev.at || Date.now() };
    const changed = JSON.stringify([prev.nickname, prev.total, prev.solved, prev.scores]) !== JSON.stringify([nickname, total, solved, scores]);
    if (changed) { next.at = Date.now(); await users.setJSON(uid, next); }
    return json({ ok: true, total, solved, scores });
  }

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    const uid = q.get('uid') || '';
    const sort = SORTS.includes(q.get('sort')) ? q.get('sort') : 'total';
    const rows = (await board(users, cache)).filter((r) => r.id !== uid);
    // 내 기록은 항상 최신 값으로 반영
    if (validUid(uid)) {
      const mine = await users.get(uid, { type: 'json' });
      if (mine) rows.push({ id: uid, ...mine });
    }
    const ranked = rows.map((r) => ({ id: r.id, nickname: r.nickname, value: valueOf(r, sort), at: r.at || 0 })).filter((r) => r.value > 0);
    ranked.sort((a, b) => b.value - a.value || a.at - b.at);
    const i = ranked.findIndex((r) => r.id === uid);
    return json({
      sort,
      top: ranked.slice(0, 100).map((r) => ({ nickname: r.nickname, value: r.value, me: r.id === uid })),
      me: i >= 0 ? { rank: i + 1, value: ranked[i].value } : null,
    });
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/rank' };
