/**
 * Bill type/subType → 이벤트 분류 + 포지션 수량 효과. 근거: docs/subtypes.json (OKX /account/subtypes).
 * posBal은 의미가 확인되기 전까지 쓰지 않는다.
 * @typedef {'TRADE'|'INTEREST'|'DELIVERY'|'FUNDING'|'TRANSFER'|'LIQUIDATION'|'ADL'|'OTHER'|'UNKNOWN'} EventType
 * @typedef {{event:EventType, qty:1|-1|0, posSide:'long'|'short'|'net'|null, known:boolean}} Classified
 */

const TYPE_EVENT = {
  '2': 'TRADE', '14': 'TRADE', '3': 'DELIVERY', '5': 'LIQUIDATION', '9': 'ADL', '7': 'INTEREST', '8': 'FUNDING',
  '1': 'TRANSFER', '6': 'TRANSFER', '12': 'TRANSFER', '15': 'TRANSFER', '16': 'TRANSFER', '33': 'TRANSFER',
};
const OTHER_TYPES = new Set(['4', '10', '11', '13', '20', '22', '24', '26', '27', '28', '29', '30', '32', '34', '35', '37', '38', '250', '251']);

/** subType → [수량 효과, 포지션 방향]. sz는 항상 양수로 들어온다. */
const QTY = {};
const add = (subs, qty, side) => subs.forEach((s) => { QTY[s] = [qty, side]; });
add(['3', '206'], 1, 'long');
add(['4', '207'], 1, 'short');
add(['5', '100', '104', '112', '125', '208'], -1, 'long');
add(['6', '101', '105', '113', '126', '209'], -1, 'short');
add(['1', '204', '102', '106', '127'], 1, 'net');
add(['2', '205', '103', '107', '128'], -1, 'net');

/** 수량에 영향이 없는 것으로 확인된 청산·정산 계열 subType */
const NO_QTY = new Set(['117', '170', '171', '172', '414', '415', '16', '17', '110', '111', '116', '313', '314', '315', '316', '317']);

/**
 * @param {{type?:string|number|null, subType?:string|number|null}} bill
 * @returns {Classified}
 */
export function classify(bill) {
  const type = bill.type == null || bill.type === '' ? null : String(bill.type);
  const sub = bill.subType == null ? '' : String(bill.subType);
  const q = QTY[sub];

  // type을 모르면(일부 CSV) 수량 표에 있는 subType으로만 판정한다.
  if (type == null) {
    if (q) return { event: 'TRADE', qty: q[0], posSide: q[1], known: true };
    return { event: 'UNKNOWN', qty: 0, posSide: null, known: false };
  }
  if (OTHER_TYPES.has(type)) return { event: 'OTHER', qty: 0, posSide: null, known: true };
  const event = TYPE_EVENT[type];
  if (!event) return { event: 'UNKNOWN', qty: 0, posSide: null, known: false };

  if (event === 'TRADE' || event === 'DELIVERY' || event === 'LIQUIDATION' || event === 'ADL') {
    if (q) {
      return { event, qty: q[0], posSide: q[1], known: true };
    }
    if (NO_QTY.has(sub)) return { event, qty: 0, posSide: null, known: true };
    return { event: 'UNKNOWN', qty: 0, posSide: null, known: false };
  }
  return { event, qty: 0, posSide: null, known: true };
}

/** 포지션 키: 롱/숏 분리 모드는 instId|long|short, 단방향은 instId */
export const positionKey = (instId, posSide) => (posSide === 'long' || posSide === 'short' ? `${instId}|${posSide}` : instId);
