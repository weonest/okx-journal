import { EPS } from './ledger.js';

const MATCH_WINDOW_MS = 5 * 60 * 1000;
const near = (a, b) => Math.abs(a - b) <= Math.max(EPS, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));

const emptyAmt = () => ({ pnl: 0, fee: 0, interest: 0, funding: 0 });

/** 수량 가중 평균가 누적(kind: 'in' 진입·증가, 'out' 감소·청산). px 없는 Bill은 건너뛴다. */
function accPx(t, kind, sz, px) {
  if (!(sz > 0) || px == null) return;
  t[kind + 'Qty'] = (t[kind + 'Qty'] ?? 0) + sz; t[kind + 'Cost'] = (t[kind + 'Cost'] ?? 0) + sz * px;
}

/** 체결 1건 기록(표·차트·일지용). 롱은 진입=매수, 숏은 진입=매도. 금액 합계에는 쓰지 않는다. */
function addExec(t, b, kind, sz, pnl, fee) {
  if (!(sz > 0)) return;
  const buy = (kind === 'in') === (t.side === 'long');
  t.execs.push({ ts: b.ts, billId: b.billId, ordId: b.ordId || null, side: buy ? 'buy' : 'sell', kind, sz, px: b.px ?? null, pnl, fee, ccy: b.ccy ?? null });
}

function addAmt(t, ccy, part) {
  const c = ccy ?? '?';
  const a = (t.amounts[c] ??= emptyAmt());
  for (const k of Object.keys(part)) a[k] += part[k] ?? 0;
}

/** 금액 합계. 통화가 하나일 때만 평면 필드(pnl 등)를 채우고, 여럿이면 null(통화를 섞어 더하지 않는다). */
function finalize(t) {
  t.avgEntryPx = t.inQty > 0 ? t.inCost / t.inQty : null;
  t.avgExitPx = t.outQty > 0 ? t.outCost / t.outQty : null;
  const ccys = Object.keys(t.amounts);
  for (const c of ccys) t.amounts[c].net = t.amounts[c].pnl + t.amounts[c].fee + t.amounts[c].interest + t.amounts[c].funding;
  if (ccys.length === 1) {
    const a = t.amounts[ccys[0]];
    Object.assign(t, { ccy: ccys[0], pnl: a.pnl, fee: a.fee, interest: a.interest, funding: a.funding, net: a.net });
  } else {
    Object.assign(t, { ccy: null, pnl: ccys.length ? null : 0, fee: ccys.length ? null : 0, interest: ccys.length ? null : 0, funding: ccys.length ? null : 0, net: ccys.length ? null : 0 });
  }
  return t;
}

/**
 * 원장 행 → 라운드트립(0→…→0). 금액은 amounts[ccy]에 통화별로 담는다.
 * FUTURES·MARGIN 손익·수수료·이자의 정본은 Bill이다(bill.pnl, bill.fee, INTEREST·FUNDING은 balChg).
 * @param {ReturnType<import('./ledger.js').buildLedger>['rows']} rows
 * @param {{positionsHistory?:any[]|null, openPositions?:any[]|null}} [opts]
 */
export function buildPositions(rows, opts = {}) {
  const trades = [];
  const cur = new Map(); // key → 열린 trade
  const unattributed = [];
  const orphans = [];

  const start = (row, side, size) => {
    const t = {
      id: `${row.key}#${row.bill.billId}`, instType: row.bill.instType, instId: row.instId, key: row.key, side,
      openTs: row.bill.ts, closeTs: null, maxSize: size, size, status: 'OPEN', closeReason: null,
      amounts: {}, billIds: [], execs: [], mgnMode: row.bill.mgnMode ?? null,
    };
    cur.set(row.key, t);
    trades.push(t);
    return t;
  };
  const close = (t, row) => {
    t.closeTs = row.bill.ts; t.status = 'CLOSED'; t.size = 0;
    t.closeReason = row.event === 'TRADE' ? 'TRADE' : row.event; // DELIVERY | LIQUIDATION | ADL
    cur.delete(t.key);
  };

  for (const row of rows) {
    const b = row.bill;
    if (row.effect) {
      if (row.effect === 'ORPHAN') { orphans.push({ billId: b.billId, instId: row.instId, ts: b.ts, reason: '열린 기록 없는 청산(조회 기간 이전 포지션)' }); continue; }
      const pnl = b.pnl ?? 0;
      const fee = b.fee ?? 0;
      if (row.effect === 'OPEN') {
        const t = start(row, row.dirAfter, Math.abs(row.rem));
        t.billIds.push(b.billId); addAmt(t, b.ccy, { pnl, fee }); accPx(t, 'in', row.openSz, b.px); addExec(t, b, 'in', row.openSz, pnl, fee);
      } else if (row.effect === 'FLIP') {
        const t = cur.get(row.key);
        const share = row.closeSz / (row.closeSz + row.openSz); // 수수료는 수량 비례로 나눈다
        t.billIds.push(b.billId); addAmt(t, b.ccy, { pnl, fee: fee * share }); accPx(t, 'out', row.closeSz, b.px); addExec(t, b, 'out', row.closeSz, pnl, fee * share);
        close(t, row);
        const n = start(row, row.dirAfter, row.openSz);
        n.billIds.push(b.billId); addAmt(n, b.ccy, { fee: fee * (1 - share) }); accPx(n, 'in', row.openSz, b.px); addExec(n, b, 'in', row.openSz, 0, fee * (1 - share));
      } else {
        const t = cur.get(row.key);
        if (!t) { orphans.push({ billId: b.billId, instId: row.instId, ts: b.ts, reason: '열린 구간 없음' }); continue; }
        t.billIds.push(b.billId); addAmt(t, b.ccy, { pnl, fee });
        if (row.effect === 'INCREASE') { accPx(t, 'in', row.openSz, b.px); addExec(t, b, 'in', row.openSz, pnl, fee); } else { accPx(t, 'out', row.closeSz, b.px); addExec(t, b, 'out', row.closeSz, pnl, fee); }
        t.size = Math.abs(row.rem);
        if (t.size > t.maxSize) t.maxSize = t.size;
        if (row.effect === 'CLOSE') close(t, row);
      }
    } else if (row.event === 'INTEREST' || row.event === 'FUNDING') {
      const field = row.event === 'INTEREST' ? 'interest' : 'funding';
      if (b.balChg == null) { unattributed.push({ billId: b.billId, event: row.event, reason: 'balChg 없음' }); continue; }
      const open = [...cur.values()].filter((t) => t.instId === b.instId);
      if (!b.instId) unattributed.push({ billId: b.billId, event: row.event, ccy: b.ccy, amount: b.balChg, reason: 'instId 없음' });
      else if (open.length === 0) unattributed.push({ billId: b.billId, event: row.event, ccy: b.ccy, amount: b.balChg, reason: '열린 포지션 없음' });
      else if (open.length > 1) unattributed.push({ billId: b.billId, event: row.event, ccy: b.ccy, amount: b.balChg, reason: '같은 상품에 열린 포지션 여러 개(롱·숏)' });
      else { open[0].billIds.push(b.billId); addAmt(open[0], b.ccy, { [field]: b.balChg }); }
    }
  }

  trades.forEach(finalize);
  const unclosed = trades.filter((t) => t.status === 'OPEN');
  const diffs = [];
  const verify = {
    history: verifyHistory(trades, opts.positionsHistory, diffs),
    position: verifyPosition(unclosed, opts.openPositions, diffs),
  };
  return { trades, unclosed, diffs, unattributed, orphans, verify };
}

const histSide = (h) => (h.posSide === 'long' || h.posSide === 'short' ? h.posSide : h.direction ?? null);

function verifyHistory(trades, hist, diffs) {
  if (!hist || hist.length === 0) return { status: null, note: 'positions-history 없음: 비교하지 않음' };
  const minTs = Math.min(...hist.map((h) => h.closeTs ?? h.uTime ?? Infinity));
  const used = new Set();
  let matched = 0;
  const unmatchedTrades = [];
  for (const t of trades) {
    if (t.status !== 'CLOSED' || t.closeTs < minTs - MATCH_WINDOW_MS) continue; // 이력 범위 밖은 비교하지 않는다
    let best = null;
    for (const h of hist) {
      if (used.has(h) || h.instId !== t.instId || histSide(h) !== t.side) continue;
      const d = Math.abs((h.closeTs ?? h.uTime) - t.closeTs);
      if (d <= MATCH_WINDOW_MS && (!best || d < best.d)) best = { h, d };
    }
    if (!best) { unmatchedTrades.push(t.id); continue; }
    used.add(best.h); matched++;
    compare(t, best.h, diffs);
  }
  const unmatchedHistory = hist.filter((h) => !used.has(h)).map((h) => h.posId);
  return { status: diffs.some((d) => d.kind === 'history') || unmatchedTrades.length || unmatchedHistory.length ? 'DIFF' : 'OK', matched, unmatchedTrades, unmatchedHistory };
}

function compare(t, h, diffs) {
  const a = t.amounts[h.ccy];
  const push = (field, expected, actual, reason) => diffs.push({ kind: 'history', tradeId: t.id, posId: h.posId, field, expected, actual, diff: actual == null ? null : actual - expected, reason });
  if (!a) { push('ccy', h.ccy, Object.keys(t.amounts).join(','), '통화 불일치'); return; }
  if (t.instType === 'MARGIN') {
    if (h.pnl != null && !near(a.pnl, h.pnl)) push('pnl', h.pnl, a.pnl);
    if (h.fee != null && !near(a.fee, h.fee)) push('fee', h.fee, a.fee);
  } else if (h.realizedPnl != null) {
    const got = a.pnl + a.fee + a.funding;
    if (!near(got, h.realizedPnl)) push('realizedPnl', h.realizedPnl, got, h.liqPenalty ? 'liqPenalty 미반영 가능' : undefined);
  }
}

function verifyPosition(unclosed, pos, diffs) {
  if (!pos) return { status: null, note: 'Position 없음: 최종 수량을 대조하지 않음' };
  const live = pos.filter((p) => p.pos != null && Math.abs(p.pos) > EPS);
  const keyOf = (p) => `${p.instId}|${p.posSide === 'long' || p.posSide === 'short' ? p.posSide : p.pos > 0 ? 'long' : 'short'}`;
  const byKey = new Map(live.map((p) => [keyOf(p), p]));
  const before = diffs.length;
  for (const t of unclosed) {
    const p = byKey.get(`${t.instId}|${t.side}`);
    if (!p) diffs.push({ kind: 'position', tradeId: t.id, field: 'size', expected: null, actual: t.size, reason: 'Position에 없는 미청산 구간' });
    else { byKey.delete(`${t.instId}|${t.side}`); if (!near(Math.abs(p.pos), t.size)) diffs.push({ kind: 'position', tradeId: t.id, field: 'size', expected: Math.abs(p.pos), actual: t.size, diff: t.size - Math.abs(p.pos) }); }
  }
  for (const p of byKey.values()) diffs.push({ kind: 'position', posId: p.posId, field: 'size', expected: Math.abs(p.pos), actual: null, reason: '복원 구간에 없는 Position' });
  return { status: diffs.length > before ? 'DIFF' : 'OK' };
}
