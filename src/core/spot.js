import { EPS } from './ledger.js';

const STABLE = new Set(['USDT', 'USDC', 'USD']);
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= Math.max(EPS, rel * Math.max(Math.abs(a), Math.abs(b)));
const cmpId = (a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

const isSpot = (f) => f.instType === 'SPOT' || (f.instType == null && /^[^-]+-[^-]+$/.test(f.instId ?? ''));

function emptyAmt() { return { pnl: 0, fee: 0, interest: 0, funding: 0, net: 0 }; }

/**
 * SPOT Fill → 평균단가법 실현손익 + 라운드트립(보유 0→…→0). 4단계 trade 형태와 같다.
 * - Fill.side('buy'|'sell')가 없으면 계산하지 않고 noSide에 담는다.
 * - fee: 음수=수수료, 양수=리베이트(API 기준). feeCcy가 기초코인이면 수량 차감, 견적통화면 비용, 그 외는 note만.
 * - 취득가를 모르는 매도(보유 부족)는 pnl=null + reason.
 * - 라운드트립 pnl은 수수료 제외 총손익, fee는 (매수 수수료 중 매도분 몫 + 매도 수수료). net=pnl+fee.
 * @param {any[]} fills
 * @param {{dust?:number|Record<string,number>, bills?:any[]|null, balances?:any[]|null}} [opts]
 *   dust: 숫자(전 상품 공통) 또는 {instId:minSz}. 기본 0(EPS 미만만 0으로 본다).
 */
export function buildSpot(fills, opts = {}) {
  const seen = new Set();
  const list = [];
  for (const f of fills) {
    if (!isSpot(f)) continue;
    if (f.tradeId) { const k = `${f.instId}|${f.tradeId}`; if (seen.has(k)) continue; seen.add(k); }
    list.push(f);
  }
  list.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || cmpId(String(a.tradeId ?? ''), String(b.tradeId ?? '')));

  const dustOf = (instId) => Math.max(EPS, typeof opts.dust === 'number' ? opts.dust : opts.dust?.[instId] ?? 0);
  const st = new Map(); // instId → {qty,cost,buyFee,trade}
  const trades = [];
  const sells = [];
  const unknown = [];
  const noSide = [];
  const notes = [];
  const expected = new Map(); // tradeId → {ccy: delta} (Bill 대사용)

  const addExp = (f, base, quote, dBase, dQuote, feeCcy, fee) => {
    const e = {};
    const add = (c, v) => { if (c) e[c] = (e[c] ?? 0) + v; };
    add(base, dBase); add(quote, dQuote); add(feeCcy, fee ?? 0);
    expected.set(f.tradeId || `#${expected.size}`, e);
  };

  for (const f of list) {
    const [base, quote] = f.instId.split('-');
    const sz = f.fillSz, px = f.fillPx;
    if (f.side !== 'buy' && f.side !== 'sell') { noSide.push({ tradeId: f.tradeId, instId: f.instId, reason: 'side 없음' }); continue; }
    if (sz == null || px == null || sz <= 0) { noSide.push({ tradeId: f.tradeId, instId: f.instId, reason: '수량·가격 없음' }); continue; }
    const s = st.get(f.instId) ?? { qty: 0, cost: 0, buyFee: 0, trade: null };
    st.set(f.instId, s);
    const fee = f.fee ?? 0;                       // 부호 그대로(음수=수수료)
    const feeCcy = f.feeCcy || null;
    const feeBase = feeCcy === base, feeQuote = feeCcy === quote;
    if (fee !== 0 && !feeBase && !feeQuote) notes.push({ tradeId: f.tradeId, instId: f.instId, note: `제3통화 수수료(${feeCcy ?? '?'}) ${fee}: 환산하지 않음` });
    const quoteFee = feeQuote ? -fee : 0;         // 비용(+)
    const baseFeeQty = feeBase ? -fee : 0;        // 차감 수량(+)

    if (f.side === 'buy') {
      addExp(f, base, quote, sz, -px * sz, feeCcy, fee);
      if (!s.trade) {
        s.trade = {
          id: `${f.instId}#${f.tradeId}`, instType: 'SPOT', instId: f.instId, key: `${f.instId}|long`, side: 'long',
          openTs: f.ts, closeTs: null, maxSize: 0, size: 0, status: 'OPEN', closeReason: null,
          amounts: {}, billIds: [], fillIds: [], execs: [], quote, mgnMode: null, feeInBase: 0,
        };
        trades.push(s.trade);
      }
      const net = sz - baseFeeQty;
      s.qty += net; s.cost += px * sz; s.buyFee += quoteFee;
      s.trade.execs.push({ ts: f.ts, tradeId: f.tradeId, ordId: f.ordId || null, side: f.side, kind: 'in', sz, px, pnl: 0, fee, ccy: feeCcy }); s.trade.fillIds.push(f.tradeId); s.trade.feeInBase += baseFeeQty;
      s.trade.size = s.qty; s.trade.maxSize = Math.max(s.trade.maxSize, s.qty);
    } else {
      addExp(f, base, quote, -sz, px * sz, feeCcy, fee);
      // 매도 수수료가 기초코인이면 견적통화 환산액으로 손익에 반영한다(체결가 기준).
      const sellFee = quoteFee + baseFeeQty * px;
      if (sz > s.qty + dustOf(f.instId)) {
        const reason = s.qty <= EPS ? '취득가 미상(데이터 기간 내 매수 없음)' : '취득가 미상(보유 수량 초과분 포함)';
        unknown.push({ tradeId: f.tradeId, instId: f.instId, ts: f.ts, sz, held: s.qty, reason });
        sells.push({ tradeId: f.tradeId, instId: f.instId, ts: f.ts, sz, px, pnl: null, fee: -sellFee, reason });
        if (s.trade) { s.trade.execs.push({ ts: f.ts, tradeId: f.tradeId, ordId: f.ordId || null, side: f.side, kind: 'out', sz, px, pnl: null, fee, ccy: feeCcy }); s.trade.fillIds.push(f.tradeId); closeTrade(s, f, 'UNKNOWN_BASIS'); }
        s.qty = 0; s.cost = 0; s.buyFee = 0;
        continue;
      }
      const avg = s.cost / s.qty;
      const allocFee = s.buyFee * (sz / s.qty);
      const gross = (px - avg) * sz;
      const feeTotal = -(allocFee + sellFee);
      sells.push({ tradeId: f.tradeId, instId: f.instId, ts: f.ts, sz, px, avgPx: avg, pnl: gross, fee: feeTotal, net: gross + feeTotal, ccy: quote });
      const a = (s.trade.amounts[quote] ??= emptyAmt());
      a.pnl += gross; a.fee += feeTotal;
      s.trade.execs.push({ ts: f.ts, tradeId: f.tradeId, ordId: f.ordId || null, side: f.side, kind: 'out', sz, px, pnl: gross, fee, ccy: feeCcy }); s.trade.fillIds.push(f.tradeId);
      s.cost -= avg * sz; s.buyFee -= allocFee; s.qty -= sz;
      s.trade.size = s.qty;
      if (s.qty < dustOf(f.instId)) closeTrade(s, f, 'TRADE');
    }
  }

  for (const t of trades) {
    const c = Object.keys(t.amounts);
    for (const k of c) t.amounts[k].net = t.amounts[k].pnl + t.amounts[k].fee;
    if (c.length === 1) Object.assign(t, { ccy: c[0], pnl: t.amounts[c[0]].pnl, fee: t.amounts[c[0]].fee, interest: 0, funding: 0, net: t.amounts[c[0]].net });
    else Object.assign(t, { ccy: t.quote, pnl: 0, fee: 0, interest: 0, funding: 0, net: 0 });
  }
  const unclosed = trades.filter((t) => t.status === 'OPEN');
  const holdings = [...st].map(([instId, s]) => ({ instId, base: instId.split('-')[0], quote: instId.split('-')[1], qty: s.qty, avgPx: s.qty > EPS ? s.cost / s.qty : null }));
  const verify = {
    bills: verifyBills(expected, opts.bills),
    avgPx: verifyAvg(holdings, opts.balances),
  };
  return { trades, unclosed, sells, unknown, noSide, notes, holdings, verify };
}

function closeTrade(s, f, reason) {
  if (!s.trade) return;
  s.trade.status = 'CLOSED'; s.trade.closeTs = f.ts; s.trade.size = 0; s.trade.closeReason = reason;
  s.trade = null;
  s.qty = 0; s.cost = 0; s.buyFee = 0;
}

/** SPOT Bill(type '2' 거래) 잔고 변화 합계 vs Fill에서 계산한 통화별 변화. tradeId로 맞출 수 있으면 맞춘 것만 비교한다. */
function verifyBills(expected, bills) {
  if (!bills || bills.length === 0) return { status: null, note: 'SPOT Bill 없음: 잔고를 대사하지 않음' };
  const sb = bills.filter((b) => (b.instType === 'SPOT' || b.instType == null) && b.type === '2' && b.balChg != null);
  if (sb.length === 0) return { status: null, note: '거래(type 2) SPOT Bill 없음' };
  const byId = sb.every((b) => b.tradeId);
  const act = {}, exp = {};
  const billIds = new Set(sb.map((b) => b.tradeId));
  for (const b of sb) act[b.ccy] = (act[b.ccy] ?? 0) + b.balChg;
  let unmatchedFills = 0;
  for (const [id, e] of expected) {
    if (byId && !billIds.has(id)) { unmatchedFills++; continue; }
    for (const [c, v] of Object.entries(e)) exp[c] = (exp[c] ?? 0) + v;
  }
  const diffs = [];
  for (const c of new Set([...Object.keys(act), ...Object.keys(exp)])) {
    const a = act[c] ?? 0, e = exp[c] ?? 0;
    if (!near(a, e)) diffs.push({ ccy: c, expected: e, actual: a, diff: a - e });
  }
  const fillIds = new Set(expected.keys());
  const unmatchedBills = byId ? sb.filter((b) => !fillIds.has(b.tradeId)).length : null;
  return { status: diffs.length || unmatchedFills || unmatchedBills ? 'DIFF' : 'OK', diffs, unmatchedFills, unmatchedBills, matchedBy: byId ? 'tradeId' : 'total' };
}

/** Balance.openAvgPx(OKX 계산 평균단가, USD) vs 우리 평균단가. 견적통화가 USD 계열일 때만 비교한다. */
function verifyAvg(holdings, balances) {
  if (!balances || balances.length === 0) return { status: null, note: 'Balance 없음: 평균단가를 대조하지 않음' };
  const items = [];
  for (const h of holdings) {
    if (h.avgPx == null) continue;
    const b = balances.find((x) => x.ccy === h.base);
    if (!b || b.openAvgPx == null) { items.push({ instId: h.instId, reason: 'Balance에 openAvgPx 없음' }); continue; }
    if (!STABLE.has(h.quote)) { items.push({ instId: h.instId, reason: `견적통화 ${h.quote}: USD 비교 불가` }); continue; }
    const ok = near(h.avgPx, b.openAvgPx, 1e-4);
    items.push({ instId: h.instId, expected: b.openAvgPx, actual: h.avgPx, diff: h.avgPx - b.openAvgPx, ok });
  }
  const cmp = items.filter((i) => i.ok !== undefined);
  return { status: cmp.length === 0 ? null : cmp.every((i) => i.ok) ? 'OK' : 'DIFF', items };
}
