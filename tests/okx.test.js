import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { sign, isoTs } from '../src/core/okx/sign.js';
import { createClient } from '../src/core/okx/client.js';
import { mapOrder, mapFill, mapBill, mapPosition, mapPositionHistory, mapBalance } from '../src/core/okx/mapApi.js';
import { mergeRecords } from '../src/core/merge.js';
import { syncAll } from '../src/core/okx/sync.js';

test('sign: Node crypto 결과와 일치', async () => {
  const ts = isoTs(Date.UTC(2026, 0, 2, 3, 4, 5, 678));
  assert.equal(ts, '2026-01-02T03:04:05.678Z');
  const path = '/api/v5/account/balance?ccy=BTC';
  const want = createHmac('sha256', 's3cret').update(ts + 'GET' + path).digest('base64');
  assert.equal(await sign('s3cret', ts, 'get', path, ''), want);
});

const res = (data, code = '0', status = 200) => ({ ok: status < 400, status, json: async () => ({ code, msg: '', data }) });

test('client: 헤더 4개·쿼리 서명·시간 보정', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    return url.includes('public/time') ? res([{ ts: '1000000030000' }]) : res([]);
  };
  const c = createClient({ key: 'K', secret: 'S', passphrase: 'P', fetch: f, now: () => 1000000000000 });
  await c.syncTime();
  assert.equal(c.skew, 30000);
  await c.get('/api/v5/account/balance', { ccy: 'BTC' });
  const { url, init } = calls[1];
  assert.ok(url.endsWith('/api/v5/account/balance?ccy=BTC'));
  const h = init.headers;
  assert.deepEqual(Object.keys(h).sort(), ['OK-ACCESS-KEY', 'OK-ACCESS-PASSPHRASE', 'OK-ACCESS-SIGN', 'OK-ACCESS-TIMESTAMP']);
  assert.equal(h['OK-ACCESS-TIMESTAMP'], isoTs(1000000030000));
  assert.equal(h['OK-ACCESS-SIGN'], createHmac('sha256', 'S').update(h['OK-ACCESS-TIMESTAMP'] + 'GET/api/v5/account/balance?ccy=BTC').digest('base64'));
});

test('client: 오류 코드는 throw, 50011은 대기 후 재시도', async () => {
  let n = 0; const sleeps = [];
  const f = async () => (++n < 3 ? res([], '50011', 429) : res([{ a: 1 }]));
  const c = createClient({ key: 'K', secret: 'S', passphrase: 'P', fetch: f, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(await c.get('/x'), [{ a: 1 }]);
  assert.equal(n, 3); assert.equal(sleeps.length, 2);
  const bad = createClient({ key: 'K', secret: 'S', passphrase: 'P', fetch: async () => res([], '50102') });
  await assert.rejects(() => bad.get('/x'), /50102/);
});

test('paginate: 마지막 커서를 after로, 적게 오면 종료', async () => {
  const afters = [];
  const pages = [[{ billId: '5' }, { billId: '4' }], [{ billId: '3' }, { billId: '2' }], [{ billId: '1' }]];
  let i = 0;
  const f = async (url) => { afters.push(new URL(url).searchParams.get('after')); return res(pages[i++] ?? []); };
  const c = createClient({ key: 'K', secret: 'S', passphrase: 'P', fetch: f, sleep: async () => {} });
  const all = await c.paginate('/api/v5/account/bills', {}, 'billId', { limit: 2 });
  assert.deepEqual(all.map((x) => x.billId), ['5', '4', '3', '2', '1']);
  assert.deepEqual(afters, [null, '4', '2']);
});

test('mapApi: 문자열 숫자 파싱, SWAP→FUTURES, 빈 값 null', () => {
  const o = mapOrder({ ordId: '1', instType: 'SWAP', instId: 'BTC-USDT-SWAP', side: 'buy', posSide: 'long', sz: '2', px: '', accFillSz: '2', avgPx: '50000', state: 'filled', cTime: '1767340800000', fee: '-1.5', feeCcy: 'USDT' });
  assert.equal(o.instType, 'FUTURES'); assert.equal(o.ts, 1767340800000); assert.equal(o.px, null); assert.equal(o.fee, -1.5);
  const b = mapBill({ billId: 'b', type: '2', subType: '3', ts: '1', instType: 'SWAP', sz: '2', posBal: '', posBalChg: '2', ccy: 'USDT', fee: '-1', pnl: '0', mgnMode: '', ordId: '' });
  assert.equal(b.source, 'api'); assert.equal(b.posBal, null); assert.equal(b.posBalChg, 2); assert.equal(b.mgnMode, null);
  const f = mapFill({ tradeId: 't', ts: '5', execType: 'T', fillPx: '1.5', fillSz: '3', fee: '-0.1', feeCcy: 'ETH', instType: 'SPOT' });
  assert.equal(f.fillPx, 1.5); assert.equal(f.instType, 'SPOT');
  assert.equal(mapPosition({ posId: 'p', uTime: '9', pos: '-3', instType: 'MARGIN' }).pos, -3);
  assert.equal(mapPositionHistory({ posId: 'p', uTime: '9', realizedPnl: '5', type: '2' }).closeTs, 9);
  const bal = mapBalance({ uTime: '3', details: [{ ccy: 'BTC', cashBal: '0.5', availBal: '0.4', openAvgPx: '', eqUsd: '100' }] });
  assert.equal(bal[0].bal, 0.5); assert.equal(bal[0].openAvgPx, null);
});

const R = (source, billId, ts) => ({ source, billId, ts });

test('merge: 상위 출처 기간 안의 하위 출처 제거, 기간 밖은 유지, 출처 내 중복 제거', () => {
  const recs = [R('csv', 'a', 10), R('csv', 'b', 50), R('csv', 'c', 150), R('archive', 'd', 40), R('archive', 'd', 40), R('archive', 'e', 100), R('api', 'f', 90), R('api', 'g', 120)];
  const m = mergeRecords(recs, 'Bill');
  // api [90,120] > archive [40,100] > csv [10,150]
  assert.deepEqual(m.records.map((r) => r.billId), ['a', 'd', 'f', 'g', 'c'].sort((x, y) => recs.find((r) => r.billId === x).ts - recs.find((r) => r.billId === y).ts));
  assert.equal(m.dropped.dupes, 1);
  assert.equal(m.dropped.covered, 2); // csv b(50)는 archive 기간 안, archive e(100)는 api 기간 안
  assert.throws(() => mergeRecords([{ source: 'x' }], 'Bill'));
});

test('syncAll: 가짜 client로 종류별 수집·중복 제거', async () => {
  const bill = { billId: '1', type: '2', subType: '3', ts: '100', instType: 'SWAP', sz: '1' };
  const c = {
    paginate: async (path) => (path.includes('bills') ? [bill] : path.includes('orders') ? [{ ordId: 'o', cTime: '5', instType: 'SPOT' }] : []),
    get: async (path) => (path.includes('balance') ? [{ uTime: '1', details: [{ ccy: 'BTC', cashBal: '1' }] }] : []),
  };
  const out = await syncAll(c);
  assert.equal(out.bills.length, 1); // bills + bills-archive 겹침 제거
  assert.equal(out.orders.length, 1);
  assert.equal(out.balance.length, 1);
});
