import { h, table, td, fmtNum, fmtPct, fmtTs, cls } from './dom.js';
import { S, addJournal } from './store.js';

const netText = (net) => Object.entries(net).map(([c, v]) => `${fmtNum(v)} ${c}`).join(' / ') || '-';

function statTable(m, label) {
  const rows = Object.entries(m.value).sort((a, b) => b[1].count - a[1].count).map(([k, x]) =>
    [k, x.count, x.wins, x.losses, fmtPct(x.winRate), td(netText(x.net), cls(Object.values(x.net)[0]))]);
  return h('div', { title: `source: ${m.source}\nnote: ${m.note}` },
    h('h2', {}, label),
    rows.length ? table(['태그', '거래', '승', '패', '승률', '순손익(통화별)'], rows) : h('div', { class: 'mute' }, '-: 연결된 청산 거래 없음'));
}

export function journalView() {
  const err = h('div', { class: 'warn' });
  const pick = h('input', { type: 'file', accept: '.json,application/json' });
  pick.onchange = async () => { try { await addJournal(pick.files[0]); } catch (e) { err.textContent = '오류: ' + e.message; } };
  const up = h('section', {}, h('h2', {}, '노션 일지 불러오기'),
    h('div', { class: 'mute' }, '노션 API는 브라우저에서 막혀 있어 `node --env-file=.env.local scripts/notion-export.js`로 만든 data/notion-journal.json을 올립니다.'),
    h('div', { class: 'row' }, pick), err);
  if (!S.journal) return h('div', {}, up, h('section', {}, h('div', { class: 'mute' }, '-: 일지가 없습니다. 우측 상단 "예시 데이터"를 누르면 합성 일지가 함께 보입니다.')));
  if (!S.linked) return h('div', {}, up, h('section', {}, '거래 데이터가 없어 연결하지 못했습니다. 먼저 거래 데이터를 불러오세요.'));

  const L = S.linked, tradeById = new Map(S.result.trades.map((t) => [t.id, t]));
  const link = new Map(L.links.map((l) => [l.pageId, l]));
  const rows = [...S.journal.entries].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((e) => {
    const l = link.get(e.pageId), t = l && tradeById.get(l.tradeId);
    return [e.date ? fmtTs(Date.parse(e.date.length <= 10 ? e.date + 'T00:00:00+09:00' : e.date)) : '-', e.instId ?? '-', e.side ?? '-', e.strategies.join(', ') || '-', e.mistakes.join(', ') || '-', e.grade ?? '-',
      t ? td(`${t.instId} ${t.side}${t.ccy ? ' · ' + fmtNum(t.net) + ' ' + t.ccy : ''}`, cls(t.net)) : td('미연결', 'warn'),
      l ? (l.by === 'linkId' ? '연결ID' : '종목+날짜') + (l.note ? ' (' + l.note + ')' : '') : (L.unlinked.find((u) => u.pageId === e.pageId)?.reason ?? '-')];
  });
  return h('div', {},
    up,
    h('section', {}, h('div', {}, `일지 ${S.journal.entries.length}건 · 연결 ${L.links.length} · 미연결 ${L.unlinked.length}`,
      S.journal.exportedAt ? h('span', { class: 'mute' }, ` · 내보낸 시각 ${fmtTs(S.journal.exportedAt)} (KST)`) : null)),
    h('section', {}, statTable(S.jstats.strategies, '전략별'), statTable(S.jstats.mistakes, '실수별'), statTable(S.jstats.grade, '등급별')),
    h('section', {}, h('h2', {}, '일지 목록'), table(['날짜(KST)', '종목', '방향', '전략', '실수', '등급', '연결된 거래', '연결 근거/사유'], rows)));
}

/** 거래 상세용: 연결된 일지 항목(제목·태그·본문). 없으면 null. */
export function journalForTrade(tradeId) {
  const es = S.linked?.byTrade.get(tradeId);
  if (!es?.length) return null;
  return h('section', {}, h('h2', {}, '매매일지 (노션)'), es.map((e) => h('div', {},
    h('div', {}, h('strong', {}, e.title ?? '(제목 없음)'), e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, ' 노션에서 열기') : null),
    h('div', { class: 'mute' }, `전략: ${e.strategies.join(', ') || '-'} · 실수: ${e.mistakes.join(', ') || '-'} · 등급: ${e.grade ?? '-'}`),
    e.body?.length ? h('div', { class: 'log' }, e.body.join('\n')) : h('div', { class: 'mute' }, '-: 본문 없음(--no-body로 내보냈거나 빈 페이지)'))));
}
