import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger } from '../src/core/ledger.js';
import { buildPositions } from '../src/core/positions.js';

let n = 0;
const bill = (o) => ({
  source: 'api', instType: 'FUTURES', instId: 'BTC-USDT-261225', type: '2', ccy: 'USDT',
  billId: String(++n), ts: 1_000_000 + n * 1000, sz: null, pnl: 0, fee: 0, bal: null, balChg: null, ...o,
});
const run = (bills, opts) => buildPositions(buildLedger(bills).rows, opts);

test('오픈→증가→감소→청산: 한 거래로 묶고 손익·수수료 합산', () => {
  const r = run([
    bill({ subType: '3', sz: 2, fee: -1 }), bill({ subType: '3', sz: 1, fee: -0.5 }),
    bill({ subType: '5', sz: 1, pnl: 10, fee: -0.5 }), bill({ subType: '5', sz: 2, pnl: 20, fee: -1 }),
  ]);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.status, 'CLOSED');
  assert.equal(t.side, 'long');
  assert.equal(t.maxSize, 3);
  assert.equal(t.pnl, 30);
  assert.equal(t.fee, -3);
  assert.equal(t.net, 27);
  assert.equal(t.billIds.length, 4);
});

test('플립: 닫힘과 새 오픈으로 나누고 수수료는 수량 비례', () => {
  const r = run([
    bill({ subType: '1', sz: 2, fee: -1 }),
    bill({ subType: '2', sz: 5, pnl: 8, fee: -5 }),
    bill({ subType: '1', sz: 3, pnl: 4, fee: -1 }),
  ]);
  assert.equal(r.trades.length, 2);
  const [a, b] = r.trades;
  assert.equal(a.side, 'long'); assert.equal(a.status, 'CLOSED');
  assert.equal(a.pnl, 8); assert.equal(a.fee, -1 - 2);
  assert.equal(b.side, 'short'); assert.equal(b.status, 'CLOSED');
  assert.equal(b.fee, -3 - 1); assert.equal(b.pnl, 4);
});

test('이자·펀딩 귀속: 구간 안은 거래에, 밖은 unattributed', () => {
  const r = run([
    bill({ type: '7', subType: '9', instType: 'MARGIN', instId: 'BTC-USDT', balChg: -9 }), // 포지션 열기 전
    bill({ instType: 'MARGIN', instId: 'BTC-USDT', subType: '1', sz: 1, fee: -0.1 }),
    bill({ type: '7', subType: '9', instType: 'MARGIN', instId: 'BTC-USDT', balChg: -0.2 }),
    bill({ instType: 'MARGIN', instId: 'BTC-USDT', subType: '2', sz: 1, pnl: 5, fee: -0.1 }),
    bill({ type: '7', subType: '9', instType: 'MARGIN', instId: 'BTC-USDT', balChg: -9 }), // 청산 후
  ]);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].interest, -0.2);
  assert.equal(r.trades[0].net, 5 - 0.2 - 0.2);
  assert.equal(r.unattributed.length, 2);
});

test('만기 정산은 청산으로 처리, closeReason 표시', () => {
  const r = run([bill({ subType: '4', sz: 2 }), bill({ type: '3', subType: '113', sz: 2, pnl: -7 })]);
  assert.equal(r.trades[0].status, 'CLOSED');
  assert.equal(r.trades[0].closeReason, 'DELIVERY');
  assert.equal(r.trades[0].pnl, -7);
});

test('강제청산은 closeReason LIQUIDATION', () => {
  const r = run([bill({ subType: '3', sz: 1 }), bill({ type: '5', subType: '104', sz: 1, pnl: -50 })]);
  assert.equal(r.trades[0].closeReason, 'LIQUIDATION');
});

test('미청산은 OPEN으로 남는다', () => {
  const r = run([bill({ subType: '3', sz: 2 }), bill({ subType: '5', sz: 1 })]);
  assert.equal(r.unclosed.length, 1);
  assert.equal(r.unclosed[0].size, 1);
  assert.equal(r.unclosed[0].closeTs, null);
});

test('롱·숏 분리 모드: 같은 상품 두 구간이 동시에 열리면 이자는 귀속하지 않는다', () => {
  const r = run([
    bill({ subType: '3', sz: 1 }), bill({ subType: '4', sz: 1 }),
    bill({ type: '7', subType: '9', balChg: -1 }),
  ]);
  assert.equal(r.unclosed.length, 2);
  assert.match(r.unattributed[0].reason, /여러 개/);
});

test('코인 마진: 손익은 코인 단위로 유지, 통화가 섞이면 합계는 null', () => {
  const r = run([
    bill({ instId: 'BTC-USD-261225', ccy: 'BTC', subType: '3', sz: 1, fee: -0.0001 }),
    bill({ instId: 'BTC-USD-261225', ccy: 'BTC', subType: '5', sz: 1, pnl: 0.01, fee: -0.0001 }),
  ]);
  assert.equal(r.trades[0].ccy, 'BTC');
  assert.ok(near(r.trades[0].net, 0.0098));
  const mixed = run([bill({ subType: '3', sz: 1, fee: -1 }), bill({ subType: '5', sz: 1, ccy: 'BTC', pnl: 0.1 })]);
  assert.equal(mixed.trades[0].ccy, null);
  assert.equal(mixed.trades[0].net, null);
  assert.equal(mixed.trades[0].amounts.BTC.net, 0.1);
});
function near(a, b) { return Math.abs(a - b) < 1e-12; }

test('열린 기록 없는 청산은 orphans, 거래를 만들지 않는다', () => {
  const r = run([bill({ subType: '5', sz: 1, pnl: 3 })]);
  assert.equal(r.trades.length, 0);
  assert.equal(r.orphans.length, 1);
});

const mk = () => run([
  bill({ subType: '3', sz: 1, fee: -1 }), bill({ subType: '5', sz: 1, pnl: 10, fee: -1 }),
]);

test('positions-history 대조: 일치 / 차이 / 이력 없음', () => {
  const base = mk();
  const t = base.trades[0];
  const h = { posId: 'p1', instId: t.instId, posSide: 'long', closeTs: t.closeTs + 1000, realizedPnl: 8, ccy: 'USDT' };
  const rows = buildLedger([bill({ subType: '3', sz: 1, fee: -1 }), bill({ subType: '5', sz: 1, pnl: 10, fee: -1 })]).rows;
  const closeTs = rows[1].bill.ts;
  const same = buildPositions(rows, { positionsHistory: [{ ...h, closeTs }] });
  assert.equal(same.verify.history.status, 'OK');
  assert.equal(same.diffs.length, 0);
  const diff = buildPositions(rows, { positionsHistory: [{ ...h, closeTs, realizedPnl: 9 }] });
  assert.equal(diff.verify.history.status, 'DIFF');
  assert.equal(diff.diffs[0].field, 'realizedPnl');
  assert.equal(diff.diffs[0].diff, -1);
  const none = buildPositions(rows, {});
  assert.equal(none.verify.history.status, null);
});

test('MARGIN은 pnl·fee를 따로 비교', () => {
  const rows = buildLedger([
    bill({ instType: 'MARGIN', instId: 'BTC-USDT', subType: '1', sz: 1, fee: -1 }),
    bill({ instType: 'MARGIN', instId: 'BTC-USDT', subType: '2', sz: 1, pnl: 10, fee: -1 }),
  ]).rows;
  const closeTs = rows[1].bill.ts;
  const r = buildPositions(rows, { positionsHistory: [{ posId: 'm', instId: 'BTC-USDT', posSide: 'net', direction: 'long', closeTs, pnl: 10, fee: -3, ccy: 'USDT' }] });
  assert.deepEqual(r.diffs.map((d) => d.field), ['fee']);
});

test('최종 수량을 Position과 대조', () => {
  const rows = buildLedger([bill({ subType: '3', sz: 3 }), bill({ subType: '5', sz: 1 })]).rows;
  const ok = buildPositions(rows, { openPositions: [{ posId: 'x', instId: 'BTC-USDT-261225', posSide: 'long', pos: 2 }] });
  assert.equal(ok.verify.position.status, 'OK');
  const bad = buildPositions(rows, { openPositions: [{ posId: 'x', instId: 'BTC-USDT-261225', posSide: 'long', pos: 3 }] });
  assert.equal(bad.verify.position.status, 'DIFF');
  assert.equal(bad.diffs[0].diff, -1);
  const extra = buildPositions(rows, { openPositions: [{ posId: 'y', instId: 'ETH-USDT-261225', posSide: 'short', pos: 1 }] });
  assert.equal(extra.diffs.length, 2);
});

test('평균 진입가·청산가는 수량 가중', async () => {
  const { buildLedger } = await import('../src/core/ledger.js');
  const { buildPositions } = await import('../src/core/positions.js');
  const b = (id, ts, subType, sz, px, pnl = 0) => ({ billId: id, ts, type: '2', subType, instId: 'BTC-USDT-SWAP', instType: 'FUTURES', sz, px, pnl, fee: 0, balChg: pnl, ccy: 'USDT', mgnMode: 'cross' });
  const L = buildLedger([b('1', 1, '3', 2, 100), b('2', 2, '3', 2, 200), b('3', 3, '5', 1, 300, 5), b('4', 4, '5', 3, 400, 9)]);
  const t = buildPositions(L.rows).trades[0];
  assert.equal(t.avgEntryPx, 150); assert.equal(t.avgExitPx, 375);
});
