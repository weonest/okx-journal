import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, table, td, fmtNum, fmtTs, fmtDur, cls } from './dom.js';
import { S } from './store.js';

const ui = { type: 'ALL', inst: 'ALL', side: 'ALL', sort: 'closeTs', dir: -1, sel: null };

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
  const chartEl = h('div', { class: 'chart' });
  const msg = h('div', { class: 'mute' }, '캔들 불러오는 중…');
  setTimeout(() => drawCandles(chartEl, msg, t, fills, bills), 0);
  return h('div', {},
    h('div', { class: 'row' }, h('button', { class: 'sub', onclick: () => { ui.sel = null; rerender(); } }, '◀ 목록'), h('strong', {}, `${t.instId} ${t.side} · ${t.status}`)),
    h('section', {}, h('div', {}, `진입 ${fmtTs(t.openTs)} → 청산 ${fmtTs(t.closeTs)} (KST) · 최대 수량 ${fmtNum(t.maxSize, 6)}${t.closeReason && t.closeReason !== 'TRADE' ? ' · ' + t.closeReason : ''}`), h('ul', {}, amt.map((a) => h('li', {}, a)))),
    h('section', {}, h('h2', {}, '캔들 (공개 API market/history-candles)'), msg, chartEl),
    h('section', {}, h('h2', {}, '이벤트 타임라인'), ev.length ? table(['시각(KST)', '구분', '가격', '수량', '손익', '수수료', '통화'], ev.map((e) => [fmtTs(e.ts), e.kind, fmtNum(e.px, 6), fmtNum(e.sz, 6), fmtNum(e.pnl, 4), fmtNum(e.fee, 4), e.ccy ?? '-'])) : h('div', { class: 'mute' }, '-: 연결된 이벤트 없음')));
}

const BARS = [['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['1H', 3600e3], ['4H', 14400e3], ['1D', 86400e3]];

async function drawCandles(el, msg, t, fills, bills) {
  try {
    const end = t.closeTs ?? Date.now(), span = Math.max(end - t.openTs, 60e3);
    const [bar, ms] = BARS.find(([, m]) => span / m <= 40) ?? BARS.at(-1);
    const pad = Math.max(ms * 20, span * 0.3);
    const from = t.openTs - pad, to = end + pad;
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(t.instId)}&bar=${bar}&after=${Math.ceil(to)}&limit=100`;
    const j = await (await fetch(url)).json();
    if (j.code !== '0') throw new Error(j.msg || 'code ' + j.code);
    const cs = j.data.map((c) => ({ time: Math.floor(+c[0] / 1000), open: +c[1], high: +c[2], low: +c[3], close: +c[4] })).filter((c) => c.time * 1000 >= from).sort((a, b) => a.time - b.time);
    if (!cs.length) { msg.textContent = '-: 해당 구간 캔들 없음'; return; }
    msg.textContent = `봉 ${bar} · ${cs.length}개`;
    if (!el.isConnected) return;
    const ch = createChart(el, { width: el.clientWidth, height: 220, layout: { background: { color: '#141a18' }, textColor: '#8a9894' }, grid: { vertLines: { color: '#263230' }, horzLines: { color: '#263230' } }, timeScale: { timeVisible: true } });
    const s = ch.addCandlestickSeries();
    s.setData(cs);
    const snap = (ts) => { const sec = ts / 1000; let b = cs[0].time; for (const c of cs) if (c.time <= sec) b = c.time; return b; };
    const mk = [];
    const evs = fills.length ? fills.map((f) => ({ ts: f.ts, buy: f.side === 'buy' })) : [{ ts: t.openTs, buy: t.side === 'long' }, ...(t.closeTs ? [{ ts: t.closeTs, buy: t.side !== 'long' }] : [])];
    for (const e of evs) mk.push({ time: snap(e.ts), position: e.buy ? 'belowBar' : 'aboveBar', shape: e.buy ? 'arrowUp' : 'arrowDown', color: e.buy ? '#3ecf8e' : '#f0616d', text: e.buy ? '매수' : '매도' });
    s.setMarkers(mk.sort((a, b) => a.time - b.time));
    ch.timeScale().fitContent();
  } catch (e) { msg.textContent = '-: 캔들을 불러오지 못했습니다 (' + e.message + ')'; }
}
