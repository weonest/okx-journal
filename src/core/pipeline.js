// 원본 레코드 → 병합 → 원장 → 포지션/현물 → 지표. 화면은 이 결과만 읽는다(UI에서 계산하지 않는다).
import { parseOkxFile, detectKind } from './csv.js';
import { fromCsv } from './normalize.js';
import { mergeRecords } from './merge.js';
import { buildLedger } from './ledger.js';
import { buildPositions } from './positions.js';
import { buildSpot } from './spot.js';
import { buildOrders } from './orders.js';
import { buildMetrics } from './metrics.js';

/** CSV 양식 → 레코드 종류. E(아카이브)는 Bill */
export const KIND_OF = { A: 'Order', B: 'Fill', C: 'Bill', D: 'PositionHistory', E: 'Bill' };
export const emptyRaw = () => ({ Order: [], Fill: [], Bill: [], PositionHistory: [], Position: [], balance: [], instruments: [], subtypes: [] });

/**
 * CSV 파일 여러 개 → 종류별 레코드. 파일 하나가 실패해도 나머지는 계속한다.
 * @param {{name:string, text:string}[]} files
 * @param {{tzOffsetHours?:number|null, subtypes?:object[]}} [opts]
 */
export function ingestCsv(files, opts = {}) {
  const raw = emptyRaw();
  const info = [];
  for (const f of files) {
    try {
      const { meta, headers, rows } = parseOkxFile(f.text);
      const kind = detectKind(headers);
      const r = fromCsv(kind, rows, { meta, tzOffsetHours: opts.tzOffsetHours, subtypes: opts.subtypes });
      raw[KIND_OF[kind]].push(...r.records);
      info.push({ name: f.name, kind, rows: rows.length, records: r.records.length, duplicates: r.duplicates, tsMissing: r.tsMissing, error: null });
    } catch (e) {
      info.push({ name: f.name, kind: null, rows: 0, records: 0, duplicates: 0, tsMissing: 0, error: e.message });
    }
  }
  return { raw, info };
}

/** syncAll() 결과 → raw (API 레코드) */
export function fromApi(out) {
  return {
    ...emptyRaw(), Order: out.orders ?? [], Fill: out.fills ?? [], Bill: out.bills ?? [], PositionHistory: out.positionHistory ?? [],
    Position: out.positions ?? [], balance: out.balance ?? [], instruments: out.instruments ?? [], subtypes: out.subtypes ?? [],
  };
}

/** 여러 raw를 이어 붙인다(병합 전) */
export function concatRaw(...raws) {
  const o = emptyRaw();
  for (const r of raws) for (const k of Object.keys(o)) o[k].push(...(r[k] ?? []));
  return o;
}

/**
 * @param {ReturnType<emptyRaw>} raw
 * @param {{usdRate?:Function, notionalOf?:Function}} [opts]
 */
export function analyze(raw, opts = {}) {
  const merged = {};
  const data = {};
  for (const kind of ['Order', 'Fill', 'Bill', 'PositionHistory']) {
    const m = mergeRecords(raw[kind], kind);
    data[kind] = m.records;
    const bySource = {};
    for (const r of raw[kind]) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    merged[kind] = { input: raw[kind].length, output: m.records.length, dropped: m.dropped, ranges: m.ranges, bySource };
  }
  const dust = {};
  for (const i of raw.instruments) if (i.instType === 'SPOT' && i.minSz != null) dust[i.instId] = i.minSz;

  const ledger = buildLedger(data.Bill);
  const positions = buildPositions(ledger.rows, { positionsHistory: data.PositionHistory, openPositions: raw.Position });
  const spot = buildSpot(data.Fill, { dust, bills: data.Bill, balances: raw.balance });
  const orders = buildOrders(data.Order, data.Fill, { bills: data.Bill });
  const trades = [...positions.trades, ...spot.trades];
  const metrics = {};
  for (const f of ['ALL', 'FUTURES', 'SPOT', 'MARGIN']) metrics[f] = buildMetrics(trades, { filter: f, usdRate: opts.usdRate, notionalOf: opts.notionalOf });
  // 종목별·방향별 표용 지표 (같은 buildMetrics를 부분 집합에 적용)
  const groups = { instId: {}, side: {} };
  for (const id of new Set(trades.map((t) => t.instId))) groups.instId[id] = buildMetrics(trades.filter((t) => t.instId === id), { filter: 'ALL' });
  for (const s of ['long', 'short']) groups.side[s] = buildMetrics(trades.filter((t) => t.side === s), { filter: 'ALL' });
  return { data, merged, ledger, positions, spot, orders, trades, metrics, groups };
}
