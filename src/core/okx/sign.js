// OKX 서명: Base64(HMAC_SHA256(secret, ts + METHOD + path(쿼리 포함) + body)). Web Crypto 사용.

/** @param {number|Date} t @returns {string} UTC ISO 밀리초 */
export function isoTs(t) {
  return new Date(t).toISOString();
}

export async function sign(secret, ts, method, path, body = '') {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ts + method.toUpperCase() + path + body)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}
