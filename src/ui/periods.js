import { h, table, td, fmtNum, fmtPct, cls } from './dom.js';
import { S } from './store.js';
import { ui, filterBar } from './dashboard.js';
import { periodTable } from '../core/metrics.js';

const UNITS = [['day', '일별'], ['week', '주별'], ['month', '월별']];
let unit = 'week';

export function periodsView(rerender) {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다.');
  const ccys = Object.keys(r.metrics[ui.filter].daily.value);
  const bar = filterBar(ccys, rerender);
  const seg = h('div', { class: 'seg' }, UNITS.map(([u, label]) => h('button', { class: u === unit ? 'on' : null, onclick: () => { unit = u; rerender(); } }, label)));
  if (!ui.ccy) return h('div', {}, bar, h('section', {}, '-: 청산된 거래 없음'));
  const pt = periodTable(r.trades, unit, ui.ccy, ui.filter);
  const rows = [...pt.value].reverse().map((x) => [x.key, x.count, `${x.wins} / ${x.losses}`, fmtPct(x.winRate), td(fmtNum(x.pnl), cls(x.pnl)), td(fmtNum(x.fee), 'down'), td(fmtNum(x.other), cls(x.other)), td(fmtNum(x.net), cls(x.net)), td(fmtNum(x.cum), cls(x.cum))]);
  return h('div', {}, bar,
    h('section', { title: `source: ${pt.source}\nnote: ${pt.note}` },
      h('div', { class: 'between' }, h('h2', { class: 'big' }, `주기별 손익 정산 (${ui.ccy})`), seg),
      rows.length ? table(['기간(KST)', '청산', '승 / 패', '승률', '손익', '수수료', '이자·펀딩', '순손익', '누적'], rows) : h('div', { class: 'mute' }, '-')));
}
