import { h, table, fmtNum, fmtPct } from './dom.js';
import { S } from './store.js';

export function ordersView() {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다.');
  const o = r.orders;
  const pct = (m) => h('span', { title: `source: ${m.source}\nnote: ${m.note}` }, fmtPct(m.value));
  const pctTd = (m) => h('td', { title: `source: ${m.source}\nnote: ${m.note}` }, fmtPct(m.value));
  const rows = Object.entries(o.stats).map(([k, t]) => [k, t.total, t.filled, t.canceled, t.partial, t.maker ?? 0, t.taker ?? 0, pctTd(t.fillRate), pctTd(t.cancelRate), pctTd(t.marketRatio)]);
  const bm = o.billMatch;
  const mm = o.mismatches.slice(0, 50).map((m) => [m.ordId ?? '-', m.field, typeof m.order === 'number' ? fmtNum(m.order, 8) : String(m.order ?? '-'), typeof m.fill === 'number' ? fmtNum(m.fill, 8) : String(m.fill ?? '-')]);
  return h('div', {},
    h('section', {}, h('h2', {}, '상품군별 주문 통계'), rows.length ? table(['상품군', '주문', '완전체결', '취소', '부분체결', 'maker', 'taker', '체결률', '취소율', '시장가 비율'], rows) : h('div', { class: 'mute' }, '-: 주문 없음')),
    bm ? h('section', {}, h('h2', {}, 'Bill 매칭률'), h('div', {}, '주문 ', pct(bm.orders), ' · 체결 ', pct(bm.fills))) : null,
    h('section', {}, h('h2', {}, `불일치 ${o.mismatches.length}건`),
      mm.length ? table(['ordId', '항목', '주문', '체결'], mm) : h('div', { class: 'mute' }, '없음'),
      h('div', { class: 'mute' }, `주문 없는 체결 ${o.orphanFills.length} · 중복 체결 ${o.dupFills}`)),
    h('section', {}, h('h2', {}, '주문 (체결 있는 최근 30건)'),
      table(['ordId', '종목', '상태', '체결수', 'VWAP'], o.joined.filter((j) => j.fillCount).slice(-30).reverse().map((j) => [j.ordId, j.instId, j.state, j.fillCount, fmtNum(j.vwap, 6)]))));
}
