import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, table, td, fmtNum, fmtTs, fmtDur, cls } from './dom.js';
import { S } from './store.js';

const ui = { type: 'ALL', inst: 'ALL', side: 'ALL', sort: 'closeTs', dir: -1, sel: null, bar: 'auto' };

export function tradesView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리세요.');
  if (ui.sel) {
    const t = r.trades.find((x) => x.id === ui.sel);
    if (t) return detail(t, r, rerender);
    ui.sel = null;
  }
  const sel = (opts, cur, on) => h('select', { onchange: (e) => { on(e.target.value); rerender(); } }, opts.map((o) => h('option', { value: o, selected: o === cur ? true : null }, o)));
  const insts = ['ALL', ...new Set(r.trades.map((t) => t.instId))];
  let list = r.trades.filter((t) => (ui.type === 'ALL' || t.instType === ui.type) && (ui.inst === 'ALL' || t.instId === ui.inst) && (ui.side === 'ALL' || t.side === ui.side));
  const val = (t) => (ui.sort === 'net' ? t.net : ui.sort === 'hold' ? (t.closeTs != null ? t.closeTs - t.openTs : null) : t[ui.sort]);
  list = [...list].sort((a, b) => ((val(a) ?? -Infinity) - (val(b) ?? -Infinity)) * ui.dir);
  const th = (label, key) => h('button', { class: 'sub', onclick: () => { ui.dir = ui.sort === key ? -ui.dir : -1; ui.sort = key; rerender(); } }, label + (ui.sort === key ? (ui.dir < 0 ? ' ▼' : ' ▲') : ''));
  const rows = list.map((t) => [
    h('td', {}, h('a', { href: '#/trades', onclick: (e) => { e.preventDefault(); ui.sel = t.id; rerender(); } }, t.instId)),
    h('td', {}, h('span', { class: 'tag sym' }, t.instType)), h('td', {}, h('span', { class: 'tag ' + t.side }, t.side.toUpperCase())), fmtTs(t.openTs), fmtTs(t.closeTs), t.closeTs != null ? fmtDur(t.closeTs - t.openTs) : '-',
    td(t.ccy ? fmtNum(t.net) + ' ' + t.ccy : '통화 여럿', cls(t.net)), t.status,
  ]);
  return h('div', {},
    h('div', { class: 'row' }, sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.type, (v) => (ui.type = v)), sel(insts, ui.inst, (v) => (ui.inst = v)), sel(['ALL', 'long', 'short'], ui.side, (v) => (ui.side = v))),
    h('div', { class: 'row' }, th('청산시각', 'closeTs'), th('진입시각', 'openTs'), th('순손익', 'net'), th('보유', 'hold')),
    h('section', {}, h('div', { class: 'mute' }, `${list.length}건`), table(['종목', '상품', '방향', '진입(KST)', '청산(KST)', '보유', '순손익', '상태'], rows)));
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
    h('div', { class: 'row' }, h('button', { class: 'sub', onclick: () => { ui.sel = null; rerender(); } }, '◀ 목록'), h('strong', {}, `${t.instId} ${t.side} · ${t.status}`)),
    h('section', {}, h('div', {}, `진입 ${fmtTs(t.openTs)} → 청산 ${fmtTs(t.closeTs)} (KST) · 최대 수량 ${fmtNum(t.maxSize, 6)}${t.closeReason && t.closeReason !== 'TRADE' ? ' · ' + t.closeReason : ''}`), h('ul', {}, amt.map((a) => h('li', {}, a)))),
    h('section', {}, h('h2', {}, '캔들 (공개 API market/history-candles)'),
      h('div', { class: 'row' }, BAR_BTN.map(([b, label]) => h('button', { class: b === ui.bar ? null : 'sub', onclick: () => { ui.bar = b; rerender(); } }, label))), msg, chartEl),
    h('section', {}, h('h2', {}, '이벤트 타임라인'), ev.length ? table(['시각(KST)', '구분', '가격', '수량', '손익', '수수료', '통화'], ev.map((e) => [fmtTs(e.ts), e.kind, fmtNum(e.px, 6), fmtNum(e.sz, 6), fmtNum(e.pnl, 4), fmtNum(e.fee, 4), e.ccy ?? '-'])) : h('div', { class: 'mute' }, '-: 연결된 이벤트 없음')));
}

const BARS = [['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['1H', 3600e3], ['4H', 14400e3], ['1D', 86400e3], ['1W', 604800e3]];
const BAR_BTN = [['auto', '자동'], ['1m', '1분'], ['15m', '15분'], ['4H', '4시간'], ['1D', '일'], ['1W', '주']];

async function drawCandles(el, msg, t, fills, bills) {
  try {
    const end = t.closeTs ?? Date.now(), span = Math.max(end - t.openTs, 60e3);
    const [bar, ms] = (ui.bar !== 'auto' && BARS.find(([b]) => b === ui.bar)) || BARS.find(([, m]) => span / m <= 40) || BARS.at(-1);
    const pad = Math.max(ms * 20, span * 0.3);
    const from = t.openTs - pad, to = end + pad;
    const all = new Map();
    let after = Math.ceil(to);
    for (let page = 0; page < 12; page++) { // 한 번에 100개씩, from까지 거슬러 올라간다
      const j = await (await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(t.instId)}&bar=${bar}&after=${after}&limit=100`)).json();
      if (j.code !== '0') throw new Error(j.msg || 'code ' + j.code);
      if (!j.data.length) break;
      for (const c of j.data) all.set(+c[0], c);
      const oldest = Math.min(...j.data.map((c) => +c[0]));
      if (oldest <= from) break;
      after = oldest;
    }
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
