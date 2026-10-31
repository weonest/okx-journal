import { createChart } from '../../vendor/lightweight-charts.mjs';
import { h, card, table, td, fmtNum, fmtPct, fmtDur, cls } from './dom.js';
import { S } from './store.js';

const ui = { filter: 'ALL', ccy: null, month: null };

export function dashboardView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, S.error ? '오류: ' + S.error : '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리고, 또는 "예시 데이터 보기"를 누르세요.');
  const m = r.metrics[ui.filter];
  const totals = m.totals.value;
  const ccys = Object.keys(m.daily.value);
  if (!ccys.includes(ui.ccy)) ui.ccy = ccys[0] ?? null;

  const sel = (opts, cur, on) => h('select', { onchange: (e) => on(e.target.value) }, opts.map((o) => h('option', { value: o, selected: o === cur ? true : null }, o)));
  const head = h('div', { class: 'row' },
    sel(['ALL', 'FUTURES', 'SPOT', 'MARGIN'], ui.filter, (v) => { ui.filter = v; ui.ccy = null; rerender(); }),
    ccys.length ? sel(ccys, ui.ccy, (v) => { ui.ccy = v; rerender(); }) : null);

  const wl = m.winLoss.value[ui.ccy];
  const cards = h('div', { class: 'grid' },
    card('청산 거래', m.count, String(m.count.value)),
    card('승률', m.winRate, fmtPct(m.winRate.value)),
    card(`순손익 (${ui.ccy ?? '-'})`, { ...m.totals, value: ui.ccy && totals[ui.ccy] ? totals[ui.ccy].net : null }, fmtNum(totals[ui.ccy]?.net)),
    card('USD 합계', m.usdNet, fmtNum(m.usdNet.value)),
    card('평균 이익', { ...m.winLoss, value: wl?.avgWin ?? null }, fmtNum(wl?.avgWin)),
    card('평균 손실', { ...m.winLoss, value: wl?.avgLoss ?? null }, fmtNum(wl?.avgLoss)),
    card('손익비', { ...m.winLoss, value: wl?.payoff ?? null }, fmtNum(wl?.payoff)),
    card('MDD (누적 순손익)', { ...m.mdd, value: m.mdd.value[ui.ccy] ?? null }, fmtNum(m.mdd.value[ui.ccy])),
    card('평균 보유시간', m.avgHoldMs, fmtDur(m.avgHoldMs.value)),
    card('롱 / 숏', m.sides, `${m.sides.value?.long} / ${m.sides.value?.short}`),
    card('일 평균 거래', m.perDay, fmtNum(m.perDay.value)),
    card('최대 노출', m.maxExposure, fmtNum(m.maxExposure.value)));

  const eq = m.daily.value[ui.ccy] ?? [];
  const lineEl = h('div', { class: 'chart' });
  const barEl = h('div', { class: 'chart' });
  setTimeout(() => drawCharts(lineEl, barEl, eq), 0);

  return h('div', {},
    head,
    r.trades.length === 0 ? h('section', {}, '거래 없음: 복원된 라운드트립이 0건입니다. 데이터 탭에서 원인(미분류·orphans)을 확인하세요.') : null,
    h('section', {}, cards),
    h('section', {}, h('h2', {}, `누적 순손익 · 일별 손익 (${ui.ccy ?? '-'}, 청산일 KST)`), lineEl, barEl),
    h('section', {}, h('h2', {}, '월 캘린더 (KST)'), calendar(eq, rerender)),
    h('section', {}, h('h2', {}, '상품군'), groupTable(['FUTURES', 'SPOT', 'MARGIN'].map((k) => [k, r.metrics[k]]))),
    h('section', {}, h('h2', {}, '종목'), groupTable(Object.entries(r.groups.instId))),
    h('section', {}, h('h2', {}, '롱 / 숏'), groupTable(Object.entries(r.groups.side))));
}

function drawCharts(lineEl, barEl, eq) {
  if (!eq.length || !lineEl.isConnected) return;
  const opt = (el) => ({ width: el.clientWidth, height: 220, layout: { background: { color: '#1f2328' }, textColor: '#9aa4ab' }, grid: { vertLines: { color: '#363c44' }, horzLines: { color: '#363c44' } }, timeScale: { borderColor: '#363c44' }, rightPriceScale: { borderColor: '#363c44' } });
  const a = createChart(lineEl, opt(lineEl));
  a.addLineSeries({ color: '#3ecf8e', lineWidth: 2 }).setData(eq.map((e) => ({ time: e.day, value: e.cum })));
  a.timeScale().fitContent();
  const b = createChart(barEl, opt(barEl));
  b.addHistogramSeries({}).setData(eq.map((e) => ({ time: e.day, value: e.net, color: e.net >= 0 ? '#3ecf8e' : '#f0616d' })));
  b.timeScale().fitContent();
  window.addEventListener('resize', () => { a.applyOptions({ width: lineEl.clientWidth }); b.applyOptions({ width: barEl.clientWidth }); });
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
