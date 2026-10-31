import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createClient } from '../src/core/okx/client.js';
import { applyArchive, getArchive, waitArchive } from '../src/core/okx/archive.js';
import { fromCsv } from '../src/core/normalize.js';
import { parseOkxFile } from '../src/core/csv.js';

const res = (data) => ({ ok: true, status: 200, json: async () => ({ code: '0', msg: '', data }) });
const mk = (f) => createClient({ key: 'K', secret: 'S', passphrase: 'P', fetch: f, now: () => 1000000000000 });

test('applyArchive: 서명된 POST, body 서명 포함', async () => {
  let call;
  const c = mk(async (url, init) => { call = { url, init }; return res([{ result: 'false' }]); });
  const r = await applyArchive(c, { year: 2025, quarter: 'q3' });
  assert.equal(r.ready, false);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, '{"year":"2025","quarter":"Q3"}');
  const h = call.init.headers;
  const want = createHmac('sha256', 'S').update(h['OK-ACCESS-TIMESTAMP'] + 'POST/api/v5/account/bills-history-archive' + call.init.body).digest('base64');
  assert.equal(h['OK-ACCESS-SIGN'], want);
  assert.equal(h['Content-Type'], 'application/json');
});

test('getArchive/waitArchive: GET 쿼리 서명, ongoing→finished, 신청 없음', async () => {
  const seq = ['ongoing', 'finished'];
  const methods = [];
  const c = mk(async (url, init) => {
    methods.push(init.method);
    assert.match(url, /\?year=2025&quarter=Q3$/);
    return res([{ state: seq.shift(), fileHref: 'https://x/y.zip', ts: '5' }]);
  });
  const r = await waitArchive(c, { year: '2025', quarter: 'Q3' }, { sleep: async () => {} });
  assert.equal(r.state, 'finished'); assert.equal(r.fileHref, 'https://x/y.zip');
  assert.deepEqual(methods, ['GET', 'GET']);
  await assert.rejects(getArchive(c, { year: '2025', quarter: 'Q5' }));
});

test('E: subtypes로 type 채우고 SWAP→FUTURES', () => {
  const subtypes = [{ type: '2', subTypeDetails: [{ subType: '1' }] }, { type: '3', subTypeDetails: [{ subType: '2' }] }];
  const { records } = fromCsv('E', parseOkxFile(readFileSync(new URL('./fixtures/archive.csv', import.meta.url), 'utf8')).rows, { subtypes });
  assert.equal(records[0].type, '2'); assert.equal(records[0].instType, 'FUTURES');
  assert.equal(records[1].type, '3'); assert.equal(records[1].instType, 'MARGIN');
});
