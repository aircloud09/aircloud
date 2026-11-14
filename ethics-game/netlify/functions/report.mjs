// 문제 오류 신고 접수. 신고 내용은 Netlify 대시보드의 Blobs(question-reports)에서 확인한다.
import { getStore } from '@netlify/blobs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let b;
  try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const qid = String(b.qid || '');
  if (!/^[\w-]{1,40}$/.test(qid)) return json({ error: 'invalid' }, 400);
  const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
  const uid = /^[A-Za-z0-9-]{8,64}$/.test(String(b.uid || '')) ? String(b.uid) : '';
  const key = `${qid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await getStore('question-reports').setJSON(key, { qid, note, uid, at: new Date().toISOString() });
  return json({ ok: true });
};

export const config = { path: '/api/report' };
