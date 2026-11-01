// 모든 주요 탭 상단에 유지되는 시세 패널: 종목 카드(나의 최다 거래 / OKX 거래량 상위) + 캔들 차트 + 내 진입·청산 마커.
// 시세는 OKX 공개 API(키 불필요)만 쓴다. 손익 계산은 하지 않는다.
import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, fmtNum } from './dom.js';
import { S } from './store.js';

const BARS = [['1m', 60e3, '1분'], ['15m', 900e3, '15분'], ['1H', 3600e3, '1시간'], ['4H', 14400e3, '4시간'], ['1D', 86400e3, '1일'], ['1W', 604800e3, '1주']];
export const mkt = { src: 'mine', inst: null, bar: '1H' };
const API = 'https://www.okx.com/api/v5/market/';
const root = h('div', { class: 'mkt' });
const chartH = () => (innerWidth < 600 ? 300 : 420);
let lastKey = null, lastResult = null, token = 0;
const CANDLES = new Map();
let tickers = null, tickersAt = 0;

async function getTickers() {
  if (tickers && Date.now() - tickersAt < 60e3) return tickers;
  const [sw, sp] = await Promise.all(['SWAP', 'SPOT'].map(async (t) => (await (await fetch(`${API}tickers?instType=${t}`)).json()).data ?? []));
  tickers = new Map([...sw, ...sp].map((x) => [x.instId, x])); tickersAt = Date.now();
  return tickers;
}
const usdVol = (x) => (x && /-USDT(-SWAP)?$/.test(x.instId) ? Number(x.volCcy24h) * Number(x.last) : null);
const short = (n) => (n == null || !Number.isFinite(n) ? '-' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));
const baseOf = (id) => id.split('-')[0];

function topMine() {
  const c = new Map();
  for (const t of S.result?.trades ?? []) c.set(t.instId, (c.get(t.instId) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

/** 패널을 반환한다. 같은 상태면 DOM(차트 포함)을 그대로 두고, 바뀐 때만 다시 만든다. */
export function marketPanel(rerender) {
  const mine = topMine();
  if (!mkt.inst) mkt.inst = mine[0]?.[0] ?? 'BTC-USDT-SWAP';
  const key = [mkt.src, mkt.inst, mkt.bar, S.selTrade, S.result === lastResult ? '' : 'new'].join('|');
  if (key === lastKey && S.result === lastResult) return root;
  lastKey = key; lastResult = S.result;
  const my = ++token;

  const tab = (v, label) => h('button', { class: mkt.src === v ? 'on' : null, onclick: () => { mkt.src = v; mkt.inst = null; rerender(); } }, label);
  const cards = h('div', { class: 'cards5' });
  const chartEl = h('div', { class: 'chart', style: `height:${chartH()}px` });
  const msg = h('div', { class: 'mute' }, '시세 불러오는 중…');
  root.replaceChildren(
    h('div', { class: 'between' }, h('div', { class: 'mute' }, mkt.src === 'mine' ? '● 나의 최다 거래 종목' : '● OKX 거래량 상위 종목(USDT 무기한)'),
      h('div', { class: 'seg' }, tab('okx', 'OKX 거래량 상위'), tab('mine', '나의 최다 거래 종목'))),
    cards,
    h('section', {},
      h('div', { class: 'between' }, h('h2', { class: 'big' }, mkt.inst.replace('-SWAP', '').replace('-', '/')),
        h('div', { class: 'seg' }, BARS.map(([b, , label]) => h('button', { class: b === mkt.bar ? 'on' : null, onclick: () => { mkt.bar = b; rerender(); } }, label)))),
      msg, chartEl));

  const pick = (inst) => { mkt.inst = inst; S.selTrade = S.result?.trades.find((t) => t.id === S.selTrade && t.instId === inst) ? S.selTrade : null; rerender(); };
  const draw = (list) => cards.replaceChildren(...list.map(([inst, sub, x]) => {
    const last = x ? Number(x.last) : null, chg = x ? (last - Number(x.open24h)) / Number(x.open24h) : null;
    return h('div', { class: 'tcard' + (inst === mkt.inst ? ' on' : ''), onclick: () => pick(inst), title: inst },
      h('div', { class: 'tk' }, baseOf(inst), h('span', { class: 'mute' }, ' ' + (inst.endsWith('-SWAP') ? 'PERP' : 'SPOT'))),
      h('div', { class: 'tp' }, last == null ? '-' : '$' + fmtNum(last, last < 10 ? 4 : 2)),
      h('div', { class: 'between' }, h('span', { class: chg == null ? 'mute' : chg >= 0 ? 'up' : 'down' }, chg == null ? '-' : (chg >= 0 ? '+' : '') + (chg * 100).toFixed(2) + '%'), h('span', { class: 'mute' }, sub)));
  }));
  draw(mine.length || mkt.src === 'okx' ? (mkt.src === 'mine' ? mine : []).map(([i, n]) => [i, `${n}건`, null]) : []);

  getTickers().then((tk) => {
    if (my !== token) return;
    if (mkt.src === 'mine') draw(mine.map(([i, n]) => [i, `${n}건`, tk.get(i)]));
    else {
      const top = [...tk.values()].filter((x) => x.instId.endsWith('-USDT-SWAP')).map((x) => [x, usdVol(x)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (!top.length) return;
      if (!top.some(([x]) => x.instId === mkt.inst)) { mkt.inst = top[0][0].instId; lastKey = null; rerender(); return; }
      draw(top.map(([x, v]) => [x.instId, 'Vol $' + short(v), x]));
    }
  }).catch(() => { if (my === token && mkt.src === 'okx') cards.replaceChildren(h('div', { class: 'mute' }, '-: 시세를 불러오지 못했습니다(OKX 공개 API)')); });

  drawChart(my, chartEl, msg);
  return root;
}

async function candlesFor(inst, bar, ms, from, to) {
  const ck = `${inst}|${bar}|${Math.round(from / ms)}|${Math.round(to / ms)}`;
  if (CANDLES.has(ck)) return CANDLES.get(ck);
  const all = new Map();
  let after = Math.ceil(to);
  for (let page = 0; page < 12; page++) {
    const j = await (await fetch(`${API}history-candles?instId=${encodeURIComponent(inst)}&bar=${bar}&after=${after}&limit=100`)).json();
    if (j.code !== '0') throw new Error(j.msg || 'code ' + j.code);
    if (!j.data.length) break;
    for (const c of j.data) all.set(+c[0], c);
    const oldest = Math.min(...j.data.map((c) => +c[0]));
    if (oldest <= from) break;
    after = oldest;
  }
  const cs = [...all.values()].map((c) => ({ time: Math.floor(+c[0] / 1000), open: +c[1], high: +c[2], low: +c[3], close: +c[4] })).filter((c) => c.time * 1000 >= from).sort((a, b) => a.time - b.time);
  CANDLES.set(ck, cs);
  return cs;
}

async function drawChart(my, el, msg) {
  try {
    const inst = mkt.inst, [bar, ms] = BARS.find(([b]) => b === mkt.bar);
    const mine = [...(S.result?.trades ?? []), ...S.mocks].filter((t) => t.instId === inst); // 모의 매매도 진입·청산 표시
    const sel = mine.find((t) => t.id === S.selTrade);
    const now = Date.now();
    let from, to = now, view = null;
    if (sel) {
      const end = sel.closeTs ?? now, pad = Math.max(ms * 20, (end - sel.openTs) * 0.3);
      from = sel.openTs - pad; to = Math.min(now, end + pad) + ms; view = [from, end + pad];
    } else from = mine.length ? Math.min(...mine.map((t) => t.openTs)) - ms * 30 : now - ms * 300;
    const cs = await candlesFor(inst, bar, ms, from, to);
    if (my !== token) return;
    if (!cs.length) { msg.textContent = '-: 해당 구간 캔들 없음(상장 전이거나 공개 API에 없음)'; return; }
    msg.textContent = '';
    const ch = createChart(el, {
      width: el.clientWidth, height: chartH(), layout: { background: { color: '#1f2328' }, textColor: '#9aa4ab' },
      grid: { vertLines: { color: '#262b31' }, horzLines: { color: '#262b31' } }, timeScale: { timeVisible: true, rightOffset: 4, minBarSpacing: 1.5, borderColor: '#363c44' }, rightPriceScale: { borderColor: '#363c44' },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    new ResizeObserver(() => ch.applyOptions({ width: el.clientWidth })).observe(el);
    const s = ch.addCandlestickSeries({ upColor: '#3ecf8e', downColor: '#f0616d', borderVisible: false, wickUpColor: '#3ecf8e', wickDownColor: '#f0616d' });
    s.setData(cs);
    const snap = (ts) => { const sec = ts / 1000; if (sec < cs[0].time || sec > cs.at(-1).time + ms / 1000) return null; let b = cs[0].time; for (const c of cs) if (c.time <= sec) b = c.time; return b; };
    const mk = [];
    for (const t of mine) {
      const big = t.id === S.selTrade, long = t.side === 'long';
      const add = (ts, buy, text) => { const time = snap(ts); if (time != null) mk.push({ time, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? '#3ecf8e' : '#f0616d', size: big ? 2 : 1, text: big ? text : '' }); };
      if (big && t.execs?.length) { for (const e of t.execs) add(e.ts, e.side === 'buy', e.side === 'buy' ? 'B' : 'S'); continue; } // 선택 거래는 체결마다 B/S
      add(t.openTs, long, '진입');
      if (t.closeTs != null) add(t.closeTs, !long, '청산');
    }
    s.setMarkers(mk.sort((a, b) => a.time - b.time));
    if (view) { try { ch.timeScale().setVisibleRange({ from: Math.max(cs[0].time, view[0] / 1000), to: Math.min(cs.at(-1).time, view[1] / 1000) }); } catch { ch.timeScale().fitContent(); } } else ch.timeScale().fitContent();
    el.addEventListener('wheel', (e) => { // 휠 확대·축소(커서 기준, 한 칸 약 25%)
      e.preventDefault();
      const ts = ch.timeScale(), r = ts.getVisibleLogicalRange();
      if (!r) return;
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) / 100 * 0.25);
      const c = ts.coordinateToLogical(e.clientX - el.getBoundingClientRect().left) ?? (r.from + r.to) / 2;
      ts.setVisibleLogicalRange({ from: c - (c - r.from) * f, to: c + (r.to - c) * f });
    }, { passive: false });
    el.addEventListener('dblclick', () => ch.timeScale().fitContent());
  } catch (e) { if (my === token) msg.textContent = '-: 캔들을 불러오지 못했습니다 (' + e.message + ')'; }
}
