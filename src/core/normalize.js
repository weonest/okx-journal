/**
 * 공통 레코드 정의. 필드명은 docs/CSV.md · docs/OKX_API.md의 공통 필드명을 따른다.
 * 모든 레코드: source('csv'|'archive'|'api'), ts(UTC ms), instType('FUTURES'|'SPOT'|'MARGIN'|string|null).
 * 숫자 필드는 number, 빈 값·"--"는 null. 시간은 내부에서 UTC ms.
 *
 * @typedef {'csv'|'archive'|'api'} Source
 * @typedef {{source:Source, ts:number|null, instType:string|null}} Base
 * @typedef {Base & {ordId:string, instId:string, lever:number|null, side:string, posSide:string|null,
 *   ordType:string, sz:number|null, accFillSz:number|null, szUnit:string, px:number|null, avgPx:number|null,
 *   pnl:number|null, fee:number|null, feeCcy:string, state:string, botId:string}} Order
 * @typedef {Base & {ordId:string, tradeId:string, instId:string, fillSz:number|null, szUnit:string,
 *   fillPx:number|null, notional:number|null, notionalCcy:string, execType:string, fee:number|null, feeCcy:string}} Fill
 * @typedef {Base & {billId:string, ordId:string, type:string|null, subType:string, instId:string, sz:number|null,
 *   szUnit:string|null, px:number|null, pnl:number|null, fee:number|null, feeCcy:string|null,
 *   posBalChg:number|null, posBal:number|null, balChg:number|null, bal:number|null, ccy:string|null,
 *   pxUsd?:number|null, pnlUsd?:number|null, feeUsd?:number|null, balUsd?:number|null, balChgUsd?:number|null}} Bill
 * @typedef {Base & {posId:string, cTime:number|null, uTime:number|null, uly:string, instId:string, mgnMode:string,
 *   posSide:string, lever:number|null, pos:number|null, margin:number|null, ccy:string, avgPx:number|null,
 *   markPx:number|null, ctVal:number|null, ctValCcy:string, ctMult:number|null, snapshotTs:number|null}} Position
 * @typedef {Base & {posId:string, instId:string, closeTs:number|null}} PositionHistory  // API 전용(2단계)
 * @typedef {Base & {ccy:string, bal:number|null, availBal:number|null}} Balance           // API 전용(2단계)
 */

/** @param {unknown} v @returns {number|null} */
export function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '' || s === '--') return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const strOrNull = (v) => { const s = str(v); return s === '' || s === '--' ? null : s; };

/**
 * "YYYY-MM-DD HH:mm:ss"(또는 / 구분, T 구분) → UTC ms. offsetHours: 해당 시각의 UTC 오프셋(UTC+8이면 8).
 * offsetHours가 null이면 시간대를 알 수 없으므로 null.
 */
export function parseTime(v, offsetHours) {
  const s = str(v);
  if (s === '' || s === '--' || offsetHours === null || offsetHours === undefined) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!m) return null;
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), ms) - offsetHours * 3600000;
}

/** 메타 행에서 시간대(UTC+8, UTC-5 등)를 찾는다. 없으면 null. */
export function tzFromMeta(meta) {
  if (!meta) return null;
  const m = meta.join(' ').match(/UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0));
}

/** "Open long" 같은 값을 side/posSide로 분리. 해당 없으면 side만 원문 소문자. */
function splitSide(raw) {
  const s = str(raw).toLowerCase();
  const m = s.match(/^(open|close)\s+(long|short)$/);
  if (m) return { side: m[1] === 'open' ? (m[2] === 'long' ? 'buy' : 'sell') : (m[2] === 'long' ? 'sell' : 'buy'), posSide: m[2] };
  return { side: s, posSide: null };
}

/**
 * 종류별 CSV 행 → 공통 레코드. 기본키 중복은 먼저 나온 행을 남기고 건수를 센다.
 * A·B의 시간대는 미확인이므로 opts.tzOffsetHours 또는 메타 행의 UTC±N을 쓴다. 둘 다 없으면 ts는 null이다.
 * C·D는 UTC+8 고정, E는 UTC ms.
 * @param {'A'|'B'|'C'|'D'|'E'} kind
 * @param {Record<string,string>[]} rows
 * @param {{meta?:string[]|null, tzOffsetHours?:number|null, subtypes?:object[]}} [opts]
 * @returns {{records:object[], duplicates:number, tsMissing:number}}
 */
/** /account/subtypes 응답([{type, subTypeDetails:[{subType}]}]) → Map(subType → type) */
export function subtypeMap(list) {
  const m = new Map();
  for (const t of Array.isArray(list) ? list : [])
    for (const d of t.subTypeDetails ?? []) m.set(String(d.subType), String(t.type));
  return m;
}

export function fromCsv(kind, rows, opts = {}) {
  const tz = opts.tzOffsetHours ?? tzFromMeta(opts.meta);
  const map = MAPPERS[kind];
  if (!map) throw new Error(`알 수 없는 종류: ${kind}`);
  const typeBySub = kind === 'E' ? subtypeMap(opts.subtypes) : null;
  const seen = new Set();
  const records = [];
  let duplicates = 0, tsMissing = 0;
  for (const r of rows) {
    const rec = map.fn(r, tz);
    if (typeBySub) {
      rec.type = rec.type ?? typeBySub.get(rec.subType) ?? null;
      rec.instType = instTypeOf(rec.instType); // SWAP → FUTURES
    }
    const key = rec[map.key];
    if (key === '' || key === null) continue; // 기본키 없는 행(합계 등)은 버린다
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    if (rec.ts === null && kind !== 'D') tsMissing++;
    records.push(rec);
  }
  return { records, duplicates, tsMissing };
}

const instTypeOf = (v) => {
  const s = str(v).toUpperCase();
  if (s === '') return null;
  if (/FUTURES|SWAP|PERP/.test(s)) return 'FUTURES';
  if (s.includes('MARGIN')) return 'MARGIN';
  if (s.includes('SPOT')) return 'SPOT';
  return s; // 모르는 값은 원문 유지 (docs/CSV.md: 확인 필요)
};

const MAPPERS = {
  A: {
    key: 'ordId',
    fn: (r, tz) => ({
      source: 'csv', ts: parseTime(r['Order Time'], tz), instType: instTypeOf(r['Instrument']),
      ordId: str(r['Order ID']), instId: str(r['Symbol']), lever: num(r['Lvg']),
      ...splitSide(r['Side']), ordType: str(r['Order Type']).toLowerCase(),
      sz: num(r['Order Amount']), accFillSz: num(r['Filled Amount']), szUnit: str(r['Amount Unit']),
      px: num(r['Order Price']), avgPx: num(r['Avg. Filled Price']),
      pnl: num(r['PNL']), fee: num(r['Fee']), feeCcy: str(r['Fee Unit']),
      state: str(r['Status']).toLowerCase(), botId: str(r['Bot ID']),
    }),
  },
  B: {
    key: 'tradeId',
    fn: (r, tz) => ({
      source: 'csv', ts: parseTime(r['Trade Time'], tz), instType: instTypeOf(r['Instrument']),
      ordId: str(r['Order ID']), tradeId: str(r['Trade ID']), instId: str(r['Symbol']),
      fillSz: num(r['Filled Amount']), szUnit: str(r['Filled Amount Unit']), fillPx: num(r['Filled Price']),
      notional: num(r['Trading Volume']), notionalCcy: str(r['Trading Volume Unit']),
      execType: str(r['taker/maker']).toUpperCase().slice(0, 1), fee: num(r['Fee']), feeCcy: str(r['Fee Unit']),
    }),
  },
  C: {
    key: 'billId',
    fn: (r) => ({
      source: 'csv', ts: parseTime(r['Time'], 8), instType: instTypeOf(r['Trade Type']),
      billId: str(r['id']), ordId: str(r['Order id']), type: strOrNull(r['Trade Type']),
      subType: str(r['Action']), instId: str(r['Symbol']), sz: num(r['Amount']), szUnit: strOrNull(r['Trading Unit']),
      px: num(r['Filled Price']), pnl: num(r['PnL']), fee: num(r['Fee']), feeCcy: strOrNull(r['Fee Unit']),
      posBalChg: num(r['Position Change']), posBal: num(r['Position Balance']),
      balChg: num(r['Balance Change']), bal: num(r['Balance']), ccy: strOrNull(r['Balance Unit']),
      pxUsd: num(r['Filled_price-USD']), pnlUsd: num(r['Pnl-USD']), feeUsd: num(r['Fee-USD']),
      balUsd: num(r['Balance-USD']), balChgUsd: num(r['Balance_change-USD']),
    }),
  },
  D: {
    key: 'posId',
    fn: (r) => ({
      source: 'csv', ts: parseTime(r['Snapshot time'], 8), instType: instTypeOf(r['Business Line']),
      posId: str(r['Position ID']), cTime: parseTime(r['Position Create Time'], 8),
      uTime: parseTime(r['Position Update Time'], 8), uly: str(r['Index']), instId: str(r['Instrument Name']),
      mgnMode: str(r['Margin Mode']).toLowerCase(), posSide: str(r['Direction']).toLowerCase(),
      lever: num(r['Leverage']), pos: num(r['Position size']), margin: num(r['Margin Amount']),
      ccy: str(r['Margin Currency']), avgPx: num(r['Average Open Price']), markPx: num(r['Mark Price']),
      ctVal: num(r['Contract Face Value']), ctValCcy: str(r['Contract Face Value Currency']),
      ctMult: num(r['Contract Multiplier']), snapshotTs: parseTime(r['Snapshot time'], 8),
    }),
  },
  E: {
    key: 'billId',
    fn: (r) => ({
      source: 'archive', ts: num(r['ts']), instType: strOrNull(r['instType']),
      billId: str(r['billId']), ordId: str(r['ordId']), type: strOrNull(r['type']), subType: str(r['subType']),
      instId: str(r['instId']), sz: num(r['sz']), szUnit: null, px: num(r['px']), pnl: num(r['pnl']),
      fee: num(r['fee']), feeCcy: null, posBalChg: num(r['posBalChg']), posBal: num(r['posBal']),
      balChg: num(r['balChg']), bal: num(r['bal']), ccy: strOrNull(r['ccy']),
      mgnMode: strOrNull(r['mgnMode']), execType: strOrNull(r['execType']), interest: num(r['interest']),
    }),
  },
};
