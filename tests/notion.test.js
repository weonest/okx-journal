import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotionPages, linkJournal, journalStats, dateRange } from '../src/core/notion.js';

const rt = (s) => [{ plain_text: s }];
const page = (id, o = {}) => ({ object: 'page', id, url: 'u/' + id, properties: {
  이름: { type: 'title', title: rt('메모' + id) },
  날짜: { type: 'date', date: o.date ? { start: o.date, end: o.end ?? null } : null },
  종목: { type: 'select', select: o.inst ? { name: o.inst } : null },
  방향: { type: 'select', select: o.side ? { name: o.side } : null },
  전략: { type: 'multi_select', multi_select: (o.st ?? []).map((name) => ({ name })) },
  실수: { type: 'multi_select', multi_select: (o.mi ?? []).map((name) => ({ name })) },
  등급: { type: 'select', select: o.grade ? { name: o.grade } : null },
  연결ID: { type: 'rich_text', rich_text: o.link ? rt(o.link) : [] },
} });
const H = 3600e3;
const T0 = Date.parse('2026-10-10T01:00:00Z'); // KST 10:00
const trades = [
  { id: 'A#1', instId: 'BTC-USDT-SWAP', side: 'long', openTs: T0, closeTs: T0 + 5 * H, status: 'CLOSED', ccy: 'USDT', net: 10 },
  { id: 'B#1', instId: 'ETH-USDT-SWAP', side: 'short', openTs: T0, closeTs: T0 + 2 * H, status: 'CLOSED', ccy: 'USDT', net: -4 },
  { id: 'C#1', instId: 'BTC-USDT-SWAP', side: 'short', openTs: T0 + 48 * H, closeTs: null, status: 'OPEN', ccy: null, net: null },
];

test('속성 파싱: 여러 타입·빈 값', () => {
  const [e] = parseNotionPages([page('1', { date: '2026-10-10', inst: 'BTC', st: ['돌파'], link: 'A#1' })]);
  assert.equal(e.instId, 'BTC'); assert.deepEqual(e.strategies, ['돌파']); assert.equal(e.linkId, 'A#1'); assert.deepEqual(e.mistakes, []);
  assert.equal(parseNotionPages([page('2')])[0].date, null);
});

test('날짜만 있으면 KST 하루', () => {
  const [a, b] = dateRange('2026-10-10');
  assert.equal(a, Date.parse('2026-10-09T15:00:00Z')); assert.equal(b - a, 86400e3 - 1);
});

test('연결: 연결ID 우선, 없으면 종목+날짜, 방향 불일치·날짜 밖은 미연결', () => {
  const es = parseNotionPages([
    page('1', { link: 'B#1' }),                        // 연결ID
    page('2', { date: '2026-10-10', inst: 'BTC' }),    // 종목+날짜 → A#1
    page('3', { date: '2026-10-10', inst: 'BTC', side: '숏' }), // 방향 불일치
    page('4', { date: '2026-10-20', inst: 'BTC' }),    // 날짜 밖
    page('5', { inst: 'BTC' }),                        // 날짜 없음
    page('6', { link: 'X', date: '2026-10-10T11:00:00+09:00', inst: 'ETH-USDT-SWAP' }), // 잘못된 연결ID → 대체 연결
  ]);
  const r = linkJournal(es, trades, { now: T0 + 100 * H });
  assert.deepEqual(r.byTrade.get('B#1').map((e) => e.pageId), ['1', '6']);
  assert.deepEqual(r.byTrade.get('A#1').map((e) => e.pageId), ['2']);
  assert.equal(r.unlinked.length, 3);
  assert.ok(r.unlinked.find((u) => u.pageId === '5').reason.includes('날짜 없음'));
  assert.equal(r.links.find((l) => l.pageId === '1').by, 'linkId');
});

test('열린 거래는 now까지 보유로 보고, 집계는 청산된 거래만', () => {
  const es = parseNotionPages([page('1', { date: '2026-10-12', inst: 'BTC', side: 'short', st: ['역추세'] })]);
  const r = linkJournal(es, trades, { now: T0 + 60 * H });
  assert.equal(r.byTrade.get('C#1').length, 1);
  assert.equal(Object.keys(journalStats(r.byTrade, trades).strategies.value).length, 0);
});

test('전략·실수 집계: 태그별 건수·승률·통화별 손익, 같은 거래 중복 태그는 한 번', () => {
  const es = parseNotionPages([
    page('1', { link: 'A#1', st: ['돌파', '돌파'], mi: ['추격'], grade: 'A' }),
    page('2', { link: 'B#1', st: ['돌파'], mi: [], grade: 'C' }),
  ]);
  const { byTrade } = linkJournal(es, trades);
  const s = journalStats(byTrade, trades);
  assert.equal(s.strategies.value['돌파'].count, 2);
  assert.equal(s.strategies.value['돌파'].winRate, 0.5);
  assert.equal(s.strategies.value['돌파'].net.USDT, 6);
  assert.equal(s.mistakes.value['추격'].wins, 1);
  assert.equal(s.grade.value['C'].losses, 1);
  assert.ok(s.strategies.source && s.strategies.note);
});

test('시각이 적힌 일지는 진입 시각과 5분 안으로 어긋나도 연결', () => {
  const near = parseNotionPages([page('1', { date: new Date(T0 - 2 * 60e3).toISOString(), inst: 'BTC' }), page('2', { date: new Date(T0 - 20 * 60e3).toISOString(), inst: 'BTC' })]);
  const r = linkJournal(near, trades);
  assert.deepEqual(r.links.map((l) => l.pageId), ['1']);
  assert.equal(r.unlinked[0].pageId, '2');
});
