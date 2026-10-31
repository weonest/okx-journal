// OKX REST 클라이언트. fetch는 주입받는다. 키는 인자로만 받고 어디에도 기록하지 않는다.
import { sign, isoTs } from './sign.js';

const BASE = 'https://www.okx.com';
const RETRY_CODES = new Set(['50011', '50013']);

/**
 * @param {{key:string, secret:string, passphrase:string, fetch:typeof fetch, now?:()=>number,
 *   sleep?:(ms:number)=>Promise<void>, gapMs?:number, maxRetry?:number, base?:string}} o
 */
export function createClient(o) {
  const { key, secret, passphrase, fetch: f } = o;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gapMs = o.gapMs ?? 250;
  const maxRetry = o.maxRetry ?? 5;
  const base = o.base ?? BASE;
  let skew = 0; // 서버시간 - 로컬시간

  async function syncTime() {
    const t0 = now();
    const res = await f(base + '/api/v5/public/time');
    const j = await res.json();
    const server = Number(j?.data?.[0]?.ts);
    if (!Number.isFinite(server)) throw new Error('서버 시간 응답 형식 오류');
    skew = server - Math.round((t0 + now()) / 2);
    return skew;
  }

  /** 서명된 GET. 요청 제한(50011/50013, HTTP 429)이면 대기 후 재시도. @returns {Promise<object[]>} data 배열 */
  async function get(path, params = {}) {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const reqPath = qs ? `${path}?${qs}` : path;
    for (let attempt = 0; ; attempt++) {
      const ts = isoTs(now() + skew);
      const res = await f(base + reqPath, {
        method: 'GET',
        headers: {
          'OK-ACCESS-KEY': key,
          'OK-ACCESS-SIGN': await sign(secret, ts, 'GET', reqPath, ''),
          'OK-ACCESS-TIMESTAMP': ts,
          'OK-ACCESS-PASSPHRASE': passphrase,
        },
      });
      let j = null;
      try { j = await res.json(); } catch { /* 본문 없음 */ }
      const limited = res.status === 429 || RETRY_CODES.has(String(j?.code));
      if (limited) {
        if (attempt >= maxRetry) throw new Error(`요청 제한 재시도 초과: ${path}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok || !j || j.code !== '0') {
        throw new Error(`OKX 오류 ${path}: code=${j?.code ?? res.status} msg=${j?.msg ?? ''}`);
      }
      return j.data;
    }
  }

  /**
   * 커서 페이지네이션. 최신순 결과의 마지막 항목 cursorField를 다음 after로 넣는다.
   * 빈 배열이거나 limit보다 적게 오면 끝. maxPages로 폭주 방지.
   */
  async function paginate(path, params, cursorField, { limit = 100, maxPages = 1000, onPage } = {}) {
    const out = [];
    let after;
    for (let p = 0; p < maxPages; p++) {
      const data = await get(path, { ...params, limit, after });
      if (!Array.isArray(data) || data.length === 0) break;
      out.push(...data);
      onPage?.(out.length);
      if (data.length < limit) break;
      const next = data[data.length - 1][cursorField];
      if (!next || next === after) break;
      after = next;
      await sleep(gapMs);
    }
    return out;
  }

  return { syncTime, get, paginate, get skew() { return skew; } };
}
