import { h, table, fmtTs, fmtPct, fmtNum } from './dom.js';
import { S } from './store.js';

const status = (s) => (s == null ? '-' : s === 'OK' ? h('span', { class: 'up' }, 'OK') : h('span', { class: 'down' }, s));

export function dataView() {
  const r = S.result;
  if (!r) return h('section', {}, S.error ? '오류: ' + S.error : '데이터가 없습니다. 설정에서 동기화하거나 CSV를 올리세요.');
  const out = [];

  out.push(h('section', {}, h('h2', {}, '출처별 기간·건수'),
    table(['종류', '출처', '입력', '기간(KST)'],
      Object.entries(r.merged).flatMap(([k, m]) => {
        const srcs = Object.keys(m.bySource);
        return srcs.length ? srcs.map((s) => [k, s, m.bySource[s], m.ranges[s] ? `${fmtTs(m.ranges[s][0])} ~ ${fmtTs(m.ranges[s][1])}` : '-']) : [[k, '-', 0, '-']];
      })),
    h('h2', {}, '병합 결과'),
    table(['종류', '입력', '결과', '같은 출처 중복', '상위 출처가 덮음'],
      Object.entries(r.merged).map(([k, m]) => [k, m.input, m.output, m.dropped.dupes, m.dropped.covered]))));

  const L = r.ledger;
  out.push(h('section', {}, h('h2', {}, '원장'),
    h('div', {}, `미분류 이벤트(UNKNOWN): ${L.unknown.length}종`),
    L.unknown.length ? table(['type', 'subType', '건수'], L.unknown.map((u) => [u.type, u.subType, u.count])) : null,
    h('div', {}, `잔고 불일치: ${L.balanceIssues.length}건` + (L.balanceSkipped ? ` · 대사 생략 ${L.balanceSkipped}건` : '')),
    h('div', {}, `열린 기록 없는 청산(orphans): ${r.positions.orphans.length}건 · 귀속 못 한 항목: ${r.positions.unattributed.length}건`),
    h('div', {}, `열린 채 남은 포지션 구간: ${r.positions.unclosed.length}건`)));

  const v = r.positions.verify;
  out.push(h('section', {}, h('h2', {}, '대조'),
    table(['항목', '결과', '비고'], [
      ['positions-history ↔ 복원 거래', status(v.history.status), v.history.note ?? `일치 ${v.history.matched} · 미매칭 거래 ${v.history.unmatchedTrades.length} · 미매칭 이력 ${v.history.unmatchedHistory.length}`],
      ['Position ↔ 미청산 수량', status(v.position.status), v.position.note ?? ''],
      ['SPOT Bill ↔ Fill 잔고', status(r.spot.verify.bills?.status), r.spot.verify.bills?.note ?? ''],
      ['Balance 평균단가 ↔ 계산', status(r.spot.verify.avgPx?.status), r.spot.verify.avgPx?.note ?? ''],
    ]),
    h('div', { class: 'mute' }, `차이 목록 ${r.positions.diffs.length}건`)));

  const bm = r.orders.billMatch;
  out.push(h('section', {}, h('h2', {}, '주문·체결 매칭'),
    bm ? table(['대상', '매칭률', '비고'], [bm.orders, bm.fills].map((m) => [m.source ?? '', m.value == null ? '-' : fmtPct(m.value), m.note ?? ''])) : '-',
    h('div', {}, `Order↔Fill 불일치 ${r.orders.mismatches.length}건 · 주문 없는 체결 ${r.orders.orphanFills.length}건 · 중복 체결 ${r.orders.dupFills}`)));

  const sp = r.spot;
  out.push(h('section', {}, h('h2', {}, '현물 가정'),
    h('div', {}, `취득가 미상 매도 ${sp.sells?.filter?.((s) => s.pnl == null).length ?? '-'}건 · side 없는 Fill ${sp.noSide?.length ?? 0}건`),
    h('ul', {}, (sp.notes ?? []).slice(0, 20).map((n) => h('li', {}, `${n.instId}: ${n.note}`))),
    h('div', { class: 'mute' }, '실데이터로 확인되지 않은 가정은 PROGRESS.md "남은 일"에 기록되어 있습니다.')));
  return h('div', {}, out);
}
