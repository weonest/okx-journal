import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrders } from '../src/core/orders.js';

let n = 0;
const ord = (o) => ({ source: 'api', instType: 'SPOT', instId: 'BTC-USDT', ordId: `o${++n}`, ordType: 'limit', state: 'filled',
  sz: 3, accFillSz: 3, szUnit: 'base', avgPx: 100, fee: -3, feeCcy: 'USDT', ...o });
const fill = (o) => ({ source: 'api', instType: 'SPOT', instId: 'BTC-USDT', tradeId: String(++n), ordId: 'x', fillSz: 1, fillPx: 100,
  szUnit: 'base', execType: 'T', fee: -1, feeCcy: 'USDT', ...o });

test('1주문 다체결: 수량 합·VWAP·수수료·maker/taker, 일치하면 불일치 없음', () => {
  const o = ord({ ordId: 'A', avgPx: 100, accFillSz: 3 });
  const r = buildOrders([o], [
    fill({ ordId: 'A', fillSz: 1, fillPx: 90, execType: 'M' }),
    fill({ ordId: 'A', fillSz: 2, fillPx: 105 }),
  ]);
  const j = r.joined[0];
  assert.equal(j.fillCount, 2); assert.equal(j.fillSz, 3);
  assert.ok(Math.abs(j.vwap - 100) < 1e-9);
  assert.equal(j.fee.USDT, -2); assert.equal(j.maker, 1); assert.equal(j.taker, 1);
  assert.deepEqual(r.mismatches.map((m) => m.field), ['fee']); // 주문 fee -3 vs 체결 -2
});

test('Order 값과 다르면 불일치 목록, 고아 체결·중복 체결', () => {
  const o = ord({ ordId: 'B', accFillSz: 5, avgPx: 100, fee: -1 });
  const f = fill({ ordId: 'B', fillSz: 2, fillPx: 100 });
  const r = buildOrders([o], [f, f, fill({ ordId: 'ZZ' })]);
  assert.equal(r.dupFills, 1);
  assert.deepEqual(r.mismatches.map((m) => m.field).sort(), ['accFillSz', 'orphanFill']);
});

test('부분체결·취소·시장가 비율·체결률', () => {
  const r = buildOrders([
    ord({ ordId: 'C1', state: 'filled' }),
    ord({ ordId: 'C2', state: 'canceled', accFillSz: 0, sz: 3, ordType: 'market' }),
    ord({ ordId: 'C3', state: 'canceled', accFillSz: 1, sz: 3 }),
    ord({ ordId: 'C4', state: 'partially_filled', accFillSz: 1, sz: 3, ordType: 'post_only' }),
  ], []);
  const s = r.stats.SPOT;
  assert.equal(s.total, 4); assert.equal(s.canceled, 2); assert.equal(s.partial, 2); assert.equal(s.withFill, 3);
  assert.equal(s.fillRate.value, 0.25); assert.equal(s.cancelRate.value, 0.5);
  assert.ok(Math.abs(s.marketRatio.value - 1 / 4) < 1e-9);
  assert.equal(r.mismatches.length, 0); // 체결 없는 주문은 불일치 아님
});

test('Bill 매칭률만 보고, 주문 0건이면 null+사유', () => {
  const r = buildOrders([ord({ ordId: 'D1' }), ord({ ordId: 'D2' })], [fill({ ordId: 'D1' })], { bills: [{ ordId: 'D1' }] });
  assert.equal(r.billMatch.orders.value, 0.5); assert.equal(r.billMatch.fills.value, 1);
  const e = buildOrders([], []);
  assert.deepEqual(e.stats, {});
});
