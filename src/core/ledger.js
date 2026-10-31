import { classify, positionKey } from './eventTypes.js';

export const EPS = 1e-8;
const SCOPE = new Set(['FUTURES', 'MARGIN']);

const cmpId = (a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);
const sign = (x) => (x > EPS ? 1 : x < -EPS ? -1 : 0);

/**
 * Bill[] → 시간순 원장 행 + 잔량 효과 + 잔고 대사.
 * 행: { bill, event, key, instId, delta, prev, rem, effect, closeSz, openSz, dir }
 *  effect: OPEN|INCREASE|REDUCE|CLOSE|FLIP|ORPHAN|null. ORPHAN은 열린 기록 없이 나온 청산(조회 기간 이전 포지션).
 *  dir: 이 행 이후(CLOSE·FLIP의 닫히는 쪽은 이전) 포지션 방향 'long'|'short'.
 * @param {import('./normalize.js').Bill[]} bills
 */
export function buildLedger(bills) {
  const seen = new Set();
  const all = [];
  for (const b of bills) {
    if (b.billId) {
      if (seen.has(b.billId)) continue;
      seen.add(b.billId);
    }
    all.push(b);
  }
  all.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || cmpId(String(a.billId ?? ''), String(b.billId ?? '')));

  const rows = [];
  const rem = new Map();
  const unknownMap = new Map();
  const scope = all.filter((b) => SCOPE.has(b.instType));

  for (const bill of scope) {
    const c = classify(bill);
    if (!c.known) {
      const k = `${bill.type ?? ''}/${bill.subType ?? ''}`;
      unknownMap.set(k, (unknownMap.get(k) ?? 0) + 1);
    }
    const row = { bill, event: c.event, key: null, instId: bill.instId, delta: 0, prev: 0, rem: 0, effect: null, closeSz: 0, openSz: 0, dir: null };
    if (c.qty !== 0 && c.posSide && bill.sz != null) {
      const key = positionKey(bill.instId, c.posSide);
      const prev = rem.get(key) ?? 0;
      const delta = c.qty * Math.abs(bill.sz);
      let next = prev + delta;
      let effect;
      let closeSz = 0;
      let openSz = 0;
      if (c.posSide === 'net') {
        if (sign(next) === 0) next = 0;
        if (sign(prev) === 0) { effect = 'OPEN'; openSz = Math.abs(next); }
        else if (sign(next) === 0) { effect = 'CLOSE'; closeSz = Math.abs(prev); }
        else if (sign(next) !== sign(prev)) { effect = 'FLIP'; closeSz = Math.abs(prev); openSz = Math.abs(next); }
        else if (Math.abs(next) > Math.abs(prev)) { effect = 'INCREASE'; openSz = Math.abs(next) - Math.abs(prev); }
        else { effect = 'REDUCE'; closeSz = Math.abs(prev) - Math.abs(next); }
        row.dir = sign(prev) !== 0 ? (prev > 0 ? 'long' : 'short') : next > 0 ? 'long' : 'short';
        row.dirAfter = next > 0 ? 'long' : next < 0 ? 'short' : null;
      } else {
        row.dir = c.posSide;
        row.dirAfter = c.posSide;
        if (next < -EPS || (prev === 0 && delta < 0)) {
          // 열린 기록보다 많이 청산 → 조회 기간 이전에 열린 포지션. 잔량은 0으로 둔다.
          effect = prev === 0 ? 'ORPHAN' : 'CLOSE';
          closeSz = prev;
          next = 0;
        } else {
          if (sign(next) === 0) next = 0;
          if (sign(prev) === 0) { effect = 'OPEN'; openSz = next; }
          else if (next === 0) { effect = 'CLOSE'; closeSz = prev; }
          else if (next > prev) { effect = 'INCREASE'; openSz = next - prev; }
          else { effect = 'REDUCE'; closeSz = prev - next; }
        }
      }
      rem.set(key, next);
      Object.assign(row, { key, delta, prev, rem: next, effect, closeSz, openSz });
    }
    rows.push(row);
  }

  // 잔고 대사: 같은 통화의 직전 bal + balChg = bal (전체 Bill 기준, 이체 포함)
  const balanceIssues = [];
  const lastBal = new Map();
  let balanceSkipped = 0;
  for (const b of all) {
    if (!b.ccy || b.bal == null || b.balChg == null) { balanceSkipped++; continue; }
    if (lastBal.has(b.ccy)) {
      const expect = lastBal.get(b.ccy) + b.balChg;
      if (Math.abs(expect - b.bal) > EPS) {
        balanceIssues.push({ billId: b.billId, ccy: b.ccy, ts: b.ts, expected: expect, actual: b.bal, diff: b.bal - expect });
      }
    }
    lastBal.set(b.ccy, b.bal);
  }

  const unknown = [...unknownMap].map(([k, count]) => {
    const [type, subType] = k.split('/');
    return { type, subType, count };
  });
  const open = Object.fromEntries([...rem].filter(([, v]) => v !== 0));
  return { rows, unknown, balanceIssues, balanceSkipped, open };
}
