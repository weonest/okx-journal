// 화면 상태. 키는 기본 sessionStorage, "이 기기에 기억"을 켠 때만 localStorage.
import { linkJournal, journalStats } from '../core/notion.js';
import { emptyRaw, concatRaw, analyze, ingestCsv, fromApi } from '../core/pipeline.js';
import { mergeByTrade, emptyReview } from '../core/review.js';
import { mergeRaw } from '../core/drive.js';

export const S = {
  api: null, csv: emptyRaw(), csvInfo: [], sample: false, result: null, journal: null, linked: null, selTrade: null, jstats: null, lastSync: null, error: null,
  reviews: {}, demoReviews: {}, byTrade: new Map(), // 앱 안 복기(거래 id → 복기). 예시 데이터일 때는 demoReviews(저장 안 함)
  usdRate: null, // 환산 기준 주입 자리(8단계에서는 없음 → USD 합계 '-')
};
const subs = new Set();
export const subscribe = (f) => (subs.add(f), () => subs.delete(f));

export function recompute() {
  try {
    S.result = analyze(concatRaw(S.api ?? emptyRaw(), S.csv), { usdRate: S.usdRate ?? undefined });
    S.error = null;
    relink();
  } catch (e) { S.result = null; S.error = e.message; }
  subs.forEach((f) => f());
  persist();
}

function relink() {
  S.linked = S.journal && S.result ? linkJournal(S.journal.entries, S.result.trades) : null;
  S.byTrade = mergeByTrade(S.linked?.byTrade, reviews());
  S.jstats = S.result && S.byTrade.size ? journalStats(S.byTrade, S.result.trades) : null;
}

// --- 거래별 복기: 사용자가 쓴 내용이므로 "이 기기에 기억"과 상관없이 IndexedDB에 저장한다 ---
export const reviews = () => (S.sample ? S.demoReviews : S.reviews);
export const reviewOf = (id) => ({ ...emptyReview(), ...(reviews()[id] ?? {}) });
let reviewHook = null; // 클라우드 동기화가 등록한다(저장 직후 올리기 예약)
export const setReviewHook = (f) => { reviewHook = f; };
export function saveReview(id, r) {
  reviews()[id] = { ...r, updatedAt: Date.now() };
  if (!S.sample) { tx('readwrite', (st) => st.put(S.reviews, 'reviews')).catch(() => {}); reviewHook?.(); }
  relink(); subs.forEach((f) => f());
}
/** 클라우드 병합 결과로 교체(예시 데이터 중에는 화면을 건드리지 않는다). */
export function replaceReviews(m) {
  S.reviews = m;
  tx('readwrite', (st) => st.put(S.reviews, 'reviews')).catch(() => {});
  if (!S.sample) { relink(); subs.forEach((f) => f()); }
}
// 이미지 원본 캐시(복기에는 id만 둔다)
export const kvGet = (k) => tx('readonly', (st) => st.get(k)).catch(() => null);
export const kvPut = (k, v) => tx('readwrite', (st) => st.put(v, k)).catch(() => {});
export const kvDel = (k) => tx('readwrite', (st) => st.delete(k)).catch(() => {});
export function exportReviews() {
  const blob = new Blob([JSON.stringify({ kind: 'okx-journal-reviews', exportedAt: Date.now(), reviews: S.reviews })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `okx-journal-reviews-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** 백업 불러오기: 같은 거래는 더 최근에 수정한 쪽을 남긴다. 합친 건수를 돌려준다. */
export async function importReviews(file) {
  const j = JSON.parse(await file.text());
  if (j?.kind !== 'okx-journal-reviews' || typeof j.reviews !== 'object') throw new Error('복기 백업 파일이 아닙니다');
  let n = 0;
  for (const [id, r] of Object.entries(j.reviews)) if (!S.reviews[id] || (r.updatedAt ?? 0) > (S.reviews[id].updatedAt ?? 0)) { S.reviews[id] = r; n++; }
  await tx('readwrite', (st) => st.put(S.reviews, 'reviews')).catch(() => {});
  relink(); subs.forEach((f) => f());
  return n;
}
async function loadReviews() {
  try { S.reviews = (await tx('readonly', (st) => st.get('reviews'))) ?? {}; } catch { S.reviews = {}; }
  // 이전 형식(복기 안에 이미지 src)을 캐시로 옮긴다
  let moved = false;
  for (const r of Object.values(S.reviews)) for (const im of r.images ?? []) {
    if (!im.src) continue;
    im.id ??= crypto.randomUUID(); im.fileId ??= null;
    await kvPut('img:' + im.id, im.src); delete im.src; moved = true;
  }
  if (moved) await tx('readwrite', (st) => st.put(S.reviews, 'reviews')).catch(() => {});
}
export async function addJournal(file) {
  const j = JSON.parse(await file.text());
  if (!Array.isArray(j.entries)) throw new Error('notion-export.js가 만든 JSON이 아닙니다(entries 없음)');
  S.journal = j; recompute();
}

// API는 최근 3개월만 주므로 교체하지 않고 기본키로 누적한다(오래된 기록이 사라지지 않게)
export function setApi(out) { S.api = mergeRaw(S.sample ? null : S.api, fromApi(out)); S.lastSync = Date.now(); S.sample = false; save('lastSync', String(S.lastSync), true); recompute(); dataHook?.(); }
let dataHook = null; // 클라우드 동기화가 등록한다(거래 데이터가 바뀌면 올리기 예약)
export const setDataHook = (f) => { dataHook = f; };
export const dataSnapshot = () => ({ api: S.api, csv: S.csv, csvInfo: S.csvInfo, lastSync: S.lastSync });
/** 드라이브와 합친 거래 데이터 반영(예시 데이터 중에는 건드리지 않는다). */
export function replaceData(d) {
  if (S.sample) return;
  S.api = d.api ?? null; S.csv = d.csv ?? emptyRaw(); S.csvInfo = d.csvInfo ?? []; S.lastSync = d.lastSync ?? S.lastSync;
  recompute();
}

export async function addCsv(files) {
  const list = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })));
  const subtypes = S.api?.subtypes?.length ? S.api.subtypes : await loadSubtypes();
  const { raw, info } = ingestCsv(list, { subtypes });
  S.csv = concatRaw(S.sample ? emptyRaw() : S.csv, raw); S.csvInfo = [...(S.sample ? [] : S.csvInfo), ...info]; S.sample = false; recompute(); dataHook?.();
}

async function loadSubtypes() {
  try { const r = await fetch('docs/subtypes.json'); return r.ok ? await r.json() : []; } catch { return []; }
}

export async function loadSample() {
  const names = ['order.csv', 'fills.csv', 'bills.csv'];
  const list = await Promise.all(names.map(async (name) => ({ name, text: await (await fetch('demo/' + name)).text() })));
  const { raw, info } = ingestCsv(list, { subtypes: await loadSubtypes() });
  const extra = await (await fetch('demo/extra.json')).json(); // 현물 체결(side 포함)·열린 포지션·잔고: 합성
  raw.Fill.push(...extra.Fill); raw.Position.push(...extra.Position); raw.balance.push(...extra.balance);
  S.journal = await (await fetch('demo/journal.json')).json();
  S.api = null; S.csv = raw; S.csvInfo = info; S.sample = true; recompute();
}

/** 예시 데이터 켜기/끄기. 끌 때 저장된 실제 데이터(기억 중이면)는 건드리지 않고 되살린다. */
export async function toggleSample() {
  if (!S.sample) return loadSample();
  noPersist = true; // 비운 상태가 저장분을 덮어쓰지 않게 한다
  S.journal = null; S.api = null; S.csv = emptyRaw(); S.csvInfo = []; S.sample = false; S.selTrade = null; S.lastSync = Number(load('lastSync')) || null;
  recompute();
  noPersist = false;
  await restore();
}

export function clearData() { idbDel(); S.journal = null; S.api = null; S.csv = emptyRaw(); S.csvInfo = []; S.sample = false; recompute(); }

// --- 저장소 (키 값은 어디에도 출력하지 않는다) ---
const safe = (f) => { try { return f(); } catch { return null; } };
export function save(name, val, local) { safe(() => (local ? localStorage : sessionStorage).setItem('okx.' + name, val)); }
export function load(name) { return safe(() => sessionStorage.getItem('okx.' + name) ?? localStorage.getItem('okx.' + name)); }
export function loadKeys() { const j = load('keys'); try { return j ? JSON.parse(j) : null; } catch { return null; } }
export function saveKeys(k, remember) {
  safe(() => { sessionStorage.removeItem('okx.keys'); localStorage.removeItem('okx.keys'); });
  save('keys', JSON.stringify(k), remember);
}
export function clearKeys() { safe(() => { sessionStorage.removeItem('okx.keys'); localStorage.removeItem('okx.keys'); }); }
S.lastSync = Number(load('lastSync')) || null;

// --- 이 기기에 기억: 켠 때만 불러온 데이터를 IndexedDB에 저장하고 새로고침 때 복원한다(예시 데이터는 저장하지 않는다) ---
const FLAG = 'okx.remember';
export const isRemembering = () => safe(() => localStorage.getItem(FLAG) === '1') === true;
export function setRemember(on) {
  safe(() => (on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG)));
  if (on) persist(); else idbDel();
}
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('okx-journal', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, f) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const out = f(t.objectStore('kv')); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };
function idbDel() { tx('readwrite', (st) => st.delete('data')).catch(() => {}); }
let noPersist = false;
function persist() {
  if (noPersist || !isRemembering() || S.sample) return;
  const snap = { api: S.api, csv: S.csv, csvInfo: S.csvInfo, journal: S.journal, lastSync: S.lastSync };
  tx('readwrite', (st) => st.put(snap, 'data')).catch(() => {});
}
/** 시작할 때 한 번: 저장된 데이터가 있으면 복원한다. */
export async function restore() {
  await loadReviews();
  if (!isRemembering()) { relink(); subs.forEach((f) => f()); return; }
  try {
    const d = await tx('readonly', (st) => st.get('data'));
    if (!d) return;
    S.api = d.api ?? null; S.csv = d.csv ?? emptyRaw(); S.csvInfo = d.csvInfo ?? []; S.journal = d.journal ?? null; S.lastSync = d.lastSync ?? S.lastSync;
    recompute();
  } catch { /* IndexedDB 사용 불가: 건너뜀 */ }
}
