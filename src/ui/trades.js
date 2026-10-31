import { h, table, td, icon, fmtNum, fmtTs, fmtDur, cls } from './dom.js';
import { S } from './store.js';
import { journalForTrade } from './journal.js';
import { mkt } from './market.js';

const ui = { type: 'ALL', inst: 'ALL', side: 'ALL', sort: 'openTs', dir: -1, q: '', pop: null, more: false };

const px = (v) => (v == null ? '-' : fmtNum(v, Math.abs(v) < 10 ? 4 : 2));
const chips = (a) => (a.length ? a.map((x) => h('span', { class: 'tag sym' }, x)) : '-');
// 열 정의: id → 라벨·아이콘·셀·정렬값. js()는 연결된 일지 항목.
const COLS = {
  openTs: { label: '매매일', icon: 'calendar', cell: (t) => fmtTs(t.openTs), val: (t) => t.openTs },
  instId: { label: '종목명', icon: 'lines', cell: (t) => t.instId.replace('-SWAP', ''), val: (t) => t.instId },
  side: { label: 'SIDE', icon: 'target', cell: (t) => h('span', { class: 'tag ' + t.side }, t.side.toUpperCase()), val: (t) => t.side },
  maxSize: { label: '최대 수량', icon: 'hash', cell: (t) => fmtNum(t.maxSize, 6), val: (t) => t.maxSize },
  net: { label: '순 손익', icon: 'arrow', cell: (t) => (t.ccy ? h('span', { class: cls(t.net) }, (t.net > 0 ? '+' : '') + fmtNum(t.net) + ' ' + t.ccy) : '통화 여럿'), val: (t) => t.net },
  avgEntryPx: { label: '평균 진입가', icon: 'hash', cell: (t) => px(t.avgEntryPx), val: (t) => t.avgEntryPx },
  avgExitPx: { label: '평균 청산가', icon: 'hash', cell: (t) => (t.status === 'CLOSED' ? px(t.avgExitPx) : '-'), val: (t) => t.avgExitPx },
  strategies: { label: '매매 전략', icon: 'lines', cell: (t, js) => chips([...new Set(js.flatMap((e) => e.strategies))]) },
  mistakes: { label: '실수', icon: 'lines', cell: (t, js) => chips([...new Set(js.flatMap((e) => e.mistakes))]) },
  grade: { label: '등급', icon: 'target', cell: (t, js) => js.map((e) => e.grade).filter(Boolean).join(', ') || '-' },
  instType: { label: '상품군', icon: 'lines', cell: (t) => t.instType, val: (t) => t.instType },
  hold: { label: '보유 시간', icon: 'hash', cell: (t) => (t.closeTs != null ? fmtDur(t.closeTs - t.openTs) : '-'), val: (t) => (t.closeTs != null ? t.closeTs - t.openTs : null) },
  closeTs: { label: '청산일', icon: 'calendar', cell: (t) => fmtTs(t.closeTs), val: (t) => t.closeTs },
  fee: { label: '수수료', icon: 'hash', cell: (t) => fmtNum(t.fee, 4), val: (t) => t.fee },
  status: { label: '상태', icon: 'target', cell: (t) => t.status, val: (t) => t.status },
};
const DEFAULT_COLS = ['openTs', 'instId', 'side', 'maxSize', 'net', 'avgEntryPx', 'avgExitPx', 'strategies', 'mistakes', 'grade'];
let cols = (() => { try { const v = JSON.parse(localStorage.getItem('okx.cols')); return Array.isArray(v) && v.every((x) => COLS[x]) && v.length ? v : DEFAULT_COLS; } catch { return DEFAULT_COLS; } })();
const saveCols = () => { try { localStorage.setItem('okx.cols', JSON.stringify(cols)); } catch { /* 저장 불가 환경 */ } };

let rr = null;
if (!window.__popClose) { // 팝오버 바깥을 누르면 닫는다(한 번만 등록)
  window.__popClose = true;
  document.addEventListener('click', (e) => { if (ui.pop && !e.target.closest('.pop, .tbtn')) { ui.pop = null; rr?.(); } });
}

export function tradesView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리세요.');
  if (!r.trades.length) return h('section', {}, '거래 없음: 복원된 라운드트립이 0건입니다.');
  rr = rerender;
  const jOf = (t) => S.linked?.byTrade.get(t.id) ?? [];
  const q = ui.q.trim().toLowerCase();
  let list = r.trades.filter((t) => (ui.type === 'ALL' || t.instType === ui.type) && (ui.inst === 'ALL' || t.instId === ui.inst) && (ui.side === 'ALL' || t.side === ui.side)
    && (!q || [t.instId, t.side, ...jOf(t).flatMap((e) => [e.title, ...e.strategies, ...e.mistakes, e.grade])].some((x) => String(x ?? '').toLowerCase().includes(q))));
  const key = (COLS[ui.sort] ?? COLS.openTs).val ?? COLS.openTs.val;
  list = [...list].sort((a, b) => ((key(a) ?? -Infinity) > (key(b) ?? -Infinity) ? 1 : (key(a) ?? -Infinity) < (key(b) ?? -Infinity) ? -1 : 0) * ui.dir);

  let t = r.trades.find((x) => x.id === S.selTrade);
  if (!t) t = list.find((x) => x.instId === mkt.inst) ?? list[0] ?? r.trades.at(-1);
  if (S.selTrade !== t.id) { S.selTrade = t.id; mkt.inst = t.instId; }

  const open = (name) => () => { ui.pop = ui.pop === name ? null : name; rerender(); };
  const tbtn = (name, ic, label) => h('button', { class: 'tbtn' + (ui.pop === name ? ' on' : ''), onclick: open(name) }, ic ? icon(ic, 15) : null, label);
  const sel = (opts, cur, on) => h('select', { onchange: (e) => { on(e.target.value); rerender(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === cur ? true : null }, l)));

  // 팝오버
  let pop = null;
  if (ui.pop === 'cols') {
    const hidden = Object.keys(COLS).filter((c) => !cols.includes(c));
    const mv = (i, d) => { const j = i + d; if (j < 0 || j >= cols.length) return; [cols[i], cols[j]] = [cols[j], cols[i]]; saveCols(); rerender(); };
    pop = h('div', { class: 'pop' }, h('div', { class: 'pop-h' }, h('strong', {}, '속성 배치 순서 / 열 편집'), h('span', { class: 'mute' }, '배치 순서 조정')),
      cols.map((c, i) => h('div', { class: 'pop-r' }, icon(COLS[c].icon, 14), h('span', { class: 'grow' }, COLS[c].label),
        h('button', { class: 'ib', title: '숨기기', disabled: cols.length <= 1 ? true : null, onclick: () => { cols = cols.filter((x) => x !== c); saveCols(); rerender(); } }, icon('eye', 14)),
        h('button', { class: 'ib', disabled: i === 0 ? true : null, onclick: () => mv(i, -1) }, icon('up', 14)),
        h('button', { class: 'ib', disabled: i === cols.length - 1 ? true : null, onclick: () => mv(i, 1) }, icon('down', 14)))),
      h('button', { class: 'add', onclick: () => { ui.more = !ui.more; rerender(); } }, icon('plus', 14), ' 새 속성 추가'),
      ui.more ? (hidden.length ? hidden.map((c) => h('div', { class: 'pop-r click', onclick: () => { cols = [...cols, c]; saveCols(); rerender(); } }, icon(COLS[c].icon, 14), h('span', { class: 'grow' }, COLS[c].label), icon('plus', 14))) : h('div', { class: 'mute pad' }, '추가할 속성이 없습니다')) : null);
  } else if (ui.pop === 'filter') {
    pop = h('div', { class: 'pop' }, h('div', { class: 'pop-h' }, h('strong', {}, '필터')),
      h('label', {}, '상품군'), sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'].map((v) => [v, v]), ui.type, (v) => (ui.type = v)),
      h('label', {}, '종목'), sel([['ALL', 'ALL'], ...[...new Set(r.trades.map((x) => x.instId))].map((v) => [v, v])], ui.inst, (v) => (ui.inst = v)),
      h('label', {}, '방향'), sel([['ALL', 'ALL'], ['long', 'LONG'], ['short', 'SHORT']], ui.side, (v) => (ui.side = v)),
      h('button', { class: 'add', onclick: () => { ui.type = ui.inst = ui.side = 'ALL'; rerender(); } }, '초기화'));
  } else if (ui.pop === 'sort') {
    pop = h('div', { class: 'pop' }, h('div', { class: 'pop-h' }, h('strong', {}, '정렬')),
      sel(Object.entries(COLS).filter(([, c]) => c.val).map(([id, c]) => [id, c.label]), ui.sort, (v) => (ui.sort = v)),
      h('div', { class: 'seg', style: 'margin-top:8px' }, h('button', { class: ui.dir > 0 ? 'on' : null, onclick: () => { ui.dir = 1; rerender(); } }, '오름차순'), h('button', { class: ui.dir < 0 ? 'on' : null, onclick: () => { ui.dir = -1; rerender(); } }, '내림차순')));
  }

  const search = h('input', { id: 'tq', type: 'search', placeholder: '검색', value: ui.q });
  search.oninput = () => { ui.q = search.value; rerender(); const n = document.getElementById('tq'); n?.focus(); n?.setSelectionRange(ui.q.length, ui.q.length); };
  const head = h('tr', {}, h('th', { class: 'c0' }), cols.map((c) => h('th', { class: COLS[c].val ? 'sortable' : null, onclick: COLS[c].val ? () => { ui.dir = ui.sort === c ? -ui.dir : -1; ui.sort = c; rerender(); } : null },
    h('span', { class: 'th' }, icon(COLS[c].icon, 14), COLS[c].label, ui.sort === c ? h('span', { class: 'mute' }, ui.dir < 0 ? ' ▼' : ' ▲') : null))));
  const rows = list.map((x) => {
    const js = jOf(x);
    return h('tr', { class: x.id === t.id ? 'on' : null, onclick: () => { S.selTrade = x.id; mkt.inst = x.instId; rerender(); scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('td', { class: 'c0' }, icon('right', 13)), cols.map((c) => h('td', {}, COLS[c].cell(x, js))));
  });
  for (let i = rows.length; i < 8; i++) rows.push(h('tr', { class: 'empty' }, h('td', { class: 'c0' }), cols.map(() => h('td', {}))));

  return h('div', {},
    detail(t, r),
    h('section', { class: 'nt' },
      h('div', { class: 'between nt-bar' }, h('div', { class: 'sbox' }, icon('search', 16), search),
        h('div', { class: 'row' }, tbtn('cols', 'sliders', '속성'), tbtn('filter', null, '필터'), tbtn('sort', null, '정렬'))),
      pop,
      h('div', { class: 'tbl' }, h('table', { class: 'notion' }, h('thead', {}, head), h('tbody', {}, rows))),
      h('div', { class: 'mute foot' }, `${list.length}건 · 행을 누르면 위 차트와 일지가 바뀝니다. 평균 진입·청산가는 선물·마진만(현물은 -).`)));
}

function detail(t, r) {
  const bills = t.billIds?.length ? r.data.Bill.filter((b) => t.billIds.includes(b.billId)) : [];
  const fillIds = new Set(t.fillIds ?? bills.map((b) => b.tradeId).filter(Boolean));
  const fills = r.data.Fill.filter((f) => f.instId === t.instId && fillIds.has(f.tradeId));
  const ev = [
    ...bills.map((b) => ({ ts: b.ts, kind: `Bill ${b.type ?? ''}/${b.subType ?? ''}`, px: b.px, sz: b.sz, pnl: b.pnl, fee: b.fee, ccy: b.ccy })),
    ...(t.fillIds ? fills.map((f) => ({ ts: f.ts, kind: `Fill ${f.side}`, px: f.fillPx, sz: f.fillSz, pnl: null, fee: f.fee, ccy: f.feeCcy })) : []),
  ].sort((a, b) => a.ts - b.ts);
  return h('div', {},
    journalForTrade(t.id) ?? h('section', {}, h('h2', {}, '매매일지'), h('div', { class: 'mute' }, S.journal ? '-: 이 거래에 연결된 일지 없음' : '-: 일지를 불러오지 않았습니다(#/journal에서 노션 내보내기 파일 업로드)')),
    h('details', { class: 'panel' }, h('summary', {}, '이벤트 타임라인'), ev.length ? table(['시각(KST)', '구분', '가격', '수량', '손익', '수수료', '통화'], ev.map((e) => [fmtTs(e.ts), e.kind, fmtNum(e.px, 6), fmtNum(e.sz, 6), fmtNum(e.pnl, 4), fmtNum(e.fee, 4), e.ccy ?? '-'])) : h('div', { class: 'mute' }, '-: 연결된 이벤트 없음')));
}
