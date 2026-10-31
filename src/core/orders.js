const lc = (s) => String(s ?? '').toLowerCase();
const rel = (a, b, r = 1e-6) => Math.abs(a - b) <= Math.max(1e-12, r * Math.max(Math.abs(a), Math.abs(b)));
const metric = (num, den, source, note) =>
  den > 0 ? { value: num / den, source, note } : { value: null, source, note: `${note} — 주문 0건` };
const role = (e) => { const s = lc(e); return s.startsWith('m') ? 'maker' : s.startsWith('t') ? 'taker' : null; };
const LIMIT_LIKE = new Set(['limit', 'post_only', 'fok', 'ioc', 'optimal_limit_ioc']);

/**
 * Order·Fill을 ordId로 조인해 체결 요약·불일치·상품군별 통계를 낸다. 손익·수수료는 합산하지 않는다(통화별 fee만 주문 단위로 대조).
 * 주문은 체결이 아니다: 취소 주문(체결 0)은 체결률 분자에서 빠진다.
 * @param {any[]} orders @param {any[]} fills
 * @param {{bills?:any[]|null}} [opts] bills가 있으면 Order·Fill의 ordId가 Bill에 있는 비율만 보고
 */
export function buildOrders(orders, fills, opts = {}) {
  const ordMap = new Map();
  for (const o of orders) if (o.ordId && !ordMap.has(o.ordId)) ordMap.set(o.ordId, o);
  const seen = new Set();
  const byOrd = new Map();
  const orphanFills = [];
  let dupFills = 0;
  for (const f of fills) {
    if (f.tradeId) { const k = `${f.instId}|${f.tradeId}`; if (seen.has(k)) { dupFills++; continue; } seen.add(k); }
    if (!f.ordId || !ordMap.has(f.ordId)) { orphanFills.push(f); continue; }
    if (!byOrd.has(f.ordId)) byOrd.set(f.ordId, []);
    byOrd.get(f.ordId).push(f);
  }

  const joined = [], mismatches = [];
  for (const [ordId, o] of ordMap) {
    const fs = byOrd.get(ordId) ?? [];
    let sz = 0, notional = 0, unk = 0, maker = 0, taker = 0, roleUnk = 0;
    const fee = {}, units = new Set();
    for (const f of fs) {
      if (f.fillSz == null || f.fillPx == null) { unk++; } else { sz += f.fillSz; notional += f.fillSz * f.fillPx; }
      if (f.szUnit) units.add(f.szUnit);
      if (f.fee != null) fee[f.feeCcy || '?'] = (fee[f.feeCcy || '?'] ?? 0) + f.fee;
      const r = role(f.execType); r === 'maker' ? maker++ : r === 'taker' ? taker++ : roleUnk++;
    }
    const vwap = sz > 0 ? notional / sz : null;
    const row = { ordId, instId: o.instId, instType: o.instType, state: lc(o.state), ordType: lc(o.ordType),
      fillCount: fs.length, fillSz: sz, vwap, fee, maker, taker, roleUnknown: roleUnk, incompleteFills: unk };
    joined.push(row);
    if (!fs.length) continue; // 체결 없는 주문은 불일치가 아니라 미체결/취소
    const bad = (field, order, fill) => mismatches.push({ ordId, field, order, fill });
    const sameUnit = units.size === 1 && (!o.szUnit || units.has(o.szUnit));
    if (unk) bad('incompleteFills', null, unk);
    else if (o.accFillSz != null && sameUnit && !rel(o.accFillSz, sz)) bad('accFillSz', o.accFillSz, sz);
    else if (o.accFillSz != null && !sameUnit) bad('szUnit', o.szUnit, [...units].join(','));
    if (o.avgPx != null && vwap != null && !rel(o.avgPx, vwap, 1e-4)) bad('avgPx', o.avgPx, vwap);
    if (o.fee != null && o.feeCcy && fee[o.feeCcy] != null && Object.keys(fee).length === 1 && !rel(o.fee, fee[o.feeCcy], 1e-4))
      bad('fee', o.fee, fee[o.feeCcy]);
  }
  for (const f of orphanFills) mismatches.push({ ordId: f.ordId ?? null, field: 'orphanFill', order: null, fill: f.tradeId ?? null });

  const byType = {};
  for (const r of joined) {
    const o = ordMap.get(r.ordId);
    const t = (byType[o.instType ?? '?'] ??= { total: 0, states: {}, ordTypes: {}, filled: 0, canceled: 0, partial: 0, withFill: 0, market: 0, limit: 0, maker: 0, taker: 0 });
    t.total++;
    t.states[r.state] = (t.states[r.state] ?? 0) + 1;
    t.ordTypes[r.ordType] = (t.ordTypes[r.ordType] ?? 0) + 1;
    const filledSz = o.accFillSz ?? (r.fillCount ? r.fillSz : 0);
    if (r.state === 'filled') t.filled++;
    if (r.state.includes('cancel')) t.canceled++;
    if (filledSz > 0) t.withFill++;
    if (filledSz > 0 && o.sz != null && filledSz < o.sz && r.state !== 'filled') t.partial++; // 부분체결(취소·진행 포함)
    if (r.ordType === 'market') t.market++; else if (LIMIT_LIKE.has(r.ordType)) t.limit++;
    t.maker += r.maker; t.taker += r.taker;
  }
  const stats = {};
  for (const [k, t] of Object.entries(byType)) {
    stats[k] = { ...t,
      fillRate: metric(t.filled, t.total, 'Order', '완전체결(state=filled) 주문 / 전체 주문'),
      anyFillRate: metric(t.withFill, t.total, 'Order', '체결수량>0 주문 / 전체 주문'),
      cancelRate: metric(t.canceled, t.total, 'Order', 'state에 cancel 포함 / 전체 주문'),
      marketRatio: metric(t.market, t.market + t.limit, 'Order', 'market / (market+limit계열)'),
    };
  }

  let billMatch = null;
  if (opts.bills) {
    const ids = new Set(opts.bills.map((b) => b.ordId).filter(Boolean));
    const ordHit = joined.filter((r) => ids.has(r.ordId)).length;
    const filled = [...byOrd.values()].flat();
    const fillHit = filled.filter((f) => ids.has(f.ordId)).length;
    billMatch = {
      orders: metric(ordHit, joined.length, 'Order↔Bill', 'ordId가 Bill에 있는 주문 비율'),
      fills: metric(fillHit, filled.length, 'Fill↔Bill', 'ordId가 Bill에 있는 체결 비율 (손익·수수료 합산 아님)'),
    };
    if (!filled.length) billMatch.fills.note = 'Fill↔Bill — 체결 0건';
  }
  return { joined, mismatches, orphanFills, dupFills, stats, billMatch };
}
