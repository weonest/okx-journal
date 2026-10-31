// 노션 매매일지: 페이지 → 일지 항목, 일지 ↔ 라운드트립 연결, 전략·실수별 집계. DOM·네트워크 없음.
const KST_DAY = 86400e3, KST = 9 * 3600e3;
const GRACE = 5 * 60e3; // 시각이 적힌 일지는 체결 시각과 몇 분 어긋날 수 있다

/** 속성 값 → 문자열(여러 타입을 같은 방식으로 읽는다). 없으면 null. */
function text(p) {
  if (!p) return null;
  const rt = (a) => (a ?? []).map((x) => x.plain_text ?? '').join('');
  switch (p.type) {
    case 'title': return rt(p.title) || null;
    case 'rich_text': return rt(p.rich_text) || null;
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'number': return p.number == null ? null : String(p.number);
    case 'formula': return p.formula?.string ?? (p.formula?.number == null ? null : String(p.formula.number));
    case 'url': return p.url ?? null;
    default: return null;
  }
}
const tags = (p) => (p?.type === 'multi_select' ? p.multi_select.map((x) => x.name) : text(p) ? [text(p)] : []);

export const DEFAULT_PROPS = { date: '날짜', instId: '종목', side: '방향', strategies: '전략', reasons: '진입 근거', mistakes: '실수', grade: '등급', linkId: '연결ID' };

/**
 * 노션 DB 조회 결과(results) → 일지 항목. 날짜가 없으면 항목은 남기되 연결에서 제외된다.
 * @param {any[]} pages @param {Partial<typeof DEFAULT_PROPS>} [names]
 */
export function parseNotionPages(pages, names = {}) {
  const n = { ...DEFAULT_PROPS, ...names };
  return pages.filter((pg) => pg && pg.object !== 'database' && !pg.archived).map((pg) => {
    const pr = pg.properties ?? {};
    const title = Object.values(pr).find((v) => v.type === 'title');
    const d = pr[n.date]?.date;
    return {
      pageId: pg.id, url: pg.url ?? null, title: text(title),
      date: d?.start ?? null, dateEnd: d?.end ?? null,
      instId: text(pr[n.instId]), side: text(pr[n.side]),
      strategies: tags(pr[n.strategies]), reasons: tags(pr[n.reasons]), mistakes: tags(pr[n.mistakes]), grade: text(pr[n.grade]),
      linkId: text(pr[n.linkId]), body: [],
    };
  });
}

const sideOf = (s) => {
  const v = String(s ?? '').trim().toLowerCase();
  return /^(long|buy|롱|매수)/.test(v) ? 'long' : /^(short|sell|숏|매도)/.test(v) ? 'short' : null;
};
/** 날짜 문자열 → [시작, 끝] UTC ms. 날짜만 있으면 KST 하루(0시~23:59:59.999). */
export function dateRange(start, end) {
  if (!start) return null;
  const one = (s, last) => (s.length <= 10 ? Date.parse(s + 'T00:00:00+09:00') + (last ? KST_DAY - 1 : 0) : Date.parse(s));
  const a = one(start, false), b = one(end ?? start, true);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, Math.max(a, b)] : null;
}
const instMatch = (e, id) => {
  const v = String(e ?? '').trim().toUpperCase();
  return !!v && (v === id || id.startsWith(v + '-') || id.replace(/-SWAP$/, '') === v);
};

/**
 * 일지 항목을 거래에 연결한다. 연결ID가 거래 id와 같으면 그것을 우선하고,
 * 없으면 같은 종목·(방향이 적혀 있으면 같은 방향)·날짜가 보유 구간과 겹치는 거래 중 진입이 가장 가까운 것.
 * @param {ReturnType<typeof parseNotionPages>} entries @param {any[]} trades
 * @param {{now?:number}} [opts]
 */
export function linkJournal(entries, trades, opts = {}) {
  const now = opts.now ?? Date.now();
  const byId = new Map(trades.map((t) => [t.id, t]));
  const byTrade = new Map(), unlinked = [], links = [];
  for (const e of entries) {
    let t = e.linkId ? byId.get(e.linkId) : null, by = t ? 'linkId' : null, why = null;
    if (!t) {
      if (e.linkId) why = `연결ID ${e.linkId}에 해당하는 거래 없음`;
      let rg = dateRange(e.date, e.dateEnd);
      if (rg && e.date.length > 10) rg = [rg[0] - GRACE, rg[1] + GRACE];
      if (!rg) why = (why ? why + ' · ' : '') + '날짜 없음';
      else if (!e.instId) why = (why ? why + ' · ' : '') + '종목 없음';
      else {
        const sd = sideOf(e.side);
        const c = trades.filter((x) => instMatch(e.instId, x.instId) && (!sd || x.side === sd) && rg[0] <= (x.closeTs ?? now) && rg[1] >= x.openTs);
        c.sort((a, b) => Math.abs(a.openTs - rg[0]) - Math.abs(b.openTs - rg[0]));
        if (c[0]) { t = c[0]; by = 'instId+date'; if (c.length > 1) why = `후보 ${c.length}건 중 진입이 가장 가까운 거래`; }
        else why = (why ? why + ' · ' : '') + '종목·날짜가 맞는 거래 없음';
      }
    }
    if (t) { (byTrade.get(t.id) ?? byTrade.set(t.id, []).get(t.id)).push(e); links.push({ pageId: e.pageId, tradeId: t.id, by, note: why }); }
    else unlinked.push({ pageId: e.pageId, title: e.title, reason: why ?? '연결 실패' });
  }
  return { byTrade, links, unlinked };
}

/**
 * 전략·실수·등급별 건수·승률·통화별 순손익. 거래 하나가 태그 여러 개면 각각에 센다.
 * 통화가 여럿인 거래는 승패에서 제외하고 note로 알린다. 청산된 거래만 센다.
 * @param {Map<string, any[]>} byTrade @param {any[]} trades
 */
export function journalStats(byTrade, trades) {
  const by = { strategies: {}, reasons: {}, mistakes: {}, grade: {} };
  let skipped = 0;
  const bump = (g, tag, t) => {
    const x = (by[g][tag] ??= { count: 0, wins: 0, losses: 0, net: {} });
    x.count++;
    if (t.net > 0) x.wins++; else if (t.net < 0) x.losses++;
    x.net[t.ccy] = (x.net[t.ccy] ?? 0) + t.net;
  };
  for (const t of trades) {
    const es = byTrade.get(t.id);
    if (!es || t.status !== 'CLOSED') continue;
    if (t.net == null || !t.ccy) { skipped++; continue; }
    const seen = { strategies: new Set(), reasons: new Set(), mistakes: new Set(), grade: new Set() };
    for (const e of es) {
      for (const s of e.strategies) if (!seen.strategies.has(s)) { seen.strategies.add(s); bump('strategies', s, t); }
      for (const x of e.reasons ?? []) if (!seen.reasons.has(x)) { seen.reasons.add(x); bump('reasons', x, t); }
      for (const m of e.mistakes) if (!seen.mistakes.has(m)) { seen.mistakes.add(m); bump('mistakes', m, t); }
      if (e.grade && !seen.grade.has(e.grade)) { seen.grade.add(e.grade); bump('grade', e.grade, t); }
    }
  }
  const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, winRate: v.count ? v.wins / v.count : null }]));
  const note = '청산된 거래만, 통화가 여러 개인 거래 제외' + (skipped ? ` (${skipped}건 제외)` : '') + '. 승률=이익 거래/전체(무승부 포함)';
  const m = (v) => ({ value: v, source: 'Notion×trades', note });
  return { strategies: m(fin(by.strategies)), reasons: m(fin(by.reasons)), mistakes: m(fin(by.mistakes)), grade: m(fin(by.grade)) };
}
