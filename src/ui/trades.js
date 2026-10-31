import { h, table, td, fmtNum, fmtTs, fmtDur, cls } from './dom.js';
import { S } from './store.js';
import { journalForTrade } from './journal.js';
import { mkt } from './market.js';

const ui = { type: 'ALL', inst: 'ALL', side: 'ALL', sort: 'openTs', dir: -1, q: '' };

const SORTS = { openTs: (t) => t.openTs, net: (t) => t.net, maxSize: (t) => t.maxSize, hold: (t) => (t.closeTs != null ? t.closeTs - t.openTs : null) };

export function tradesView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리세요.');
  if (!r.trades.length) return h('section', {}, '거래 없음: 복원된 라운드트립이 0건입니다.');
  const sel = (opts, cur, on) => h('select', { onchange: (e) => { on(e.target.value); rerender(); } }, opts.map((o) => h('option', { value: o, selected: o === cur ? true : null }, o)));
  const jOf = (t) => S.linked?.byTrade.get(t.id) ?? [];
  const q = ui.q.trim().toLowerCase();
  let list = r.trades.filter((t) => (ui.type === 'ALL' || t.instType === ui.type) && (ui.inst === 'ALL' || t.instId === ui.inst) && (ui.side === 'ALL' || t.side === ui.side)
    && (!q || [t.instId, t.side, ...jOf(t).flatMap((e) => [e.title, ...e.strategies, ...e.mistakes, e.grade])].some((x) => String(x ?? '').toLowerCase().includes(q))));
  const key = SORTS[ui.sort] ?? SORTS.openTs;
  list = [...list].sort((a, b) => ((key(a) ?? -Infinity) - (key(b) ?? -Infinity)) * ui.dir);

  let t = r.trades.find((x) => x.id === S.selTrade);
  if (!t) t = list.find((x) => x.instId === mkt.inst) ?? list[0] ?? r.trades.at(-1);
  if (S.selTrade !== t.id) { S.selTrade = t.id; mkt.inst = t.instId; }

  const th = (label, k) => h('th', { class: 'sortable', onclick: () => { ui.dir = ui.sort === k ? -ui.dir : -1; ui.sort = k; rerender(); } }, label + (ui.sort === k ? (ui.dir < 0 ? ' ▼' : ' ▲') : ''));
  const chips = (a) => (a.length ? h('td', {}, a.map((x) => h('span', { class: 'tag sym' }, x)), ' ') : td('-'));
  const rows = list.map((x) => {
    const js = jOf(x);
    const tr = h('tr', { class: x.id === t.id ? 'on' : null, onclick: () => { S.selTrade = x.id; mkt.inst = x.instId; rerender(); scrollTo({ top: 0, behavior: 'smooth' }); } },
      td(fmtTs(x.openTs)), td(x.instId), h('td', {}, h('span', { class: 'tag ' + x.side }, x.side.toUpperCase())), td(fmtNum(x.maxSize, 6)),
      td(x.ccy ? fmtNum(x.net) + ' ' + x.ccy : '통화 여럿', cls(x.net)), td(fmtNum(x.avgEntryPx, 6)), td(x.status === 'CLOSED' ? fmtNum(x.avgExitPx, 6) : '-'),
      chips([...new Set(js.flatMap((e) => e.strategies))]), chips([...new Set(js.flatMap((e) => e.mistakes))]), td(js.map((e) => e.grade).filter(Boolean).join(', ') || '-'));
    return tr;
  });
  const search = h('input', { id: 'tq', type: 'search', placeholder: '검색 (종목·전략·실수·제목)', value: ui.q });
  search.oninput = () => { ui.q = search.value; rerender(); const n = document.getElementById('tq'); n?.focus(); n?.setSelectionRange(ui.q.length, ui.q.length); };

  return h('div', {},
    detail(t, r),
    h('section', {},
      h('div', { class: 'between' }, search, h('div', { class: 'row' }, sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.type, (v) => (ui.type = v)), sel(['ALL', ...new Set(r.trades.map((x) => x.instId))], ui.inst, (v) => (ui.inst = v)), sel(['ALL', 'long', 'short'], ui.side, (v) => (ui.side = v)))),
      h('div', { class: 'mute' }, `${list.length}건 · 행을 누르면 위 차트와 일지가 바뀝니다. 평균 진입·청산가는 선물·마진만(현물은 -).`),
      h('div', { class: 'tbl' }, h('table', { class: 'clickable' },
        h('thead', {}, h('tr', {}, th('매매일(KST)', 'openTs'), h('th', {}, '종목'), h('th', {}, 'SIDE'), th('최대 수량', 'maxSize'), th('순 손익', 'net'), h('th', {}, '평균 진입가'), h('th', {}, '평균 청산가'), h('th', {}, '전략'), h('th', {}, '실수'), h('th', {}, '등급'))),
        h('tbody', {}, rows)))));
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
    h('section', {}, h('div', { class: 'between' }, h('h2', { class: 'big' }, `${t.instId} `, h('span', { class: 'tag ' + t.side }, t.side.toUpperCase()), ` · ${t.status}`), h('span', { class: 'mute' }, `${fmtTs(t.openTs)} → ${fmtTs(t.closeTs)} (KST)`))),
    journalForTrade(t.id) ?? h('section', {}, h('h2', {}, '매매일지'), h('div', { class: 'mute' }, S.journal ? '-: 이 거래에 연결된 일지 없음' : '-: 일지를 불러오지 않았습니다(#/journal에서 노션 내보내기 파일 업로드)')),
    h('details', { class: 'panel' }, h('summary', {}, '이벤트 타임라인'), ev.length ? table(['시각(KST)', '구분', '가격', '수량', '손익', '수수료', '통화'], ev.map((e) => [fmtTs(e.ts), e.kind, fmtNum(e.px, 6), fmtNum(e.sz, 6), fmtNum(e.pnl, 4), fmtNum(e.fee, 4), e.ccy ?? '-'])) : h('div', { class: 'mute' }, '-: 연결된 이벤트 없음')));
}
