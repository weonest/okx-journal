import { h, table, td, fmtNum, fmtTs, cls } from './dom.js';
import { S } from './store.js';

export function positionsView() {
  const r = S.result;
  if (!r) return h('section', {}, '데이터가 없습니다.');
  const pos = [...(S.api?.Position ?? []), ...S.csv.Position].filter((p) => p.pos);
  const bal = [...(S.api?.balance ?? []), ...S.csv.balance];
  const live = !!S.api?.Position?.length;
  const rows = pos.map((p) => {
    const sgn = p.posSide === 'short' ? -1 : p.posSide === 'long' ? 1 : Math.sign(p.pos);
    const size = Math.abs(p.pos);
    const ok = p.markPx != null && p.avgPx != null && p.ctVal != null;
    const expo = ok ? size * p.ctVal * (p.ctMult ?? 1) * p.markPx : null;
    const upl = ok ? sgn * (p.markPx - p.avgPx) * size * p.ctVal * (p.ctMult ?? 1) : null;
    return [p.instId, p.mgnMode, h('td', {}, h('span', { class: 'tag ' + (sgn < 0 ? 'short' : 'long') }, sgn < 0 ? 'SHORT' : 'LONG')), fmtNum(size, 6), fmtNum(p.avgPx, 6), fmtNum(p.markPx, 6), fmtNum(expo), td(upl == null ? '-' : fmtNum(upl) + ' (추정)', cls(upl)), p.lever ?? '-', p.margin == null ? '-' : fmtNum(p.margin) + ' ' + p.ccy, fmtTs(p.snapshotTs)];
  });
  const holds = r.spot.holdings.filter((x) => x.qty > 1e-9);
  return h('div', {},
    h('section', {}, h('h2', {}, `FUTURES·MARGIN 포지션 (${live ? 'API 실시간' : pos.length ? 'CSV 스냅샷' : '-'})`),
      pos.length ? table(['종목', '모드', '방향', '수량', '평균가', '표시가', '노출(USD 아님, 견적통화)', '미실현', '레버', '증거금', '스냅샷(KST)'], rows) : h('div', { class: 'mute' }, '-: 열린 포지션 없음 또는 데이터 없음'),
      h('div', { class: 'mute' }, '노출·미실현은 선형계약(ctVal×수량×가격) 가정의 추정입니다. OKX 제공 upl은 레코드에 없어 쓰지 않았습니다.')),
    h('section', {}, h('h2', {}, 'SPOT 보유 (Fill 평균단가법)'),
      holds.length ? table(['종목', '수량', '평균단가'], holds.map((x) => [x.instId, fmtNum(x.qty, 8), x.avgPx == null ? '-' : fmtNum(x.avgPx, 6)])) : h('div', { class: 'mute' }, '-: 보유 없음'),
      r.spot.verify?.avgPx?.status ? h('div', { class: r.spot.verify.avgPx.status === 'OK' ? 'up' : 'warn' }, `balance 평균단가 대조: ${r.spot.verify.avgPx.status}`) : null),
    bal.length ? h('section', {}, h('h2', {}, 'balance'), table(['통화', '수량'], bal.map((b) => [b.ccy, fmtNum(b.eq ?? b.cashBal ?? b.bal, 8)]))) : null);
}
