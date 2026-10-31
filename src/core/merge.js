// 출처 우선순위 병합: API > 아카이브 > CSV (docs/DATA.md "병합 규칙")
const RANK = { api: 3, archive: 2, csv: 1 };

/** 레코드 종류별 기본키 */
export const KEYS = { Order: 'ordId', Fill: 'tradeId', Bill: 'billId', Position: 'posId', PositionHistory: 'posId' };

/**
 * @param {object[]} records 같은 종류(kind)의 레코드(여러 출처 섞임)
 * @param {keyof KEYS} kind
 * @returns {{records:object[], dropped:{dupes:number, covered:number}, ranges:Record<string,[number,number]>}}
 *  - dupes: 같은 출처 안의 기본키 중복(먼저 나온 것을 남김)
 *  - covered: 상위 출처의 기간 안이라 버린 하위 출처 레코드
 */
export function mergeRecords(records, kind) {
  const key = KEYS[kind];
  if (!key) throw new Error(`알 수 없는 종류: ${kind}`);
  const bySrc = {};
  let dupes = 0;
  for (const r of records) {
    const src = r.source;
    if (!(src in RANK)) throw new Error(`알 수 없는 출처: ${src}`);
    const m = (bySrc[src] ??= new Map());
    const k = kind === 'PositionHistory' ? `${r[key]}|${r.closeTs}` : r[key];
    if (m.has(k)) { dupes++; continue; }
    m.set(k, r);
  }
  const ranges = {};
  for (const [src, m] of Object.entries(bySrc)) {
    let lo = Infinity, hi = -Infinity;
    for (const r of m.values()) if (r.ts !== null && r.ts !== undefined) { lo = Math.min(lo, r.ts); hi = Math.max(hi, r.ts); }
    if (lo <= hi) ranges[src] = [lo, hi];
  }
  const higher = (src) => Object.keys(ranges).filter((x) => RANK[x] > RANK[src]).map((x) => ranges[x]);
  const out = [];
  let covered = 0;
  for (const [src, m] of Object.entries(bySrc)) {
    const hs = higher(src);
    for (const r of m.values()) {
      if (r.ts !== null && r.ts !== undefined && hs.some(([lo, hi]) => r.ts >= lo && r.ts <= hi)) { covered++; continue; }
      out.push(r);
    }
  }
  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return { records: out, dropped: { dupes, covered }, ranges };
}
