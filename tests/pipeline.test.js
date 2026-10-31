import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ingestCsv, analyze, emptyRaw, concatRaw, fromApi } from '../src/core/pipeline.js';

const dir = new URL('./fixtures/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));

test('fixtures 전체를 읽어 분석한다(종류 분류·병합·지표)', () => {
  const { raw, info } = ingestCsv(files);
  assert.equal(info.filter((i) => i.error).length, 0, JSON.stringify(info.filter((i) => i.error)));
  const a = analyze(raw);
  assert.ok(a.merged.Bill.output > 0);
  assert.ok(Array.isArray(a.trades));
  assert.equal(a.metrics.ALL.count.source.startsWith('ALL'), true);
});

test('잘못된 CSV 한 개는 error로 보고하고 나머지는 계속한다', () => {
  const { info } = ingestCsv([{ name: 'bad.csv', text: 'a,b\n1,2' }, files[0]]);
  assert.ok(info[0].error);
  assert.equal(info[1].error, null);
});

test('빈 입력도 오류 없이 분석된다', () => {
  const a = analyze(concatRaw(emptyRaw(), fromApi({})));
  assert.equal(a.trades.length, 0);
  assert.equal(a.metrics.ALL.count.value, 0);
});
