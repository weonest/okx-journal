import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetrics } from '../src/core/metrics.js';

const H = 3600000;
const D = 86400000;
// 2026-01-01 00:00 UTC = 09:00 KST
const T0 = Date.UTC(2026, 0, 1);
let n = 0;
const tr = (o) => {
  const a = { pnl: o.pnl ?? 0, fee: o.fee ?? 0, interest: o.interest ?? 0, funding: o.funding ?? 0 };
  a.net = a.pnl + a.fee + a.interest + a.funding;
  return { id: `t${++n}`, instType: 'FUTURES', side: 'long', status: 'CLOSED', openTs: o.openTs ?? T0, closeTs: o.closeTs ?? T0 + H,
    amounts: { [o.ccy ?? 'USDT']: a }, ccy: o.ccy ?? 'USDT', ...a, ...(o.extra ?? {}) };
};

test('승률·평균·손익비·합계', () => {
  const r = buildMetrics([
    tr({ pnl: 12, fee: -2 }),                 // +10
    tr({ pnl: 32, fee: -2 }),                 // +30
    tr({ pnl: -18, fee: -2, interest: -1 }),  // -21
    tr({ pnl: -9, fee: -1 }),                 // -10
    tr({ pnl: 1, fee: -1 }),                  // 0 무승부
  ]);
  assert.equal(r.count.value, 5);
  const w = r.winLoss.value.USDT;
  assert.deepEqual([w.wins, w.losses, w.flat], [2, 2, 1]);
  assert.equal(w.winRate, 2 / 5);
  assert.equal(w.avgWin, 20); assert.equal(w.avgLoss, -15.5);
  assert.ok(Math.abs(w.payoff - 20 / 15.5) < 1e-12);
  assert.deepEqual(r.totals.value.USDT, { pnl: 18, fee: -8, interest: -1, funding: 0, net: 9 });
  assert.equal(r.usdNet.value, null); // 환산 기준 없음
});

test('일별 순손익은 KST 청산일, 누적·MDD', () => {
  // KST 1/1 23:00 = UTC 1/1 14:00, KST 1/2 01:00 = UTC 1/1 16:00 → 다른 날
  const a = tr({ pnl: 10, closeTs: T0 + 14 * H });
  const b = tr({ pnl: -4, closeTs: T0 + 16 * H });
  const c = tr({ pnl: -8, closeTs: T0 + D + 5 * H });  // KST 1/2
  const d = tr({ pnl: 3, closeTs: T0 + 3 * D });       // KST 1/4
  const r = buildMetrics([d, c, b, a]);
  assert.deepEqual(r.daily.value.USDT, [
    { day: '2026-01-01', net: 10, cum: 10 },
    { day: '2026-01-02', net: -12, cum: -2 },
    { day: '2026-01-04', net: 3, cum: 1 },
  ]);
  assert.equal(r.mdd.value.USDT, 12); // 고점 10 → 저점 -2
  assert.equal(r.perDay.value, 4 / 4); // 1/1~1/4 = 4일, 4건
});

test('통화 분리·혼합 거래·상품군 필터·롱숏·레버리지·보유시간', () => {
  const mixedT = { ...tr({ pnl: 1 }), ccy: null, net: null, amounts: { USDT: { pnl: 1, fee: 0, interest: 0, funding: 0, net: 1 }, BTC: { pnl: 0.1, fee: 0, interest: 0, funding: 0, net: 0.1 } } };
  const r = buildMetrics([
    tr({ pnl: 5, ccy: 'USDT', closeTs: T0 + 2 * H, extra: { lever: 10 } }),
    tr({ pnl: -0.5, ccy: 'BTC', closeTs: T0 + 4 * H, extra: { lever: 5, side: 'short' } }),
    tr({ pnl: 3, instType: 'SPOT', extra: { instType: 'SPOT' } }),
    mixedT,
    { ...tr({}), status: 'OPEN', closeTs: null },
  ]);
  assert.equal(r.count.value, 4); assert.match(r.count.note, /미청산 1/);
  assert.deepEqual(Object.keys(r.totals.value).sort(), ['BTC', 'USDT']);
  assert.equal(r.totals.value.USDT.net, 5 + 3 + 1);
  assert.equal(r.winLoss.value.BTC.losses, 1);
  assert.match(r.winLoss.note, /제외/);
  assert.equal(r.avgHoldMs.value, (2 * H + 4 * H + H + H) / 4);
  assert.deepEqual(r.sides.value, { long: 3, short: 1 });
  assert.deepEqual(r.leverage.value, { 10: 1, 5: 1 }); // 혼합 거래 1건(FUTURES) 레버리지 미상
  assert.match(r.leverage.note, /미상 1/);
  const s = buildMetrics([tr({ pnl: 5 }), tr({ pnl: 3, extra: { instType: 'SPOT' } })], { filter: 'SPOT' });
  assert.equal(s.count.value, 1);
  assert.equal(s.leverage.value, null);
});

test('USD 환산: 기준 표시, 환산 불가 통화는 null', () => {
  const ts = [tr({ pnl: 10 }), tr({ pnl: 0.01, ccy: 'BTC' })];
  const rate = (c) => (c === 'USDT' ? { rate: 1, basis: 'fillIdxPx' } : c === 'BTC' ? { rate: 50000, basis: '캔들 종가' } : null);
  const r = buildMetrics(ts, { usdRate: rate });
  assert.equal(r.usdNet.value, 10 + 500);
  assert.match(r.usdNet.note, /fillIdxPx/); assert.match(r.usdNet.note, /캔들 종가/);
  const r2 = buildMetrics(ts, { usdRate: (c) => (c === 'USDT' ? { rate: 1, basis: 'x' } : null) });
  assert.equal(r2.usdNet.value, null); assert.match(r2.usdNet.note, /BTC/);
});

test('최대 노출: 동시 보유 합의 최댓값, 같은 시각 청산 우선', () => {
  const a = tr({ openTs: T0, closeTs: T0 + 2 * H, extra: { n: 100 } });
  const b = tr({ openTs: T0 + H, closeTs: T0 + 3 * H, extra: { n: 50 } });
  const c = tr({ openTs: T0 + 3 * H, closeTs: T0 + 4 * H, extra: { n: 70 } });
  const r = buildMetrics([a, b, c], { notionalOf: (t) => t.n });
  assert.equal(r.maxExposure.value, 150);
  assert.equal(buildMetrics([a]).maxExposure.value, null);
  assert.equal(buildMetrics([]).count.value, 0);
  assert.equal(buildMetrics([]).winRate.value, null);
});
