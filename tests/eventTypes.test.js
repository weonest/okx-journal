import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, positionKey } from '../src/core/eventTypes.js';

test('거래: 진입 +, 청산 −, 방향', () => {
  assert.deepEqual(classify({ type: '2', subType: '3' }), { event: 'TRADE', qty: 1, posSide: 'long', known: true });
  assert.deepEqual(classify({ type: '2', subType: '6' }), { event: 'TRADE', qty: -1, posSide: 'short', known: true });
  assert.deepEqual(classify({ type: 2, subType: 1 }), { event: 'TRADE', qty: 1, posSide: 'net', known: true });
  assert.equal(classify({ type: '2', subType: '2' }).qty, -1);
});

test('만기·강제청산·ADL은 청산(−)', () => {
  assert.deepEqual(classify({ type: '3', subType: '112' }), { event: 'DELIVERY', qty: -1, posSide: 'long', known: true });
  assert.equal(classify({ type: '3', subType: '113' }).posSide, 'short');
  assert.deepEqual(classify({ type: '5', subType: '104' }), { event: 'LIQUIDATION', qty: -1, posSide: 'long', known: true });
  assert.deepEqual(classify({ type: '9', subType: '126' }), { event: 'ADL', qty: -1, posSide: 'short', known: true });
  assert.equal(classify({ type: '5', subType: '106' }).qty, 1); // net 모드 청산 매수
});

test('이자·펀딩·이체는 수량 0', () => {
  assert.equal(classify({ type: '7', subType: '9' }).event, 'INTEREST');
  assert.equal(classify({ type: '8', subType: '173' }).event, 'FUNDING');
  assert.deepEqual(classify({ type: '1', subType: '11' }), { event: 'TRANSFER', qty: 0, posSide: null, known: true });
  assert.equal(classify({ type: '11', subType: '1' }).event, 'OTHER');
});

test('모르는 type·subType은 UNKNOWN', () => {
  assert.equal(classify({ type: '999', subType: '1' }).known, false);
  assert.equal(classify({ type: '2', subType: '9999' }).event, 'UNKNOWN');
  assert.equal(classify({ type: null, subType: '9999' }).known, false);
  assert.equal(classify({ type: null, subType: '3' }).qty, 1);
});

test('positionKey', () => {
  assert.equal(positionKey('BTC-USDT-251226', 'long'), 'BTC-USDT-251226|long');
  assert.equal(positionKey('BTC-USDT-251226', 'net'), 'BTC-USDT-251226');
});
