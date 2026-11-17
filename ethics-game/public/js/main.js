// 화면 전환과 메뉴
import { store, bank, Session, api, answerText, stemText, WRONG_RATIO, TYPE_LABEL, BASIC_TYPES, mastery } from './core.js';
import { engine, sfx, CHAR_NAMES } from './engine.js';
import { hud } from './hud.js';
import { concepts, ConceptSession } from './concept.js';
import { createLobby } from './lobby.js';
import { createRunner } from './runner.js';
import { createSlash } from './slash.js';
import { createBattle } from './battle.js';

const $ = (id) => document.getElementById(id);
const esc = hud.esc;
const GAMES = {
  runner: { name: '지식 러너', create: createRunner, unit: '코인', icon: '🪙' },
  slash: { name: '개념 슬래시', create: createSlash, unit: '벤 물건', icon: '🗡️' },
  battle: { name: '논쟁 배틀', create: createBattle, unit: '입힌 피해', icon: '💥' },
};
let lobby = null, game = null, modalOnClose = null;

// ---------- 모달 ----------
function openModal(html, { onClose = null, closable = true } = {}) {
  $('modal-body').innerHTML = html;
  $('modal-close').style.display = closable ? '' : 'none';
  $('modal').classList.remove('hidden');
  $('modal-body').scrollTop = 0;
  modalOnClose = onClose;
}
function closeModal() {
  $('modal').classList.add('hidden');
  const f = modalOnClose; modalOnClose = null;
  if (f) f();
}
$('modal-close').onclick = () => { sfx.play('click'); closeModal(); };
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') && $('modal-close').style.display !== 'none') closeModal(); });

// ---------- 홈 ----------
function refreshHome() {
  const d = store.d;
  $('nick-text').textContent = d.nickname || '닉네임 설정';
  $('stat-correct').textContent = d.correct;
  $('stat-review').textContent = Object.values(d.hist).filter((h) => h.w).length;
  $('quick-mastery').textContent = mastery().pct + '%';
  if (concepts.units.length) {
    const all = concepts.units.flatMap((u) => u.stages);
    $('concept-progress').textContent = `${all.filter((st) => concepts.stars(st.id) > 0).length}/${all.length}`;
  }
  $('quick-level').textContent = d.fixedLevel ? 'Lv.' + d.fixedLevel : `자동 Lv.${Math.round(d.level)}`;
  for (const k of Object.keys(GAMES)) $('best-' + k).textContent = d.scores[k] ? `${GAMES[k].icon} ${d.scores[k]}` : '';
  api.top().then((r) => { $('stat-rank').textContent = r.me && r.me.rank ? r.me.rank + '위' : '-'; }).catch(() => { $('stat-rank').textContent = '-'; });
}
function showHome() {
  hud.hide();
  $('home').classList.remove('hidden');
  engine.use(lobby);
  refreshHome();
}

function askNickname(first) {
  openModal(`
    <h2>${first ? '닉네임을 정해 주세요' : '닉네임 변경'}</h2>
    <p class="sub">랭킹에 표시되는 이름입니다. 실명 대신 별명을 써 주세요.</p>
    <input class="text" id="nick-input" maxlength="10" placeholder="최대 10자" value="${esc(store.d.nickname)}" autocomplete="off">
    <button class="btn primary" id="nick-save">확인</button>`, { closable: !first });
  const inp = $('nick-input');
  const save = () => {
    const v = inp.value.trim().slice(0, 10);
    if (!v) { inp.focus(); return; }
    store.d.nickname = v; store.save();
    sfx.unlock(); sfx.play('click');
    api.submit().then(refreshHome);
    closeModal(); refreshHome();
  };
  $('nick-save').onclick = save;
  inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
}

// ---------- 게임 시작/종료 ----------
function startGame(key) {
  sfx.unlock();
  sfx.play('click');
  $('home').classList.add('hidden');
  hud.show();
  // 새 유형(빈칸, 틀린 곳 찾기 등)은 지식 러너에서만 낸다
  const session = new Session(key === 'runner' ? null : BASIC_TYPES);
  $('hud-best').style.display = '';
  hud.initBest(GAMES[key].icon, store.d.scores[key]);
  api.top(key).then((r) => hud.setRankData(r)).catch(() => {});
  game = GAMES[key].create({ session, hud, onEnd: (info) => endGame(key, session, info) });
  engine.use(game.stage);
  sfx.music(true);
}

function endGame(key, session, info = {}) {
  game = null;
  sfx.music(false);
  const d = store.d;
  const score = Math.max(0, Math.floor(info.score || 0));
  const isBest = score > d.scores[key];
  if (isBest) d.scores[key] = score;
  if (session.correct > d.best[key]) d.best[key] = session.correct;
  store.save();
  api.submit().then(refreshHome);
  showHome();
  if (session.correct >= 3) lobby.cheer();
  const wrong = session.log.filter((l) => !l.ok).map((l) => bank.byId[l.id]).filter(Boolean);
  const uniq = [...new Map(wrong.map((q) => [q.id, q])).values()];
  const rate = session.count ? Math.round((session.correct / session.count) * 100) : 0;
  openModal(`
    <h2>${GAMES[key].name} 결과${isBest ? ' · 최고 점수!' : ''}</h2>
    <div class="big-num">${session.correct}<small>문제 정답</small></div>
    <div class="row-stats">
      <div><b>${session.count}</b><span>푼 문제</span></div>
      <div><b>${rate}%</b><span>정답률</span></div>
      <div><b>${score}</b><span>${GAMES[key].unit}</span></div>
    </div>
    ${info.extra ? `<p class="sub" style="text-align:center">${esc(info.extra)}</p>` : ''}
    <button class="btn primary" id="res-again">다시 하기</button>
    <button class="btn ghost" id="res-home">홈으로</button>
    ${uniq.length ? `<h2 style="margin-top:18px">틀린 문제 ${uniq.length}개</h2><p class="sub">틀린 문제는 나중에 다시 나옵니다.</p>${uniq.map((q) => noteHtml(q)).join('')}` : ''}`);
  $('res-again').onclick = () => { closeModal(); startGame(key); };
  $('res-home').onclick = () => { sfx.play('click'); closeModal(); };
  bindReports();
}

function noteHtml(q, stageInfo = '') {
  return `<div class="note">
    <span class="tag">${esc(q.unit)}</span><span class="tag">${TYPE_LABEL[q.type]} · Lv.${q.level}</span>${stageInfo}
    <div class="qs">${esc(stemText(q))}</div>
    <div class="as">정답: ${esc(answerText(q))}</div>
    <div class="ex">${esc(q.explanation || '')}</div>
    <button class="rep" data-rep="${esc(q.id)}">문제 오류 신고</button>
  </div>`;
}
function bindReports() {
  $('modal-body').querySelectorAll('[data-rep]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = '신고 접수 중…';
      const ok = await api.report(b.dataset.rep);
      b.textContent = ok ? '신고했습니다' : '신고 실패 (연결 확인)';
    };
  });
}

// ---------- 랭킹 ----------
const RANK_TABS = [
  ['total', '정답', '문제', '맞힌 문제 수 (누적)'], ['solved', '푼 문제', '문제', '푼 문제 수 (누적)'],
  ['runner', '🪙 코인', '개', '지식 러너에서 한 판에 모은 코인 최고 기록'], ['slash', '🗡️ 베기', '개', '개념 슬래시에서 한 판에 벤 물건 최고 기록'], ['battle', '💥 피해', '점', '논쟁 배틀에서 한 판에 적에게 입힌 피해 최고 기록'],
];
async function showRank(sort = 'total') {
  const tab = RANK_TABS.find((t) => t[0] === sort);
  const head = `<h2>🏆 랭킹</h2>${seg('rank', RANK_TABS.map(([v, l]) => [v, l]), sort)}
    <p class="sub" style="margin-top:10px">${tab[3]}</p>`;
  const draw = (body) => {
    if ($('modal').classList.contains('hidden')) return;
    $('modal-body').innerHTML = head + body;
    $('modal-body').querySelector('[data-seg="rank"]').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      sfx.play('click'); showRank(b.dataset.v);
    };
  };
  openModal('');
  draw('<div class="empty">불러오는 중…</div>');
  try {
    await api.submit();
    const r = await api.top(sort);
    const medal = ['🥇', '🥈', '🥉'];
    const rows = r.top.map((e, i) => `<li class="${e.me ? 'me' : ''}"><span class="r">${medal[i] || i + 1}</span><span class="n">${esc(e.nickname)}</span><span class="c">${e.value}${tab[2]}</span></li>`).join('');
    const mine = r.me && r.me.rank ? `<p>내 순위: <b>${r.me.rank}위</b> (${r.me.value}${tab[2]})</p>` : '<p class="sub">아직 이 항목의 기록이 없습니다.</p>';
    draw(`${mine}${rows ? `<ul class="rank-list">${rows}</ul>` : '<div class="empty">아직 기록이 없습니다.</div>'}`);
  } catch (e) {
    draw('<div class="empty">랭킹 서버에 연결할 수 없습니다.<br>잠시 뒤에 다시 시도해 주세요.</div>');
  }
}

// ---------- 오답노트 ----------
function showNotes() {
  const d = store.d;
  // 한 번이라도 틀린 문제(변형은 하나로 묶어서 마지막에 나온 것으로 보여 줌)
  const items = Object.entries(d.hist).filter(([, h]) => h.w)
    .map(([g, h]) => ({ q: bank.byId[h.v] || (bank.groups.get(g) || [])[0], h }))
    .filter((x) => x.q).sort((a, b) => b.h.last - a.h.last);
  const body = items.length ? items.map(({ q, h }) => noteHtml(q, `<span class="tag stage">${h.n}번 풂</span>`)).join('')
    : '<div class="empty">아직 틀린 문제가 없습니다.</div>';
  openModal(`<h2>📒 오답노트</h2><p class="sub">한 번이라도 틀린 문제는 다시 맞혀도 계속 나옵니다. 출제 비율은 틀린 문제·안 푼 문제 ${Math.round(WRONG_RATIO * 100)}%(둘이 반반), 맞힌 문제 ${Math.round((1 - WRONG_RATIO) * 100)}%입니다.</p>${body}`);
  bindReports();
}

// ---------- 개념 학습 ----------
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
async function showConceptMap() {
  openModal('<h2>📚 개념 학습</h2><div class="empty">불러오는 중…</div>');
  await concepts.load();
  refreshHome();
  const body = concepts.units.map((u) => `<div class="cmap-unit"><h3>${esc(u.unit)}</h3><div class="cmap-stages">${u.stages.map((st) => {
    const open = concepts.unlocked(st);
    return `<button data-st="${st.id}" class="${st.boss ? 'boss' : ''} ${open ? '' : 'lock'}">${st.boss ? '👑 ' : ''}${esc(st.title.replace('보스: ', ''))}<span class="st">${open ? starText(concepts.stars(st.id)) : '🔒 일반 스테이지를 모두 끝내면 열림'}</span></button>`;
  }).join('')}</div></div>`).join('');
  $('modal-body').innerHTML = `<h2>📚 개념 학습</h2><p class="sub">개념 카드를 먼저 읽고, 지식 러너에서 빈칸 게이트를 통과하며 복습합니다. 체력은 깎이지 않습니다. 단원의 스테이지를 모두 끝내면 👑 비교표 보스가 열립니다.</p>${body}`;
  $('modal-body').querySelectorAll('[data-st]').forEach((b) => {
    b.onclick = () => {
      const st = concepts.byId[b.dataset.st];
      sfx.play('click');
      if (!concepts.unlocked(st)) return;
      showConceptCard(st);
    };
  });
}
// 개념 카드(읽기). result가 있으면 맞힌 칸 ✔ / 틀린 칸 ✘ 표시
function conceptCardHtml(st, result) {
  if (st.kind === 'fill') {
    return `<ol class="ccard">${st.items.map((it, i) => {
      const cls = result ? (result.wrong.has(`${st.id}-${i}`) ? 'no' : 'ok') : '';
      return `<li class="${cls}">${esc(it.text).replace(/\{(.+?)\}/, '<mark>$1</mark>')}</li>`;
    }).join('')}</ol>`;
  }
  return `<table class="ctable"><tr><th></th>${st.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${st.rows.map((r, ri) => `<tr><th>${esc(r.label)}</th>${r.cells.map((c, ci) => `<td class="${result && result.wrong.has(`${st.id}-${ri}-${ci}`) ? 'no' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}
function showConceptCard(st) {
  openModal(`<h2>${st.boss ? '👑 ' : '📖 '}${esc(st.title)}</h2>
    <p class="sub">${esc(st.unit)} · ${st.kind === 'fill' ? '노란 부분이 빈칸으로 나옵니다. 충분히 읽고 시작하세요.' : '칸마다 "누구의 것인지" 게이트로 나옵니다. 표를 외우고 시작하세요.'}</p>
    ${conceptCardHtml(st)}
    <button class="btn primary" id="c-go">🏃 달리며 복습하기</button>
    <button class="btn ghost" id="c-back">← 스테이지 목록</button>`);
  $('c-go').onclick = () => { closeModal(); startConcept(st); };
  $('c-back').onclick = () => { sfx.play('click'); showConceptMap(); };
}
function startConcept(st) {
  sfx.unlock(); sfx.play('click');
  $('home').classList.add('hidden');
  hud.show();
  hud._best = null; $('hud-best').innerHTML = ''; $('hud-best').style.display = 'none';
  const session = new ConceptSession(st);
  game = createRunner({ session, hud, concept: true, onEnd: () => endConcept(st, session) });
  engine.use(game.stage);
  sfx.music(true);
}
function endConcept(st, session) {
  game = null;
  sfx.music(false);
  const r = session.result();
  const d = store.d;
  const prev = (d.concept[st.id] || {}).stars || 0;
  if (r.stars > prev) d.concept[st.id] = { stars: r.stars };   // 가장 좋은 기록만 남긴다
  store.save();
  showHome();
  if (r.stars === 3) lobby.cheer();
  const msg = !r.finished ? '중간에 그만두어 기록되지 않았습니다.' : `${r.n}개 중 ${r.n - r.wrong.size}개 정답 · ${starText(r.stars)}`;
  openModal(`<h2>${esc(st.title)} 결과</h2>
    <p style="text-align:center;font-size:20px">${msg}</p>
    ${r.finished && r.stars < 3 ? '<p class="sub">빨간 칸을 다시 확인하고 한 번 더 도전해 보세요. 별 3개를 받으면 완벽!</p>' : ''}
    ${conceptCardHtml(st, r.finished ? r : null)}
    <button class="btn primary" id="c-again">다시 하기</button>
    <button class="btn ghost" id="c-map">스테이지 목록</button>`);
  $('c-again').onclick = () => { closeModal(); showConceptCard(st); };
  $('c-map').onclick = () => { sfx.play('click'); showConceptMap(); };
}

// ---------- 숙지도 ----------
function barColor(p) { return p >= 80 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : p >= 20 ? '#ff9f43' : 'var(--red)'; }
function showMastery() {
  const m = mastery();
  const rows = m.units.map((u) => `<div class="mrow">
    <div class="top"><span>${esc(u.unit)}</span><b>${u.pct}%</b></div>
    <div class="mbar"><i style="width:${u.pct}%;background:${barColor(u.pct)}"></i></div>
    <div class="lv">${u.lv.slice(1).map((l, i) => (l.total ? `<span>Lv.${i + 1} ${l.ok}/${l.total}</span>` : '')).join('')}<span>푼 문제 ${u.solved}/${u.total}</span></div>
  </div>`).join('');
  openModal(`<h2>📊 숙지도</h2>
    <div class="mastery-all"><div class="big">${m.pct}%</div><span class="sub">전체 숙지도</span></div>
    <p class="sub">맞힌 문제가 많을수록, 어려운 문제(Lv.4~5)를 맞힐수록 크게 오릅니다. 틀렸다가 다시 맞힌 문제는 80%만 인정합니다. Lv별 숫자는 맞힌 문제 / 전체 문제입니다.</p>
    ${rows}
    <button class="btn primary" id="m-level">🎚️ 난이도 조절하기</button>`);
  $('m-level').onclick = () => { sfx.play('click'); showLevel(); };
}

// ---------- 난이도 ----------
function showLevel() {
  const d = store.d;
  const opts = [[0, '자동', `지금 Lv.${Math.round(d.level)}`], [1, 'Lv.1', '아주 쉬움'], [2, 'Lv.2', '쉬움'], [3, 'Lv.3', '보통'], [4, 'Lv.4', '어려움'], [5, 'Lv.5', '아주 어려움']];
  openModal(`<h2>🎚️ 난이도</h2>
    <p class="sub">자동: 맞히면 올라가고 틀리면 내려가며 실력에 맞춥니다. 레벨을 고르면 그 레벨 근처(±1)의 문제가 주로 나옵니다.</p>
    <div class="lv-pick">${opts.map(([v, l, sub]) => `<button data-v="${v}" class="${d.fixedLevel === v ? 'on' : ''}">${l}<small>${sub}</small></button>`).join('')}</div>`, { onClose: refreshHome });
  $('modal-body').querySelectorAll('.lv-pick button').forEach((b) => {
    b.onclick = () => {
      sfx.unlock(); sfx.play('click');
      d.fixedLevel = Number(b.dataset.v); store.save();
      $('modal-body').querySelectorAll('.lv-pick button').forEach((x) => x.classList.toggle('on', x === b));
      refreshHome();
    };
  });
}

// ---------- 설정 ----------
function seg(key, options, cur) {
  return `<div class="seg" data-seg="${key}">${options.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}
function showSettings() {
  const d = store.d, o = d.opts;
  openModal(`
    <h2>⚙️ 설정</h2>
    <div class="set-row" style="flex-direction:column;align-items:stretch"><span>캐릭터</span>${seg('char', Object.entries(CHAR_NAMES), o.char)}</div>
    <div class="set-row" style="flex-direction:column;align-items:stretch"><span>문제 난이도 <span class="sub">(자동: 실력에 맞게 조절 · 현재 Lv.${Math.round(d.level)})</span></span>${seg('level', [[0, '자동'], [1, 'Lv.1'], [2, 'Lv.2'], [3, 'Lv.3'], [4, 'Lv.4'], [5, 'Lv.5']], d.fixedLevel)}</div>
    <div class="set-row"><span>효과음</span>${seg('sound', [[1, '켜기'], [0, '끄기']], o.sound ? 1 : 0)}</div>
    <div class="set-row"><span>배경음</span>${seg('music', [[1, '켜기'], [0, '끄기']], o.music ? 1 : 0)}</div>
    <div class="set-row"><span>그래픽</span>${seg('quality', [['auto', '자동'], ['high', '상'], ['mid', '중'], ['low', '하']], o.quality)}</div>
    <p class="sub" style="margin-top:12px">누적 ${d.solved}문제를 풀어 ${d.correct}문제를 맞혔습니다.</p>
    <p class="sub">3D 모델: KayKit (CC0) · 글꼴: 주아체 (OFL)</p>`);
  $('modal-body').querySelectorAll('[data-seg]').forEach((s) => {
    s.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const key = s.dataset.seg, v = b.dataset.v;
      s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      sfx.unlock();
      if (key === 'char') { o.char = v; lobby.setChar(v); }
      if (key === 'level') d.fixedLevel = Number(v);
      if (key === 'sound') o.sound = v === '1';
      if (key === 'music') o.music = v === '1';
      if (key === 'quality') {
        o.quality = v;
        if (v === 'auto') { engine.autoTier = true; } else { engine.autoTier = false; engine.setTier(v); }
      }
      store.save();
      refreshHome();
      sfx.play('click');
    };
  });
}

// ---------- 시작 ----------
async function boot() {
  store.load();
  engine.init($('gl'));
  const fill = $('load-fill');
  try {
    await Promise.all([
      engine.load((p) => { fill.style.width = Math.round(p * 100) + '%'; }),
      bank.load(),
      document.fonts.load('20px "Jua"').catch(() => {}),
    ]);
  } catch (e) {
    $('load-text').textContent = '불러오지 못했습니다. 새로고침해 주세요.';
    console.error(e);
    return;
  }
  lobby = createLobby();
  showHome();
  $('loading').classList.add('out');
  setTimeout(() => $('loading').classList.add('hidden'), 450);

  document.querySelectorAll('.game-card').forEach((b) => { b.onclick = () => startGame(b.dataset.game); });
  $('btn-rank').onclick = () => { sfx.unlock(); sfx.play('click'); showRank('total'); };
  $('btn-notes').onclick = () => { sfx.unlock(); sfx.play('click'); showNotes(); };
  $('btn-settings').onclick = () => { sfx.unlock(); sfx.play('click'); showSettings(); };
  $('btn-concept').onclick = () => { sfx.unlock(); sfx.play('click'); showConceptMap(); };
  concepts.load().then(refreshHome).catch(() => {});
  $('btn-mastery').onclick = () => { sfx.unlock(); sfx.play('click'); showMastery(); };
  $('btn-level').onclick = () => { sfx.unlock(); sfx.play('click'); showLevel(); };
  $('btn-nick').onclick = () => { sfx.unlock(); sfx.play('click'); askNickname(false); };
  $('btn-quit').onclick = () => { if (game) game.quit(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { api.submit(); sfx.music(false); } else if (game) sfx.music(true);
  });
  // 주소창 ?play=runner 로 바로 시작(테스트용)
  const auto = new URLSearchParams(location.search).get('play');
  if (!store.d.nickname && !auto) askNickname(true);
  if (GAMES[auto]) startGame(auto);
  window.__eq = { engine, store, bank, get game() { return game; } };
}
boot();
