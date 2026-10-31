// RFC 4180 CSV 파서와 OKX 파일(1행 메타, 2행 헤더) 분리, 양식 판별.

/** @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; }
    else if (c === ',') { row.push(field); field = ''; i++; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else { field += c; i++; }
  }
  if (inQ) throw new Error('CSV: 닫히지 않은 따옴표');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const E_FIELDS = ['billId', 'balChg'];

/**
 * 1행 메타, 2행 헤더. E(아카이브)는 메타 없이 1행이 헤더일 수 있다.
 * @returns {{meta: string[]|null, headers: string[], rows: Record<string,string>[]}}
 */
export function parseOkxFile(text) {
  const all = parseCsv(text);
  if (all.length === 0) throw new Error('CSV: 빈 파일');
  const isE = (r) => E_FIELDS.every((f) => r.includes(f));
  let meta = null, hi = 1;
  if (isE(all[0])) hi = 0;
  else meta = all[0];
  if (all.length <= hi) throw new Error('CSV: 헤더 행이 없음');
  const headers = all[hi].map((h) => h.trim());
  const rows = all.slice(hi + 1).map((r) => {
    const o = {};
    headers.forEach((h, k) => { o[h] = r[k] ?? ''; });
    return o;
  });
  return { meta, headers, rows };
}

/** @returns {'A'|'B'|'C'|'D'|'E'} */
export function detectKind(headers) {
  const h = new Set(headers);
  const has = (...k) => k.every((x) => h.has(x));
  if (has('billId', 'balChg')) return 'E';
  if (has('Order Type', 'Status')) return 'A';
  if (has('Trade ID', 'taker/maker')) return 'B';
  if (has('Position Balance', 'Balance Change')) return 'C';
  if (has('Position ID', 'Mark Price')) return 'D';
  throw new Error('알 수 없는 CSV 양식: 헤더가 A~E 어디에도 맞지 않음');
}
