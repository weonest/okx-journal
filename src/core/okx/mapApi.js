// API JSON(숫자도 문자열) → 공통 레코드 (정의: src/core/normalize.js 상단 JSDoc)
import { num } from '../normalize.js';

const s = (v) => (v === undefined || v === null ? '' : String(v));
const sn = (v) => (v === undefined || v === null || v === '' ? null : String(v));

/** API instType: SWAP·FUTURES는 앱의 FUTURES로 합친다(원본은 rawInstType 필요 시 r에서 확인). */
export const it = (v) => { const x = sn(v); return x === 'SWAP' ? 'FUTURES' : x; };

export const mapOrder = (r) => ({
  source: 'api', ts: num(r.cTime), instType: it(r.instType), ordId: s(r.ordId), instId: s(r.instId),
  lever: num(r.lever), side: s(r.side), posSide: sn(r.posSide), ordType: s(r.ordType),
  sz: num(r.sz), accFillSz: num(r.accFillSz), szUnit: s(r.tgtCcy), px: num(r.px), avgPx: num(r.avgPx),
  pnl: num(r.pnl), fee: num(r.fee), feeCcy: s(r.feeCcy), state: s(r.state), botId: '',
  category: sn(r.category), tdMode: sn(r.tdMode), uTime: num(r.uTime),
});

export const mapFill = (r) => ({
  source: 'api', ts: num(r.ts), instType: it(r.instType), ordId: s(r.ordId), tradeId: s(r.tradeId),
  billId: sn(r.billId), instId: s(r.instId), side: s(r.side), posSide: sn(r.posSide),
  fillSz: num(r.fillSz), szUnit: '', fillPx: num(r.fillPx), notional: null, notionalCcy: '',
  execType: s(r.execType), fee: num(r.fee), feeCcy: s(r.feeCcy), fillPnl: num(r.fillPnl), subType: sn(r.subType),
});

export const mapBill = (r) => ({
  source: 'api', ts: num(r.ts), instType: it(r.instType), billId: s(r.billId), ordId: s(r.ordId),
  type: sn(r.type), subType: s(r.subType), instId: s(r.instId), sz: num(r.sz), szUnit: null, px: num(r.px),
  pnl: num(r.pnl), fee: num(r.fee), feeCcy: sn(r.ccy), // bills의 fee 통화는 ccy
  posBalChg: num(r.posBalChg), posBal: num(r.posBal), balChg: num(r.balChg), bal: num(r.bal), ccy: sn(r.ccy),
  mgnMode: sn(r.mgnMode), execType: sn(r.execType), interest: num(r.interest), tradeId: sn(r.tradeId),
});

export const mapPosition = (r) => ({
  source: 'api', ts: num(r.uTime), instType: it(r.instType), posId: s(r.posId), cTime: num(r.cTime), uTime: num(r.uTime),
  uly: '', instId: s(r.instId), mgnMode: s(r.mgnMode), posSide: s(r.posSide), lever: num(r.lever), pos: num(r.pos),
  margin: num(r.margin), ccy: s(r.ccy), avgPx: num(r.avgPx), markPx: num(r.markPx), upl: num(r.upl), liqPx: num(r.liqPx),
  ctVal: null, ctValCcy: '', ctMult: null, snapshotTs: null,
});

export const mapPositionHistory = (r) => ({
  source: 'api', ts: num(r.uTime), instType: it(r.instType), posId: s(r.posId), instId: s(r.instId), closeTs: num(r.uTime),
  cTime: num(r.cTime), mgnMode: s(r.mgnMode), posSide: s(r.posSide), direction: sn(r.direction), type: sn(r.type),
  openAvgPx: num(r.openAvgPx), closeAvgPx: num(r.closeAvgPx), openMaxPos: num(r.openMaxPos), closeTotalPos: num(r.closeTotalPos),
  pnl: num(r.pnl), fee: num(r.fee), fundingFee: num(r.fundingFee), liqPenalty: num(r.liqPenalty),
  realizedPnl: num(r.realizedPnl), settledPnl: num(r.settledPnl), lever: num(r.lever), ccy: s(r.ccy),
});

/** balance 응답의 data[0] → Balance[] (details 각 통화) */
export const mapBalance = (d) => (d?.details ?? []).map((r) => ({
  source: 'api', ts: num(d.uTime), instType: 'SPOT', ccy: s(r.ccy), bal: num(r.cashBal), availBal: num(r.availBal),
  eq: num(r.eq), eqUsd: num(r.eqUsd), liab: num(r.liab), interest: num(r.interest),
  openAvgPx: num(r.openAvgPx), accAvgPx: num(r.accAvgPx), spotUpl: num(r.spotUpl), spotBal: num(r.spotBal),
}));

export const mapInstrument = (r) => ({
  instId: s(r.instId), instType: it(r.instType), baseCcy: s(r.baseCcy), quoteCcy: s(r.quoteCcy), settleCcy: s(r.settleCcy),
  ctVal: num(r.ctVal), ctMult: num(r.ctMult), ctValCcy: s(r.ctValCcy), ctType: s(r.ctType),
  lotSz: num(r.lotSz), minSz: num(r.minSz), tickSz: num(r.tickSz), expTime: num(r.expTime),
});
