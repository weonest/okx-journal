import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpot } from '../src/core/spot.js';

let n = 0;
const fill = (o) => ({
  source: 'api', instType: 'SPOT', instId: 'BTC-USDT', tradeId: String(++n), ts: 1_000_000 + n * 1000,
  side: 'buy', fillSz: 1, fillPx: 100, fee: 0, feeCcy: 'USDT', ...o,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('분할 매수→일부 매도→전량 매도: 평균단가법, 수수료는 매수분 몫+매도분', () => {
  const r = buildSpot([
    fill({ fillSz: 1, fillPx: 100, fee: -1 }),
    fill({ fillSz: 1, fillPx: 120, fee: -1 }),             // 평균 110, 수량 2, 매수수수료 2
    fill({ side: 'sell', fillSz: 1, fillPx: 130, fee: -1 }), // gross 20, 매수수수료 몫 1, 매도수수료 1
    fill({ side: 'sell', fillSz: 1, fillPx: 100, fee: -1 }), // gross -10, 몫 1, 매도 1
  ]);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.status, 'CLOSED');
  assert.equal(t.maxSize, 2);
  close(t.pnl, 10); close(t.fee, -4); close(t.net, 6);
  close(r.sells[0].pnl, 20); close(r.sells[0].fee, -2);
  assert.equal(r.unknown.length, 0);
});

test('기초코인 수수료: 수량 차감, 평균단가 상승', () => {
  const r = buildSpot([
    fill({ fillSz: 1, fillPx: 100, fee: -0.01, feeCcy: 'BTC' }),
  ]);
  const h = r.holdings[0];
  close(h.qty, 0.99); close(h.avgPx, 100 / 0.99);
  assert.equal(r.unclosed.length, 1);
});

test('취득가 미상 매도: pnl null + 사유, 라운드트립 만들지 않음', () => {
  const r = buildSpot([fill({ side: 'sell', fillSz: 1, fillPx: 100, fee: -1 })]);
  assert.equal(r.sells[0].pnl, null);
  assert.match(r.sells[0].reason, /취득가 미상/);
  assert.equal(r.unknown.length, 1);
  assert.equal(r.trades.length, 0);
});

test('보유 초과 매도: 전체 매도 손익 null, 열린 거래는 닫힘', () => {
  const r = buildSpot([fill({ fillSz: 1 }), fill({ side: 'sell', fillSz: 2, fillPx: 110 })]);
  assert.equal(r.sells[0].pnl, null);
  assert.equal(r.trades[0].status, 'CLOSED');
  assert.equal(r.trades[0].closeReason, 'UNKNOWN_BASIS');
});

test('먼지: minSz 미만 잔량이면 0으로 보고 닫는다', () => {
  const r = buildSpot([
    fill({ fillSz: 1, fillPx: 100 }),
    fill({ side: 'sell', fillSz: 0.9999, fillPx: 110 }),
  ], { dust: { 'BTC-USDT': 0.001 } });
  assert.equal(r.trades[0].status, 'CLOSED');
  assert.equal(r.unclosed.length, 0);
  close(r.holdings[0].qty, 0);
  // 닫힌 뒤 새 매수는 새 라운드트립
  const r2 = buildSpot([
    fill({ fillSz: 1 }), fill({ side: 'sell', fillSz: 0.9999 }), fill({ fillSz: 1 }),
  ], { dust: 0.001 });
  assert.equal(r2.trades.length, 2);
});

test('제3통화 수수료는 환산하지 않고 note, side 없는 Fill은 noSide', () => {
  const r = buildSpot([fill({ fee: -5, feeCcy: 'OKB' }), fill({ side: undefined })]);
  assert.equal(r.notes.length, 1);
  assert.equal(r.noSide.length, 1);
  close(r.trades[0].fee, 0);
});

test('Bill 대사: 일치 OK / 불일치 DIFF', () => {
  const fills = [fill({ fillSz: 1, fillPx: 100, fee: -1 }), fill({ side: 'sell', fillSz: 1, fillPx: 110, fee: -1 })];
  const [a, b] = fills;
  const bills = [
    { instType: 'SPOT', type: '2', ccy: 'BTC', balChg: 1, tradeId: a.tradeId },
    { instType: 'SPOT', type: '2', ccy: 'USDT', balChg: -101, tradeId: a.tradeId },
    { instType: 'SPOT', type: '2', ccy: 'BTC', balChg: -1, tradeId: b.tradeId },
    { instType: 'SPOT', type: '2', ccy: 'USDT', balChg: 109, tradeId: b.tradeId },
  ];
  assert.equal(buildSpot(fills, { bills }).verify.bills.status, 'OK');
  bills[3].balChg = 108;
  const v = buildSpot(fills, { bills }).verify.bills;
  assert.equal(v.status, 'DIFF');
  assert.equal(v.diffs[0].ccy, 'USDT');
  assert.equal(buildSpot(fills).verify.bills.status, null);
});

test('openAvgPx 대조', () => {
  const fills = [fill({ fillSz: 2, fillPx: 100 })];
  assert.equal(buildSpot(fills, { balances: [{ ccy: 'BTC', openAvgPx: 100 }] }).verify.avgPx.status, 'OK');
  assert.equal(buildSpot(fills, { balances: [{ ccy: 'BTC', openAvgPx: 105 }] }).verify.avgPx.status, 'DIFF');
});
