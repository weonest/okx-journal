import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, card, table, td, fmtNum, fmtPct, fmtDur, cls } from './dom.js';
import { S } from './store.js';
import { periodPnl } from '../core/metrics.js';

const ui = { filter: 'ALL', ccy: null, month: null, range: 30, grp: '상품군' };
const RANGES = [[null, '전체'], [7, '7일'], [30, '30일'], [90, '90일']];
const CH = { layout: { background: { color: '#1f2328' }, textColor: '#9aa4ab' }, grid: { vertLines: { visible: false }, horzLines: { color: '#2a2f35' } }, timeScale: { borderColor: '#363c44' }, rightPriceScale: { borderColor: '#363c44' } };

const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([v, label]) => h('button', { class: v === cur ? 'on' : null, onclick: () => on(v) }, label)));
const metaOf = (m) => ({ title: `source: ${m.source}\nnote: ${m.note}` });

export function dashboardView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, S.error ? '오류: ' + S.error : '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리고, 또는 "예시 데이터 보기"를 누르세요.');
  const m = r.metrics[ui.filter];
  const totals = m.totals.value;
  const ccys = Object.keys(m.daily.value);
  if (!ccys.includes(ui.ccy)) ui.ccy = ccys[0] ?? null;
  const sel = (opts, cur, on) => h('select', { onchange: (e) => on(e.target.value) }, opts.map((o) => h('option', { value: o, selected: o === cur ? true : null }, o)));
  const filters = h('div', { class: 'row' },
    sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.filter, (v) => { ui.filter = v; ui.ccy = null; rerender(); }),
    ccys.length ? sel(ccys, ui.ccy, (v) => { ui.ccy = v; rerender(); }) : null);
  if (r.trades.length === 0) return h('div', {}, filters, h('section', {}, '거래 없음: 복원된 라운드트립이 0건입니다. 데이터 탭에서 원인(미분류·orphans)을 확인하세요.'));

  const eq = m.daily.value[ui.ccy] ?? [];
  const per = periodPnl(eq, ui.range);
  const P = per.value;
  const rangeTabs = seg(RANGES, ui.range, (v) => { ui.range = v; rerender(); });
  const rangeLabel = ui.range == null ? '전체' : `${ui.range}일`;

  // 기간 손익 + 누적 차트
  const lineEl = h('div', { class: 'chart', style: 'height:240px' });
  const top = h('section', {},
    h('div', { class: 'between' }, h('h2', { class: 'big' }, `${rangeLabel} 손익`), rangeTabs),
    h('div', { class: 'bignum', ...metaOf(per) }, P ? h('span', { class: cls(P.sum) }, (P.sum > 0 ? '+' : '') + fmtNum(P.sum)) : '-', h('small', {}, ' ' + (ui.ccy ?? ''))),
    P ? lineEl : h('div', { class: 'mute' }, '-: ' + per.note));

  // 일간 PnL + 분석
  const readDate = h('div', { class: 'mute' }), readVal = h('div', { class: 'bignum' });
  const barEl = h('div', { class: 'chart', style: 'height:240px' });
  const daily = h('section', {}, h('div', { class: 'between' }, h('h2', { class: 'big' }, '일간 PnL')), readDate, readVal, P ? barEl : h('div', { class: 'mute' }, '-'));
  const stat = (k, v, c) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'sv ' + (c ?? '') }, v));
  const analysis = h('section', { ...metaOf(per) }, h('h2', { class: 'big' }, 'PnL 분석'),
    stat('일 승률 (수익일/거래일)', P?.dayWinRate == null ? '-' : fmtPct(P.dayWinRate)),
    h('div', { class: 'two' }, stat('수익일', P ? String(P.profitDays) : '-', 'up'), stat('손실일', P ? String(P.lossDays) : '-', 'down')),
    h('div', { class: 'two' }, stat('누적 이익', P ? '+' + fmtNum(P.grossProfit) : '-', 'up'), stat('누적 손실', P ? fmtNum(P.grossLoss) : '-', 'down')));
  setTimeout(() => drawCharts(lineEl, barEl, P, readDate, readVal), 0);

  const wl = m.winLoss.value[ui.ccy];
  const main = h('div', { class: 'grid' },
    card(`순손익 (${ui.ccy ?? '-'})`, { ...m.totals, value: ui.ccy && totals[ui.ccy] ? totals[ui.ccy].net : null }, fmtNum(totals[ui.ccy]?.net)),
    card('거래 승률', m.winRate, fmtPct(m.winRate.value), `${m.count.value}건`),
    card('손익비', { ...m.winLoss, value: wl?.payoff ?? null }, fmtNum(wl?.payoff)),
    card('MDD (누적 순손익)', { ...m.mdd, value: m.mdd.value[ui.ccy] ?? null }, fmtNum(m.mdd.value[ui.ccy])));
  const more = h('details', {}, h('summary', {}, '지표 더 보기'), h('div', { class: 'grid' },
    card('USD 합계', m.usdNet, fmtNum(m.usdNet.value)),
    card('평균 이익', { ...m.winLoss, value: wl?.avgWin ?? null }, fmtNum(wl?.avgWin)),
    card('평균 손실', { ...m.winLoss, value: wl?.avgLoss ?? null }, fmtNum(wl?.avgLoss)),
    card('평균 보유시간', m.avgHoldMs, fmtDur(m.avgHoldMs.value)),
    card('롱 / 숏', m.sides, `${m.sides.value?.long} / ${m.sides.value?.short}`),
    card('일 평균 거래', m.perDay, fmtNum(m.perDay.value)),
    card('최대 노출', m.maxExposure, fmtNum(m.maxExposure.value))));

  const GROUPS = {
    '상품군': () => ['FUTURES', 'SPOT', 'MARGIN'].map((k) => [k, r.metrics[k]]),
    '종목': () => Object.entries(r.groups.instId),
    '롱 / 숏': () => Object.entries(r.groups.side),
  };
  return h('div', {},
    filters, top,
    h('div', { class: 'split' }, daily, analysis),
    h('section', {}, main, more),
    h('section', {}, h('h2', {}, '월 캘린더 (KST)'), calendar(eq, rerender)),
    h('section', {}, h('div', { class: 'between' }, h('h2', {}, '구분별 성과'), seg(Object.keys(GROUPS).map((k) => [k, k]), ui.grp, (v) => { ui.grp = v; rerender(); })), groupTable(GROUPS[ui.grp]())));
}

function drawCharts(lineEl, barEl, P, readDate, readVal) {
  if (!P || !P.points.length || !lineEl.isConnected) return;
  const base = (el, hgt) => ({ ...CH, width: el.clientWidth, height: hgt, handleScroll: false, handleScale: false });
  const a = createChart(lineEl, base(lineEl, 240));
  const area = a.addAreaSeries({ lineColor: '#3ecf8e', topColor: 'rgba(62,207,142,.25)', bottomColor: 'rgba(62,207,142,0)', lineWidth: 2 });
  area.setData(P.points.map((e) => ({ time: e.day, value: e.cum })));
  a.timeScale().fitContent();
  const b = createChart(barEl, base(barEl, 240));
  const bars = b.addHistogramSeries({});
  bars.setData(P.points.map((e) => ({ time: e.day, value: e.net, color: e.net >= 0 ? '#3ecf8e' : '#f0616d' })));
  b.timeScale().fitContent();
  const show = (day, v) => { readDate.textContent = day; readVal.textContent = (v > 0 ? '+' : '') + fmtNum(v); readVal.className = 'bignum ' + cls(v); };
  const last = P.points.at(-1);
  show(last.day, last.net);
  b.subscribeCrosshairMove((p) => { const d = p.time && p.seriesData.get(bars); if (d) show(String(p.time), d.value); else show(last.day, last.net); });
  const ro = new ResizeObserver(() => { a.applyOptions({ width: lineEl.clientWidth }); b.applyOptions({ width: barEl.clientWidth }); });
  ro.observe(lineEl);
}

function calendar(eq, rerender) {
  if (!eq.length) return h('div', { class: 'mute' }, '-');
  const months = [...new Set(eq.map((e) => e.day.slice(0, 7)))];
  if (!months.includes(ui.month)) ui.month = months.at(-1);
  const i = months.indexOf(ui.month);
  const net = new Map(eq.map((e) => [e.day, e.net]));
  const [y, mo] = ui.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells = ['일', '월', '화', '수', '목', '금', '토'].map((d) => h('div', { class: 'h' }, d));
  for (let k = 0; k < first; k++) cells.push(h('div', { class: 'h' }));
  for (let d = 1; d <= days; d++) {
    const key = `${ui.month}-${String(d).padStart(2, '0')}`;
    const v = net.get(key);
    cells.push(h('div', {}, h('div', { class: 'mute' }, d), v == null ? null : h('div', { class: cls(v) }, fmtNum(v, 1))));
  }
  return h('div', {},
    h('div', { class: 'row' },
      h('button', { class: 'sub', disabled: i === 0 ? true : null, onclick: () => { ui.month = months[i - 1]; rerender(); } }, '◀'),
      h('strong', {}, ui.month),
      h('button', { class: 'sub', disabled: i === months.length - 1 ? true : null, onclick: () => { ui.month = months[i + 1]; rerender(); } }, '▶')),
    h('div', { class: 'cal' }, cells));
}

function groupTable(entries) {
  const rows = entries.map(([name, m]) => {
    const tot = m.totals.value;
    const nets = Object.entries(tot).map(([c, a]) => `${fmtNum(a.net)} ${c}`).join(' / ') || '-';
    const first = Object.values(tot)[0];
    return [name, m.count.value, m.winRate.value == null ? '-' : fmtPct(m.winRate.value), td(nets, cls(first?.net)), m.usdNet.value == null ? '-' : fmtNum(m.usdNet.value)];
  });
  return table(['구분', '청산', '승률', '순손익(통화별)', 'USD'], rows);
}
