import { h, table, td, fmtNum, fmtPct, fmtTs, cls } from './dom.js';
import { S, addJournal, exportReviews, importReviews } from './store.js';
import { parseMarkdown } from '../core/markdown.js';

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
  const rmsg = h('span', { class: 'mute' });
  const rpick = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  rpick.onchange = async () => { try { rmsg.textContent = `불러옴: ${await importReviews(rpick.files[0])}건 반영`; } catch (e) { rmsg.textContent = '오류: ' + e.message; } rpick.value = ''; };
  const nRev = Object.keys(S.reviews).length;
  const backup = h('section', {}, h('h2', {}, '앱 복기 백업'),
    h('div', { class: 'mute' }, '세션 상세 목록에서 "열기"로 쓴 복기는 이 브라우저에만 저장됩니다. 다른 기기로 옮기거나 보관하려면 내보내세요.'),
    h('div', { class: 'row' }, h('button', { class: 'sub', disabled: nRev ? null : true, onclick: exportReviews }, `내보내기(${nRev}건)`), h('button', { class: 'sub', onclick: () => rpick.click() }, '불러오기'), rpick, rmsg));
  const stats = S.jstats ? h('section', {}, h('div', { class: 'mute small' }, '노션 일지와 앱 복기를 합친 집계입니다.'), statTable(S.jstats.strategies, '전략별'), statTable(S.jstats.reasons, '진입 근거별'), statTable(S.jstats.mistakes, '실수별'), statTable(S.jstats.grade, '등급별')) : null;
  if (!S.journal) return h('div', {}, stats, backup, up, h('section', {}, h('div', { class: 'mute' }, '-: 노션 일지가 없습니다. 노션 없이도 세션 상세 목록의 "열기"로 복기를 쓸 수 있습니다.')));
  if (!S.linked) return h('div', {}, backup, up, h('section', {}, '거래 데이터가 없어 연결하지 못했습니다. 먼저 거래 데이터를 불러오세요.'));

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
    stats,
    h('section', {}, h('h2', {}, '일지 목록'), table(['날짜(KST)', '종목', '방향', '전략', '실수', '등급', '연결된 거래', '연결 근거/사유'], rows)),
    backup);
}

/**
 * 마크다운 → DOM(HTML 문자열을 쓰지 않는다). onToggle(줄 번호)를 주면 체크박스를 누를 수 있다.
 * @param {string} text @param {((line:number)=>void)|null} [onToggle]
 */
export function renderMarkdown(text, onToggle = null) {
  const inl = (c) => c.map((x) => {
    if (x.t === 'text') return x.v;
    if (x.t === 'code') return h('code', { class: 'md-code' }, x.v);
    if (x.t === 'a') return h('a', { href: x.href, target: '_blank', rel: 'noopener noreferrer' }, inl(x.c));
    return h({ b: 'strong', i: 'em', s: 'del' }[x.t], {}, inl(x.c));
  });
  const lines = (ls) => ls.flatMap((c, i) => (i ? [h('br'), ...inl(c)] : inl(c)));
  return parseMarkdown(text).map((b) => {
    if (b.t === 'h') return h(['h3', 'h4', 'h5'][b.level - 1], { class: 'md-h md-h' + b.level }, inl(b.c));
    if (b.t === 'p') return h('p', { class: 'md-p' }, lines(b.lines));
    if (b.t === 'hr') return h('hr', { class: 'md-hr' });
    if (b.t === 'quote') return h('blockquote', { class: 'md-q' }, lines(b.lines));
    if (b.t === 'code') return h('pre', { class: 'md-pre' }, h('code', {}, b.text));
    if (b.t === 'table') return h('div', { class: 'tbl' }, h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, b.head.map((c) => h('th', {}, inl(c))))), h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inl(c))))))));
    // 목록: 단계는 들여쓰기로 표시
    return h(b.t, { class: 'md-list', start: b.start && b.start !== 1 ? b.start : null }, b.items.map((it) => h('li', { class: it.check == null ? null : 'md-task', style: it.depth ? `margin-left:${it.depth * 20}px` : null },
      it.check == null ? null : h('span', { class: 'chk' + (it.check ? ' done' : '') + (onToggle ? ' click' : ''), role: onToggle ? 'checkbox' : null, 'aria-checked': String(it.check), onclick: onToggle ? (e) => { e.stopPropagation(); onToggle(it.line); } : null }, it.check ? '✓' : ''),
      h('span', { class: it.check ? 'md-done' : null }, inl(it.c)))));
  });
}

/** 노션 내보내기 본문(줄 배열) → 같은 마크다운 렌더러로 표시 */
export const renderBody = (lines) => renderMarkdown(lines.join('\n'));
const GRADE = { A: 'g-a', B: 'g-b', C: 'g-c', D: 'g-d' };

/** 거래 상세용: 연결된 일지 항목(제목·태그·본문). 없으면 null. */
export function journalForTrade(tradeId) {
  const es = S.linked?.byTrade.get(tradeId);
  if (!es?.length) return null;
  const how = new Map((S.linked.links ?? []).map((l) => [l.pageId, l]));
  return h('section', { class: 'jcard' }, h('div', { class: 'between' }, h('h2', { class: 'big' }, '매매일지'),
    h('button', { class: 'sub', title: '노션 "연결ID" 칸에 붙여넣으면 이 거래에 정확히 연결됩니다', onclick: (e) => { navigator.clipboard?.writeText(tradeId); e.target.textContent = '복사됨'; } }, '거래 ID 복사')),
    es.map((e) => {
      const l = how.get(e.pageId);
      return h('article', { class: 'jentry' },
        h('div', { class: 'between' }, h('h3', { class: 'jt' }, e.title ?? '(제목 없음)'),
          h('div', { class: 'row' }, e.grade ? h('span', { class: 'grade ' + (GRADE[e.grade] ?? '') }, `등급 ${e.grade}`) : null,
            h('span', { class: 'mute small' }, l?.by === 'linkId' ? '연결ID로 연결' : '종목+날짜로 자동 연결'),
            e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, '노션에서 열기') : null)),
        h('div', { class: 'jtags' },
          e.strategies.length ? [h('span', { class: 'jk' }, '전략'), e.strategies.map((x) => h('span', { class: 'chip blue' }, x))] : null,
          e.reasons?.length ? [h('span', { class: 'jk' }, '진입 근거'), e.reasons.map((x) => h('span', { class: 'chip green' }, x))] : null,
          e.mistakes.length ? [h('span', { class: 'jk' }, '실수'), e.mistakes.map((x) => h('span', { class: 'chip red' }, x))] : null),
        e.body?.length ? h('div', { class: 'jbody' }, renderBody(e.body)) : h('div', { class: 'mute' }, '-: 본문 없음(--no-body로 내보냈거나 빈 페이지)'));
    }));
}
