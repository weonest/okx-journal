// Google Drive 동기화(복기 공유용). fetch와 토큰은 주입받는다(실제 네트워크는 UI가 넘긴다).
// 저장 위치: 내 드라이브의 "OKX Journal" 폴더(drive.file 범위: 이 앱이 만든 파일만 접근).
// 폴더·파일은 이름이 아니라 appProperties 표식(okxj=…)으로 찾으므로 이름을 바꾸거나 옮겨도 이어진다.
import { KEYS } from './merge.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const UP = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
export const ROOT_NAME = 'OKX Journal';
export const IMG_DIR = '이미지';
export const REVIEWS_FILE = 'reviews.json';
export const DATA_FILE = 'okx-data.json';

export class DriveAuthError extends Error { constructor(scope = false) { super(scope ? '권한 범위 부족' : 'Google 로그인이 만료되었습니다'); this.code = scope ? 403 : 401; this.scope = scope; } }

/** @param {typeof fetch} fetch @param {() => string|null} getToken */
export function createDrive(fetch, getToken) {
  const call = async (url, init = {}) => {
    const tok = getToken();
    if (!tok) throw new DriveAuthError();
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + tok } });
    if (r.status === 401) throw new DriveAuthError();
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 403 && /scope|insufficient/i.test(t)) throw new DriveAuthError(true); // 로그인 때 받은 권한이 모자람
      throw new Error(`Drive ${r.status}: ${t.slice(0, 200)}`);
    }
    return r;
  };
  const multipart = (meta, body, mime) => {
    const b = 'okxj' + Math.random().toString(36).slice(2);
    const blob = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, body, `\r\n--${b}--`]);
    return { body: blob, headers: { 'Content-Type': `multipart/related; boundary=${b}` } };
  };
  const list = async (q, spaces = 'drive') =>
    (await (await call(`${API}?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&pageSize=10`)).json()).files ?? [];
  const tagQ = (k) => `appProperties has { key='okxj' and value='${k}' } and trashed=false`;
  const create = async (meta, body, mime) => (await (await call(`${UP}?uploadType=multipart&fields=id`, { method: 'POST', ...multipart(meta, body, mime) })).json()).id;

  return {
    /** 표식으로 찾기 → { id, name, modifiedTime } | null */
    async findTagged(k) { return (await list(tagQ(k)))[0] ?? null; },
    /** 표식 달린 폴더를 찾고 없으면 parent 아래에 만든다 → id */
    async ensureFolder(k, name, parent) {
      const f = (await list(`${tagQ(k)} and mimeType='${FOLDER}'`))[0];
      if (f) return f.id;
      const r = await call(`${API}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent], appProperties: { okxj: k } }) });
      return (await r.json()).id;
    },
    async getJson(id) { return (await call(`${API}/${id}?alt=media`)).json(); },
    async getBlob(id) { return (await call(`${API}/${id}?alt=media`)).blob(); },
    /** JSON 쓰기: id가 있으면 덮어쓰고, 없으면 meta(name·parents·appProperties)로 만든다 → id */
    async putJson(id, meta, obj, pretty = true) {
      const text = JSON.stringify(obj, null, pretty ? 1 : 0);
      if (id) { await call(`${UP}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text }); return id; }
      return create(meta, text, 'application/json');
    },
    /** 새 파일(이미지 등) 올리기 → id */
    putBlob(meta, blob, mime) { return create(meta, blob, mime); },
    async del(id) { await call(`${API}/${id}`, { method: 'DELETE' }); },
    /** 이전 저장 위치(appDataFolder)에서 이름으로 찾기(이전용) */
    async findAppData(name) { return (await list(`name='${name}' and trashed=false`, 'appDataFolder'))[0] ?? null; },
  };
}

/**
 * 거래별 복기 병합: 같은 거래는 updatedAt이 더 큰 쪽을 남긴다.
 * 같으면 원격을 쓴다(같은 저장본이고, 원격에는 업로드된 이미지 fileId가 채워져 있을 수 있다).
 * @returns {{ merged: Record<string, any>, pulled: number, pushed: number }} pulled=원격이 이긴 수, pushed=로컬에만 있거나 로컬이 이긴 수
 */
export function mergeReviews(local, remote) {
  const merged = {};
  let pulled = 0, pushed = 0;
  for (const id of new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])) {
    const a = local?.[id], b = remote?.[id];
    if (a && b) {
      const ta = a.updatedAt ?? 0, tb = b.updatedAt ?? 0;
      if (ta > tb) { merged[id] = a; pushed++; } else { merged[id] = b; if (tb > ta) pulled++; }
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

/** 드라이브에서 알아보기 쉬운 이미지 파일 이름: 거래 id(instId|side#billId) + 짧은 이미지 id */
export const imageName = (tradeId, img) => `${String(tradeId).replace(/[|#/\\:*?"<>]+/g, '_')}_${String(img.id).slice(0, 8)}.jpg`;

// --- 거래 데이터(OKX 동기화·CSV) 누적 병합 ---
const REC = ['Order', 'Fill', 'Bill', 'PositionHistory']; // 쌓이는 기록: 출처+기본키로 합친다
const SNAP = ['Position', 'balance', 'instruments', 'subtypes']; // 현재 상태: 최신 쪽을 쓴다
const recKey = (kind, r) => {
  const k = kind === 'PositionHistory' ? (r.posId ? `${r.posId}|${r.closeTs}` : '') : r[KEYS[kind]];
  return `${r.source}|${k || JSON.stringify(r)}`; // 키가 없으면 내용 전체로 구분
};
const count = (raw) => REC.reduce((n, k) => n + (raw?.[k]?.length ?? 0), 0);

/**
 * 두 raw를 합친다. 쌓이는 기록은 합집합(같은 키는 newer), 현재 상태는 newer가 있으면 newer.
 * API는 최근 3개월만 주므로, 동기화마다 교체하지 않고 이 함수로 누적해야 과거 기록이 남는다.
 */
export function mergeRaw(older, newer) {
  if (!older) return newer ?? null;
  if (!newer) return older;
  const o = {};
  for (const k of REC) {
    const m = new Map();
    for (const r of older[k] ?? []) m.set(recKey(k, r), r);
    for (const r of newer[k] ?? []) m.set(recKey(k, r), r);
    o[k] = [...m.values()];
  }
  for (const k of SNAP) o[k] = newer[k] ?? older[k] ?? [];
  return o;
}

/**
 * 이 기기 데이터와 드라이브 데이터를 합친다. {api, csv, csvInfo, lastSync}
 * @returns {{ data:object, push:boolean, pull:boolean }} push=드라이브에 올릴 게 있음, pull=이 기기에 반영할 게 있음
 */
export function mergeData(local, remote) {
  const L = local ?? {}, R = remote ?? {};
  const lt = L.lastSync ?? 0, rt = R.lastSync ?? 0;
  const api = lt >= rt ? mergeRaw(R.api, L.api) : mergeRaw(L.api, R.api); // 최근에 동기화한 쪽이 newer
  const csv = mergeRaw(R.csv, L.csv);
  const info = new Map([...(R.csvInfo ?? []), ...(L.csvInfo ?? [])].map((i) => [`${i.name}|${i.kind}|${i.records}`, i]));
  const data = { api, csv, csvInfo: [...info.values()], lastSync: Math.max(lt, rt) || null };
  const n = count(api) + count(csv);
  return {
    data,
    push: n > count(R.api) + count(R.csv) || lt > rt || data.csvInfo.length > (R.csvInfo?.length ?? 0),
    pull: n > count(L.api) + count(L.csv) || rt > lt || data.csvInfo.length > (L.csvInfo?.length ?? 0),
  };
}

/** 올릴 만한 거래 데이터가 있는지 */
export const hasData = (d) => count(d?.api) + count(d?.csv) > 0;
