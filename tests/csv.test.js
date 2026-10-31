import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseOkxFile, detectKind } from '../src/core/csv.js';
import { fromCsv, parseTime, tzFromMeta, num } from '../src/core/normalize.js';

const f = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parseCsv: 따옴표·""·CRLF·BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","d""e"\r\n1,2,3\r\n'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,"x\ny"\n'), [['a', 'x\ny']]);
  assert.throws(() => parseCsv('a,"b'));
});

test('parseOkxFile: 메타 행 + 헤더, BOM/CRLF', () => {
  const p = parseOkxFile(f('order.csv'));
  assert.equal(p.meta[0], 'Exchange');
  assert.equal(p.headers[0], 'Order ID');
  assert.equal(p.rows.length, 4);
  assert.equal(p.rows[1].Symbol, 'ETH,USDT');
});

test('parseOkxFile: E는 메타 없이 1행이 헤더', () => {
  const p = parseOkxFile(f('archive.csv'));
  assert.equal(p.meta, null);
  assert.equal(p.rows.length, 2);
});

test('detectKind: A~E 판별, 모르는 헤더는 에러', () => {
  for (const [n, k] of [['order.csv', 'A'], ['fills.csv', 'B'], ['bills.csv', 'C'], ['pos.csv', 'D'], ['archive.csv', 'E']]) {
    assert.equal(detectKind(parseOkxFile(f(n)).headers), k, n);
  }
  assert.throws(() => detectKind(['foo', 'bar']));
});

test('num: 빈 값·-- 는 null', () => {
  assert.equal(num(''), null); assert.equal(num('--'), null); assert.equal(num('1,234.5'), 1234.5); assert.equal(num('-0.1'), -0.1);
});

test('시간 변환: UTC+8 → UTC ms, 시간대 모르면 null', () => {
  assert.equal(parseTime('2026-01-02 09:00:00', 8), Date.UTC(2026, 0, 2, 1, 0, 0));
  assert.equal(parseTime('2026-01-02 09:00:00', null), null);
  assert.equal(tzFromMeta(['Timezone', 'UTC+8']), 8);
  assert.equal(tzFromMeta(['a', 'b']), null);
});

test('A: 중복 제거, side 분리, 취소 상태', () => {
  const p = parseOkxFile(f('order.csv'));
  const r = fromCsv('A', p.rows, { meta: p.meta });
  assert.equal(r.records.length, 3);
  assert.equal(r.duplicates, 1);
  const [o1, o2, o3] = r.records;
  assert.equal(o1.instType, 'FUTURES'); assert.equal(o1.side, 'buy'); assert.equal(o1.posSide, 'long');
  assert.equal(o1.px, null); assert.equal(o1.avgPx, 50000); assert.equal(o1.fee, -1.5);
  assert.equal(o1.ts, Date.UTC(2026, 0, 2, 1));
  assert.equal(o2.state, 'canceled'); assert.equal(o2.instType, 'SPOT');
  assert.equal(o3.instType, 'MARGIN'); assert.equal(o3.side, 'buy'); assert.equal(o3.posSide, 'short'); assert.equal(o3.botId, 'bot7');
});

test('A: 메타에 시간대 없고 지정도 없으면 ts null + 건수', () => {
  const r = fromCsv('A', parseOkxFile(f('order.csv')).rows, {});
  assert.equal(r.records[0].ts, null);
  assert.equal(r.tsMissing, 3);
  assert.equal(fromCsv('A', parseOkxFile(f('order.csv')).rows, { tzOffsetHours: 0 }).records[0].ts, Date.UTC(2026, 0, 2, 9));
});

test('B: 체결 중복 제거, maker/taker', () => {
  const p = parseOkxFile(f('fills.csv'));
  const r = fromCsv('B', p.rows, { meta: p.meta });
  assert.equal(r.records.length, 2); assert.equal(r.duplicates, 1);
  assert.equal(r.records[0].execType, 'T'); assert.equal(r.records[1].execType, 'M');
  assert.equal(r.records[1].feeCcy, 'ETH');
});

test('C: Bill 변환, -- 는 null, UTC+8', () => {
  const r = fromCsv('C', parseOkxFile(f('bills.csv')).rows);
  assert.equal(r.records.length, 2);
  const [b1, b2] = r.records;
  assert.equal(b1.ts, Date.UTC(2026, 0, 2, 1, 0, 1)); assert.equal(b1.subType, 'Open long');
  assert.equal(b1.posBalChg, 2); assert.equal(b1.feeUsd, -1.5);
  assert.equal(b2.sz, null); assert.equal(b2.px, null); assert.equal(b2.posBal, null); assert.equal(b2.balChg, -0.2);
});

test('D: Position 변환', () => {
  const r = fromCsv('D', parseOkxFile(f('pos.csv')).rows);
  assert.equal(r.records.length, 1);
  const p = r.records[0];
  assert.equal(p.posId, 'P1'); assert.equal(p.instType, 'FUTURES'); assert.equal(p.pos, 2); assert.equal(p.ctVal, 0.01);
  assert.equal(p.snapshotTs, Date.UTC(2026, 0, 2, 2));
});

test('E: 아카이브 ts는 UTC ms 그대로, source=archive', () => {
  const r = fromCsv('E', parseOkxFile(f('archive.csv')).rows);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[0].source, 'archive'); assert.equal(r.records[0].ts, 1767340800000);
  assert.equal(r.records[1].posBalChg, null); assert.equal(r.records[1].interest, 0.01);
});
