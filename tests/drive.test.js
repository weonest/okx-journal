import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, mergeReviews, forCloud, pendingImages, imageName, mergeRaw, mergeData, hasData, DriveAuthError } from '../src/core/drive.js';

const res = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([JSON.stringify(body)]) });

test('mergeReviews: 거래별로 updatedAt이 큰 쪽, 같으면 원격, 한쪽에만 있으면 그대로', () => {
  const local = { a: { updatedAt: 5, v: 'L' }, b: { updatedAt: 1, v: 'L' }, c: { updatedAt: 3, v: 'L' }, d: { updatedAt: 2, v: 'L' } };
  const remote = { a: { updatedAt: 4, v: 'R' }, b: { updatedAt: 9, v: 'R' }, d: { updatedAt: 2, v: 'R' }, e: { updatedAt: 1, v: 'R' } };
  const { merged, pulled, pushed } = mergeReviews(local, remote);
  assert.deepEqual(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v.v])), { a: 'L', b: 'R', c: 'L', d: 'R', e: 'R' });
  assert.equal(pulled, 2); // b, e (d는 같아서 세지 않음)
  assert.equal(pushed, 2); // a, c
});

test('forCloud: 이미지 원본은 빼고 id·fileId만', () => {
  const out = forCloud({ t: { updatedAt: 1, images: [{ id: 'i1', name: 'x.jpg', fileId: 'f1', src: 'data:...' }] } });
  assert.deepEqual(out.t.images, [{ id: 'i1', name: 'x.jpg', fileId: 'f1' }]);
});

test('pendingImages: fileId 없는 이미지만', () => {
  const p = pendingImages({ t: { images: [{ id: 'a', fileId: 'f' }, { id: 'b', fileId: null }] }, u: { images: [] } });
  assert.deepEqual(p.map((x) => [x.tradeId, x.img.id]), [['t', 'b']]);
});

test('imageName: 파일 이름에 못 쓰는 문자를 바꾸고 종목·방향을 남긴다', () => {
  assert.equal(imageName('BTC-USDT-SWAP|long#123', { id: 'abcdef123456' }), 'BTC-USDT-SWAP_long_123_abcdef12.jpg');
});

function fakeFetch(calls, handlers) {
  return async (url, init = {}) => {
    calls.push({ url: decodeURIComponent(url), method: init.method ?? 'GET', auth: init.headers?.Authorization, ct: init.headers?.['Content-Type'], body: init.body });
    for (const [re, r] of handlers) if (re.test(decodeURIComponent(url)) && (!r.method || r.method === (init.method ?? 'GET'))) return res(200, r.body);
    return res(200, {});
  };
}

test('ensureFolder: 표식으로 찾고, 없으면 parent 아래에 표식 달아 만든다', async () => {
  const calls = [];
  const d = createDrive(fakeFetch(calls, [[/files\?spaces=drive/, { body: { files: [] } }], [/files\?fields=id/, { method: 'POST', body: { id: 'dir1' } }]]), () => 'tok');
  assert.equal(await d.ensureFolder('root', 'OKX Journal', 'root'), 'dir1');
  assert.match(calls[0].url, /appProperties has \{ key='okxj' and value='root' \} and trashed=false and mimeType='application\/vnd.google-apps.folder'/);
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[1].body), { name: 'OKX Journal', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], appProperties: { okxj: 'root' } });
});

test('ensureFolder: 이미 있으면 만들지 않는다', async () => {
  const calls = [];
  const d = createDrive(fakeFetch(calls, [[/files\?spaces=drive/, { body: { files: [{ id: 'old' }] } }]]), () => 'tok');
  assert.equal(await d.ensureFolder('root', 'OKX Journal', 'root'), 'old');
  assert.equal(calls.length, 1);
});

test('putJson: 새 파일은 meta와 함께 multipart POST, 기존은 PATCH. findAppData는 appDataFolder 검색', async () => {
  const calls = [];
  const d = createDrive(fakeFetch(calls, [[/uploadType=multipart/, { body: { id: 'new1' } }], [/spaces=appDataFolder/, { body: { files: [{ id: 'a1' }] } }]]), () => 'tok');
  assert.equal(await d.putJson(null, { name: 'reviews.json', parents: ['dir1'], appProperties: { okxj: 'reviews' } }, { a: 1 }), 'new1');
  assert.equal(calls[0].method, 'POST'); assert.match(calls[0].ct, /^multipart\/related; boundary=/);
  assert.equal(await d.putJson('f9', null, { a: 1 }), 'f9');
  assert.equal(calls[1].method, 'PATCH'); assert.match(calls[1].url, /\/upload\/drive\/v3\/files\/f9\?uploadType=media/);
  assert.deepEqual(await d.findAppData('reviews.json'), { id: 'a1' });
  assert.match(calls[2].url, /spaces=appDataFolder&q=name='reviews.json' and trashed=false/);
});

test('createDrive: 토큰 없음·401은 DriveAuthError, 그 밖의 실패는 Error', async () => {
  await assert.rejects(createDrive(async () => res(200, {}), () => null).findTagged('x'), DriveAuthError);
  await assert.rejects(createDrive(async () => res(401, {}), () => 't').findTagged('x'), DriveAuthError);
  await assert.rejects(createDrive(async () => res(500, { e: 1 }), () => 't').findTagged('x'), /Drive 500/);
  // 받은 권한이 모자라면 scope 표시가 붙은 DriveAuthError(다시 연결 안내용)
  await assert.rejects(createDrive(async () => res(403, { error: { message: 'The granted scopes do not give access to all of the requested spaces.' } }), () => 't').findTagged('x'), (e) => e instanceof DriveAuthError && e.scope === true);
});

const raw = (o = {}) => ({ Order: [], Fill: [], Bill: [], PositionHistory: [], Position: [], balance: [], instruments: [], subtypes: [], ...o });
const bill = (id, v = 1, source = 'api') => ({ source, billId: id, ts: Number(id), v });

test('mergeRaw: 기록은 출처+기본키로 합치고(같으면 newer), 현재 상태는 newer', () => {
  const older = raw({ Bill: [bill('1'), bill('2', 1)], Position: [{ posId: 'p1' }] });
  const newer = raw({ Bill: [bill('2', 9), bill('3')], Position: [] });
  const m = mergeRaw(older, newer);
  assert.deepEqual(m.Bill.map((b) => [b.billId, b.v]), [['1', 1], ['2', 9], ['3', 1]]);
  assert.deepEqual(m.Position, []); // 새 동기화에서 포지션이 모두 닫힘
  assert.equal(mergeRaw(null, newer), newer);
  // 같은 billId라도 출처가 다르면 따로 둔다(출처 우선순위 병합은 analyze가 한다)
  assert.equal(mergeRaw(raw({ Bill: [bill('5', 1, 'csv')] }), raw({ Bill: [bill('5', 1, 'api')] })).Bill.length, 2);
});

test('mergeData: 3개월 지난 기록도 남고, 올릴지·받을지 판단', () => {
  const local = { api: raw({ Bill: [bill('10'), bill('11')] }), csv: raw(), csvInfo: [], lastSync: 200 };
  const remote = { api: raw({ Bill: [bill('1'), bill('10')] }), csv: raw({ Fill: [{ source: 'csv', tradeId: 't1' }] }), csvInfo: [{ name: 'a.csv', kind: 'B', records: 1 }], lastSync: 100 };
  const { data, push, pull } = mergeData(local, remote);
  assert.deepEqual(data.api.Bill.map((b) => b.billId).sort(), ['1', '10', '11']);
  assert.equal(data.csv.Fill.length, 1);
  assert.equal(data.csvInfo.length, 1);
  assert.equal(data.lastSync, 200);
  assert.equal(push, true); assert.equal(pull, true);
  const same = mergeData(data, data);
  assert.equal(same.push, false); assert.equal(same.pull, false);
  assert.equal(hasData(data), true); assert.equal(hasData({}), false);
});
