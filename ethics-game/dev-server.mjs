// 로컬 테스트용 서버: 정적 파일 + 랭킹 API 흉내(메모리 저장)
// 실행: node dev-server.mjs  →  http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 8787);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const ranks = new Map();
const reports = [];

const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b)); });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/rank') {
    if (req.method === 'POST') {
      try {
        const b = JSON.parse(await readBody(req));
        const prev = ranks.get(b.uid) || { total: 0, solved: 0, scores: {} };
        const scores = {};
        for (const g of ['runner', 'slash', 'battle']) scores[g] = Math.max(prev.scores[g] || 0, Number(b.scores && b.scores[g]) || 0);
        ranks.set(b.uid, { nickname: String(b.nickname).slice(0, 10), total: Math.max(prev.total, Number(b.total) || 0), solved: Math.max(prev.solved, Number(b.solved) || 0), scores });
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: 'bad request' }); }
    }
    const uid = url.searchParams.get('uid'), sort = url.searchParams.get('sort') || 'total';
    const val = (v) => (v.scores[sort] !== undefined ? v.scores[sort] : v[sort]) || 0;
    const all = [...ranks.entries()].map(([id, v]) => ({ id, nickname: v.nickname, value: val(v) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
    const idx = all.findIndex((e) => e.id === uid);
    return json(res, 200, {
      sort,
      top: all.slice(0, 100).map((e) => ({ nickname: e.nickname, value: e.value, me: e.id === uid })),
      me: idx >= 0 ? { rank: idx + 1, value: all[idx].value } : null,
    });
  }
  if (url.pathname === '/api/report' && req.method === 'POST') {
    reports.push(await readBody(req));
    console.log('report:', reports[reports.length - 1]);
    return json(res, 200, { ok: true });
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
