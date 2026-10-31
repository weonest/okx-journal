import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, table, td, fmtNum, fmtTs, fmtDur, cls } from './dom.js';
import { S } from './store.js';
import { journalForTrade } from './journal.js';

const ui = { type: 'ALL', inst: 'ALL', side: 'ALL', sort: 'openTs', dir: -1, sel: null, bar: 'auto', q: '' };

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

  let t = r.trades.find((x) => x.id === ui.sel);
  if (!t) t = list[0] ?? r.trades.at(-1);

  const th = (label, k) => h('th', { class: 'sortable', onclick: () => { ui.dir = ui.sort === k ? -ui.dir : -1; ui.sort = k; rerender(); } }, label + (ui.sort === k ? (ui.dir < 0 ? ' ▼' : ' ▲') : ''));
  const chips = (a) => (a.length ? h('td', {}, a.map((x) => h('span', { class: 'tag sym' }, x)), ' ') : td('-'));
  const rows = list.map((x) => {
    const js = jOf(x);
    const tr = h('tr', { class: x.id === t.id ? 'on' : null, onclick: () => { ui.sel = x.id; rerender(); scrollTo({ top: 0, behavior: 'smooth' }); } },
      td(fmtTs(x.openTs)), td(x.instId), h('td', {}, h('span', { class: 'tag ' + x.side }, x.side.toUpperCase())), td(fmtNum(x.maxSize, 6)),
      td(x.ccy ? fmtNum(x.net) + ' ' + x.ccy : '통화 여럿', cls(x.net)), td(fmtNum(x.avgEntryPx, 6)), td(x.status === 'CLOSED' ? fmtNum(x.avgExitPx, 6) : '-'),
      chips([...new Set(js.flatMap((e) => e.strategies))]), chips([...new Set(js.flatMap((e) => e.mistakes))]), td(js.map((e) => e.grade).filter(Boolean).join(', ') || '-'));
    return tr;
  });
  const search = h('input', { id: 'tq', type: 'search', placeholder: '검색 (종목·전략·실수·제목)', value: ui.q });
  search.oninput = () => { ui.q = search.value; rerender(); const n = document.getElementById('tq'); n?.focus(); n?.setSelectionRange(ui.q.length, ui.q.length); };

  return h('div', {},
    detail(t, r, rerender),
    h('section', {},
      h('div', { class: 'between' }, search, h('div', { class: 'row' }, sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.type, (v) => (ui.type = v)), sel(['ALL', ...new Set(r.trades.map((x) => x.instId))], ui.inst, (v) => (ui.inst = v)), sel(['ALL', 'long', 'short'], ui.side, (v) => (ui.side = v)))),
      h('div', { class: 'mute' }, `${list.length}건 · 행을 누르면 위 차트와 일지가 바뀝니다. 평균 진입·청산가는 선물·마진만(현물은 -).`),
      h('div', { class: 'tbl' }, h('table', { class: 'clickable' },
        h('thead', {}, h('tr', {}, th('매매일(KST)', 'openTs'), h('th', {}, '종목'), h('th', {}, 'SIDE'), th('최대 수량', 'maxSize'), th('순 손익', 'net'), h('th', {}, '평균 진입가'), h('th', {}, '평균 청산가'), h('th', {}, '전략'), h('th', {}, '실수'), h('th', {}, '등급'))),
        h('tbody', {}, rows)))));
}

function detail(t, r, rerender) {
  const bills = t.billIds?.length ? r.data.Bill.filter((b) => t.billIds.includes(b.billId)) : [];
  const fillIds = new Set(t.fillIds ?? bills.map((b) => b.tradeId).filter(Boolean));
  const fills = r.data.Fill.filter((f) => f.instId === t.instId && fillIds.has(f.tradeId));
  const ev = [
    ...bills.map((b) => ({ ts: b.ts, kind: `Bill ${b.type ?? ''}/${b.subType ?? ''}`, px: b.px, sz: b.sz, pnl: b.pnl, fee: b.fee, ccy: b.ccy })),
    ...(t.fillIds ? fills.map((f) => ({ ts: f.ts, kind: `Fill ${f.side}`, px: f.fillPx, sz: f.fillSz, pnl: null, fee: f.fee, ccy: f.feeCcy })) : []),
  ].sort((a, b) => a.ts - b.ts);
  const amt = Object.entries(t.amounts).map(([c, a]) => `${c}: 손익 ${fmtNum(a.pnl, 4)} / 수수료 ${fmtNum(a.fee, 4)} / 이자 ${fmtNum(a.interest, 4)} / 펀딩 ${fmtNum(a.funding, 4)} = ${fmtNum(a.net, 4)}`);
  const chartEl = h('div', { class: 'chart', style: 'height:380px' });
  const msg = h('div', { class: 'mute' }, '캔들 불러오는 중…');
  setTimeout(() => drawCandles(chartEl, msg, t, fills, bills), 0);
  return h('div', {},
    h('section', {}, h('div', { class: 'between' }, h('h2', { class: 'big' }, `${t.instId} `, h('span', { class: 'tag ' + t.side }, t.side.toUpperCase()), ` · ${t.status}`), h('div', { class: 'row' }, BAR_BTN.map(([b, label]) => h('button', { class: b === ui.bar ? null : 'sub', onclick: () => { ui.bar = b; rerender(); } }, label)))),
      msg, chartEl),
    h('section', {}, h('div', {}, `진입 ${fmtTs(t.openTs)} → 청산 ${fmtTs(t.closeTs)} (KST) · 최대 수량 ${fmtNum(t.maxSize, 6)}${t.closeReason && t.closeReason !== 'TRADE' ? ' · ' + t.closeReason : ''}`), h('ul', {}, amt.map((a) => h('li', {}, a)))),
    journalForTrade(t.id) ?? h('section', {}, h('h2', {}, '매매일지'), h('div', { class: 'mute' }, S.journal ? '-: 이 거래에 연결된 일지 없음' : '-: 일지를 불러오지 않았습니다(#/journal에서 노션 내보내기 파일 업로드)')),
    h('details', { class: 'panel' }, h('summary', {}, '이벤트 타임라인'), ev.length ? table(['시각(KST)', '구분', '가격', '수량', '손익', '수수료', '통화'], ev.map((e) => [fmtTs(e.ts), e.kind, fmtNum(e.px, 6), fmtNum(e.sz, 6), fmtNum(e.pnl, 4), fmtNum(e.fee, 4), e.ccy ?? '-'])) : h('div', { class: 'mute' }, '-: 연결된 이벤트 없음')));
}

const CANDLES = new Map(); // 같은 구간 재조회 방지(검색 입력으로 다시 그릴 때마다 요청하지 않는다)
const BARS = [['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['1H', 3600e3], ['4H', 14400e3], ['1D', 86400e3], ['1W', 604800e3]];
const BAR_BTN = [['auto', '자동'], ['1m', '1분'], ['15m', '15분'], ['4H', '4시간'], ['1D', '일'], ['1W', '주']];

async function drawCandles(el, msg, t, fills, bills) {
  try {
    const end = t.closeTs ?? Date.now(), span = Math.max(end - t.openTs, 60e3);
    const [bar, ms] = (ui.bar !== 'auto' && BARS.find(([b]) => b === ui.bar)) || BARS.find(([, m]) => span / m <= 40) || BARS.at(-1);
    const pad = Math.max(ms * 20, span * 0.3);
    const from = t.openTs - pad, to = end + pad;
    const ck = `${t.instId}|${bar}|${Math.round(from / ms)}|${Math.round(to / ms)}`;
    const all = new Map(CANDLES.get(ck) ?? []);
    let after = Math.ceil(to);
    for (let page = 0; page < 12 && !CANDLES.has(ck); page++) { // 한 번에 100개씩, from까지 거슬러 올라간다
      const j = await (await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(t.instId)}&bar=${bar}&after=${after}&limit=100`)).json();
      if (j.code !== '0') throw new Error(j.msg || 'code ' + j.code);
      if (!j.data.length) break;
      for (const c of j.data) all.set(+c[0], c);
      const oldest = Math.min(...j.data.map((c) => +c[0]));
      if (oldest <= from) break;
      after = oldest;
    }
    CANDLES.set(ck, [...all]);
    const cs = [...all.values()].map((c) => ({ time: Math.floor(+c[0] / 1000), open: +c[1], high: +c[2], low: +c[3], close: +c[4] })).filter((c) => c.time * 1000 >= from).sort((a, b) => a.time - b.time);
    if (!cs.length) { msg.textContent = '-: 해당 구간 캔들 없음'; return; }
    msg.textContent = `봉 ${bar} · ${cs.length}개`;
    if (!el.isConnected) return;
    const ch = createChart(el, { width: el.clientWidth, height: 380, layout: { background: { color: '#1f2328' }, textColor: '#9aa4ab' }, grid: { vertLines: { color: '#363c44' }, horzLines: { color: '#363c44' } }, timeScale: { timeVisible: true, rightOffset: 4, minBarSpacing: 2, borderColor: '#363c44' }, rightPriceScale: { borderColor: '#363c44' }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true }, kineticScroll: { mouse: false, touch: true } });
    new ResizeObserver(() => ch.applyOptions({ width: el.clientWidth })).observe(el);
    const s = ch.addCandlestickSeries();
    s.setData(cs);
    const snap = (ts) => { const sec = ts / 1000; let b = cs[0].time; for (const c of cs) if (c.time <= sec) b = c.time; return b; };
    const mk = [];
    const evs = fills.length ? fills.map((f) => ({ ts: f.ts, buy: f.side === 'buy' })) : [{ ts: t.openTs, buy: t.side === 'long' }, ...(t.closeTs ? [{ ts: t.closeTs, buy: t.side !== 'long' }] : [])];
    for (const e of evs) mk.push({ time: snap(e.ts), position: e.buy ? 'belowBar' : 'aboveBar', shape: e.buy ? 'arrowUp' : 'arrowDown', color: e.buy ? '#3ecf8e' : '#f0616d', text: e.buy ? '매수' : '매도' });
    s.setMarkers(mk.sort((a, b) => a.time - b.time));
    ch.timeScale().fitContent();
    // 휠 확대·축소: 기본 단계가 작아 직접 처리한다(커서 위치 기준, 한 칸에 약 25%)
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const ts = ch.timeScale(), r = ts.getVisibleLogicalRange();
      if (!r) return;
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) / 100 * 0.25);
      const x = e.clientX - el.getBoundingClientRect().left;
      const c = ts.coordinateToLogical(x) ?? (r.from + r.to) / 2;
      ts.setVisibleLogicalRange({ from: c - (c - r.from) * f, to: c + (r.to - c) * f });
    }, { passive: false });
    el.addEventListener('dblclick', () => ch.timeScale().fitContent());
  } catch (e) { msg.textContent = '-: 캔들을 불러오지 못했습니다 (' + e.message + ')'; }
}
