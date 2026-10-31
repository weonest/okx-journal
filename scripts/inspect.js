// data/okx-*.json 집계만 출력한다. 개별 행·ID 값은 출력하지 않는다.
import { readFileSync, existsSync } from 'node:fs';

const load = (n) => (existsSync(`data/okx-${n}.json`) ? JSON.parse(readFileSync(`data/okx-${n}.json`, 'utf8')) : []);
const bills = load('bills'), fills = load('fills'), orders = load('orders'), pos = load('positions');
const ph = load('positionHistory'), inst = load('instruments'), subtypes = load('subtypes');
const count = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
const show = (title, rows) => { console.log(`\n## ${title}`); for (const [k, v] of rows) console.log(`${k}\t${v}`); };

console.log(`건수 bills=${bills.length} fills=${fills.length} orders=${orders.length} positions=${pos.length} positionHistory=${ph.length}`);

// type/subType 설명
const desc = new Map();
for (const t of subtypes) for (const s of t.subTypeDetails ?? []) desc.set(`${t.type}/${s.subType}`, `${t.typeDesc} - ${s.subTypeDesc}`);
show('type/subType 건수 (설명)', count(bills, (b) => `${b.type}/${b.subType} ${desc.get(`${b.type}/${b.subType}`) ?? '(설명 없음)'}`));
show('instType 건수 (bills)', count(bills, (b) => b.instType ?? '(없음)'));
show('수수료 통화 (fills: instType/feeCcy)', count(fills, (f) => `${f.instType}/${f.feeCcy}`));
show('수수료 부호 (fills: instType, 음수/양수/0)', count(fills, (f) => `${f.instType}/${f.fee < 0 ? '음수' : f.fee > 0 ? '양수' : '0'}`));
show('posSide (orders)', count(orders, (o) => o.posSide ?? '(없음)'));
show('posSide (positionHistory)', count(ph, (p) => p.posSide));
show('mgnMode (bills)', count(bills, (b) => b.mgnMode ?? '(없음)'));
const idShape = (v) => (v == null || v === '' ? '(없음)' : `len${String(v).length}${/^\d+$/.test(String(v)) ? '-digits' : '-mixed'}`);
show('ID 형식 billId/ordId/tradeId', [...count(bills, (b) => 'bill ' + idShape(b.billId)), ...count(orders, (o) => 'ord ' + idShape(o.ordId)), ...count(fills, (f) => 'trade ' + idShape(f.tradeId))]);
show('inverse 여부 (instruments ctType)', count(inst.filter((i) => i.instType === 'FUTURES'), (i) => `${i.ctType}/${i.settleCcy}`));
show('inverse 사용 (bills ccy, FUTURES)', count(bills.filter((b) => b.instType === 'FUTURES'), (b) => b.ccy ?? '(없음)'));

// posBal 의미: subType+sz 누적(롱 +, 숏 -)과 posBal 비교. 거래 계열 subType 3~6만.
const SIGN = { 3: 1, 4: -1, 5: -1, 6: 1 }; // 3 롱진입 4 숏진입 5 롱청산 6 숏청산 → 순포지션(롱+, 숏-)
const lp = { 3: 1, 4: 1, 5: -1, 6: -1 };    // 방향 무시 크기 누적
const byInst = new Map();
for (const b of bills.filter((x) => x.instType === 'FUTURES' && SIGN[b.subType] && b.sz != null && b.posBal != null)) {
  if (!byInst.has(b.instId)) byInst.set(b.instId, []);
  byInst.get(b.instId).push(b);
}
let rows = 0, eqNet = 0, eqAbs = 0, eqSize = 0;
for (const arr of byInst.values()) {
  arr.sort((a, b) => a.ts - b.ts);
  let net = 0, mag = 0;
  for (const b of arr) {
    net += SIGN[b.subType] * b.sz; mag += lp[b.subType] * b.sz; rows++;
    if (b.posBal === net) eqNet++;
    if (Math.abs(b.posBal) === Math.abs(net)) eqAbs++;
    if (b.posBal === mag) eqSize++;
  }
}
console.log(`\n## posBal vs 누적 수량 (FUTURES 거래 행 ${rows}건, 종목 ${byInst.size}개; 구간 시작 이전 포지션이 있으면 어긋남)`);
console.log(`순포지션 일치 ${eqNet} / |순포지션| 일치 ${eqAbs} / 방향무시 크기 일치 ${eqSize}`);
const sameAsSz = bills.filter((b) => b.posBalChg != null && b.sz != null && SIGN[b.subType]);
console.log(`|posBalChg| == sz 인 거래 행: ${sameAsSz.filter((b) => Math.abs(b.posBalChg) === b.sz).length} / ${sameAsSz.length}`);
