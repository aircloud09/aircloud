// 랭킹: 맞힌 문제 수(누적) 저장과 조회
// 저장소: Netlify Blobs (사용자 1명 = 키 1개)
import { getStore } from '@netlify/blobs';

const CACHE_MS = 20000;       // 순위표를 다시 만드는 최소 간격
const MAX_STEP = 500;         // 한 번 제출로 늘어날 수 있는 최대 개수(비정상 점수 방지)

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
const validUid = (s) => /^[A-Za-z0-9-]{8,64}$/.test(s);

async function board(users, cache) {
  const cached = await cache.get('board', { type: 'json' });
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const { blobs } = await users.list();
  const rows = (await Promise.all(blobs.map(async (b) => {
    const v = await users.get(b.key, { type: 'json' });
    return v && v.total > 0 ? { id: b.key, nickname: v.nickname, total: v.total, at: v.at } : null;
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
    const uid = String(b.uid || ''), nickname = cleanName(b.nickname), total = Math.floor(Number(b.total));
    if (!validUid(uid) || !nickname || !(total >= 0)) return json({ error: 'invalid' }, 400);
    const prev = await users.get(uid, { type: 'json' });
    const base = prev ? prev.total : 0;
    const next = Math.max(base, Math.min(total, base + MAX_STEP));
    if (!prev || prev.total !== next || prev.nickname !== nickname) {
      await users.setJSON(uid, { nickname, total: next, at: Date.now() });
    }
    return json({ ok: true, total: next });
  }

  if (req.method === 'GET') {
    const uid = new URL(req.url).searchParams.get('uid') || '';
    const rows = (await board(users, cache)).filter((r) => r.id !== uid);
    // 내 기록은 항상 최신 값으로 반영
    if (validUid(uid)) {
      const mine = await users.get(uid, { type: 'json' });
      if (mine && mine.total > 0) rows.push({ id: uid, nickname: mine.nickname, total: mine.total, at: mine.at });
    }
    rows.sort((a, b) => b.total - a.total || a.at - b.at);
    const i = rows.findIndex((r) => r.id === uid);
    return json({
      top: rows.slice(0, 100).map((r) => ({ nickname: r.nickname, total: r.total, me: r.id === uid })),
      me: i >= 0 ? { rank: i + 1, total: rows[i].total } : null,
    });
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/rank' };
