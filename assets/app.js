// PHANTOM — 코스닥 한계기업 위험도 조회
// 정적 사이트: data/index.json(검색 색인), data/meta.json(등급 기준), data/firms/{종목코드}.json(기업 상세)

const app = document.getElementById('app');
// 오류 신고·공지 저장소(Google Apps Script 웹 앱, apps-script/Code.gs). 비어 있으면 신고 버튼과 공지를 숨긴다.
const API = 'https://script.google.com/macros/s/AKfycby-yi_wFnmS353NlVlcCkMOzWvNzYjLLzih7q4a-MD-oyh9f3gWRO8dgepgRhtVIvd67A/exec';
const S = { index: [], byCode: new Map(), meta: null, firms: new Map(), cur: null, lastFirm: null, seq: 0 };
const EXAMPLES = ['005710', '243070', '065450', '261200', '001810', '134780'];
const GRADES = ['1', '2', '3', '4', '5', '6'];
const GNAME = { 1: '매우 낮음', 2: '낮음', 3: '보통', 4: '주의', 5: '경계', 6: '위험', D: '한계기업' };
const TABS = [['overview', '개요'], ['credit', '신용위험평가표'], ['fin', '요약재무제표'], ['history', '위험도 추이'], ['funding', '자금조달']];
const ICR_STATES = ['무차입', 'ICR 3 이상', 'ICR 1~3', 'ICR<1 1년째', 'ICR<1 2년 연속'];
const ICR_LABEL = {
  '무차입': '빚이 없어 이자비용 없음',
  'ICR 3 이상': '영업이익이 이자의 3배 이상',
  'ICR 1~3': '영업이익이 이자의 1~3배',
  'ICR<1 1년째': '영업이익이 이자보다 적음, 1년째',
  'ICR<1 2년 연속': '영업이익이 이자보다 적음, 2년 연속',
};
const MINUS = '−';

// ------------------------------------------------------------------ 표기
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = (v) => (v > 0 ? '+' : v < 0 ? MINUS : '');
const F = {
  pct: (v, d = 1) => (v == null ? '—' : (v < 0 ? MINUS : '') + Math.abs(v * 100).toFixed(d) + '%'),
  spct: (v, d = 1) => (v == null ? '—' : sgn(v) + Math.abs(v * 100).toFixed(d) + '%'),
  pp: (v, d = 1) => (v == null ? '—' : sgn(v) + Math.abs(v * 100).toFixed(d) + '%p'),
  x: (v, d = 2) => (v == null ? '—' : (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) + '배'),
  pts: (v, d = 1) => (v == null ? '—' : Math.abs(v) < 0.05 ? '0.0' : sgn(v) + Math.abs(v).toFixed(d)),
  num: (v, d = 1) => (v == null ? '—' : (v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d })),
  score: (v) => (v == null ? '—' : v.toFixed(1)),
  date: (s) => {
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${y}년 ${+m}월 ${+d}일`;
  },
};
const scoreOf = (pd) => S.meta.score.a + S.meta.score.b * Math.log(pd / (1 - pd));
const gc = (g) => (GNAME[g] ? 'g-' + g : 'g-na');
const gLabel = (g) => (g === 'D' ? 'D 한계기업' : GNAME[g] ? `${g}등급 ${GNAME[g]}` : '판정 불가');
const chip = (g) => `<span class="chip ${gc(g)}" title="${esc(gLabel(g))}">${GNAME[g] ? esc(g) : '?'}</span>`;
const stateShort = (s) => (!s ? '—' : s.startsWith('D') ? '이미 한계기업' : s);

function shortReason(r) {
  if (!r) return '';
  if (r.includes('종합적으로 고려')) return '상장 적격성 실질심사';
  if (r.includes('최종부도')) return '최종 부도';
  if (r.includes('피흡수합병')) return '흡수합병';
  if (r.includes('완전자회사')) return '완전자회사 편입';
  return r.replace(/\s+/g, ' ').trim();
}
function stLong(s) {
  if (s.t === 'listed') return '코스닥 상장';
  if (s.t === 'delisted') return `${F.date(s.date)} 상장폐지${s.reason ? ` (${shortReason(s.reason)})` : ''}`;
  if (s.t === 'kospi') return '코스피로 이전 상장';
  return s.label;
}
function stShort(r) {
  const s = r.st;
  if (s.t === 'delisted') return `상장폐지 ${s.date ? s.date.slice(0, 4) : ''}`;
  if (s.t === 'kospi') return '코스피 이전';
  if (s.t === 'other') return s.label;
  return '';
}

// ------------------------------------------------------------------ 검색
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const norm = (s) => String(s || '').toLowerCase().replace(/\(주\)|㈜|주식회사|\s+/g, '');
const cho = (s) => [...s].map((ch) => {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
}).join('');

function search(q) {
  const n = norm(q);
  if (!n) return [];
  const isCode = /^\d+$/.test(n);
  const isCho = /^[ㄱ-ㅎ]+$/.test(n);
  const out = [];
  for (const r of S.index) {
    let s = 0;
    if (isCode) {
      if (r.c.startsWith(n)) s = 3;
    } else if (isCho) {
      const i = r._h.indexOf(n);
      if (i === 0) s = 2.5; else if (i > 0) s = 1;
    } else {
      r._k.forEach((k, j) => {
        const w = j === 0 ? 0 : 0.3;
        if (k === n) s = Math.max(s, 4 - w);
        else if (k.startsWith(n)) s = Math.max(s, 3 - w);
        else if (k.includes(n)) s = Math.max(s, 2 - w);
      });
    }
    if (s > 0) out.push([s + (r.st.t === 'listed' ? 0.1 : 0), r]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].n.length - b[1].n.length || a[1].n.localeCompare(b[1].n, 'ko'));
  return out.slice(0, 8).map((x) => x[1]);
}

const ICON_SEARCH = '<svg class="search-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';
const ICON_GO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const searchForm = (id) => `<form class="search" role="search" data-search>
  <div class="search-box">${ICON_SEARCH}
    <input id="${id}" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false"
      placeholder="기업명 또는 종목코드" aria-label="기업명 또는 종목코드로 검색"
      role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
    <button class="search-go" type="submit" aria-label="검색">${ICON_GO}</button>
  </div>
  <ul class="suggest" id="${id}-list" role="listbox" aria-label="검색 결과" hidden></ul>
</form>`;

function bindSearch(form) {
  if (!form) return;
  const input = form.querySelector('input');
  const list = form.querySelector('.suggest');
  let items = [];
  let active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const draw = () => {
    const q = input.value.trim();
    if (!q) return close();
    if (!items.length) {
      list.innerHTML = `<li class="empty" role="option" aria-disabled="true">‘${esc(q)}’에 맞는 기업이 없습니다. 코스닥 제조업 ${S.index.length.toLocaleString()}개사 안에서 찾습니다.</li>`;
    } else {
      list.innerHTML = items.map((r, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === active}" data-code="${r.c}">
        ${chip(r.g)}
        <span class="s-main"><b>${esc(r.n)}</b><span class="s-code">${r.c}</span><span class="s-sub">${esc(r.i)}</span></span>
        <span class="s-st">${esc(stShort(r))}</span></li>`).join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('input', () => { items = search(input.value); active = items.length ? 0 : -1; draw(); });
  input.addEventListener('focus', () => { if (input.value.trim()) { items = search(input.value); active = items.length ? 0 : -1; draw(); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-code]');
    if (li) { e.preventDefault(); openFirm(li.dataset.code); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = items[active] || search(input.value)[0];
    if (r) openFirm(r.c); else { items = []; draw(); }
  });
}
const openFirm = (code) => { location.hash = `#/firm/${code}`; };

// ------------------------------------------------------------------ 공통 틀
const topBar = (active = '') => `<header class="top"><div class="top-in">
  <a class="brand" href="#/" aria-label="PHANTOM 첫 화면">PHANTOM</a>
  ${searchForm('tq')}
  <a class="top-link" href="#/about"${active === 'about' ? ' aria-current="page"' : ''}>모형 안내</a>
</div></header>`;

const reportBtn = () => (API ? '<button type="button" class="linkish" data-report>오류 신고</button>' : '');
const footNote = () => `<footer class="foot"><p>PHANTOM은 광운대학교 참빛설계학기 연구 모형의 추정치를 보여 줍니다. 등급은 ${S.meta.asof}년 결산 공시로 계산했고, 실제 결과는 ${S.meta.asof_outcome}년 결산까지, 상장 상태는 ${F.date(S.meta.asof_status)} 기준으로 확인했습니다. 투자 권유나 신용평가가 아닙니다. 모형의 계수는 함께 나타나는 경향(연관)을 뜻할 뿐 원인을 뜻하지 않습니다.</p>
  <p class="foot-links"><a href="#/about">모형 안내</a>${reportBtn()}</p></footer>`;
const disclaim = () => `<p class="disclaim">연구 모형의 추정치이며 투자 권유나 신용평가가 아닙니다. <a href="#/about">계산 방법 보기</a>${reportBtn()}</p>`;

// ------------------------------------------------------------------ 첫 화면
function renderHome() {
  document.title = 'PHANTOM | 코스닥 한계기업 위험도 조회';
  const ex = EXAMPLES.map((c) => S.byCode.get(c)).filter(Boolean)
    .map((r) => `<a class="ex" href="#/firm/${r.c}"><i class="dot ${gc(r.g)}"></i>${esc(r.n)}</a>`).join('');
  app.innerHTML = `<div class="home">
    <nav class="home-nav" aria-label="보조"><a href="#/about">모형 안내</a>${reportBtn()}</nav>
    <main class="home-main">
      <h1 class="wordmark" aria-label="PHANTOM">${[...'PHANTOM'].map((c, i) => `<span aria-hidden="true" style="animation-delay:${i * 80}ms">${c}</span>`).join('')}</h1>
      <p class="tagline">코스닥 제조업 기업이 3년 안에 한계기업이 될 위험을 조회합니다</p>
      ${searchForm('q')}
      <div class="examples"><span class="ex-label">예시</span>${ex}</div>
    </main>
    <footer class="home-foot">${S.meta.asof}년 결산 공시를 바탕으로 한 연구 모형의 추정치이며, 투자 권유나 신용평가가 아닙니다.<br>광운대학교 참빛설계학기 연구팀</footer>
  </div>`;
  bindSearch(app.querySelector('[data-search]'));
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) app.querySelector('#q').focus();
}

// ------------------------------------------------------------------ 기업 화면
async function renderFirm(code, tab, seq) {
  const r = S.byCode.get(code);
  if (!r) return renderMissing(code);
  document.title = `${r.n} | PHANTOM`;
  let f = S.firms.get(code);
  if (!f) {
    // 0.15초 넘게 걸리면 불러오는 중임을 보여 준다. 그사이 다른 화면으로 옮겼으면(seq가 바뀜) 늦게 온 응답은 버린다.
    const wait = setTimeout(() => {
      if (seq === S.seq) app.innerHTML = `${topBar()}<main class="page">${firmHead(r, null)}<p class="loading" role="status">불러오는 중…</p></main>`;
    }, 150);
    try {
      f = await getJSON(`data/firms/${code}.json`);
      S.firms.set(code, f);
    } catch (e) {
      f = null;
    } finally {
      clearTimeout(wait);
    }
    if (seq !== S.seq) return;
  }
  S.cur = f;
  if (!f) {
    app.innerHTML = `${topBar()}<main class="page">${firmHead(r, null)}<div class="notice" role="alert">자료를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.
      <button type="button" class="btn-sm" data-retry>다시 시도</button></div>${footNote()}</main>`;
    app.querySelector('[data-retry]').addEventListener('click', route);
    bindSearch(app.querySelector('[data-search]'));
    S.lastFirm = null;
    return;
  }
  app.innerHTML = `${topBar()}<main class="page">${firmHead(r, f)}${tabsNav(code, tab)}<div class="tab-body">${RENDER[tab](f)}</div>${footNote()}</main>`;
  bindSearch(app.querySelector('[data-search]'));
  drawCharts();
  fitScrollers();
  if (S.lastFirm !== code) window.scrollTo(0, 0);
  else {
    const t = app.querySelector('.tabs');
    if (t) {
      const y = t.getBoundingClientRect().top + window.scrollY - 72;
      if (window.scrollY > y) window.scrollTo(0, y);
    }
  }
  S.lastFirm = code;
}

function firmHead(r, f) {
  const year = f ? f.eval.year : r.y;
  const facts = [['업종', r.i], ['평가 기준', `${year}년 결산`], ['상태', stLong(r.st)]];
  return `<header class="firm-head"><h1>${esc(r.n)}<span class="code">${r.c}</span></h1>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></header>`;
}
const tabsNav = (code, tab) => `<nav class="tabs" aria-label="상세 화면">${TABS.map(([id, label]) =>
  `<a href="#/firm/${code}${id === 'overview' ? '' : '/' + id}"${id === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;

// 가로로 넘치는 탭 줄과 표: 현재 탭을 가운데로, 자금조달 표는 최근 연도가 보이게, 오른쪽에 더 있으면 끝을 흐리게
function fitScrollers() {
  const tabs = app.querySelector('.tabs');
  const cur = tabs && tabs.querySelector('[aria-current]');
  if (cur && tabs.scrollWidth > tabs.clientWidth) {
    tabs.scrollLeft += cur.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - cur.offsetWidth) / 2;
  }
  for (const t of app.querySelectorAll('.mx')) {
    const sc = t.closest('.scroll');
    if (sc) sc.scrollLeft = sc.scrollWidth;
  }
  for (const el of app.querySelectorAll('.tabs, .scroll')) {
    const mark = () => el.classList.toggle('more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    if (!el.dataset.fit) {
      el.addEventListener('scroll', mark, { passive: true });
      el.dataset.fit = '1';
    }
    mark();
  }
}

// ---------- 판정 구역
function ramp(cur) {
  const cells = GRADES.map((g) => `<div class="r-cell ${gc(g)}${g === cur ? ' is-cur' : ''}">${g}</div>`).join('')
    + `<div></div><div class="r-cell g-D${cur === 'D' ? ' is-cur' : ''}">D</div>`;
  const names = GRADES.map((g) => `<div class="r-name${g === cur ? ' is-cur' : ''}">${GNAME[g]}</div>`).join('')
    + `<div></div><div class="r-name${cur === 'D' ? ' is-cur' : ''}">한계기업</div>`;
  return `<div class="ramp" role="img" aria-label="${esc(gLabel(cur))}. 척도는 1등급 매우 낮음부터 6등급 위험까지, 그리고 이미 한계기업인 D">${cells}${names}</div>`;
}

function verdict(g, score, pd, year) {
  return `<section class="verdict" aria-label="위험도 판정">
    <div class="v-grade"><span class="v-num">${esc(g)}</span><div><div class="v-name">${GNAME[g]}</div><div class="v-cap">위험도 등급</div></div></div>
    <dl class="v-stats">
      <div class="stat"><dt>위험도 점수</dt><dd>${F.score(score)}</dd></div>
      <div class="stat"><dt>${year + 1}~${year + 3}년 한계기업 진입 확률</dt><dd>${F.pct(pd)}</dd></div>
    </dl>${ramp(g)}</section>`;
}

function verdictD(e, icrYears) {
  const yrs = (icrYears || []).map((x) => `<div class="stat"><dt>${x.y}년 이자보상배율</dt><dd>${F.x(x.icr)}</dd></div>`).join('');
  return `<section class="verdict" aria-label="위험도 판정">
    <div class="v-grade"><span class="v-num">D</span><div><div class="v-name">한계기업</div><div class="v-cap">이미 한계기업</div></div></div>
    <dl class="v-stats">${yrs}</dl>${ramp('D')}</section>
    <p class="calib">영업이익으로 이자비용을 갚지 못하는 상태(이자보상배율 1 미만)가 ${e && e.icr_streak ? `${e.icr_streak}년` : '3년 이상'} 이어져 이미 한계기업입니다. PHANTOM은 아직 한계기업이 아닌 기업이 3년 안에 한계기업이 될 확률을 계산하므로, 이 기업에는 진입 확률과 점수를 매기지 않습니다.</p>`;
}

function verdictNA(year) {
  return `<section class="verdict" aria-label="위험도 판정">
    <div class="v-grade"><span class="v-num">?</span><div><div class="v-name">판정 불가</div><div class="v-cap">${year}년 결산</div></div></div>
    <dl class="v-stats"></dl>${ramp('')}</section>
    <p class="calib">빚은 있는데 이자비용 자료가 없거나 재무 자료가 비어 있어 이자상환 상태를 정할 수 없습니다. 그래서 진입 확률을 계산하지 않았습니다.</p>`;
}

function calib(e) {
  const c = e.calibration;
  if (!c) return '';
  return `<p class="calib">같은 ${e.grade}등급(${GNAME[e.grade]})으로 매겨진 기업-연도 ${c.n.toLocaleString()}개 가운데 실제로 3년 안에 한계기업이 된 비율은 <b>${F.pct(c.rate)}</b>였습니다. <span class="muted">2017~2022년 표본 밖 검증, 95% 구간 ${F.pct(c.lo)}~${F.pct(c.hi)}</span></p>`;
}

const stagesTable = (e) => `<div class="scroll"><table class="t"><thead><tr><th>단계</th><th>더한 항목</th><th class="r">진입 확률</th><th class="r">위험도 점수</th><th>등급</th></tr></thead><tbody>
  ${e.stages.map((s, i) => `<tr${i === e.stages.length - 1 ? ' class="total"' : ''}><td>${esc(s.name)}</td><td class="muted">${esc(s.adds)}</td>
    <td class="r">${F.pct(s.pd)}</td><td class="r">${F.score(scoreOf(s.pd))}</td><td>${chip(s.grade)} ${GNAME[s.grade]}</td></tr>`).join('')}
  </tbody></table></div>`;

// ---------- 항목 표시
function displayItems(f) {
  const e = f.eval;
  const by = Object.fromEntries(e.items.map((i) => [i.key, i]));
  const sum = (keys) => (keys.some((k) => by[k].pts == null) ? null : keys.reduce((a, k) => a + by[k].pts, 0));
  const fy = f.funding.find((x) => x.y === e.year) || {};
  const rows = [{
    key: 'ICR', domain: '이자상환 상태', group: '이자상환 능력', label: '이자상환 상태',
    value: e.icr != null ? `ICR ${F.x(e.icr)}` : stateShort(e.state), sub: ICR_LABEL[e.state] || stateShort(e.state),
    pos: ICR_STATES.indexOf(e.state) + 1, posKind: 'state', pts: sum(['S1_ICR미만1년', 'S2_ICR미만2년', 'ICR1_3', '무차입']), sig: true,
  }];
  for (const it of e.items) {
    if (['S1_ICR미만1년', 'S2_ICR미만2년', 'ICR1_3', '무차입', '지분율결측'].includes(it.key)) continue;
    const row = {
      key: it.key, domain: it.domain, group: it.group, label: it.label, value: valText(it), pos: it.pos, pct: it.pct,
      posKind: it.kind === 'cont' ? 'pct' : null, pts: it.pts ?? null, sig: it.sig, clipped: it.clipped,
    };
    if (it.key === '지분율') {
      row.pts = sum(['지분율', '지분율결측']);
      if (by['지분율결측'].value === 1) { row.value = '공시 없음'; row.sub = '중앙값 36.12%로 계산'; row.posKind = null; }
    }
    if (it.key === '메자닌발행' && it.value === 1 && fy.mezz_n) {
      row.sub = `${fy.mezz_n}건${fy.mezz_ratio ? `, 자산의 ${F.pct(fy.mezz_ratio)}` : ''}`;
    }
    if (it.clipped) {
      // 패널 값이 표본 1%·99% 경계에 걸린 항목: 모형에는 경계값이 들어갔고, 실제 값은 그 밖일 수 있다.
      const hi = it.clipped === 'hi';
      const clip = `${hi ? '상한' : '하한'}값 적용, ${it.actual ? `실제 ${it.actual}` : `실제는 이보다 ${hi ? '클' : '작을'} 수 있음`}`;
      row.sub = row.sub ? `${row.sub}, ${clip}` : clip;
    }
    rows.push(row);
  }
  return rows;
}

function valText(it) {
  const v = it.value;
  if (v == null) return '—';
  switch (it.key) {
    case '부채비율': case 'ROA': case '영업CF자산': case '유형자산비율': case '관계사투자비율': case '매입채무비율':
      return F.pct(v, v !== 0 && Math.abs(v) < 0.01 ? 2 : 1);
    case '부채비율변화': return F.pp(v);
    case '유동비율': return F.x(v);
    case '매출증가율': return F.spct(v);
    case 'ln자산': return `${F.num(Math.exp(v) / 1e8, 0)}억원`;
    case 'ln업력': return `${Math.round(Math.exp(v) - 1)}년`;
    case '지분율': return `${v.toFixed(2)}%`;
    case '보유_직접': case '보유_보증': case '보유_기은': return v === 1 ? '보유' : '보유 안 함';
    case '메자닌발행': return v === 1 ? '발행' : '발행 안 함';
    default: return String(v);
  }
}

function posCell(r) {
  if (!r.posKind || !r.pos) return '<span class="muted">—</span>';
  const title = r.posKind === 'state'
    ? `위험이 낮은 쪽부터 무차입, ICR 3 이상, 1~3, 1 미만 1년째, 1 미만 2년 연속 순서 중 ${r.pos}번째`
    : `같은 해 분포에서 아래부터 ${Math.round(r.pct * 100)}% 지점`;
  return `<span class="pos" title="${esc(title)}" role="img" aria-label="${esc(`5칸 중 ${r.pos}번째, 1칸이 위험이 가장 낮은 쪽`)}">${[1, 2, 3, 4, 5].map((i) => `<i${i === r.pos ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

// ---------- 탭: 개요
function overview(f) {
  const e = f.eval;
  const note = e.note ? `<p class="note">${esc(e.note)}</p>` : '';
  const head = disclaim() + afterNotice(f);
  if (e.grade === 'D') return verdictD(e, e.icr_years) + head + note + stripBlock(f);
  if (!GNAME[e.grade]) return verdictNA(e.year) + head + note + stripBlock(f);
  return verdict(e.grade, e.score, e.pd, e.year) + head + calib(e) + note
    + `<section class="block"><h2>단계별 결과</h2><p class="lede">기업 내부 정보만 쓴 식에서 시작해 정책금융과 메자닌 정보를 차례로 더한 결과입니다. 마지막 줄이 최종 판정입니다.</p>${stagesTable(e)}</section>`
    + `<section class="block"><h2>점수 구성</h2><p class="lede">같은 업종의 평균적인 기업에서 출발해, 영역마다 이 기업이 평균과 다른 만큼 점수가 오르내립니다. 점수가 40점 오르면 진입 오즈가 두 배가 됩니다.</p>
        <div class="chart" data-chart="waterfall"></div>
        <div class="legend"><span><i style="background:var(--up)"></i>점수를 올림</span><span><i style="background:var(--down)"></i>점수를 낮춤</span><span><i style="background:repeating-linear-gradient(45deg,var(--ink-3) 0 2px,#fff 2px 5px);outline:1px solid var(--ink-3)"></i>통계적으로 유의하지 않음</span><span><svg width="14" height="12" aria-hidden="true"><path d="M7 0v12" stroke="#cfcddd" stroke-width="1.5" stroke-dasharray="3 3"/></svg>등급 경계(3|4는 3등급과 4등급 사이)</span></div></section>`
    + moversBlock(f) + stripBlock(f);
}

// 평가 뒤에 상장폐지된 기업: 모형은 3년 안의 부실 사유 상장폐지도 한계기업 진입과 같은 결과로 본다.
function afterNotice(f) {
  const a = f.eval.after;
  if (!a) return '';
  const why = shortReason(f.status.reason);
  const head = `이 기업은 평가 뒤인 ${F.date(a.date)}에 상장폐지되었습니다${why ? `(${esc(why)})` : ''}.`;
  return a.kind === 'distress'
    ? `<p class="notice">${head} 모형은 3년 안의 부실 사유 상장폐지도 한계기업 진입과 같은 결과로 보므로, 이 평가의 실제 결과는 ‘진입’입니다. 위 등급은 ${f.eval.year}년 결산 시점의 추정치입니다.</p>`
    : `<p class="notice">${head} 부실 사유의 상장폐지가 아니어서 3년 안 결과는 판정하지 않습니다.</p>`;
}

function moversBlock(f) {
  const rows = displayItems(f).filter((r) => r.pts != null && r.sig);
  const ups = rows.filter((r) => r.pts >= 0.05).sort((a, b) => b.pts - a.pts).slice(0, 3);
  const downs = rows.filter((r) => r.pts <= -0.05).sort((a, b) => a.pts - b.pts).slice(0, 3);
  const li = (r) => `<li><div>${esc(r.label)}<span>${esc(r.value)}${r.sub ? `, ${esc(r.sub)}` : ''}</span></div><div class="${r.pts > 0 ? 'up' : 'down'}">${F.pts(r.pts)}점</div></li>`;
  const col = (title, arr) => `<div><h3>${title}</h3><ol>${arr.length ? arr.map(li).join('') : '<li><div class="muted">해당 항목 없음</div></li>'}</ol></div>`;
  const debt = [...ups, ...downs].some((r) => r.key === '부채비율변화')
    ? ' 부채비율 변화는 부채비율 수준을 함께 넣은 식의 계수라, 수준이 같은 기업끼리 비교한 연관입니다. 그래서 부채비율이 늘었는데 점수가 낮아질 수 있습니다.' : '';
  return `<section class="block"><h2>점수를 크게 움직인 항목</h2><p class="lede">같은 업종 평균 기업과 비교해 점수를 가장 많이 올리거나 낮춘 항목입니다. 5% 수준에서 통계적으로 유의한 항목만 골랐습니다. 점수는 다른 항목이 같을 때 함께 나타나는 경향(연관)이며, 그 항목이 위험의 원인이라는 뜻은 아닙니다.${debt}</p>
    <div class="movers">${col('점수를 올린 항목', ups)}${col('점수를 낮춘 항목', downs)}</div></section>`;
}

function stripBlock(f) {
  const h = f.history;
  return `<section class="block"><h2>연도별 등급</h2><p class="lede">${h[0].y}~${h[h.length - 1].y}년 결산 기준입니다. 누르면 위험도 추이로 넘어갑니다.</p>
    <a class="strip" href="#/firm/${f.code}/history" aria-label="연도별 등급. 위험도 추이 보기">${h.map((x) =>
      `<span class="s-cell ${gc(x.g)}" title="${x.y}년 ${esc(gLabel(x.g))}"><b>${GNAME[x.g] ? esc(x.g) : '?'}</b><i>’${String(x.y).slice(2)}</i></span>`).join('')}</a></section>`;
}

// ---------- 탭: 신용위험평가표
function credit(f) {
  const e = f.eval;
  const p = f.profile;
  const kv = [
    ['종목코드', f.code], ['기업명', f.name], ['업종', f.industry], ['세부 업종', p.ksic_small],
    ['설립일', F.date(p.founded)], ['업력', p.age != null ? `${p.age}년` : null], ['상장일', F.date(p.listed)],
    ['결산월', p.fiscal_month ? `${p.fiscal_month}월` : null],
    ['최대주주 지분율', p.owner_pct != null ? `${p.owner_pct.toFixed(2)}%` : '공시 없음'], ['상태', stLong(f.status)],
  ];
  const graded = !!GNAME[e.grade] && e.grade !== 'D';
  const s1 = `<section class="block"><h2>1. 기업 개요</h2><dl class="grid2">${kv.map(([k, v]) => `<div class="kv"><dt>${k}</dt><dd>${esc(v ?? '—')}</dd></div>`).join('')}</dl></section>`;
  const s2 = `<section class="block"><h2>2. 위험도 등급 결과</h2>${graded
    ? `<p class="lede">재무 기준 ${e.year}년 결산, 평가 대상 기간 ${e.year + 1}~${e.year + 3}년</p>${stagesTable(e)}`
    : `<p class="lede">${e.grade === 'D' ? `${e.year}년 결산 기준으로 이미 한계기업(D)이라 진입 확률을 계산하지 않습니다.` : '이자상환 상태를 정할 자료가 없어 판정하지 않았습니다.'}</p>`}</section>`;
  const s3 = `<section class="block"><h2>3. 항목별 상세</h2><p class="lede">위험도 점수식에 들어가는 항목만 보여 줍니다. 같은 해 위치는 그해 아직 한계기업이 아닌 코스닥 제조업 기업 사이에서 이 기업이 놓인 5분위입니다. 막대는 왼쪽일수록 모형에서 위험이 낮은 쪽이며, 방향은 모형 계수의 부호를 따릅니다.</p>
    ${e.input_note ? `<p class="note">${esc(e.input_note)}</p>` : ''}
    ${itemTable(f, graded)}
    <p class="note">${graded ? '점수 기여 = 57.71 × 계수 × (이 기업 값 − 표본 평균). 정책금융 세 유형과 메자닌은 해당 여부로 계산합니다. ' : ''}†는 값이 표본의 1%·99% 경계에 걸려 모형에 경계값을 넣은 항목이며, 실제 값은 그보다 크거나 작을 수 있습니다. 흐린 줄은 5% 수준에서 통계적으로 유의하지 않은 항목입니다.</p></section>`;
  return s1 + s2 + s3;
}

function itemTable(f, graded) {
  const e = f.eval;
  const rows = displayItems(f);
  const domPts = Object.fromEntries((e.domains || []).map((d) => [d.name, d.pts]));
  const cols = graded ? 5 : 4;
  let body = graded ? `<tr class="base"><td colspan="4">같은 업종 평균 기업의 점수(출발점)</td><td class="r">${F.score(e.base_score)}</td></tr>` : '';
  for (const d of ['이자상환 상태', '기업 내부 재무', '정책금융', '메자닌']) {
    const rs = rows.filter((r) => r.domain === d);
    const multi = rs.length > 1;
    body += `<tr class="dom"><th colspan="${graded ? 4 : cols}">${d}${d === '정책금융' ? ' <span class="ns-tag">세 유형을 함께 봐도 유의하지 않음</span>' : ''}</th>${graded ? `<th class="r">${multi ? `소계 ${F.pts(domPts[d])}` : ''}</th>` : ''}</tr>`;
    for (const r of rs) {
      const cls = r.pts > 0.05 ? 'up' : r.pts < -0.05 ? 'down' : '';
      body += `<tr${r.sig ? '' : ' class="ns"'}><td class="grp c-grp">${esc(r.group)}</td>
        <td class="c-lab">${esc(r.label)}${r.sig ? '' : '<span class="ns-tag">유의하지 않음</span>'}</td>
        <td class="r c-val">${esc(r.value)}${r.clipped ? '<sup title="모형에는 표본 경계값을 넣었습니다">†</sup>' : ''}${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</td>
        <td class="c-pos">${posCell(r)}</td>${graded ? `<td class="r c-pts ${cls}">${F.pts(r.pts)}</td>` : ''}</tr>`;
    }
  }
  if (graded) body += `<tr class="total"><td colspan="4">위험도 점수</td><td class="r">${F.score(e.score)}</td></tr>`;
  return `<div class="scroll"><table class="t items"><thead><tr><th>구분</th><th>평가항목</th><th class="r">업체값</th>
    <th><span class="pos-head" aria-label="같은 해 위치, 왼쪽이 위험 낮은 쪽"><span>위험 낮음</span><span>위험 높음</span></span></th>${graded ? '<th class="r">점수 기여</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- 탭: 요약재무제표
function fin(f) {
  const d = f.fin;
  const by = Object.fromEntries(d.rows.map((r) => [r.k, r.v]));
  const strong = new Set(['자산총계', '부채총계', '자본총계', '매출액']);
  const tr = (k) => `<tr><td${strong.has(k) ? ' style="font-weight:600"' : ''}>${k === '이익잉여금' ? '이익잉여금(결손금)' : k}</td>${(by[k] || [null, null, null]).map((v) => `<td class="r">${F.num(v, 1)}</td>`).join('')}</tr>`;
  const head = `<thead><tr><th>계정</th>${d.years.map((y) => `<th class="r">${y}년</th>`).join('')}</tr></thead>`;
  const t1 = `<div class="scroll"><table class="t fin">${head}<tbody>
    <tr class="grp"><th colspan="4">재무상태표</th></tr>${['자산총계', '유동자산', '비유동자산', '부채총계', '유동부채', '비유동부채', '자본총계', '이익잉여금'].map(tr).join('')}
    <tr class="grp"><th colspan="4">손익계산서</th></tr>${['매출액', '영업이익', '당기순이익'].map(tr).join('')}</tbody></table></div>`;
  const R = [
    ['ICR', '이자보상배율(영업이익÷이자비용)', (v) => F.x(v)], ['부채비율', '부채비율(부채÷자산)', F.pct], ['부채비율변화', '부채비율 변화', F.pp],
    ['유동비율', '유동비율', (v) => F.x(v)], ['ROA', 'ROA(순이익÷자산)', F.pct], ['영업CF자산', '영업현금흐름÷자산', F.pct],
    ['매출증가율', '매출액 증가율', F.spct], ['유형자산비율', '유형자산÷자산', F.pct], ['관계사투자비율', '관계사 투자÷자산', F.pct],
    ['매입채무비율', '매입채무÷자산', F.pct], ['지분율', '최대주주 지분율', (v) => (v == null ? '—' : `${v.toFixed(2)}%`)],
  ];
  const t2 = `<div class="scroll"><table class="t fin"><thead><tr><th>비율</th>${d.ratios.map((x) => `<th class="r">${x.y}년</th>`).join('')}</tr></thead><tbody>
    ${R.map(([k, label, fmt]) => `<tr><td>${label}</td>${d.ratios.map((x) => `<td class="r">${x[k] == null ? '—' : fmt(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<section class="block"><h2>요약재무제표</h2><p class="lede">단위 ${esc(d.unit)}. 출처 ${esc(d.source)}.</p>${t1}${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}</section>
    <section class="block"><h2>위험도 점수식에 들어가는 비율</h2><p class="lede">연구 패널의 값입니다(DataGuide 주재무제표, 연결 우선). 표본의 1%·99% 경계로 다듬은 값이라 위 재무제표로 직접 계산한 값과 조금 다를 수 있습니다.</p>${t2}</section>`;
}

// ---------- 탭: 위험도 추이
function outcomeText(h) {
  if (h.y3 === 1) return '진입';
  if (h.ev === 'delist') return '진입(부실 사유 상장폐지)';
  if (h.y3 === 0) return '진입 안 함';
  if (h.g === 'D') return '이미 한계기업';
  if (h.y > 2022) return '아직 확정 전';
  return '판단 불가';
}
function historyTab(f) {
  const rows = f.history.slice().reverse().map((h) => `<tr><td>${h.y}년</td><td>${chip(h.g)} ${esc(GNAME[h.g] || '판정 불가')}</td>
    <td class="r">${F.score(h.score)}</td><td class="r">${F.pct(h.pd)}</td><td>${esc(stateShort(h.state))}</td><td class="r">${F.x(h.icr)}</td><td>${outcomeText(h)}</td></tr>`).join('');
  return `<section class="block"><h2>위험도 추이</h2><p class="lede">해마다 그해 결산으로 매긴 위험도 점수입니다. 바탕의 띠는 등급 구간, 맨 위 줄은 이미 한계기업이었던 해, 맨 아래 줄은 실제로 3년 안에 한계기업이 되었는지(2022년 결산까지 확정)입니다.</p>
      <div class="chart" data-chart="history"></div>
      <div class="legend"><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#1b1930"/></svg>3년 안에 진입</span><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="#6e6c86" stroke-width="1.5"/></svg>진입 안 함</span><span><i style="background:var(--gD)"></i>이미 한계기업(D)</span></div></section>
    <section class="block"><h2>연도별 표</h2><div class="scroll"><table class="t"><thead><tr><th>결산 연도</th><th>등급</th><th class="r">위험도 점수</th><th class="r">진입 확률</th><th>이자상환 상태</th><th class="r">ICR</th><th>3년 안 실제 결과</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ---------- 탭: 자금조달
function fundingTab(f) {
  const xs = f.funding;
  const dot = (v) => (v === 1 ? '<span class="held" role="img" aria-label="있음"></span>' : v === 0 ? '<span class="none" aria-label="없음">·</span>' : '<span class="none" aria-label="기록 없음">–</span>');
  const row = (label, fn, sub = '') => `<tr><td>${label}${sub ? `<span class="sub">${sub}</span>` : ''}</td>${xs.map((x) => `<td>${fn(x)}</td>`).join('')}</tr>`;
  const span = xs.length + 1;
  return `<section class="block"><h2>자금조달</h2><p class="lede">해마다 정책금융 대출·보증을 받고 있었는지(사업보고서 주석 원문 판독)와 메자닌 발행 결정이 있었는지입니다.</p>
    <div class="scroll"><table class="t mx"><thead><tr><th>항목</th>${xs.map((x) => `<th>${x.y}</th>`).join('')}</tr></thead><tbody>
    <tr class="grp"><th colspan="${span}">정책금융 보유</th></tr>
    ${row('직접대출형', (x) => dot(x.direct), '산업은행·수출입은행')}
    ${row('보증·정책자금형', (x) => dot(x.guar), '신용보증기금·기술보증기금·중소벤처기업진흥공단')}
    ${row('기업은행', (x) => dot(x.ibk))}
    <tr class="grp"><th colspan="${span}">메자닌 발행(CB·BW·EB)</th></tr>
    ${row('발행 건수', (x) => (x.mezz_n ? `${x.mezz_n}건` : dot(x.mezz)))}
    ${row('발행액÷자산', (x) => (x.mezz_ratio ? F.pct(x.mezz_ratio) : dot(x.mezz)))}
    ${row('리픽싱 조건', (x) => dot(x.refix), '2020년 공시부터 기록')}
    </tbody></table></div>
    <p class="note">● 있음, · 없음, – 기록 없음. 연구 결과에서 재무 상태가 같다면 정책금융 보유는 한계기업 진입과 뚜렷한 연관이 없었고(세 유형 결합 p = 0.46), 메자닌을 발행한 해에는 3년 안 진입 오즈가 약 1.8배 높았습니다.</p></section>`;
}

const RENDER = { overview, credit, fin, history: historyTab, funding: fundingTab };

function renderMissing(code) {
  document.title = 'PHANTOM';
  app.innerHTML = `${topBar()}<main class="page"><header class="firm-head"><h1>찾는 기업이 없습니다</h1></header>
    <p class="lede" style="margin-top:12px">종목코드 ${esc(code)}는 PHANTOM 표본(2013~2024년 코스닥 제조업)에 없습니다. 위 검색창에서 기업명으로 찾아보세요.</p>${footNote()}</main>`;
  bindSearch(app.querySelector('[data-search]'));
}

// ------------------------------------------------------------------ 모형 안내
function renderAbout() {
  document.title = '모형 안내 | PHANTOM';
  const g = S.meta.grades;
  const dist = S.meta.dist2024;
  const gradeRows = g.map((x) => `<tr><td>${chip(x.g)} ${esc(x.name)}</td><td class="r">${esc(x.pd)}</td><td class="r">${esc(x.score)}</td>
    <td class="r">${x.oos_rate == null ? '—' : `<b>${F.pct(x.oos_rate)}</b>`}</td><td class="r muted">${x.oos_rate == null ? '' : `${F.pct(x.oos_lo)}~${F.pct(x.oos_hi)}`}</td>
    <td class="r">${x.oos_n == null ? '—' : x.oos_n.toLocaleString()}</td><td class="r">${(dist[x.g] ?? 0).toLocaleString()}</td></tr>`).join('');
  app.innerHTML = `${topBar('about')}<main class="page">
    <header class="firm-head"><h1>모형 안내</h1></header>
    <section class="block"><div class="prose">
      <p>PHANTOM은 코스닥 제조업 기업이 앞으로 3년 안에 한계기업이 될 위험을 보여 줍니다. 한계기업은 영업이익으로 이자비용을 갚지 못하는 상태(이자보상배율 1 미만)가 3년 연속 이어진 기업입니다.</p>
      <p>위험은 2013~2022년 코스닥 제조업 995개사, 6,633개 기업-연도로 추정한 로지스틱 회귀식으로 계산합니다. 한 해의 결산 자료를 넣으면 다음 3년 안에 한계기업이 되거나 부실 사유로 상장폐지될 확률이 나옵니다. 그 기간에 실제로 진입한 경우는 1,251건(18.9%)이었습니다.</p>
    </div></section>
    <section class="block"><h2>등급 기준</h2><p class="lede">진입 확률이 두 배가 될 때마다 한 등급씩 올라갑니다. 실제 진입률은 점수식을 만들 때 쓰지 않은 해(2017~2022년)에 각 등급 기업이 실제로 한계기업이 된 비율입니다.</p>
      <div class="scroll"><table class="t"><thead><tr><th>등급</th><th class="r">진입 확률</th><th class="r">위험도 점수</th><th class="r">실제 진입률</th><th class="r">95% 구간</th><th class="r">기업-연도</th><th class="r">2024년 기업 수</th></tr></thead><tbody>${gradeRows}
      <tr><td>${chip('판정 불가')} 판정 불가</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td></td><td class="r">—</td><td class="r">${(dist['판정 불가'] ?? 0).toLocaleString()}</td></tr></tbody></table></div>
      <p class="note">2024년 결산 기준 ${Object.values(dist).reduce((a, b) => a + b, 0).toLocaleString()}개사. 표본 밖 검증의 AUC는 0.826입니다(진입 기업과 진입하지 않은 기업을 하나씩 골랐을 때 진입 기업의 점수가 더 높을 확률).</p></section>
    <section class="block"><h2>점수식</h2><div class="prose">
      <div class="formula">진입 확률 = 1 ÷ (1 + e<sup>−z</sup>)<br>z = 상수 + 업종 + Σ 계수 × 항목 값<br>위험도 점수 = 500 + 57.71 × ln(진입 확률 ÷ (1 − 진입 확률))</div>
      <p>항목은 이자상환 상태 4개, 기업 내부 재무 11개(부채비율, 부채비율 변화, 유동비율, ROA, 영업현금흐름÷자산, 매출액 증가율, 자산 규모, 업력, 유형자산÷자산, 관계사 투자÷자산, 매입채무÷자산), 최대주주 지분율 2개, 정책금융 보유 3유형, 메자닌 발행 1개와 업종입니다. 상수는 최근 3년(2020~2022년) 실제 진입률 20.8%에 맞췄고, 위험도 점수는 40점 오를 때마다 진입 오즈가 두 배가 됩니다.</p>
      <p>개요 화면의 단계별 결과는 같은 방식으로 만든 세 식(기업 내부 정보만, 정책금융 추가, 메자닌 추가)의 결과이고, 마지막 식이 최종 판정입니다.</p>
    </div></section>
    <section class="block"><h2>자료</h2><dl class="grid2">
      <div class="kv"><dt>재무·이자상환</dt><dd>DataGuide 주재무제표(연결 우선)</dd></div>
      <div class="kv"><dt>정책금융</dt><dd>사업보고서 주석 원문 판독, 기업-기관 3,453쌍</dd></div>
      <div class="kv"><dt>메자닌·지분율</dt><dd>DART 주요사항보고서, 최대주주 현황</dd></div>
      <div class="kv"><dt>상장폐지</dt><dd>한국거래소 상장폐지 목록</dd></div>
      <div class="kv"><dt>요약재무제표</dt><dd>DART 주요계정, 구할 수 없는 해는 DataGuide</dd></div>
      <div class="kv"><dt>표본</dt><dd>코스닥 제조업 ${S.meta.firms.toLocaleString()}개사, ${S.meta.firm_years.toLocaleString()} 기업-연도(2013~2024)</dd></div>
    </dl></section>
    <section class="block"><h2>읽을 때 주의할 점</h2><div class="prose">
      <p>등급은 3년 안 진입 위험의 순서를 매기는 도구이며, 개별 기업의 부실을 확정하지 않습니다. 계수는 함께 나타나는 경향을 뜻할 뿐 원인을 뜻하지 않습니다.</p>
      <p>재무 상태를 통제하면 정책금융 보유는 진입과 뚜렷한 연관이 없었습니다(세 유형 결합 p = 0.46). 메자닌을 발행한 해에는 재무 상태가 같아도 3년 안 진입 오즈가 약 1.8배 높았습니다. 그래도 표본 밖 예측력은 이자상환 상태와 재무 변수가 대부분을 설명합니다.</p>
      <p>정책금융은 받고 있었는지만 관찰했고, 새로 받은 시점과 금액은 반영하지 않았습니다. 등급은 ${S.meta.asof}년 결산 공시로 계산한 추정치입니다. 실제 결과는 ${S.meta.asof_outcome}년 결산까지, 상장 상태는 ${F.date(S.meta.asof_status)} 기준으로 확인했고, 평가 뒤에 상장폐지된 기업은 기업 화면에 따로 알립니다.</p>
    </div></section>
    <section class="block"><h2>만든 곳</h2><p class="lede">광운대학교 참빛설계학기 연구팀, 2026년 11월</p></section>
    ${footNote()}</main>`;
  bindSearch(app.querySelector('[data-search]'));
  window.scrollTo(0, 0);
  S.lastFirm = null;
}

// ------------------------------------------------------------------ 차트
function drawCharts() {
  for (const el of app.querySelectorAll('.chart[data-chart]')) {
    if (!S.cur) continue;
    if (el.dataset.chart === 'waterfall') drawWaterfall(el, S.cur.eval);
    if (el.dataset.chart === 'history') drawHistory(el, S.cur);
  }
}

function drawWaterfall(el, e) {
  const W = Math.max(300, Math.round(el.clientWidth));
  const narrow = W < 560;
  const L = narrow ? 104 : 176;
  const R = narrow ? 50 : 64;
  const rowH = narrow ? 36 : 40;
  const rows = [{ label: narrow ? '업종 평균' : '같은 업종 평균 기업', type: 'base', v: e.base_score }];
  let cur = e.base_score;
  for (const d of e.domains) {
    rows.push({ label: d.name, type: 'delta', a: cur, b: cur + d.pts, v: d.pts, ns: d.name === '정책금융' });
    cur += d.pts;
  }
  rows.push({ label: '위험도 점수', type: 'final', v: e.score });
  const vals = rows.flatMap((r) => (r.type === 'delta' ? [r.a, r.b] : [r.v]));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max(hi - lo, 30) * 0.12;
  lo -= pad; hi += pad;
  const X = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  // 등급 경계 이름: 앞 이름과 겹치면 한 줄 위로 올리고, 그래도 겹치면 생략한다. 좁은 화면은 '3|4'처럼 줄여 쓴다.
  const labW = narrow ? 26 : 74;
  const lastX = [-Infinity, -Infinity];
  const marks = [];
  S.meta.cuts.forEach((c, i) => {
    const v = scoreOf(c);
    if (v <= lo || v >= hi) return;
    const x = X(v);
    const row = x - lastX[0] >= labW ? 0 : x - lastX[1] >= labW ? 1 : -1;
    if (row >= 0) lastX[row] = x;
    marks.push({ x, i, row });
  });
  const top = marks.some((m) => m.row === 1) ? 48 : 34;
  const H = top + rows.length * rowH + 4;
  const desc = rows.map((r) => `${r.label} ${r.type === 'delta' ? F.pts(r.v) : F.score(r.v)}`).join(', ');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc('점수 구성: ' + desc)}">
    <defs><pattern id="hatchW" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><rect width="1.8" height="5" fill="#6e6c86"/></pattern></defs>`;
  for (const m of marks) {
    s += `<line x1="${m.x}" x2="${m.x}" y1="${top - 10}" y2="${H - 2}" stroke="#cfcddd" stroke-dasharray="3 4"/>`;
    if (m.row >= 0) s += `<text x="${m.x}" y="${top - 16 - m.row * 14}" text-anchor="middle">${narrow ? `${m.i + 1}|${m.i + 2}` : `${m.i + 1}·${m.i + 2}등급 경계`}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    s += `<text class="${r.type === 'final' ? 'lab-b' : 'lab'}" x="0" y="${y + 4.5}">${esc(r.label)}</text>`;
    if (r.type === 'delta') {
      const x1 = X(Math.min(r.a, r.b));
      const w = Math.max(2, X(Math.max(r.a, r.b)) - x1);
      const fill = r.ns ? 'url(#hatchW)' : r.v >= 0 ? 'var(--up)' : 'var(--down)';
      s += `<rect x="${x1}" y="${y - 8}" width="${w}" height="16" rx="3" fill="${fill}"${r.ns ? ' stroke="#6e6c86" stroke-width="1"' : ''}/>`;
      const xn = X(r.b);
      s += `<line x1="${xn}" x2="${xn}" y1="${y + 8}" y2="${y + rowH - 7}" stroke="#6e6c86" stroke-width="1"/>`;
      s += `<text class="val" x="${W}" y="${y + 4.5}" text-anchor="end">${F.pts(r.v)}</text>`;
    } else {
      const x = X(r.v);
      if (r.type === 'base') s += `<line x1="${x}" x2="${x}" y1="${y + 6}" y2="${y + rowH - 7}" stroke="#6e6c86" stroke-width="1"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${r.type === 'final' ? 7 : 5.5}" fill="${r.type === 'final' ? '#1b1930' : '#fff'}" stroke="#1b1930" stroke-width="2"/>`;
      s += `<text class="val" x="${W}" y="${y + 4.5}" text-anchor="end">${F.score(r.v)}</text>`;
    }
  });
  el.innerHTML = s + '</svg>';
}

function drawHistory(el, f) {
  const hs = f.history;
  const W = Math.max(300, Math.round(el.clientWidth));
  const narrow = W < 560;
  const ml = narrow ? 44 : 64;
  const mr = narrow ? 10 : 100;
  const mt = 48;
  const PH = narrow ? 200 : 232;
  const H = mt + PH + 66;
  const y0 = hs[0].y;
  const y1 = hs[hs.length - 1].y;
  const sc = hs.filter((h) => h.score != null).map((h) => h.score);
  const smin = Math.floor((Math.min(330, ...sc) - 15) / 50) * 50;
  const smax = Math.ceil((Math.max(510, ...sc) + 15) / 50) * 50;
  const step = (W - ml - mr) / Math.max(1, y1 - y0);
  const X = (y) => (y1 === y0 ? ml + (W - ml - mr) / 2 : ml + (y - y0) * step);
  const Y = (v) => mt + (1 - (v - smin) / (smax - smin)) * PH;
  const cuts = S.meta.cuts.map(scoreOf);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${y0}~${y1}년 위험도 점수 추이. 아래 연도별 표에 같은 값이 있습니다.`)}">
    <defs><pattern id="hatchH" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><rect width="1.8" height="5" fill="#9b99b0"/></pattern></defs>`;
  for (let g = 1; g <= 6; g++) {
    const a = Math.max(g === 1 ? -Infinity : cuts[g - 2], smin);
    const b = Math.min(g === 6 ? Infinity : cuts[g - 1], smax);
    if (b <= a) continue;
    s += `<rect x="${ml}" y="${Y(b)}" width="${W - ml - mr}" height="${Y(a) - Y(b)}" fill="var(--g${g})" fill-opacity="${0.1 + g * 0.025}"/>`;
    if (g > 1 && cuts[g - 2] > smin && cuts[g - 2] < smax) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(cuts[g - 2])}" y2="${Y(cuts[g - 2])}" stroke="#fff" stroke-width="2"/>`;
    if (!narrow && Y(a) - Y(b) >= 15) s += `<text x="${W - mr + 12}" y="${(Y(a) + Y(b)) / 2 + 4}">${g} ${GNAME[g]}</text>`;
  }
  for (let v = smin; v <= smax; v += 50) {
    s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ffffff" stroke-opacity=".9"/><text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  s += `<text x="${ml - 8}" y="${mt - 24}" text-anchor="end">${narrow ? 'D' : '한계기업'}</text>`;
  const bw = Math.min(30, step * 0.78);
  hs.forEach((h) => {
    if (h.g !== 'D' && h.g !== '판정 불가') return;
    const x = X(h.y);
    s += `<rect x="${x - bw / 2}" y="${mt - 38}" width="${bw}" height="22" rx="3" fill="${h.g === 'D' ? 'var(--gD)' : 'url(#hatchH)'}"/>`;
    if (h.g === 'D') s += `<text x="${x}" y="${mt - 23}" text-anchor="middle" style="fill:#fff;font-weight:700">D</text>`;
  });
  let path = '';
  let prev = null;
  hs.forEach((h) => {
    if (h.score == null) { prev = null; return; }
    path += `${prev && prev.y === h.y - 1 ? ' L' : ' M'}${X(h.y).toFixed(1)},${Y(h.score).toFixed(1)}`;
    prev = h;
  });
  s += `<path d="${path}" fill="none" stroke="#4a4862" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<line class="xh" x1="0" x2="0" y1="${mt - 40}" y2="${mt + PH}" stroke="#1b1930" stroke-width="1" visibility="hidden"/>`;
  hs.forEach((h) => {
    if (h.score == null) return;
    s += `<circle cx="${X(h.y)}" cy="${Y(h.score)}" r="5.5" fill="var(--g${h.g})" stroke="#fff" stroke-width="2"/>`;
  });
  hs.forEach((h) => {
    if (narrow && (h.y - y0) % 2 && h.y !== y1) return;
    s += `<text x="${X(h.y)}" y="${mt + PH + 20}" text-anchor="middle">${narrow ? '’' + String(h.y).slice(2) : h.y}</text>`;
  });
  const oy = mt + PH + 46;
  s += `<text x="${ml - 8}" y="${oy + 4}" text-anchor="end">${narrow ? '결과' : '3년 안'}</text>`;
  hs.forEach((h) => {
    const x = X(h.y);
    if (h.y3 === 1 || h.ev === 'delist') s += `<circle cx="${x}" cy="${oy}" r="4.5" fill="#1b1930"/>`;
    else if (h.y3 === 0) s += `<circle cx="${x}" cy="${oy}" r="4" fill="none" stroke="#6e6c86" stroke-width="1.5"/>`;
  });
  hs.forEach((h, i) => {
    s += `<rect class="hit" data-i="${i}" x="${X(h.y) - step / 2}" y="${mt - 40}" width="${step}" height="${PH + 96}" fill="transparent" tabindex="0"
      aria-label="${esc(`${h.y}년 ${gLabel(h.g)}, 점수 ${F.score(h.score)}, 3년 안 실제 결과 ${outcomeText(h)}`)}"/>`;
  });
  el.innerHTML = s + '</svg><div class="tip" hidden></div>';

  const tip = el.querySelector('.tip');
  const xh = el.querySelector('.xh');
  const show = (i) => {
    const h = hs[i];
    tip.innerHTML = `<b>${h.y}년 결산</b><br>${chip(h.g)} ${esc(gLabel(h.g))}<br>위험도 점수 <b>${F.score(h.score)}</b><br>진입 확률 ${F.pct(h.pd)}<br>${esc(stateShort(h.state))}, ICR ${F.x(h.icr)}<br>3년 안 실제 결과 ${outcomeText(h)}`;
    tip.hidden = false;
    const x = X(h.y);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
    const tw = tip.offsetWidth;
    let left = x + 14;
    if (left + tw > W) left = x - 14 - tw;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, (h.score != null ? Y(h.score) : mt) - 40)}px`;
  };
  const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
  el.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('pointerenter', () => show(+r.dataset.i));
    r.addEventListener('focus', () => show(+r.dataset.i));
    r.addEventListener('pointerleave', hide);
    r.addEventListener('blur', hide);
  });
}

// ------------------------------------------------------------------ 시작
async function getJSON(p) {
  const r = await fetch(p, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${p} (${r.status})`);
  return r.json();
}

function route() {
  const seq = ++S.seq;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'firm' && parts[1]) return renderFirm(parts[1], TABS.some((t) => t[0] === parts[2]) ? parts[2] : 'overview', seq);
  if (parts[0] === 'about') return renderAbout();
  S.lastFirm = null;
  if (parts[0] === 'admin') return renderAdmin(parts[1], seq);
  return renderHome();
}

// 관리자 화면은 따로 불러온다(방문자에게는 받지 않게).
async function renderAdmin(view, seq) {
  document.title = '관리자 | PHANTOM';
  let m;
  try {
    m = await import('./admin.js');
  } catch (e) {
    if (seq === S.seq) app.innerHTML = `<main class="page"><p class="notice">관리자 화면을 불러오지 못했습니다. 새로고침해 주세요.</p></main>`;
    return;
  }
  if (seq !== S.seq) return;
  m.render(view, { app, S, API, api, esc, F, chip, gLabel, GNAME, topBar, footNote, bindSearch, isLive: () => seq === S.seq });
}

// ------------------------------------------------------------------ 신고·공지(Apps Script)
// 본문을 문자열로 보내면 text/plain이 되어 사전 요청(preflight) 없이 다른 도메인으로 보낼 수 있다.
async function api(body) {
  const r = await fetch(API, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch (e) { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch (e) { /* 저장소를 못 쓰는 브라우저: 무시 */ } },
};

async function loadNotice() {
  if (!API) return;
  let n;
  try {
    const r = await fetch(`${API}?a=notice`);
    n = (await r.json()).notice;
  } catch (e) {
    return;
  }
  const bar = document.getElementById('notice');
  if (!bar || !n || !n.on || !n.text || store.get('phantom-notice', sessionStorage) === n.updated) return;
  bar.className = `notice-bar${n.level === 'warn' ? ' warn' : ''}`;
  bar.innerHTML = `<p>${esc(n.text)}</p><button type="button" aria-label="공지 닫기">닫기</button>`;
  bar.hidden = false;
  bar.querySelector('button').addEventListener('click', () => {
    bar.hidden = true;
    store.set('phantom-notice', n.updated, sessionStorage);
  });
}

const KINDS = ['숫자·데이터', '화면·동작', '문구·설명', '기타'];
const TAB_NAME = Object.fromEntries(TABS);

function reportContext() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const r = parts[0] === 'firm' ? S.byCode.get(parts[1]) : null;
  const tab = r ? (TAB_NAME[parts[2]] ? parts[2] : 'overview') : '';
  return {
    route: location.hash || '#/', code: r ? r.c : '', name: r ? r.n : '', tab,
    vw: String(window.innerWidth), ua: navigator.userAgent, data: S.meta ? S.meta.built || String(S.meta.asof) : '',
    where: r ? `${r.n}(${r.c}) ${TAB_NAME[tab]}` : parts[0] === 'about' ? '모형 안내' : '첫 화면',
  };
}

function openReport() {
  if (!API || document.querySelector('dialog.report')) return;
  const c = reportContext();
  const dlg = document.createElement('dialog');
  dlg.className = 'report';
  dlg.setAttribute('aria-labelledby', 'report-title');
  dlg.innerHTML = `<form class="report-form" novalidate>
    <h2 id="report-title">오류 신고</h2>
    <p class="lede">숫자가 이상하거나 화면이 깨지는 곳을 알려 주세요. 연구팀이 확인합니다.</p>
    <fieldset class="kinds"><legend>종류</legend>${KINDS.map((k, i) => `<label><input type="radio" name="kind" value="${k}"${i ? '' : ' checked'}>${k}</label>`).join('')}</fieldset>
    <label class="field"><span>내용</span><textarea name="text" rows="5" maxlength="2000" required placeholder="어느 화면의 무엇이 어떻게 이상한지 적어 주세요."></textarea></label>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <details class="ctx"><summary>함께 보내는 정보</summary><dl>
      <div><dt>화면</dt><dd>${esc(c.where)}</dd></div><div><dt>화면 폭</dt><dd>${esc(c.vw)}px</dd></div>
      <div><dt>브라우저</dt><dd>${esc(c.ua)}</dd></div><div><dt>데이터</dt><dd>${esc(c.data)}</dd></div></dl>
      <p>이름·연락처는 받지 않습니다.</p></details>
    <p class="msg" role="status" aria-live="polite"></p>
    <div class="actions"><button type="button" class="btn-ghost" data-close>닫기</button><button type="submit" class="btn">보내기</button></div>
  </form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  const form = dlg.querySelector('form');
  const msg = dlg.querySelector('.msg');
  const send = dlg.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = form.text.value.trim();
    if (text.length < 2) { msg.textContent = '내용을 적어 주세요.'; form.text.focus(); return; }
    let cid = store.get('phantom-cid');
    if (!cid) { cid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('phantom-cid', cid); }
    send.disabled = true;
    msg.textContent = '보내는 중…';
    try {
      const { where, ...ctx } = c;
      const res = await api({ a: 'report', kind: form.kind.value, text, ctx, cid, hp: form.website.value });
      if (res.ok) {
        form.innerHTML = `<h2 id="report-title">신고가 접수되었습니다</h2><p class="lede">${res.id ? `접수 번호 ${esc(res.id)}. ` : ''}알려 주셔서 고맙습니다. 연구팀이 확인하겠습니다.</p>
          <div class="actions"><button type="button" class="btn" data-close>닫기</button></div>`;
        form.querySelector('[data-close]').addEventListener('click', () => dlg.close());
        return;
      }
      msg.textContent = res.error === 'rate' ? '조금 전에 보낸 신고가 있습니다. 잠시 뒤 다시 보내 주세요.' : '보내지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.';
    } catch (e) {
      msg.textContent = '보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    send.disabled = false;
  });
  dlg.showModal();
  form.text.focus();
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

async function boot() {
  try {
    const [index, meta] = await Promise.all([getJSON('data/index.json'), getJSON('data/meta.json')]);
    S.index = index;
    S.meta = meta;
    for (const r of index) {
      S.byCode.set(r.c, r);
      r._k = [norm(r.n), ...(r.a || []).map(norm)];
      r._h = cho(norm(r.n));
    }
  } catch (e) {
    app.innerHTML = `<main class="page"><p class="notice">자료를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요. (${esc(e.message)})</p></main>`;
    return;
  }
  window.addEventListener('hashchange', route);
  let lastW = window.innerWidth;
  window.addEventListener('resize', debounce(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; drawCharts(); fitScrollers(); } }, 150));
  document.addEventListener('click', (e) => { if (e.target.closest('[data-report]')) openReport(); });
  route();
  loadNotice();
}

boot();
