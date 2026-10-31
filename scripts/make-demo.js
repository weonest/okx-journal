// 합성 예시 데이터 생성: node scripts/make-demo.js → demo/{order,fills,bills}.csv, demo/extra.json
// 모두 난수(고정 시드)로 만든 가짜 데이터다. 실데이터를 읽지 않는다.
import fs from 'node:fs';

let seed = 20261031;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const TZ = 8 * 3600e3;
const fmt = (ts) => new Date(ts + TZ).toISOString().slice(0, 19).replace('T', ' ');
const r = (v, d = 2) => Number(v.toFixed(d));

const INST = {
  'BTC-USDT-SWAP': { base: 95000, ct: 0.01, szr: [5, 30], tick: 0.1 },
  'ETH-USDT-SWAP': { base: 2800, ct: 0.1, szr: [20, 120], tick: 0.01 },
  'SOL-USDT-SWAP': { base: 150, ct: 1, szr: [50, 400], tick: 0.01 },
};
const START = Date.UTC(2026, 8, 1, 0, 0, 0), DAYS = 58;
let oid = 5000, tid = 9000, bid = 1;
const ev = [], orders = [], fills = [];

function addOrder(o) { orders.push(o); }
function px(base, t) { return base * (1 + 0.08 * Math.sin(t / 3e8) + 0.03 * Math.sin(t / 7e7)); }

const journal = [];
const open = []; // 마지막에 열어 둘 포지션
for (const [id, c] of Object.entries(INST)) {
  let t = START + between(0, 6) * 3600e3;
  const n = id.startsWith('BTC') ? 16 : id.startsWith('ETH') ? 13 : 11;
  for (let i = 0; i < n; i++) {
    t += between(0.6, 3.6) * 86400e3;
    if (t > START + (DAYS - 2) * 86400e3) break;
    const dir = rnd() < 0.58 ? 'long' : 'short';
    const sz = Math.round(between(...c.szr));
    const lever = pick([5, 10, 10, 20]);
    const entry = r(px(c.base, t) * (1 + between(-0.002, 0.002)), 2);
    const win = rnd() < 0.6;
    const mv = (win ? between(0.004, 0.045) : -between(0.003, 0.02)) * (dir === 'long' ? 1 : -1);
    const exit = r(entry * (1 + mv), 2);
    const hold = between(0.3, 30) * 3600e3;
    const maker = rnd() < 0.35;
    const rate = maker ? 0.0002 : 0.0005;
    const mk = (ts0, action, n2, p, pnl) => {
      const ts = Math.round(ts0 / 1000) * 1000;
      const notional = n2 * c.ct * p;
      const fee = -r(notional * rate, 4);
      const ordId = String(oid++), trId = String(tid++);
      addOrder({ ordId, ts, inst: 'Perpetual Futures', sym: id, lever, side: action, type: maker ? 'Limit' : 'Market', sz: n2, fill: n2, unit: 'Cont', px: maker ? p : null, avg: p, pnl, fee, state: 'Filled' });
      fills.push({ trId, ordId, ts, inst: 'Futures', sym: id, sz: n2, px: p, notional: r(notional, 2), role: maker ? 'Maker' : 'Taker', fee });
      ev.push({ ts: ts + 1000, ordId, sym: id, action, sz: n2, px: p, pnl, fee });
    };
    const openAct = dir === 'long' ? 'Open long' : 'Open short', closeAct = dir === 'long' ? 'Close long' : 'Close short';
    mk(t, openAct, sz, entry, 0);
    if (rnd() < 0.55) {
      const st = [pick(['돌파', '눌림목', '역추세', '추세추종'])]; if (rnd() < 0.25) st.push('거래량 급증');
      const mi = !win && rnd() < 0.7 ? [pick(['추격 진입', '손절 지연', '과대 포지션'])] : [];
      journal.push({ pageId: `demo-${journal.length + 1}`, url: null, title: `${id.split('-')[0]} ${dir === 'long' ? '롱' : '숏'} 복기`, date: new Date(Math.round(t / 1000) * 1000).toISOString(), dateEnd: null,
        instId: id.split('-')[0], side: dir === 'long' ? 'LONG' : 'SHORT', strategies: st, reasons: [pick(['20EMA 지지', '지지선 반등', '저항 돌파', '추세선 이탈', '거래량 급증'])], mistakes: mi, grade: win ? pick(['A', 'A', 'B']) : pick(['B', 'C', 'C']), linkId: null,
        body: [`# 진입 근거`, `- ${st[0]} 패턴 확인 후 진입 (레버 ${lever}배)`, win ? '계획대로 청산함.' : mi.length ? `복기: ${mi[0]}이(가) 문제였다.` : '손절 규칙은 지켰다.'] });
    }
    if (i === n - 1 && id !== 'SOL-USDT-SWAP') { open.push({ id, dir, sz, entry, lever, c }); continue; } // 열어 둠
    const pnlOf = (n2, p) => r((p - entry) * n2 * c.ct * (dir === 'long' ? 1 : -1), 4);
    if (sz >= 20 && rnd() < 0.4) {
      const a = Math.round(sz * 0.6), p1 = r(entry + (exit - entry) * 0.6, 2);
      mk(t + hold * 0.6, closeAct, a, p1, pnlOf(a, p1));
      mk(t + hold, closeAct, sz - a, exit, pnlOf(sz - a, exit));
    } else mk(t + hold, closeAct, sz, exit, pnlOf(sz, exit));
    if (rnd() < 0.35) ev.push({ ts: Math.round((t + hold * 0.5 + 60000) / 1000) * 1000, ordId: '', sym: id, action: 'Funding fee', sz: null, px: null, pnl: 0, fee: 0, fund: r(between(-0.6, 0.3), 4) });
  }
}
// 미체결·취소 주문(지정가) 몇 건
for (let i = 0; i < 12; i++) {
  const id = pick(Object.keys(INST)), c = INST[id], ts = START + between(1, DAYS - 1) * 86400e3;
  addOrder({ ordId: String(oid++), ts, inst: 'Perpetual Futures', sym: id, lever: 10, side: pick(['Open long', 'Open short']), type: 'Limit', sz: Math.round(between(...c.szr)), fill: 0, unit: 'Cont', px: r(px(c.base, ts), 2), avg: null, pnl: 0, fee: 0, state: 'Canceled' });
}

// 원장 잔고 누적
ev.sort((a, b) => a.ts - b.ts);
let bal = 5000, posBal = {};
const SUB = { 'Open long': 3, 'Open short': 4, 'Close long': 5, 'Close short': 6 };
const bills = ev.map((e) => {
  const f = e.fund != null;
  const chg = f ? e.fund : r(e.pnl + e.fee, 4);
  bal = r(bal + chg, 4);
  let pc = '', pb = '';
  if (!f) { posBal[e.sym] = (posBal[e.sym] ?? 0) + (e.action.startsWith('Open') ? e.sz : -e.sz); pc = e.action.startsWith('Open') ? e.sz : -e.sz; pb = posBal[e.sym]; }
  return [`E${bid++}`, f ? (chg >= 0 ? 174 : 173) : SUB[e.action], e.ts, chg, pc, bal, pb, f ? '' : e.sz, f ? '' : e.px, 'USDT', f ? '' : e.pnl, f ? '' : e.fee, 'cross', e.sym, e.ordId, f ? '' : 'T'];
});

// 현물(JSON: CSV Fill에는 side가 없어 정규화 레코드로 직접 제공)
const spotFills = [];
const spotOrders = [];
function spot(instId, ts, side, sz, p, feeCcy) {
  const [base, quote] = instId.split('-');
  const ordId = String(oid++), tradeId = String(tid++);
  const notional = r(sz * p, 4);
  const fee = feeCcy === base ? -r(sz * 0.001, 8) : -r(notional * 0.001, 6);
  spotFills.push({ source: 'csv', ts, instType: 'SPOT', ordId, tradeId, instId, side, fillSz: sz, szUnit: base, fillPx: p, notional, notionalCcy: quote, execType: 'Taker', fee, feeCcy: feeCcy ?? quote });
  addOrder({ ordId, ts, inst: 'Spot', sym: instId, lever: 1, side: side === 'buy' ? 'Buy' : 'Sell', type: 'Limit', sz, fill: sz, unit: base, px: p, avg: p, pnl: 0, fee, state: 'Filled', feeUnit: feeCcy ?? quote });
}
const d = (n, h = 10) => START + n * 86400e3 + h * 3600e3;
spot('ETH-USDT', d(3), 'buy', 1.5, 2650, 'USDT'); spot('ETH-USDT', d(6), 'buy', 1.0, 2580, 'USDT'); spot('ETH-USDT', d(12), 'sell', 2.5, 2840, 'USDT');
spot('SOL-USDT', d(9), 'buy', 20, 142, 'SOL'); spot('SOL-USDT', d(15), 'sell', 12, 158, 'USDT'); spot('SOL-USDT', d(21), 'sell', 7.98, 149, 'USDT');
spot('ETH-USDT', d(26), 'buy', 2, 2710, 'USDT'); spot('ETH-USDT', d(33), 'sell', 2, 2560, 'USDT');
spot('BTC-USDT', d(30), 'buy', 0.05, 93500, 'USDT'); spot('BTC-USDT', d(41), 'buy', 0.03, 96800, 'USDT'); // 보유 유지
const btcQty = 0.08, btcAvg = r((0.05 * 93500 + 0.03 * 96800) / 0.08, 4);

const now = START + (DAYS - 0.5) * 86400e3;
const positions = open.map((p) => ({
  source: 'api', ts: now, instType: 'FUTURES', posId: 'demo-' + p.id, cTime: now - 86400e3, uTime: now, uly: p.id.replace('-SWAP', ''), instId: p.id, mgnMode: 'cross',
  posSide: p.dir, lever: p.lever, pos: p.sz, margin: r(p.sz * p.c.ct * p.entry / p.lever, 2), ccy: 'USDT', avgPx: p.entry,
  markPx: r(p.entry * (1 + (rnd() - 0.45) * 0.02), 2), ctVal: p.c.ct, ctValCcy: p.id.split('-')[0], ctMult: 1, snapshotTs: now,
}));
const balance = [{ source: 'api', ts: now, ccy: 'BTC', eq: btcQty, cashBal: btcQty, openAvgPx: btcAvg }];

const q = (s) => (/[",]/.test(String(s)) ? `"${s}"` : String(s ?? '--'));
const csv = (head, rows) => '﻿' + head.join(',') + '\n' + rows.map((x) => x.map((v) => (v === null || v === undefined ? '--' : q(v))).join(',')).join('\n') + '\n';
const meta = 'Exchange,OKX,UID,0000,Timezone,UTC+8\n';
orders.sort((a, b) => a.ts - b.ts);
fs.mkdirSync('demo', { recursive: true });
fs.writeFileSync('demo/order.csv', meta + csv(['Order ID', 'Order Time', 'Instrument', 'Symbol', 'Lvg', 'Side', 'Order Type', 'Order Amount', 'Filled Amount', 'Amount Unit', 'Order Price', 'Avg. Filled Price', 'Price Unit', 'PNL', 'Fee', 'Fee Unit', 'Status', 'Bot ID'],
  orders.map((o) => [o.ordId, fmt(o.ts), o.inst, o.sym, o.lever, o.side, o.type, o.sz, o.fill, o.unit, o.px, o.avg, 'USDT', o.pnl, o.fee, o.feeUnit ?? 'USDT', o.state, ''])));
fs.writeFileSync('demo/fills.csv', meta + csv(['Trade ID', 'Order ID', 'Trade Time', 'Instrument', 'Symbol', 'Filled Amount', 'Filled Amount Unit', 'Filled Price', 'Fill Price Unit', 'Trading Volume', 'Trading Volume Unit', 'taker/maker', 'Fee', 'Fee Unit'],
  fills.map((f) => [f.trId, f.ordId, fmt(f.ts), f.inst, f.sym, f.sz, 'Cont', f.px, 'USDT', f.notional, 'USDT', f.role, f.fee, 'USDT'])));
fs.writeFileSync('demo/bills.csv', 'instType,billId,subType,ts,balChg,posBalChg,bal,posBal,sz,px,ccy,pnl,fee,mgnMode,instId,ordId,execType,interest\n' + bills.map((x) => ['SWAP', x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], x[9], x[10], x[11], x[12], x[13], x[14], x[15], ''].join(',')).join('\n') + '\n');
fs.writeFileSync('demo/journal.json', JSON.stringify({ exportedAt: now, entries: journal }, null, 1)); // 합성 일지(노션 내보내기 형식)
fs.writeFileSync('demo/extra.json', JSON.stringify({ Fill: spotFills, Position: positions, balance }, null, 1));
console.log(`orders ${orders.length} fills ${fills.length} bills ${bills.length} spotFills ${spotFills.length} openPositions ${positions.length}`);
