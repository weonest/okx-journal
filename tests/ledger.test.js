import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger } from '../src/core/ledger.js';

let n = 0;
/** 합성 Bill 헬퍼. 기본: FUTURES 거래 */
export const bill = (o) => ({
  source: 'api', instType: 'FUTURES', instId: 'BTC-USDT-261225', type: '2', ccy: 'USDT',
  billId: String(++n), ts: 1000 + n, sz: null, pnl: 0, fee: 0, bal: null, balChg: null, ...o,
});

test('오픈→증가→감소→청산 (롱)', () => {
  const { rows, open } = buildLedger([
    bill({ subType: '3', sz: 2 }), bill({ subType: '3', sz: 1 }),
    bill({ subType: '5', sz: 1 }), bill({ subType: '5', sz: 2 }),
  ]);
  assert.deepEqual(rows.map((r) => r.effect), ['OPEN', 'INCREASE', 'REDUCE', 'CLOSE']);
  assert.deepEqual(rows.map((r) => r.rem), [2, 3, 2, 0]);
  assert.deepEqual(open, {});
});

test('롱·숏 분리 모드는 키가 따로 쌓인다', () => {
  const { rows, open } = buildLedger([bill({ subType: '3', sz: 2 }), bill({ subType: '4', sz: 3 })]);
  assert.deepEqual(rows.map((r) => r.key), ['BTC-USDT-261225|long', 'BTC-USDT-261225|short']);
  assert.deepEqual(open, { 'BTC-USDT-261225|long': 2, 'BTC-USDT-261225|short': 3 });
});

test('단방향 플립', () => {
  const { rows } = buildLedger([bill({ subType: '1', sz: 2 }), bill({ subType: '2', sz: 5 })]);
  assert.equal(rows[1].effect, 'FLIP');
  assert.equal(rows[1].closeSz, 2);
  assert.equal(rows[1].openSz, 3);
  assert.equal(rows[1].dir, 'long');
  assert.equal(rows[1].dirAfter, 'short');
});

test('열린 기록 없는 청산은 ORPHAN, 잔량 0', () => {
  const { rows } = buildLedger([bill({ subType: '5', sz: 1 })]);
  assert.equal(rows[0].effect, 'ORPHAN');
  assert.equal(rows[0].rem, 0);
});

test('만기 정산은 청산으로 잔량을 줄인다', () => {
  const { rows } = buildLedger([bill({ subType: '3', sz: 2 }), bill({ type: '3', subType: '112', sz: 2 })]);
  assert.equal(rows[1].effect, 'CLOSE');
});

test('중복 billId 제거, 시간순 정렬', () => {
  const a = bill({ subType: '3', sz: 1, ts: 5000 });
  const b = bill({ subType: '5', sz: 1, ts: 4000 });
  const { rows } = buildLedger([a, { ...a }, b]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].bill.ts, 4000);
});

test('SPOT Bill은 포지션 원장에서 제외, UNKNOWN은 목록으로', () => {
  const { rows, unknown } = buildLedger([
    bill({ instType: 'SPOT', subType: '1', sz: 1 }),
    bill({ type: '2', subType: '9999', sz: 1 }),
    bill({ type: '999', subType: '1' }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(unknown.map((u) => `${u.type}/${u.subType}`).sort(), ['2/9999', '999/1']);
});

test('잔고 대사: 불일치 보고, null은 건너뜀', () => {
  const { balanceIssues, balanceSkipped } = buildLedger([
    bill({ subType: '3', sz: 1, bal: 100, balChg: 10 }),
    bill({ type: '1', instType: '', subType: '11', balChg: 5, bal: 105 }),
    bill({ subType: '5', sz: 1, balChg: 3, bal: 110 }), // 기대 108
    bill({ type: '7', subType: '9', balChg: null, bal: null }),
  ]);
  assert.equal(balanceIssues.length, 1);
  assert.equal(balanceIssues[0].expected, 108);
  assert.equal(balanceIssues[0].diff, 2);
  assert.equal(balanceSkipped, 1);
});
