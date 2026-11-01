// 거래별 복기(앱 안에서 쓰는 일지). 순수 함수만 둔다. 저장은 UI(store)가 한다.

/** 사용자가 쓰는 칸. tags는 쉼표로 나눈 태그 배열. */
export const REVIEW_FIELDS = [
  { key: 'reasons', label: '진입 근거', type: 'tags' },
  { key: 'strategies', label: '매매 전략', type: 'tags' },
  { key: 'mood', label: '심리 상태', type: 'text' },
  { key: 'ruleScore', label: '규칙 수행도(%)', type: 'number' },
  { key: 'feedback', label: '자가 피드백 및 최종 평가', type: 'text' },
  { key: 'todo', label: '실수 교정 요점 및 할 일', type: 'text' },
  { key: 'mistakes', label: '실수', type: 'tags' },
  { key: 'grade', label: '등급', type: 'grade' },
  { key: 'margin', label: '마진', type: 'number' },
];

export const emptyReview = () => ({
  reasons: [], strategies: [], mistakes: [], mood: '', ruleScore: null, feedback: '', todo: '', grade: null, margin: null,
  body: '', images: [], comments: [], updatedAt: null,
});

export const parseTags = (s) => [...new Set(String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

/** 내용이 하나라도 있으면 true(빈 복기는 통계·목록에서 뺀다). */
export function hasContent(r) {
  if (!r) return false;
  return r.reasons.length > 0 || r.strategies.length > 0 || r.mistakes.length > 0 || !!r.mood || r.ruleScore != null || !!r.feedback || !!r.todo
    || !!r.grade || r.margin != null || !!r.body || r.images.length > 0 || r.comments.length > 0;
}

/**
 * 사용 레버리지: 거래의 체결 ordId로 Order.lever를 찾는다. 없으면 null과 사유.
 * @param {{execs?:{ordId:string|null}[]}} trade @param {{ordId:string, lever:number|null}[]} orders
 */
export function leverageOf(trade, orders) {
  const ids = new Set((trade.execs ?? []).map((e) => e.ordId).filter(Boolean));
  if (!ids.size) return { value: null, source: 'Order.lever', note: '체결에 주문 ID 없음' };
  const levs = [...new Set((orders ?? []).filter((o) => ids.has(o.ordId) && o.lever != null).map((o) => o.lever))];
  if (!levs.length) return { value: null, source: 'Order.lever', note: '연결된 주문에 레버리지 없음' };
  const value = Math.max(...levs);
  return { value, source: 'Order.lever', note: levs.length > 1 ? `주문마다 다름(${levs.join(', ')}배) → 최대값` : '' };
}

/** ROE = 순손익 / 마진(사용자 입력, 거래 통화 기준). 근거가 없으면 null과 사유. */
export function roeOf(trade, review) {
  const m = review?.margin;
  if (trade.net == null || !trade.ccy) return { value: null, source: 'net/margin', note: '순손익 통화가 여럿이거나 없음' };
  if (trade.status !== 'CLOSED') return { value: null, source: 'net/margin', note: '미청산 거래' };
  if (!(m > 0)) return { value: null, source: 'net/margin', note: '마진 미입력' };
  return { value: trade.net / m, source: 'net/margin', note: `마진 ${m} ${trade.ccy}(입력값) 기준` };
}

/** 복기 → 노션 일지 항목과 같은 모양(통계·표 열 공용). */
export const reviewEntry = (tradeId, r) => ({
  pageId: 'local:' + tradeId, title: null, strategies: r.strategies, reasons: r.reasons, mistakes: r.mistakes, grade: r.grade, local: true,
});

/** 노션 연결(byTrade)과 앱 복기를 거래 id 기준으로 합친다. 원본 Map은 바꾸지 않는다. */
export function mergeByTrade(byTrade, reviews) {
  const out = new Map([...(byTrade ?? new Map())].map(([k, v]) => [k, [...v]]));
  for (const [id, r] of Object.entries(reviews ?? {})) {
    if (!hasContent(r)) continue;
    (out.get(id) ?? out.set(id, []).get(id)).push(reviewEntry(id, r));
  }
  return out;
}
