// PHANTOM 관리자 화면: 신고함, 공지 배너, 데이터 현황
// app.js가 #/admin 경로에서만 불러온다. 신고함·공지 배너는 Apps Script 저장소(관리자 키 필요)를,
// 데이터 현황은 공개 자료(data/status.json, data/meta.json)를 읽는다.

const VIEWS = [['reports', '신고함'], ['notice', '공지 배너'], ['data', '데이터 현황']];
const STATUSES = ['새 신고', '확인 중', '해결', '보류'];
const TAB_NAME = { overview: '개요', credit: '위험도 평가표', fin: '요약재무제표', history: '위험도 추이', funding: '자금조달' };
const KEY = 'phantom-admin-key';

let X;                                  // app.js가 넘겨준 도구와 상태
const cache = { reports: null, status: null };

const keyGet = () => { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch (e) { return null; } };
const keySet = (k, remember) => { try { (remember ? localStorage : sessionStorage).setItem(KEY, k); } catch (e) { /* 저장 못 하면 이번 화면에서만 */ } };
const keyClear = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } };
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

export function render(view, ctx) {
  X = ctx;
  const v = VIEWS.some(([id]) => id === view) ? view : 'reports';
  const { app, esc } = X;
  app.innerHTML = `${X.topBar()}<main class="page admin">
    <header class="firm-head"><h1>관리자</h1>${X.API && keyGet() ? '<button type="button" class="linkish" data-logout>로그아웃</button>' : ''}</header>
    <nav class="tabs" aria-label="관리자 메뉴">${VIEWS.map(([id, label]) =>
      `<a href="#/admin${id === 'reports' ? '' : '/' + id}"${id === v ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>
    <div class="tab-body" id="admin-body"></div>${X.footNote()}</main>`;
  X.bindSearch(app.querySelector('[data-search]'));
  const out = app.querySelector('[data-logout]');
  if (out) out.addEventListener('click', () => { keyClear(); cache.reports = null; render(v, X); });
  window.scrollTo(0, 0);
  const body = app.querySelector('#admin-body');
  if (v === 'data') return dataView(body);
  if (!X.API) {
    body.innerHTML = '<p class="notice">신고 저장소(Apps Script) 주소가 아직 설정되지 않았습니다. assets/app.js의 API에 웹 앱 주소를 넣으면 신고함과 공지 배너를 쓸 수 있습니다.</p>';
    return undefined;
  }
  if (!keyGet()) return loginView(body, v);
  return v === 'notice' ? noticeView(body) : reportsView(body);
}

// ---------------------------------------------------------------- 로그인
function loginView(body, v, err = '') {
  body.innerHTML = `<form class="admin-login">
    <h2>관리자 키</h2>
    <p class="lede">Apps Script에서 setup을 실행했을 때 실행 로그에 나온 키를 넣어 주세요.</p>
    <input type="password" name="key" autocomplete="current-password" aria-label="관리자 키" required>
    <label class="check"><input type="checkbox" name="remember">이 기기에서 기억하기</label>
    <p class="msg" role="status">${X.esc(err)}</p>
    <button type="submit" class="btn">들어가기</button></form>`;
  const form = body.querySelector('form');
  const msg = form.querySelector('.msg');
  form.key.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = form.key.value.trim();
    if (!k) return;
    msg.textContent = '확인하는 중…';
    try {
      const r = await X.api({ a: 'ping', key: k });
      if (!r.ok) { msg.textContent = '키가 맞지 않습니다. 여러 번 틀리면 15분 동안 잠깁니다.'; return; }
      keySet(k, form.remember.checked);
      if (X.isLive()) render(v, X);
    } catch (err2) {
      msg.textContent = '저장소에 연결하지 못했습니다. 인터넷 연결이나 웹 앱 주소를 확인해 주세요.';
    }
  });
}

function keyRejected(body, v) {
  keyClear();
  loginView(body, v, '키가 바뀌었거나 맞지 않습니다. 다시 넣어 주세요.');
}

// ---------------------------------------------------------------- 신고함
async function reportsView(body) {
  body.innerHTML = '<p class="loading" role="status">신고를 불러오는 중…</p>';
  let res;
  try {
    res = await X.api({ a: 'list', key: keyGet() });
  } catch (e) {
    if (!X.isLive()) return;
    body.innerHTML = '<p class="notice">신고를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요. <button type="button" class="btn-sm" data-retry>다시 시도</button></p>';
    body.querySelector('[data-retry]').addEventListener('click', () => reportsView(body));
    return;
  }
  if (!X.isLive()) return;
  if (!res.ok) { keyRejected(body, 'reports'); return; }
  cache.reports = res.reports;
  drawReports(body, '전체');
}

function drawReports(body, filter) {
  const all = cache.reports;
  const count = (s) => (s === '전체' ? all.length : all.filter((r) => r.status === s).length);
  const shown = filter === '전체' ? all : all.filter((r) => r.status === filter);
  body.innerHTML = `<section class="block">
    <div class="admin-bar"><div class="filters" role="group" aria-label="상태별 보기">${['전체', ...STATUSES].map((s) =>
      `<button type="button" class="filter${s === filter ? ' on' : ''}" data-f="${s}" aria-pressed="${s === filter}">${s}<b>${count(s)}</b></button>`).join('')}</div>
      <button type="button" class="btn-sm" data-reload>새로 고침</button></div>
    ${shown.length ? `<ol class="reports">${shown.map(reportItem).join('')}</ol>`
      : `<p class="empty">${filter === '전체' ? '아직 접수된 신고가 없습니다.' : `‘${filter}’ 상태인 신고가 없습니다.`}</p>`}
    <p class="note">최근 500건까지 보여 줍니다. 전체 기록은 Google 시트의 ‘신고’ 탭에 있습니다.</p></section>`;
  body.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => drawReports(body, b.dataset.f)));
  body.querySelector('[data-reload]').addEventListener('click', () => reportsView(body));
  body.querySelectorAll('form[data-id]').forEach((f) => f.addEventListener('submit', (e) => saveReport(e, f, body, filter)));
}

function reportItem(r) {
  const { esc } = X;
  // 화면 주소는 신고자가 보낸 값이므로 사이트 안 경로(#/…)일 때만 링크로 만든다.
  const safe = /^#\/[\w/.-]*$/.test(r.route) ? r.route : null;
  const label = r.name ? `${r.name}(${r.code})${r.tab && TAB_NAME[r.tab] ? ` ${TAB_NAME[r.tab]}` : ''}` : (r.route || '—');
  const page = safe ? `<a href="${esc(safe)}">${esc(label)}</a>` : esc(label);
  return `<li class="report-item">
    <div class="ri-head"><b>${esc(r.id)}</b><span>${esc(fmtTime(r.ts))}</span><span class="kind">${esc(r.kind)}</span>
      <span class="st st-${STATUSES.indexOf(r.status)}">${esc(r.status)}</span></div>
    <p class="ri-text">${esc(r.text)}</p>
    <dl class="ri-meta"><div><dt>화면</dt><dd>${page}</dd></div><div><dt>화면 폭</dt><dd>${esc(r.vw)}px</dd></div>
      <div><dt>데이터</dt><dd>${esc(r.data)}</dd></div><div><dt>브라우저</dt><dd>${esc(r.ua)}</dd></div>
      ${r.handled ? `<div><dt>처리</dt><dd>${esc(fmtTime(r.handled))}</dd></div>` : ''}</dl>
    <form class="ri-act" data-id="${esc(r.id)}">
      <select name="status" aria-label="처리 상태">${STATUSES.map((s) => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <input name="memo" value="${esc(r.memo)}" placeholder="처리 메모" maxlength="500" aria-label="처리 메모">
      <button type="submit" class="btn-sm">저장</button><span class="msg" role="status"></span></form>
  </li>`;
}

async function saveReport(e, f, body, filter) {
  e.preventDefault();
  const msg = f.querySelector('.msg');
  const btn = f.querySelector('button');
  btn.disabled = true;
  msg.textContent = '저장하는 중…';
  try {
    const r = await X.api({ a: 'update', key: keyGet(), id: f.dataset.id, status: f.status.value, memo: f.memo.value });
    if (!r.ok) {
      if (r.error === 'key') { keyRejected(body, 'reports'); return; }
      msg.textContent = '저장하지 못했습니다.';
      btn.disabled = false;
      return;
    }
    const it = cache.reports.find((x) => x.id === f.dataset.id);
    if (it) Object.assign(it, { status: f.status.value, memo: f.memo.value, handled: new Date().toISOString() });
    drawReports(body, filter);
  } catch (err) {
    msg.textContent = '저장하지 못했습니다. 인터넷 연결을 확인해 주세요.';
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- 공지 배너
async function noticeView(body) {
  body.innerHTML = '<p class="loading" role="status">공지를 불러오는 중…</p>';
  let n = null;
  try {
    n = (await (await fetch(`${X.API}?a=notice`)).json()).notice;
  } catch (e) { /* 아래에서 빈 공지로 시작 */ }
  if (!X.isLive()) return;
  n = n || { on: false, text: '', level: 'info', updated: '' };
  const { esc } = X;
  body.innerHTML = `<section class="block"><h2>공지 배너</h2>
    <p class="lede">켜 두면 모든 화면 맨 위에 이 문구가 나옵니다. 방문자가 닫으면 그 방문 동안은 다시 나오지 않습니다. 저장한 내용은 2분 안에 반영됩니다.</p>
    <form class="notice-form">
      <label class="field"><span>문구</span><textarea name="text" rows="3" maxlength="300" placeholder="예: 11월 26일 전시 중에는 화면이 느릴 수 있습니다.">${esc(n.text)}</textarea></label>
      <fieldset class="kinds"><legend>종류</legend>
        <label><input type="radio" name="level" value="info"${n.level === 'warn' ? '' : ' checked'}>안내</label>
        <label><input type="radio" name="level" value="warn"${n.level === 'warn' ? ' checked' : ''}>주의</label></fieldset>
      <label class="check"><input type="checkbox" name="show"${n.on ? ' checked' : ''}>사이트에 표시</label>
      <p class="sub-h">미리 보기</p><div class="preview"></div>
      <p class="msg" role="status">${n.updated ? `마지막 저장 ${esc(fmtTime(n.updated))}` : '아직 저장한 공지가 없습니다.'}</p>
      <button type="submit" class="btn">저장</button>
    </form></section>`;
  const form = body.querySelector('form');
  const prev = body.querySelector('.preview');
  const msg = form.querySelector('.msg');
  const draw = () => {
    const t = form.text.value.trim();
    prev.innerHTML = t
      ? `<div class="notice-bar${form.level.value === 'warn' ? ' warn' : ''}"><p>${esc(t)}</p></div>`
      : '<p class="muted">문구를 적으면 여기에 보입니다.</p>';
  };
  form.addEventListener('input', draw);
  draw();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.textContent = '저장하는 중…';
    try {
      const r = await X.api({ a: 'notice', key: keyGet(), on: form.show.checked, text: form.text.value, level: form.level.value });
      if (!r.ok) {
        if (r.error === 'key') { keyRejected(body, 'notice'); return; }
        msg.textContent = '저장하지 못했습니다.';
      } else {
        form.show.checked = r.notice.on;
        msg.textContent = `저장했습니다(${r.notice.on ? '표시 중' : '꺼짐'}). ${fmtTime(r.notice.updated)}`;
      }
    } catch (err) {
      msg.textContent = '저장하지 못했습니다. 인터넷 연결을 확인해 주세요.';
    }
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------- 데이터 현황
async function dataView(body) {
  body.innerHTML = '<p class="loading" role="status">불러오는 중…</p>';
  let st;
  try {
    st = cache.status || (cache.status = await (await fetch('data/status.json', { cache: 'no-cache' })).json());
  } catch (e) {
    if (X.isLive()) body.innerHTML = '<p class="notice">data/status.json을 불러오지 못했습니다.</p>';
    return;
  }
  if (!X.isLive()) return;
  const { esc, chip, GNAME, F, S } = X;
  const m = S.meta;
  const n = (v) => Number(v || 0).toLocaleString();
  const firm = (x) => `<a href="#/firm/${esc(x.c)}">${esc(x.n)}</a> <span class="muted">${esc(x.c)}</span>`;
  const grade = (g) => `${chip(g)} ${esc(GNAME[g] || '판정 불가')}`;
  const table = (head, rows) => `<div class="scroll"><table class="t"><thead><tr>${head.map((h, i) => `<th${i && /^(기업 수|항목 수|평가|건수)$/.test(h) ? ' class="r"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const list = (title, arr, head, row) => (arr.length
    ? `<details class="list"><summary>${title} <b>${n(arr.length)}</b></summary>${table(head, arr.map(row))}</details>` : '');
  const gs = ['1', '2', '3', '4', '5', '6', 'D', '판정 불가'];
  const stName = { listed: '상장', delisted: '상장폐지', kospi: '코스피 이전', other: '기타' };
  const after = st.after.slice().sort((a, b) => (b.kind === 'distress') - (a.kind === 'distress') || b.date.localeCompare(a.date));
  body.innerHTML = `
    <section class="block"><h2>기준</h2><dl class="grid2">
      <div class="kv"><dt>등급 계산</dt><dd>${m.asof}년 결산 공시</dd></div>
      <div class="kv"><dt>실제 결과 확인</dt><dd>${m.asof_outcome}년 결산까지</dd></div>
      <div class="kv"><dt>상장 상태</dt><dd>${esc(F.date(m.asof_status))} 기준</dd></div>
      <div class="kv"><dt>데이터 생성</dt><dd>${esc(fmtTime(st.built))}</dd></div>
      <div class="kv"><dt>기업</dt><dd>${n(m.firms)}개사, ${n(m.firm_years)}개 기업-연도</dd></div>
      <div class="kv"><dt>모형</dt><dd>${esc(m.model)}</dd></div></dl></section>
    <section class="block"><h2>분포</h2><div class="admin-grid">
      ${table(['평가 등급', '기업 수'], gs.map((g) => `<tr><td>${grade(g)}</td><td class="r">${n(st.counts.grade[g])}</td></tr>`))}
      ${table(['상장 상태', '기업 수'], Object.keys(stName).map((k) => `<tr><td>${stName[k]}</td><td class="r">${n(st.counts.status[k])}</td></tr>`))}
      ${table(['요약재무제표 출처', '기업 수'], [['DART 연결', st.counts.fin.CFS], ['DART 별도', st.counts.fin.OFS], ['DataGuide', st.counts.fin.DG], ['재무제표 없음', st.counts.fin.none]]
        .map(([k, v]) => `<tr><td>${k}</td><td class="r">${n(v)}</td></tr>`))}</div></section>
    <section class="block"><h2>경계값 표시</h2>
      <p class="lede">위험도 평가표에서 † 표시가 붙는 항목입니다. 값이 표본의 1%·99% 경계에 걸려 모형에는 경계값이 들어갔습니다. ${n(st.clipped.firms)}개사가 해당합니다.</p>
      ${table(['항목', '항목 수'], Object.entries(st.clipped.items).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${n(v)}</td></tr>`))}</section>
    <section class="block"><h2>확인이 필요한 기업</h2>
      <p class="lede">화면에 따로 안내문이 붙는 기업입니다. 눌러서 펼치면 목록이 나옵니다.</p>
      ${list('평가 뒤 상장폐지', after, ['기업', '평가', '상장폐지일', '구분', '사유'], (x) => `<tr><td>${firm(x)}</td><td class="r">${x.y}년 ${chip(x.g)}</td><td>${esc(x.date)}</td><td>${x.kind === 'distress' ? '부실 사유' : '그 외'}</td><td class="muted">${esc(x.reason || '')}</td></tr>`)}
      ${list('재무제표 안내문', st.fin_note, ['기업', '안내'], (x) => `<tr><td>${firm(x)}</td><td class="muted">${esc(x.note)}</td></tr>`)}
      ${list('평가연도를 앞당긴 기업(마지막 해 판정 불가)', st.eval_note, ['기업', '안내'], (x) => `<tr><td>${firm(x)}</td><td class="muted">${esc(x.note)}</td></tr>`)}
      ${list('연구 패널의 재무 연도가 어긋난 기업', st.input_note, ['기업', '안내'], (x) => `<tr><td>${firm(x)}</td><td class="muted">${esc(x.note)}</td></tr>`)}
      ${list('재무제표가 없는 기업', st.no_fin, ['기업'], (x) => `<tr><td>${firm(x)}</td></tr>`)}
    </section>`;
}
