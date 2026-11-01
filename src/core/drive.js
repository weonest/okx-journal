// Google Drive appDataFolder 동기화(복기 공유용). fetch와 토큰은 주입받는다(실제 네트워크는 UI가 넘긴다).
const API = 'https://www.googleapis.com/drive/v3/files';
const UP = 'https://www.googleapis.com/upload/drive/v3/files';
export const REVIEWS_FILE = 'reviews.json';

export class DriveAuthError extends Error { constructor() { super('Google 로그인이 만료되었습니다'); this.code = 401; } }

/** @param {typeof fetch} fetch @param {() => string|null} getToken */
export function createDrive(fetch, getToken) {
  const call = async (url, init = {}) => {
    const tok = getToken();
    if (!tok) throw new DriveAuthError();
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + tok } });
    if (r.status === 401) throw new DriveAuthError();
    if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  const multipart = (meta, body, mime) => {
    const b = 'okxj' + Math.random().toString(36).slice(2);
    const blob = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, body, `\r\n--${b}--`]);
    return { body: blob, headers: { 'Content-Type': `multipart/related; boundary=${b}` } };
  };
  return {
    /** 이름으로 appDataFolder 파일 찾기 → { id, modifiedTime } | null */
    async find(name) {
      const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
      const j = await (await call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=10`)).json();
      return j.files?.[0] ?? null;
    },
    async getJson(id) { return (await call(`${API}/${id}?alt=media`)).json(); },
    async getBlob(id) { return (await call(`${API}/${id}?alt=media`)).blob(); },
    /** JSON 쓰기: id가 있으면 덮어쓰고, 없으면 appDataFolder에 만든다. → id */
    async putJson(id, name, obj) {
      const text = JSON.stringify(obj);
      if (id) { await call(`${UP}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }); return id; }
      const m = multipart({ name, parents: ['appDataFolder'] }, text, 'application/json');
      return (await (await call(`${UP}?uploadType=multipart&fields=id`, { method: 'POST', ...m })).json()).id;
    },
    /** 새 파일(이미지 등) 올리기 → id */
    async putBlob(name, blob, mime) {
      const m = multipart({ name, parents: ['appDataFolder'] }, blob, mime);
      return (await (await call(`${UP}?uploadType=multipart&fields=id`, { method: 'POST', ...m })).json()).id;
    },
    async del(id) { await call(`${API}/${id}`, { method: 'DELETE' }); },
  };
}

/**
 * 거래별 복기 병합: 같은 거래는 updatedAt이 더 큰 쪽을 남긴다(같으면 로컬).
 * @returns {{ merged: Record<string, any>, pulled: number, pushed: number }} pulled=원격이 이긴 수, pushed=로컬에만 있거나 로컬이 이긴 수
 */
export function mergeReviews(local, remote) {
  const merged = {};
  let pulled = 0, pushed = 0;
  for (const id of new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])) {
    const a = local?.[id], b = remote?.[id];
    if (a && b) {
      const ta = a.updatedAt ?? 0, tb = b.updatedAt ?? 0;
      if (tb > ta) { merged[id] = b; pulled++; } else { merged[id] = a; if (ta > tb) pushed++; }
    } else if (a) { merged[id] = a; pushed++; } else { merged[id] = b; pulled++; }
  }
  return { merged, pulled, pushed };
}

/** 클라우드용: 이미지 원본(src)은 빼고 id·fileId만 남긴다. */
export function forCloud(reviews) {
  const out = {};
  for (const [id, r] of Object.entries(reviews ?? {})) out[id] = { ...r, images: (r.images ?? []).map(({ src, ...im }) => im) };
  return out;
}

/** 아직 올리지 않은 이미지 목록 → [{ tradeId, img }] */
export const pendingImages = (reviews) => Object.entries(reviews ?? {}).flatMap(([tradeId, r]) => (r.images ?? []).filter((im) => !im.fileId).map((img) => ({ tradeId, img })));
