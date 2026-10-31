import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, icon, card, table, td, fmtNum, fmtPct, fmtDur, cls } from './dom.js';
import { S } from './store.js';
const KST_MS = 9 * 3600 * 1000;
import { periodPnl, monthStats } from '../core/metrics.js';

export const ui = { filter: 'ALL', ccy: null, month: null, range: 30, grp: '상품군' };
const RANGES = [[null, '전체'], [7, '7일'], [30, '30일'], [90, '90일']];
const CH = { layout: { background: { color: '#1f2328' }, textColor: '#9aa4ab' }, grid: { vertLines: { visible: false }, horzLines: { color: '#2a2f35' } }, timeScale: { borderColor: '#363c44' }, rightPriceScale: { borderColor: '#363c44' } };

const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([v, label]) => h('button', { class: v === cur ? 'on' : null, onclick: () => on(v) }, label)));
const metaOf = (m) => ({ title: `source: ${m.source}\nnote: ${m.note}` });

/** 상품군·통화 선택 바(대시보드·캘린더·정산 공용). ccys는 호출 측이 고른 상품군의 통화 목록. */
export function filterBar(ccys, rerender) {
  if (!ccys.includes(ui.ccy)) ui.ccy = ccys[0] ?? null;
  const sel = (opts, cur, on) => h('select', { onchange: (e) => on(e.target.value) }, opts.map((o) => h('option', { value: o, selected: o === cur ? true : null }, o)));
  return h('div', { class: 'row' },
    sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.filter, (v) => { ui.filter = v; ui.ccy = null; rerender(); }),
    ccys.length ? sel(ccys, ui.ccy, (v) => { ui.ccy = v; rerender(); }) : null);
}

export function calendarView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다.');
  const ccys = Object.keys(r.metrics[ui.filter].daily.value);
  return h('div', {}, filterBar(ccys, rerender), calendarSection(r, rerender));
}

export function dashboardView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, S.error ? '오류: ' + S.error : '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리고, 또는 우측 상단 "예시 데이터"를 누르세요.');
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
    card(`누적 순손익 (${ui.ccy ?? '-'})`, { ...m.totals, value: ui.ccy && totals[ui.ccy] ? totals[ui.ccy].net : null }, fmtNum(totals[ui.ccy]?.net), '수수료·펀딩·이자 반영 후', 'trend', cls(totals[ui.ccy]?.net)),
    card('거래 승률', m.winRate, fmtPct(m.winRate.value), `청산 ${m.count.value}건`, 'percent', 'up'),
    card('손익비 (평균이익/평균손실)', { ...m.winLoss, value: wl?.payoff ?? null }, fmtNum(wl?.payoff), wl?.avgWin != null && wl?.avgLoss != null ? `${fmtNum(wl.avgWin)} / ${fmtNum(wl.avgLoss)}` : null, 'award', 'gold'),
    card('최대 낙폭 (MDD)', { ...m.mdd, value: m.mdd.value[ui.ccy] ?? null }, fmtNum(m.mdd.value[ui.ccy]), '누적 순손익 고점 대비', 'alert', 'down'));
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
    filters, main, top,
    h('div', { class: 'split' }, daily, analysis),
    h('section', {}, more),
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

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };

function sparkline(curve) {
  const W = 140, H = 56;
  if (curve.length < 2) return h('div', { class: 'mute' }, '-');
  const vs = curve.map((c) => c.cum), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), sp = hi - lo || 1;
  const pts = curve.map((c, i) => [(i / (curve.length - 1)) * W, H - 4 - ((c.cum - lo) / sp) * (H - 8)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const up = vs.at(-1) >= 0, col = up ? '#3ecf8e' : '#f0616d';
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark' },
    svg('polygon', { points: `0,${H} ${line} ${W},${H}`, fill: col, 'fill-opacity': '.15' }),
    svg('polyline', { points: line, fill: 'none', stroke: col, 'stroke-width': '2', 'stroke-linejoin': 'round' }));
}
function ring(rate) {
  const R = 30, C = 2 * Math.PI * R * 0.5; // 반원 호
  const arc = (frac, col) => svg('path', { d: `M 6 38 A ${R} ${R} 0 0 1 66 38`, fill: 'none', stroke: col, 'stroke-width': '7', 'stroke-linecap': 'round', 'stroke-dasharray': `${C * frac} ${C}` });
  return svg('svg', { viewBox: '0 0 72 44', width: 84, height: 52 }, arc(1, '#363c44'), rate == null ? svg('g') : arc(rate, '#3ecf8e'));
}

function calendarSection(r, rerender) {
  const closed = r.trades.filter((t) => t.status === 'CLOSED' && t.closeTs != null);
  const months = [...new Set(closed.map((t) => new Date(t.closeTs + KST_MS).toISOString().slice(0, 7)))].sort();
  if (!months.length || !ui.ccy) return h('section', {}, h('h2', {}, '트레이딩 캘린더 (KST)'), h('div', { class: 'mute' }, '-: 청산된 거래 없음'));
  if (!months.includes(ui.month)) ui.month = months.at(-1);
  const i = months.indexOf(ui.month);
  const ms = monthStats(r.trades, ui.month, ui.ccy, ui.filter), v = ms.value;
  const [y, mo] = ui.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const nd = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells = ['일', '월', '화', '수', '목', '금', '토'].map((d) => h('div', { class: 'dow' }, d));
  for (let k = 0; k < first; k++) cells.push(h('div', { class: 'day empty' }));
  for (let d = 1; d <= nd; d++) {
    const day = v.days[`${ui.month}-${String(d).padStart(2, '0')}`];
    cells.push(h('div', { class: 'day ' + (day ? (day.net > 0 ? 'pos' : day.net < 0 ? 'neg' : 'flat') : '') },
      h('div', { class: 'dn' }, d),
      day ? [h('div', { class: 'dv ' + cls(day.net) }, (day.net > 0 ? '+' : '') + fmtNum(day.net, 2)), h('div', { class: 'dc' }, `${day.count}건 청산`)] : null));
  }
  const nav = h('div', { class: 'row' },
    h('button', { class: 'sub', disabled: i === 0 ? true : null, onclick: () => { ui.month = months[i - 1]; rerender(); } }, '◀'),
    h('strong', {}, `${y}년 ${mo}월`),
    h('button', { class: 'sub', disabled: i === months.length - 1 ? true : null, onclick: () => { ui.month = months[i + 1]; rerender(); } }, '▶'),
    h('span', { class: 'mute' }, `${ui.filter} · ${ui.ccy}`));
  const dash = (x, f) => (x == null ? '--' : f(x));
  const panel = (title, ...kids) => h('div', { class: 'pcard', ...metaOf(ms) }, h('div', { class: 'pt' }, title), ...kids);
  const side = h('div', { class: 'cside' },
    panel('총 손익', h('div', { class: 'between' }, h('div', { class: 'psv ' + cls(v.total) }, v.count ? (v.total > 0 ? '+' : '') + fmtNum(v.total) + ' ' + ui.ccy : '--'), sparkline(v.curve))),
    panel('수익 팩터', h('div', { class: 'psv' }, dash(v.profitFactor, (x) => fmtNum(x, 2)))),
    panel('승률 / 패율', h('div', { class: 'between' }, h('div', {}, h('span', { class: 'psv up' }, dash(v.winRate, fmtPct)), ' ', h('span', { class: 'psv down' }, dash(v.lossRate, fmtPct))), ring(v.winRate))),
    panel('손익비', h('div', { class: 'psv' }, dash(v.riskReward, (x) => fmtNum(x, 2)))));
  return h('section', {}, h('h2', { class: 'big' }, '트레이딩 캘린더 (KST)'), nav, h('div', { class: 'calwrap' }, h('div', { class: 'calgrid' }, cells), side));
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
