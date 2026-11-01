import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyReview, parseTags, hasContent, leverageOf, roeOf, mergeByTrade, newMock, mockTrade, mockTrades, isMockId } from '../src/core/review.js';

test('parseTags: 쉼표로 나누고 공백·중복 제거', () => {
  assert.deepEqual(parseTags(' 돌파, 지지 반등,돌파 ,, '), ['돌파', '지지 반등']);
  assert.deepEqual(parseTags(null), []);
});

test('hasContent: 빈 복기는 false, 한 칸이라도 있으면 true', () => {
  assert.equal(hasContent(emptyReview()), false);
  assert.equal(hasContent({ ...emptyReview(), mood: '차분' }), true);
  assert.equal(hasContent({ ...emptyReview(), ruleScore: 0 }), true);
});

test('leverageOf: 체결 ordId로 주문 레버리지를 찾고, 여러 값이면 최대값과 note', () => {
  const t = { execs: [{ ordId: 'o1' }, { ordId: 'o2' }, { ordId: null }] };
  assert.equal(leverageOf(t, [{ ordId: 'o1', lever: 10 }, { ordId: 'o2', lever: 10 }]).value, 10);
  const m = leverageOf(t, [{ ordId: 'o1', lever: 5 }, { ordId: 'o2', lever: 20 }]);
  assert.equal(m.value, 20); assert.match(m.note, /5, 20/);
  assert.equal(leverageOf(t, [{ ordId: 'x', lever: 3 }]).value, null);
  assert.equal(leverageOf({ execs: [] }, []).note, '체결에 주문 ID 없음');
});

test('roeOf: 마진 입력 시 net/margin, 없으면 null과 사유', () => {
  const t = { net: 50, ccy: 'USDT', status: 'CLOSED' };
  assert.equal(roeOf(t, { margin: 500 }).value, 0.1);
  assert.equal(roeOf(t, { margin: null }).note, '마진 미입력');
  assert.equal(roeOf({ ...t, status: 'OPEN' }, { margin: 500 }).value, null);
  assert.equal(roeOf({ ...t, net: null, ccy: null }, { margin: 500 }).value, null);
});

test('mergeByTrade: 노션 항목 뒤에 내용 있는 복기만 붙이고 원본은 그대로', () => {
  const src = new Map([['a', [{ pageId: 'p1', strategies: ['x'], reasons: [], mistakes: [], grade: 'A' }]]]);
  const out = mergeByTrade(src, { a: { ...emptyReview(), strategies: ['돌파'] }, b: emptyReview(), c: { ...emptyReview(), grade: 'B' } });
  assert.equal(out.get('a').length, 2);
  assert.equal(out.get('a')[1].pageId, 'local:a');
  assert.equal(out.has('b'), false);
  assert.equal(out.get('c')[0].grade, 'B');
  assert.equal(src.get('a').length, 1);
});

test('모의 매매: 입력값 그대로 거래 모양으로, 미입력은 null(계산으로 채우지 않음)', () => {
  const r = newMock({ instId: 'BTC-USDT-SWAP', side: 'short', ts: 1000 });
  let t = mockTrade('mock:a', r);
  assert.equal(t.mock, true); assert.equal(t.side, 'short'); assert.equal(t.status, 'OPEN');
  assert.equal(t.net, null); assert.deepEqual(t.amounts, {});
  assert.equal(roeOf(t, { margin: 100 }).value, null); // 미청산
  r.mock = { ...r.mock, closeTs: 2000, size: 1, entryPx: 100, exitPx: 90, net: 9.5, lever: 5 };
  t = mockTrade('mock:a', { ...r, margin: 50 });
  assert.equal(t.status, 'CLOSED'); assert.equal(t.net, 9.5); assert.equal(t.ccy, 'USDT');
  assert.equal(roeOf(t, { margin: 50 }).value, 0.19);
  assert.equal(leverageOf(t, []).value, 5);
});

test('mockTrades: mock: 키만, 삭제 표시는 제외, 매매일 순. 삭제된 복기는 내용 없음', () => {
  const list = mockTrades({
    'mock:b': newMock({ ts: 20 }), 'mock:a': newMock({ ts: 10 }),
    'mock:x': { ...newMock({ ts: 5 }), deleted: true }, 'BTC|long#1': { ...emptyReview(), mood: 'x' },
  });
  assert.deepEqual(list.map((t) => t.id), ['mock:a', 'mock:b']);
  assert.equal(isMockId('mock:a'), true); assert.equal(isMockId('BTC|long#1'), false);
  assert.equal(hasContent({ ...emptyReview(), mood: 'x', deleted: true }), false);
});
