// 동기화: 최근(3일/7일) + 3개월 archive 엔드포인트를 모두 받아 합친다. 증분은 begin(ms)으로.
import { mapOrder, mapFill, mapBill, mapPosition, mapPositionHistory, mapBalance, mapInstrument } from './mapApi.js';
import { mergeRecords } from '../merge.js';

// API instType 값. FUTURES(앱) = SWAP + FUTURES(API)
export const API_TYPES = ['SWAP', 'FUTURES', 'SPOT', 'MARGIN'];
const POS_TYPES = ['SWAP', 'FUTURES', 'MARGIN'];

/**
 * @param {ReturnType<import('./client.js').createClient>} c
 * @param {{since?:number|null, onProgress?:(label:string, n:number)=>void}} [o] since: 마지막 동기화 ts(ms) 이후만
 */
export async function syncAll(c, o = {}) {
  const begin = o.since ?? undefined;
  const prog = (l, n) => o.onProgress?.(l, n);
  const out = { orders: [], fills: [], bills: [], positions: [], positionHistory: [], balance: [], instruments: [] };

  for (const instType of API_TYPES) {
    for (const path of ['/api/v5/trade/orders-history', '/api/v5/trade/orders-history-archive']) {
      const d = await c.paginate(path, { instType, begin }, 'ordId');
      out.orders.push(...d.map(mapOrder)); prog(path + ':' + instType, d.length);
    }
    const fh = await c.paginate('/api/v5/trade/fills-history', { instType, begin }, 'billId');
    out.fills.push(...fh.map(mapFill)); prog('fills-history:' + instType, fh.length);
  }
  const fr = await c.paginate('/api/v5/trade/fills', { begin }, 'billId');
  out.fills.push(...fr.map(mapFill)); prog('fills', fr.length);

  for (const path of ['/api/v5/account/bills', '/api/v5/account/bills-archive']) {
    const d = await c.paginate(path, { begin }, 'billId');
    out.bills.push(...d.map(mapBill)); prog(path, d.length);
  }
  for (const instType of POS_TYPES) {
    out.positions.push(...(await c.get('/api/v5/account/positions', { instType })).map(mapPosition));
    const ph = await c.paginate('/api/v5/account/positions-history', { instType }, 'uTime');
    out.positionHistory.push(...ph.map(mapPositionHistory)); prog('positions-history:' + instType, ph.length);
  }
  const bal = await c.get('/api/v5/account/balance');
  out.balance = mapBalance(bal[0]);
  for (const instType of API_TYPES) {
    out.instruments.push(...(await c.get('/api/v5/public/instruments', { instType })).map(mapInstrument));
  }
  out.subtypes = await c.get('/api/v5/account/subtypes');

  // 같은 출처 안 중복(최근/archive 겹침) 제거
  out.orders = mergeRecords(out.orders, 'Order').records;
  out.fills = mergeRecords(out.fills, 'Fill').records;
  out.bills = mergeRecords(out.bills, 'Bill').records;
  out.positionHistory = mergeRecords(out.positionHistory, 'PositionHistory').records;
  return out;
}

/** 다음 증분 동기화 기준: 받은 레코드 중 가장 큰 ts */
export function lastTs(out) {
  let m = null;
  for (const k of ['orders', 'fills', 'bills']) for (const r of out[k]) if (r.ts != null && (m === null || r.ts > m)) m = r.ts;
  return m;
}
