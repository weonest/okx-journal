import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, mergeReviews, forCloud, pendingImages, DriveAuthError } from '../src/core/drive.js';

const res = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob([JSON.stringify(body)]) });

test('mergeReviews: 거래별로 updatedAt이 큰 쪽, 한쪽에만 있으면 그대로', () => {
  const local = { a: { updatedAt: 5, v: 'L' }, b: { updatedAt: 1, v: 'L' }, c: { updatedAt: 3, v: 'L' }, d: { updatedAt: 2, v: 'L' } };
  const remote = { a: { updatedAt: 4, v: 'R' }, b: { updatedAt: 9, v: 'R' }, d: { updatedAt: 2, v: 'R' }, e: { updatedAt: 1, v: 'R' } };
  const { merged, pulled, pushed } = mergeReviews(local, remote);
  assert.deepEqual(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v.v])), { a: 'L', b: 'R', c: 'L', d: 'L', e: 'R' });
  assert.equal(pulled, 2); // b, e
  assert.equal(pushed, 2); // a, c (d는 같음)
});

test('forCloud: 이미지 원본은 빼고 id·fileId만', () => {
  const out = forCloud({ t: { updatedAt: 1, images: [{ id: 'i1', name: 'x.jpg', fileId: 'f1', src: 'data:...' }] } });
  assert.deepEqual(out.t.images, [{ id: 'i1', name: 'x.jpg', fileId: 'f1' }]);
});

test('pendingImages: fileId 없는 이미지만', () => {
  const p = pendingImages({ t: { images: [{ id: 'a', fileId: 'f' }, { id: 'b', fileId: null }] }, u: { images: [] } });
  assert.deepEqual(p.map((x) => [x.tradeId, x.img.id]), [['t', 'b']]);
});

test('createDrive: 토큰 헤더, appDataFolder 검색, 새 파일은 multipart POST, 기존은 PATCH', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization, ct: init.headers?.['Content-Type'] });
    if (url.includes('/drive/v3/files?spaces=appDataFolder')) return res(200, { files: [{ id: 'f9', modifiedTime: 't' }] });
    if (url.includes('uploadType=multipart')) return res(200, { id: 'new1' });
    return res(200, {});
  };
  const d = createDrive(fetch, () => 'tok');
  assert.deepEqual(await d.find('reviews.json'), { id: 'f9', modifiedTime: 't' });
  assert.match(decodeURIComponent(calls[0].url), /name='reviews.json' and trashed=false/);
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.equal(await d.putJson(null, 'reviews.json', { a: 1 }), 'new1');
  assert.equal(calls[1].method, 'POST'); assert.match(calls[1].ct, /^multipart\/related; boundary=/);
  assert.equal(await d.putJson('f9', 'reviews.json', { a: 1 }), 'f9');
  assert.equal(calls[2].method, 'PATCH'); assert.match(calls[2].url, /\/upload\/drive\/v3\/files\/f9\?uploadType=media/);
});

test('createDrive: 토큰 없음·401은 DriveAuthError, 그 밖의 실패는 Error', async () => {
  await assert.rejects(createDrive(async () => res(200, {}), () => null).find('x'), DriveAuthError);
  await assert.rejects(createDrive(async () => res(401, {}), () => 't').find('x'), DriveAuthError);
  await assert.rejects(createDrive(async () => res(500, { e: 1 }), () => 't').find('x'), /Drive 500/);
});
